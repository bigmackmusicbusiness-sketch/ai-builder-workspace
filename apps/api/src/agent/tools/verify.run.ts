// apps/api/src/agent/tools/verify.run.ts — run the verification matrix.
// Delegates to apps/api/src/verify/pipeline.ts. Returns structured results.
// Allowed roles: planner (readOnly=true), runtime, visual, backend, fixer, release.
import type { z } from 'zod';
import { VerifyRunInput, VerifyRunOutput } from '@abw/agent-core';
import { runPipeline } from '../../verify/pipeline';
import type { AdapterName } from '../../verify/pipeline';

export type VerifyRunInputType  = z.infer<typeof VerifyRunInput>;
export type VerifyRunOutputType = z.infer<typeof VerifyRunOutput>;

export async function verifyRun(
  input: VerifyRunInputType,
  ctx: { projectId: string; tenantId: string; projectRoot: string; previewUrl?: string },
): Promise<VerifyRunOutputType> {
  if (input.readOnly) {
    // Return placeholder — history queries wired in Step 13
    return {
      results:  [],
      allGreen: true,
    };
  }

  const pipeline = await runPipeline({
    adapters:    input.adapters as AdapterName[],
    projectId:   ctx.projectId,
    tenantId:    ctx.tenantId,
    projectRoot: ctx.projectRoot,
    previewUrl:  ctx.previewUrl,
  });

  const results = pipeline.results.map((r) => ({
    adapter:      r.adapter,
    ok:           r.ok,
    durationMs:   r.durationMs,
    summary:      r.summary,
    findingCount: r.findings.length,
    skipped:      r.skipped,
  }));

  return {
    results,
    allGreen: pipeline.allGreen,
  };
}
