// apps/api/src/agent/phases/execute.ts — Phase B: Executor (parallelized).
//
// 1. Kicks off all gen_image calls in parallel (slowest leg, runs alongside copy).
// 2. Authors copy as JSON first (write_copy_doc tool) → entire site copy in one doc.
// 3. Runs humanizer (Phase B') over copy.json — single call, full-site copy.
// 4. Renders pages in parallel (one render_page subcall per page).
// 5. Slots in images event-driven as they complete.
//
// Foundation step: stub. Step 2 wires the parallel fan-out for `website` type.

import type { PlanType } from './plan';
import type { WorkspaceHandle } from '../../preview/workspace';

export interface ExecuteInput {
  plan:        PlanType;
  projectSlug: string;
  tenantId:    string;
  projectId:   string;
  ws:          WorkspaceHandle;
}

export interface ExecuteResult {
  ok:           boolean;
  pagesWritten: string[];
  imagesGenerated: string[];
  error?:       string;
}

export async function runExecutor(input: ExecuteInput): Promise<ExecuteResult> {
  void input;
  return {
    ok:              false,
    pagesWritten:    [],
    imagesGenerated: [],
    error:           'Executor not yet implemented (Step 2)',
  };
}
