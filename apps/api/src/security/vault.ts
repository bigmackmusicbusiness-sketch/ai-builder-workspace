// apps/api/src/security/vault.ts — libsodium sealed-box secret vault.
// NEVER import this from the browser or a Cloudflare Worker.
// The secret_values table is readable only by the service role.
//
// Interface:
//   put(name, value, scope, env, tenantId, ownerId?) → metadata id
//   get(name, env, tenantId) → plaintext (server-only)
//   rotate(metadataId, newValue, tenantId) → void
//   list(tenantId, projectId?) → SecretMetadata[] (no values)
//   del(metadataId, tenantId) → void

import sodium from 'libsodium-wrappers';
import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db/client';
import { secretMetadata, secretValues } from '@abw/db';
import { eq, and } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

export type SecretMetadataRow = InferSelectModel<typeof secretMetadata>;

let _sodiumReady = false;
async function getSodium() {
  if (!_sodiumReady) {
    await sodium.ready;
    _sodiumReady = true;
  }
  return sodium;
}

function getMasterKey(): Uint8Array {
  const raw = process.env['VAULT_MASTER_KEY'];
  if (!raw) throw new Error('VAULT_MASTER_KEY is not set');
  return Buffer.from(raw, 'base64');
}

async function encrypt(plaintext: string): Promise<{ ciphertext: string; nonce: string }> {
  const lib = await getSodium();
  const key = getMasterKey();
  const nonce = lib.randombytes_buf(lib.crypto_secretbox_NONCEBYTES);
  const ct = lib.crypto_secretbox_easy(Buffer.from(plaintext, 'utf8'), nonce, key);
  return {
    ciphertext: Buffer.from(ct).toString('base64'),
    nonce:      Buffer.from(nonce).toString('base64'),
  };
}

async function decrypt(ciphertext: string, nonce: string): Promise<string> {
  const lib = await getSodium();
  const key = getMasterKey();
  const ct = Buffer.from(ciphertext, 'base64');
  const n  = Buffer.from(nonce, 'base64');
  const pt = lib.crypto_secretbox_open_easy(ct, n, key);
  if (!pt) throw new Error('vault: decryption failed — bad key or tampered ciphertext');
  return Buffer.from(pt).toString('utf8');
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
  const { ciphertext, nonce } = await encrypt(opts.value);

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
  const { ciphertext, nonce } = await encrypt(opts.newValue);
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
