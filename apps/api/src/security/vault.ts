// apps/api/src/security/vault.ts — AES-256-GCM secret vault (Node built-in crypto).
// NEVER import this from the browser or a Cloudflare Worker.
// The secret_values table is readable only by the service role.
//
// Interface:
//   put(name, value, scope, env, tenantId, ownerId?) → metadata id
//   get(name, env, tenantId) → plaintext (server-only)
//   rotate(metadataId, newValue, tenantId) → void
//   list(tenantId, projectId?) → SecretMetadata[] (no values)
//   del(metadataId, tenantId) → void
//
// NOTE: Replaced libsodium-wrappers with Node's built-in crypto (AES-256-GCM)
// to avoid pnpm virtual-store ESM resolution issues during esbuild bundling.
// AES-256-GCM with a random 12-byte IV and authenticated tag is equivalent in
// security to XSalsa20-Poly1305 for this use case.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db/client';
import { secretMetadata, secretValues } from '@abw/db';
import { eq, and } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

export type SecretMetadataRow = InferSelectModel<typeof secretMetadata>;

const ALGO = 'aes-256-gcm' as const;
const IV_BYTES = 12;   // 96-bit IV — GCM standard
const TAG_BYTES = 16;  // 128-bit auth tag

function getMasterKey(): Buffer {
  const raw = process.env['VAULT_MASTER_KEY'];
  if (!raw) throw new Error('VAULT_MASTER_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('VAULT_MASTER_KEY must be 32 bytes (base64-encoded)');
  return key;
}

function encrypt(plaintext: string): { ciphertext: string; nonce: string } {
  const key = getMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store ciphertext + tag concatenated; nonce stored separately
  const ciphertextWithTag = Buffer.concat([encrypted, tag]);
  return {
    ciphertext: ciphertextWithTag.toString('base64'),
    nonce:      iv.toString('base64'),
  };
}

function decrypt(ciphertext: string, nonce: string): string {
  const key = getMasterKey();
  const iv = Buffer.from(nonce, 'base64');
  const buf = Buffer.from(ciphertext, 'base64');
  if (buf.length < TAG_BYTES) throw new Error('vault: ciphertext too short');
  const tag        = buf.subarray(buf.length - TAG_BYTES);
  const encrypted  = buf.subarray(0, buf.length - TAG_BYTES);
  const decipher   = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('vault: decryption failed — bad key or tampered ciphertext');
  }
}

/** Store a new secret. Returns the metadata ID. */
export async function vaultPut(opts: {
  name: string;
  value: string;
  scope: string;
  env: string;
  tenantId: string;
  projectId?: string;
  ownerId?: string;
}): Promise<string> {
  const db = getDb();
  const { ciphertext, nonce } = encrypt(opts.value);

  const [meta] = await db.insert(secretMetadata).values({
    name:      opts.name,
    scope:     opts.scope,
    env:       opts.env,
    tenantId:  opts.tenantId,
    projectId: opts.projectId ?? null,
    ownerId:   opts.ownerId ?? null,
    lastRotatedAt: new Date(),
  }).returning();
  if (!meta) throw new Error('vault: failed to insert metadata');

  await db.insert(secretValues).values({
    metadataId: meta.id,
    ciphertext,
    nonce,
  });

  return meta.id;
}

/** Retrieve a plaintext secret. Server-side only. */
export async function vaultGet(opts: {
  name: string;
  env: string;
  tenantId: string;
  projectId?: string;
}): Promise<string> {
  const db = getDb();
  const metaRows = await db.select()
    .from(secretMetadata)
    .where(and(
      eq(secretMetadata.name, opts.name),
      eq(secretMetadata.env, opts.env),
      eq(secretMetadata.tenantId, opts.tenantId),
    ));
  const meta = metaRows[0];
  if (!meta) throw new Error(`vault: secret '${opts.name}' not found for env '${opts.env}'`);

  const valRows = await db.select()
    .from(secretValues)
    .where(eq(secretValues.metadataId, meta.id))
    .orderBy(secretValues.createdAt)
    .limit(1);
  const val = valRows[0];
  if (!val) throw new Error(`vault: no value for secret '${opts.name}'`);

  return decrypt(val.ciphertext, val.nonce);
}

/** Rotate an existing secret. Old ciphertext rows are NOT deleted (audit trail). */
export async function vaultRotate(opts: {
  metadataId: string;
  newValue: string;
  tenantId: string;
}): Promise<void> {
  const db = getDb();
  const { ciphertext, nonce } = encrypt(opts.newValue);
  await db.insert(secretValues).values({ metadataId: opts.metadataId, ciphertext, nonce });
  await db.update(secretMetadata)
    .set({ lastRotatedAt: new Date() })
    .where(and(
      eq(secretMetadata.id, opts.metadataId),
      eq(secretMetadata.tenantId, opts.tenantId),
    ));
}

/** List secret metadata for a tenant. Never returns values. */
export async function vaultList(opts: {
  tenantId: string;
  projectId?: string;
}): Promise<SecretMetadataRow[]> {
  const db = getDb();
  return db.select().from(secretMetadata)
    .where(eq(secretMetadata.tenantId, opts.tenantId));
}

/** Soft-delete a secret's metadata (marks deletedAt). Values retained for audit. */
export async function vaultDel(opts: {
  metadataId: string;
  tenantId: string;
}): Promise<void> {
  const db = getDb();
  await db.update(secretMetadata)
    .set({ deletedAt: new Date() })
    .where(and(
      eq(secretMetadata.id, opts.metadataId),
      eq(secretMetadata.tenantId, opts.tenantId),
    ));
}

/** Derive an opaque ref key (for storing in config without the value). */
export function vaultRef(name: string, env: string): string {
  return `vault:${createHash('sha256').update(`${name}:${env}`).digest('hex').slice(0, 16)}`;
}

/** Generate a cryptographically secure token (for webhook signing, etc.). */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}
