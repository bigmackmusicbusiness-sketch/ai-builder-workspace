// apps/api/src/agent/tools/preview.boot.ts — boot a project preview session.
// Delegates to the preview bundler + sessionManager. Allowed roles: runtime, visual.
import type { z } from 'zod';
import { PreviewBootInput, PreviewBootOutput } from '@abw/agent-core';
import { bundleProject } from '../../preview/bundler';
import { createSession, updateSession } from '../../preview/sessionManager';

export type PreviewBootInputType  = z.infer<typeof PreviewBootInput>;
export type PreviewBootOutputType = z.infer<typeof PreviewBootOutput>;

export async function previewBoot(
  input: PreviewBootInputType,
  ctx: { tenantId: string; projectSlug: string; rootDir: string; entryPoint: string },
): Promise<PreviewBootOutputType> {
  const sessionId  = crypto.randomUUID();
  const previewUrl = `http://localhost:3000/${input.projectId}`;  // local stub; real URL from KV sync

  createSession({
    sessionId,
    projectId:   input.projectId,
    projectSlug: ctx.projectSlug,
    tenantId:    ctx.tenantId,
    previewUrl,
  });
  updateSession(sessionId, { status: 'bundling' });

  // Kick off bundle asynchronously
  void bundleProject({
    projectId:   input.projectId,
    projectSlug: ctx.projectSlug,
    rootDir:     ctx.rootDir,
    entryPoint:  ctx.entryPoint,
    framework:   input.framework,
  }).then((output) => {
    updateSession(sessionId, {
      status: output.errors.length > 0 ? 'error' : 'booted',
      error:  output.errors[0],
    });
  }).catch((err: unknown) => {
    updateSession(sessionId, { status: 'error', error: String(err) });
  });

  return { sessionId, previewUrl, status: 'booting' };
}
