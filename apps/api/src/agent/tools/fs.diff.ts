// apps/api/src/agent/tools/fs.diff.ts — produce a unified diff for a project file.
// Compares current blob against the HEAD snapshot or original (empty baseline).
// Uses Node.js built-ins only — no external diff package required.
import type { z } from 'zod';
import { FsDiffInput, FsDiffOutput } from '@abw/agent-core';
import { getDb } from '../../db/client';
import { files, fileBlobs, versions } from '@abw/db';
import { eq, and, desc } from 'drizzle-orm';

export type FsDiffInputType  = z.infer<typeof FsDiffInput>;
export type FsDiffOutputType = z.infer<typeof FsDiffOutput>;

/** Produce a minimal unified diff string from two texts. */
function unifiedDiff(oldText: string, newText: string, oldLabel: string, newLabel: string): string {
  const oldLines = oldText === '' ? [] : oldText.split('\n');
  const newLines = newText === '' ? [] : newText.split('\n');

  const lines: string[] = [];
  lines.push(`--- ${oldLabel}`);
  lines.push(`+++ ${newLabel}`);

  // Simple line-by-line diff (LCS not needed for small files; sufficient for agent use)
  const maxLen = Math.max(oldLines.length, newLines.length);
  let added = 0; let removed = 0;

  // Build a hunk: find changed lines
  let hunkStart = -1;
  const hunkLines: string[] = [];

  const flush = () => {
    if (hunkLines.length > 0 && hunkStart >= 0) {
      lines.push(`@@ -${hunkStart + 1} +${hunkStart + 1} @@`);
      lines.push(...hunkLines);
      hunkLines.length = 0;
    }
  };

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) continue;
    if (hunkStart < 0) hunkStart = i;
    if (oldLine !== undefined) { hunkLines.push(`-${oldLine}`); removed++; }
    if (newLine !== undefined) { hunkLines.push(`+${newLine}`); added++; }
  }
  flush();

  return lines.join('\n');
}

export async function fsDiff(
  input: FsDiffInputType,
  ctx: { projectId: string; tenantId: string },
): Promise<FsDiffOutputType> {
  const db = getDb();

  const [fileRow] = await db
    .select({ contentHash: files.contentHash })
    .from(files)
    .where(and(
      eq(files.projectId, ctx.projectId),
      eq(files.tenantId, ctx.tenantId),
      eq(files.path, input.path),
    ))
    .limit(1);

  if (!fileRow?.contentHash) {
    throw new Error(`fs.diff: file not found: ${input.path}`);
  }

  const [currentBlob] = await db
    .select({ content: fileBlobs.content })
    .from(fileBlobs)
    .where(eq(fileBlobs.hash, fileRow.contentHash))
    .limit(1);

  const currentContent = currentBlob?.content ?? '';
  let baseContent = '';

  if (input.against === 'HEAD') {
    const [latestVersion] = await db
      .select({ manifest: versions.manifest })
      .from(versions)
      .where(and(eq(versions.projectId, ctx.projectId), eq(versions.tenantId, ctx.tenantId)))
      .orderBy(desc(versions.createdAt))
      .limit(1);

    if (latestVersion?.manifest) {
      const manifest = latestVersion.manifest as Record<string, string>;
      const baseHash = manifest[input.path];
      if (baseHash) {
        const [baseBlob] = await db
          .select({ content: fileBlobs.content })
          .from(fileBlobs)
          .where(eq(fileBlobs.hash, baseHash))
          .limit(1);
        baseContent = baseBlob?.content ?? '';
      }
    }
  }

  const diff = unifiedDiff(baseContent, currentContent, `a/${input.path}`, `b/${input.path}`);
  const lines = diff.split('\n');
  let added = 0; let removed = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }

  return { path: input.path, diff, added, removed };
}
