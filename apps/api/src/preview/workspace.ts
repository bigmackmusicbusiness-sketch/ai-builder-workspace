// apps/api/src/preview/workspace.ts — per-project file workspace on disk.
// Each project gets an isolated directory under ~/.abw-workspaces/{tenant}/{slug}/.
// The AI's tool calls read/write files here; the preview bundler reads from here.
//
// Security:
//   - Paths are resolved and validated to stay inside the project root.
//   - Absolute or escaping paths (../) are rejected.
//   - Tenant isolation: every call takes tenantId; workspaces never cross tenants.
import { mkdir, readFile, writeFile, stat, readdir, rm, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, relative, sep, dirname } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { emit as emitPreviewEvent } from './eventBus';

/** Root directory for all workspaces on this machine. */
const WORKSPACE_ROOT = join(homedir(), '.abw-workspaces');

/** Files larger than this are rejected for safety. */
const MAX_FILE_BYTES = 1_000_000; // 1 MB

export interface WorkspaceHandle {
  tenantId:    string;
  projectSlug: string;
  rootDir:     string;
}

/** Resolve the on-disk root for a given tenant+slug. Creates it if missing. */
export async function getWorkspace(tenantId: string, projectSlug: string): Promise<WorkspaceHandle> {
  if (!/^[a-z0-9-]+$/.test(projectSlug)) {
    throw new Error(`Invalid project slug: ${projectSlug}`);
  }
  if (!tenantId || tenantId.includes('..') || tenantId.includes(sep)) {
    throw new Error(`Invalid tenant id`);
  }
  const rootDir = join(WORKSPACE_ROOT, tenantId, projectSlug);
  await mkdir(rootDir, { recursive: true });
  return { tenantId, projectSlug, rootDir };
}

/** Resolve a relative path inside the workspace, rejecting escapes. */
function safeResolve(ws: WorkspaceHandle, relPath: string): string {
  // Strip leading slash so it's always treated as relative
  const cleaned = relPath.replace(/^[/\\]+/, '');
  const abs = resolve(ws.rootDir, cleaned);
  const rel = relative(ws.rootDir, abs);
  if (rel.startsWith('..') || resolve(abs) !== abs || rel.includes('..' + sep) || rel === '..') {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
  return abs;
}

/** Does this path exist in the workspace? */
export async function workspaceExists(ws: WorkspaceHandle): Promise<boolean> {
  try {
    const s = await stat(ws.rootDir);
    if (!s.isDirectory()) return false;
    // A workspace is "real" if it has at least one file
    const entries = await readdir(ws.rootDir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/** Write a UTF-8 text file at `path` (relative to workspace root), creating parents as needed. */
export async function writeWorkspaceFile(
  ws: WorkspaceHandle,
  relPath: string,
  content: string,
): Promise<{ bytes: number }> {
  if (content.length > MAX_FILE_BYTES) {
    throw new Error(`File too large (${content.length} bytes, max ${MAX_FILE_BYTES}).`);
  }
  const abs = safeResolve(ws, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
  // Notify preview subscribers so they can hot-reload the iframe.
  emitPreviewEvent(ws.tenantId, ws.projectSlug, { type: 'file-changed', path: relPath });
  return { bytes: Buffer.byteLength(content, 'utf8') };
}

/** Write a binary file (Buffer) at `path` — used for AI-generated images and other assets.
 *
 *  Coolify (and any container deploy) wipes the local filesystem on every
 *  rollout. Without a durable copy, an image generated 30 minutes ago is
 *  gone the moment we redeploy the api. So after writing to disk we also
 *  fire-and-forget a backup to the workspace-backups bucket, mirroring
 *  what writeWorkspaceFile does for text. The restore path below pulls
 *  binaries back when the workspace is empty (post-restart).
 *
 *  Prior to May 2026 this path didn't back up — the comment in the
 *  backup section claimed binaries were "already stored as assets", but
 *  gen_image only writes to the workspace tree, never to the assets
 *  bucket. Every redeploy silently destroyed every AI-generated image
 *  in every project as a result. */
export async function writeWorkspaceFileBuffer(
  ws: WorkspaceHandle,
  relPath: string,
  buffer: Buffer,
): Promise<{ bytes: number }> {
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error(`File too large (${buffer.length} bytes, max ${MAX_FILE_BYTES}).`);
  }
  const abs = safeResolve(ws, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buffer);
  emitPreviewEvent(ws.tenantId, ws.projectSlug, { type: 'file-changed', path: relPath });
  // Fire-and-forget durable backup so the file survives container restarts.
  backupFileBufferToStorage(ws, relPath, buffer).catch(() => { /* non-fatal */ });
  return { bytes: buffer.length };
}

/** Read a file as UTF-8 text. Returns null if it doesn't exist. */
export async function readWorkspaceFile(
  ws: WorkspaceHandle,
  relPath: string,
): Promise<string | null> {
  const abs = safeResolve(ws, relPath);
  try {
    return await readFile(abs, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Delete a file. No-op if missing. */
export async function deleteWorkspaceFile(ws: WorkspaceHandle, relPath: string): Promise<void> {
  const abs = safeResolve(ws, relPath);
  try {
    await unlink(abs);
    emitPreviewEvent(ws.tenantId, ws.projectSlug, { type: 'file-changed', path: relPath });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/** Recursively list all files in the workspace, returning relative paths. */
export async function listWorkspaceFiles(ws: WorkspaceHandle): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try { entries = await readdir(dir); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      const s = await stat(full);
      if (s.isDirectory()) {
        await walk(full);
      } else {
        out.push('/' + relative(ws.rootDir, full).replace(/\\/g, '/'));
      }
    }
  }
  await walk(ws.rootDir);
  return out.sort();
}

/** Wipe the workspace. Used when the user deletes a project. */
export async function clearWorkspace(ws: WorkspaceHandle): Promise<void> {
  await rm(ws.rootDir, { recursive: true, force: true });
}

// ── Supabase Storage backup / restore ─────────────────────────────────────────
// Workspace files (text AND binary) are backed up to Supabase Storage so they
// survive server restarts — Coolify's container filesystem is ephemeral and
// the workspace tree under ~/.abw-workspaces is wiped on every rollout.
//
// IMPORTANT: this bucket MUST be private. Workspace files include tenant
// source code, sometimes with leftover environment-style references, and
// must not be exposed via public URL. Restore uses the service-role key
// to download directly — no signed URLs needed for server-to-server reads.
//
// May 2026 fix: binaries are now backed up alongside text. Before this,
// the comment claimed binaries were "already stored as assets", but
// gen_image (and other binary writers) only hit the workspace filesystem
// — every redeploy silently destroyed every AI-generated image in every
// project. The new write path backs up text + binary alike; the restore
// path reads bytes and dispatches by extension.
//
// See B1 of the security plan: prior versions stored these in
// `project-assets` (a public bucket) which leaked text files to anyone with
// the path. The migration to `workspace-backups` is handled by
// ensureWorkspaceBackupsBucket() below + a one-shot copy script.

export const BACKUP_BUCKET = 'workspace-backups';
const TEXT_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.json',
  '.md', '.txt', '.svg', '.xml', '.yaml', '.yml', '.toml',
  // Note: '.env' deliberately removed — the agent's write_file gate refuses
  // to write .env files in the first place; if one slips through some other
  // path (manual upload), we don't want it backed up to storage.
]);

/** Binary file types we durably back up. SVG is intentionally treated as
 *  text (see TEXT_EXTENSIONS) so it's restored as a string. */
const BINARY_EXTENSIONS: Record<string, string> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.avif': 'image/avif',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.pdf':  'application/pdf',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
};

function isTextFile(relPath: string): boolean {
  const dot = relPath.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(relPath.slice(dot).toLowerCase());
}

/** Return the binary content-type for `relPath` if its extension is on
 *  the allowlist, else null (text files + unknown types skip the binary
 *  backup path). */
function binaryMime(relPath: string): string | null {
  const dot = relPath.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = relPath.slice(dot).toLowerCase();
  return BINARY_EXTENSIONS[ext] ?? null;
}

function backupStoragePath(ws: WorkspaceHandle, relPath: string): string {
  // relPath already starts with / from listWorkspaceFiles; strip it
  const clean = relPath.replace(/^\/+/, '');
  return `${ws.tenantId}/workspaces/${ws.projectSlug}/${clean}`;
}

/**
 * Back up a single text file to Supabase Storage.
 * Fire-and-forget — call without await from the write_file tool.
 */
export async function backupFileToStorage(
  ws: WorkspaceHandle,
  relPath: string,
  content: string,
): Promise<void> {
  if (!isTextFile(relPath)) return;
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const path = backupStoragePath(ws, relPath);
  await supabase.storage.from(BACKUP_BUCKET).upload(path, Buffer.from(content, 'utf-8'), {
    contentType: 'text/plain; charset=utf-8',
    upsert:      true,
  });
}

/**
 * Back up a single binary file (image, video, audio, pdf, font) to Supabase
 * Storage. Fire-and-forget — called automatically from writeWorkspaceFileBuffer
 * so AI-generated images don't disappear on container restart.
 *
 * Unknown binary extensions are skipped silently — the allowlist in
 * BINARY_EXTENSIONS is intentionally narrow so we don't accidentally
 * back up node_modules junk or other build artifacts.
 */
export async function backupFileBufferToStorage(
  ws: WorkspaceHandle,
  relPath: string,
  buffer: Buffer,
): Promise<void> {
  const mime = binaryMime(relPath);
  if (!mime) return;
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const path = backupStoragePath(ws, relPath);
  await supabase.storage.from(BACKUP_BUCKET).upload(path, buffer, {
    contentType: mime,
    upsert:      true,
  });
}

/**
 * Restore all backed-up text files from Supabase Storage into the local workspace.
 * Called when the workspace exists but is empty (e.g. after a server restart).
 * Non-fatal: if storage has nothing, the function returns without error.
 *
 * Falls back to the legacy `project-assets` bucket if the new
 * `workspace-backups` bucket has nothing — covers projects whose backups
 * predate the security migration. Once those projects rewrite, the new
 * upload goes to the private bucket and the legacy path quietly retires.
 *
 * Concurrency: callers from chat / publish / preview / files routes can
 * fire this simultaneously when the FS is empty. Without a per-(tenant,
 * slug) mutex, two restores would race on the same Storage list and
 * write the same files in interleaved order — fine in the common case
 * (idempotent writes), but a brief window can serve a half-restored
 * tree to the bundler. We dedupe via an in-memory promise cache so
 * concurrent callers all await the same restore.
 */
const inflightRestores = new Map<string, Promise<void>>();

/** Hard ceiling on a single restore. Supabase Storage list/download calls
 *  have NO built-in timeout — if one hangs, doRestoreWorkspaceFromStorage
 *  hangs, and because the result is cached in inflightRestores, EVERY
 *  subsequent build for the same project hangs on the same dead promise
 *  (a request-killing poison). Healthy restores finish in well under 10s;
 *  60s catches a genuine hang while giving big-project restores headroom. */
const RESTORE_TIMEOUT_MS = 60_000;

export function restoreWorkspaceFromStorage(ws: WorkspaceHandle): Promise<void> {
  const key = `${ws.tenantId}/${ws.projectSlug}`;
  const existing = inflightRestores.get(key);
  if (existing) return existing;
  // Race the restore against a hard timeout. On timeout the promise rejects,
  // the .finally() clears the inflightRestores entry so the next caller
  // retries fresh instead of awaiting the same dead promise, and all callers
  // already treat a restore failure as non-fatal (.catch on the call site).
  const p = Promise.race([
    doRestoreWorkspaceFromStorage(ws),
    new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error(`workspace restore timed out after ${RESTORE_TIMEOUT_MS / 1000}s`)),
        RESTORE_TIMEOUT_MS,
      ),
    ),
  ]).finally(() => {
    inflightRestores.delete(key);
  });
  inflightRestores.set(key, p);
  return p;
}

async function doRestoreWorkspaceFromStorage(ws: WorkspaceHandle): Promise<void> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const prefix   = `${ws.tenantId}/workspaces/${ws.projectSlug}/`;

  const downloadFromBucket = async (bucket: string): Promise<number> => {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 200, sortBy: { column: 'name', order: 'asc' },
    });
    if (error || !data?.length) return 0;
    let restored = 0;
    await Promise.allSettled(
      data
        .filter((f) => f.name && !f.name.endsWith('/'))
        .map(async (file) => {
          const { data: blob, error: dlErr } = await supabase.storage
            .from(bucket)
            .download(`${prefix}${file.name}`);
          if (dlErr || !blob) return;
          // Dispatch by extension: binary (image/video/audio/pdf/font) is
          // restored byte-for-byte via writeWorkspaceFileBuffer; everything
          // else is treated as utf-8 text. Both helpers fire-and-forget the
          // bucket re-upload, but since the bucket already has the bytes,
          // those calls are no-ops.
          if (binaryMime(file.name)) {
            const ab = await blob.arrayBuffer();
            await writeWorkspaceFileBuffer(ws, file.name, Buffer.from(ab));
          } else {
            const text = await blob.text();
            await writeWorkspaceFile(ws, file.name, text);
          }
          restored++;
        }),
    );
    return restored;
  };

  // Try the secure bucket first
  const fromPrivate = await downloadFromBucket(BACKUP_BUCKET);
  if (fromPrivate > 0) return;

  // Legacy fallback: workspaces backed up before the bucket split
  await downloadFromBucket('project-assets');
}

/**
 * Ensure the private `workspace-backups` bucket exists. Idempotent — if the
 * bucket is already there, the createBucket call returns an error which we
 * swallow. Call this once at server boot. Failures are logged but the api
 * still starts; existing backups in `project-assets` continue to be read
 * via the legacy fallback in restoreWorkspaceFromStorage().
 */
export async function ensureWorkspaceBackupsBucket(): Promise<void> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await supabase.storage.createBucket(BACKUP_BUCKET, { public: false });
  if (!error) {
    // eslint-disable-next-line no-console
    console.log(`[storage] created private bucket "${BACKUP_BUCKET}"`);
    return;
  }
  // Common no-op errors when the bucket already exists — safe to swallow.
  const msg = error.message ?? String(error);
  if (/already exists|duplicate|409/i.test(msg)) {
    // eslint-disable-next-line no-console
    console.log(`[storage] bucket "${BACKUP_BUCKET}" already present`);
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(`[storage] could not ensure bucket "${BACKUP_BUCKET}": ${msg}`);
}
