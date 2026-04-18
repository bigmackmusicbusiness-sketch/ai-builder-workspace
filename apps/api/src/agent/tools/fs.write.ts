// apps/api/src/agent/tools/fs.write.ts — write file content, scoped to affectedFiles.
// Rejects any path not in the plan's affectedFiles list. Audited on every call.
// Allowed roles: builder, fixer (fixer must also supply a findingId).
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { FsWriteInput, FsWriteOutput } from '@abw/agent-core';
import { getDb } from '../../db/client';
import { files, fileBlobs } from '@abw/db';
import { eq, and } from 'drizzle-orm';
import { writeAuditEvent } from '../../security/audit';

export type FsWriteInputType  = z.infer<typeof FsWriteInput>;
export type FsWriteOutputType = z.infer<typeof FsWriteOutput>;

export interface FsWriteContext {
  projectId:     string;
  tenantId:      string;
  runId:         string;
  stepId:        string;
  actorId:       string;
  affectedFiles: string[];  // from the plan; writes outside this list are rejected
}

/** Derive a language tag from a file path extension. */
function langFromPath(p: string): string {
  const ext = p.split('.').pop() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    css: 'css', json: 'json', md: 'markdown', sql: 'sql', html: 'html',
    yaml: 'yaml', yml: 'yaml', sh: 'shell',
  };
  return map[ext] ?? 'plaintext';
}

export async function fsWrite(
  input: FsWriteInputType,
  ctx: FsWriteContext,
): Promise<FsWriteOutputType> {
  // Scope enforcement — reject paths not in the plan
  if (!ctx.affectedFiles.includes(input.path)) {
    throw Object.assign(
      new Error(`fs.write: path '${input.path}' not in affectedFiles. Add it to the plan first.`),
      { code: 'SCOPE_VIOLATION' },
    );
  }

  const db = getDb();
  const hash  = createHash('sha256').update(input.content).digest('hex');
  const bytes = Buffer.byteLength(input.content, 'utf8');
  const lang  = langFromPath(input.path);

  // Store blob (content-addressed; idempotent)
  await db.insert(fileBlobs)
    .values({ hash, content: input.content, size: bytes })
    .onConflictDoNothing();

  // Update or insert file record
  const [existing] = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.projectId, ctx.projectId), eq(files.tenantId, ctx.tenantId), eq(files.path, input.path)))
    .limit(1);

  if (existing) {
    await db
      .update(files)
      .set({ contentHash: hash, size: bytes, lang, dirty: false })
      .where(and(eq(files.id, existing.id), eq(files.tenantId, ctx.tenantId)));
  } else {
    await db.insert(files).values({
      projectId:   ctx.projectId,
      tenantId:    ctx.tenantId,
      path:        input.path,
      lang,
      contentHash: hash,
      size:        bytes,
      dirty:       false,
    });
  }

  await writeAuditEvent({
    actor:    ctx.actorId,
    tenantId: ctx.tenantId,
    action:   'agent.fs_write',
    target:   'file',
    after:    { path: input.path, hash, reason: input.reason },
    runId:    ctx.runId,
    env:      'dev',
  });

  return { path: input.path, hash, bytesWritten: bytes };
}
