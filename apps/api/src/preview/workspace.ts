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

/** Write a binary file (Buffer) at `path` — used for AI-generated images and other assets. */
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
// Text workspace files are backed up to Supabase Storage so they survive
// server restarts (Railway's container filesystem is ephemeral).
// Binary files (images) are excluded — they're already stored as assets.

const BACKUP_BUCKET = 'project-assets';
const TEXT_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.json',
  '.md', '.txt', '.svg', '.xml', '.yaml', '.yml', '.toml', '.env',
]);

function isTextFile(relPath: string): boolean {
  const dot = relPath.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(relPath.slice(dot).toLowerCase());
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
 * Restore all backed-up text files from Supabase Storage into the local workspace.
 * Called when the workspace exists but is empty (e.g. after a server restart).
 * Non-fatal: if storage has nothing, the function returns without error.
 */
export async function restoreWorkspaceFromStorage(ws: WorkspaceHandle): Promise<void> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const prefix   = `${ws.tenantId}/workspaces/${ws.projectSlug}/`;

  // List all files under the prefix (paginate up to 200)
  const { data, error } = await supabase.storage.from(BACKUP_BUCKET).list(prefix, {
    limit: 200, sortBy: { column: 'name', order: 'asc' },
  });
  if (error || !data?.length) return;

  await Promise.allSettled(
    data
      .filter((f) => f.name && !f.name.endsWith('/'))
      .map(async (file) => {
        const { data: blob, error: dlErr } = await supabase.storage
          .from(BACKUP_BUCKET)
          .download(`${prefix}${file.name}`);
        if (dlErr || !blob) return;
        const text = await blob.text();
        // Reconstruct relative path: file.name is the part after the prefix
        await writeWorkspaceFile(ws, file.name, text);
      }),
  );
}
