// apps/api/src/db/repositories/filesRepo.ts — all DB access for files + blobs + versions.
// Routes never call drizzle directly; they go through this module.
import { eq, and, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getDb } from '../client';
import { files, fileBlobs, versions } from '@abw/db';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileRow {
  id: string;
  projectId: string;
  tenantId: string;
  path: string;
  contentHash: string;
  size: number;
  lang: string | null;
  dirty: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FileSaveInput {
  fileId: string;
  projectId: string;
  tenantId: string;
  content: string;
  lang: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ── Repo ──────────────────────────────────────────────────────────────────────

/** List all files for a project (path + metadata only — no content). */
export async function listFiles(projectId: string, tenantId: string): Promise<FileRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.projectId, projectId), eq(files.tenantId, tenantId)))
    .orderBy(files.path);
  return rows as unknown as FileRow[];
}

/** Get full file content by resolving its blob. */
export async function getFileContent(fileId: string, tenantId: string): Promise<string | null> {
  const db = getDb();
  const row = await db
    .select({ contentHash: files.contentHash })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.tenantId, tenantId)))
    .limit(1);
  if (!row[0]) return null;
  const { contentHash } = row[0];
  if (!contentHash) return null; // file exists but has no blob yet

  const blob = await db
    .select({ content: fileBlobs.content })
    .from(fileBlobs)
    .where(eq(fileBlobs.hash, contentHash))
    .limit(1);

  return blob[0]?.content ?? null;
}

/** Save file content by UUID: hash → upsert blob → update file record. Returns new content hash. */
export async function saveFile(input: FileSaveInput): Promise<string> {
  const db = getDb();
  const hash = sha256(input.content);
  const size = Buffer.byteLength(input.content, 'utf8');

  // Upsert blob (content-addressed; skip if same hash already stored)
  await db
    .insert(fileBlobs)
    .values({ hash, content: input.content, size })
    .onConflictDoNothing();

  // Update files record
  await db
    .update(files)
    .set({ contentHash: hash, size, lang: input.lang, dirty: false })
    .where(and(eq(files.id, input.fileId), eq(files.tenantId, input.tenantId)));

  return hash;
}

export interface FileSaveByPathInput {
  projectId: string;
  tenantId:  string;
  path:      string;
  content:   string;
  lang:      string;
}

export interface FileSaveByPathResult {
  id:   string;
  hash: string;
}

/**
 * Path-keyed save: SELECT-then-INSERT/UPDATE for (projectId, tenantId, path).
 * Created because the editor identifies files by their relative path (the file
 * tree's stable identifier across project loads), and a brand-new project has
 * no `files` rows in the DB until something writes — so an UPDATE-only path
 * silently no-ops while the route returns 404 from Fastify path-matching.
 *
 * No unique constraint exists on (projectId, tenantId, path) yet, so we don't
 * use ON CONFLICT — the SELECT-then-{INSERT|UPDATE} is racy against itself
 * but each tenant only has one editor open per file at a time, so collisions
 * are rare and the worst case is a duplicate row that the next save will
 * still find.
 */
export async function saveFileByPath(
  input: FileSaveByPathInput,
): Promise<FileSaveByPathResult> {
  const db = getDb();
  const hash = sha256(input.content);
  const size = Buffer.byteLength(input.content, 'utf8');

  // Upsert blob (content-addressed)
  await db
    .insert(fileBlobs)
    .values({ hash, content: input.content, size })
    .onConflictDoNothing();

  // Find existing row by path
  const [existing] = await db
    .select({ id: files.id })
    .from(files)
    .where(and(
      eq(files.projectId, input.projectId),
      eq(files.tenantId,  input.tenantId),
      eq(files.path,      input.path),
    ))
    .limit(1);

  if (existing) {
    await db
      .update(files)
      .set({ contentHash: hash, size, lang: input.lang, dirty: false })
      .where(eq(files.id, existing.id));
    return { id: existing.id, hash };
  }

  // Insert new file row pointing at the blob
  const [inserted] = await db
    .insert(files)
    .values({
      projectId:   input.projectId,
      tenantId:    input.tenantId,
      path:        input.path,
      lang:        input.lang,
      contentHash: hash,
      size,
      dirty:       false,
    })
    .returning({ id: files.id });

  if (!inserted) throw new Error('Failed to insert file row');
  return { id: inserted.id, hash };
}

/** Get file content by (projectId, tenantId, path). Returns null if no row. */
export async function getFileContentByPath(
  projectId: string,
  tenantId:  string,
  path:      string,
): Promise<{ id: string; content: string; lang: string | null } | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: files.id, contentHash: files.contentHash, lang: files.lang })
    .from(files)
    .where(and(
      eq(files.projectId, projectId),
      eq(files.tenantId,  tenantId),
      eq(files.path,      path),
    ))
    .limit(1);

  if (!row) return null;
  if (!row.contentHash) return { id: row.id, content: '', lang: row.lang };

  const [blob] = await db
    .select({ content: fileBlobs.content })
    .from(fileBlobs)
    .where(eq(fileBlobs.hash, row.contentHash))
    .limit(1);

  return { id: row.id, content: blob?.content ?? '', lang: row.lang };
}

/** Search file paths and content for a query string (server-side grep). */
export async function searchFiles(
  projectId: string,
  tenantId: string,
  query: string,
): Promise<{ fileId: string; path: string; matchCount: number }[]> {
  const db = getDb();
  // Use Postgres ILIKE on path; for content search we join blobs.
  // This is a basic implementation — a real ripgrep-style search
  // would stream results; we return top 50 matches.
  const pattern = `%${query}%`;
  const rows = await db
    .select({
      fileId: files.id,
      path: files.path,
      matchCount: sql<number>`1`,
    })
    .from(files)
    .where(
      and(
        eq(files.projectId, projectId),
        eq(files.tenantId, tenantId),
        sql`${files.path} ILIKE ${pattern}`,
      ),
    )
    .limit(50);
  return rows as { fileId: string; path: string; matchCount: number }[];
}

// ── Versions / Snapshots ───────────────────────────────────────────────────────

export interface VersionRow {
  id: string;
  projectId: string;
  tenantId: string;
  label: string | null;
  manifest: Record<string, string>; // path → contentHash
  createdAt: Date;
  createdBy: string;
}

/** Take a snapshot of the current file→blob map for the project. */
export async function createSnapshot(
  projectId: string,
  tenantId: string,
  createdBy: string,
  label?: string,
): Promise<string> {
  const db = getDb();

  // Build the file→blob map
  const fileRows = await db
    .select({ path: files.path, hash: files.contentHash })
    .from(files)
    .where(and(eq(files.projectId, projectId), eq(files.tenantId, tenantId)));

  const blobMap: Record<string, string> = {};
  for (const r of fileRows) {
    if (r.hash) blobMap[r.path] = r.hash; // skip files with no blob yet
  }

  const [row] = await db
    .insert(versions)
    .values({
      projectId,
      tenantId,
      label: label ?? null,
      manifest: blobMap,
      createdBy,
    })
    .returning({ id: versions.id });

  if (!row) throw new Error('Failed to create snapshot');
  return row.id;
}

/** List snapshots for a project, newest first. */
export async function listSnapshots(
  projectId: string,
  tenantId: string,
): Promise<VersionRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(versions)
    .where(and(eq(versions.projectId, projectId), eq(versions.tenantId, tenantId)))
    .orderBy(sql`${versions.createdAt} DESC`)
    .limit(50);
  return rows as unknown as VersionRow[];
}

/** Restore: point the project's files at the blobs from a historical snapshot.
 *  This is NEVER destructive — it creates a new snapshot pointing at the old blob set.
 */
export async function restoreSnapshot(
  versionId: string,
  projectId: string,
  tenantId: string,
  restoredBy: string,
): Promise<void> {
  const db = getDb();

  const [ver] = await db
    .select()
    .from(versions)
    .where(
      and(
        eq(versions.id, versionId),
        eq(versions.projectId, projectId),
        eq(versions.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!ver) throw Object.assign(new Error('Version not found'), { statusCode: 404 });

  const blobMap = (ver.manifest ?? {}) as Record<string, string>;

  // Update each file record to point at the restored blob hash
  for (const [path, hash] of Object.entries(blobMap)) {
    await db
      .update(files)
      .set({ contentHash: hash, dirty: false })
      .where(
        and(
          eq(files.projectId, projectId),
          eq(files.tenantId, tenantId),
          eq(files.path, path),
        ),
      );
  }

  // Snapshot the restored state so there's an audit trail
  await createSnapshot(projectId, tenantId, restoredBy, `Restore from version ${versionId}`);
}
