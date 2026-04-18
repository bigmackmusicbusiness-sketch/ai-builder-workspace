// apps/api/src/agent/tools/fs.read.ts — read file content from the project's file store.
// Allowed roles: planner, builder, runtime, visual, backend, fixer, release.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { z } from 'zod';
import { FsReadInput, FsReadOutput } from '@abw/agent-core';
import { getDb } from '../../db/client';
import { files, fileBlobs } from '@abw/db';
import { eq, and } from 'drizzle-orm';

export type FsReadInputType  = z.infer<typeof FsReadInput>;
export type FsReadOutputType = z.infer<typeof FsReadOutput>;

/** Language from extension */
function langFromPath(p: string): string {
  const ext = p.split('.').pop() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    css: 'css', json: 'json', md: 'markdown', sql: 'sql', html: 'html',
    yaml: 'yaml', yml: 'yaml', sh: 'shell',
  };
  return map[ext] ?? 'plaintext';
}

/**
 * Read a project file by path. Resolves via DB (blob store) first;
 * falls back to disk if `projectRoot` is provided in the context.
 */
export async function fsRead(
  input: FsReadInputType,
  ctx: { projectId: string; tenantId: string; projectRoot?: string },
): Promise<FsReadOutputType> {
  const db = getDb();

  // Try DB blob store first
  const [file] = await db
    .select({ contentHash: files.contentHash })
    .from(files)
    .where(and(
      eq(files.projectId, ctx.projectId),
      eq(files.tenantId, ctx.tenantId),
      eq(files.path, input.path),
    ))
    .limit(1);

  let content: string;

  if (file?.contentHash) {
    const [blob] = await db
      .select({ content: fileBlobs.content })
      .from(fileBlobs)
      .where(eq(fileBlobs.hash, file.contentHash))
      .limit(1);
    content = blob?.content ?? '';
  } else if (ctx.projectRoot) {
    // Fallback: read from disk (sandboxed to project root)
    const safePath = resolve(ctx.projectRoot, input.path);
    if (!safePath.startsWith(resolve(ctx.projectRoot))) {
      throw new Error(`fs.read: path traversal blocked: ${input.path}`);
    }
    content = await readFile(safePath, 'utf8');
  } else {
    throw new Error(`fs.read: file not found: ${input.path}`);
  }

  // Apply line range if requested
  if (input.startLine !== undefined || input.endLine !== undefined) {
    const allLines = content.split('\n');
    const start = (input.startLine ?? 1) - 1;
    const end   = input.endLine ?? allLines.length;
    content = allLines.slice(start, end).join('\n');
  }

  const lines = content.split('\n').length;
  return { path: input.path, content, lines, lang: langFromPath(input.path) };
}
