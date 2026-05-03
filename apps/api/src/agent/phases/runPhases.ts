// apps/api/src/agent/phases/runPhases.ts — phase orchestrator entry point.
//
// Wires Phase A (plan) → Phase B (execute) → Phase B' (humanize) → Phase C (polish).
// Each phase is a focused subagent call with a narrow tool surface. This is the
// replacement for the single 30-iteration loop in chat.ts when the project type
// has `agentInstructions` defined.
//
// Foundation step (Step 1): skeleton only, returns null so chat.ts falls back to
// the existing iteration loop. Step 2 fills in the actual phase logic for `website`.

import type { ProjectType } from '@abw/project-types';
import type { WorkspaceHandle } from '../../preview/workspace';

export interface PhaseEvent {
  type:        'phase_started' | 'phase_done' | 'phase_failed' | 'plan_summary';
  phase:       'plan' | 'execute' | 'humanize' | 'polish';
  message?:    string;
  durationMs?: number;
  error?:      string;
}

export interface RunPhasesInput {
  brief:       string;
  projectType: ProjectType;
  projectSlug: string;
  tenantId:    string;
  projectId:   string;
  ws:          WorkspaceHandle;
  /** SSE event sink — callers push events to the chat stream via this. */
  emit:        (event: PhaseEvent) => void;
}

export interface RunPhasesOutput {
  ok:        boolean;
  summary:   string;
  /** True if the phase orchestrator handled the request end-to-end. False means
   *  caller should fall back to the legacy iteration loop. */
  handled:   boolean;
}

/**
 * Phase orchestrator entry point.
 *
 * Foundation step: returns `{ handled: false }` for every input so the existing
 * iteration loop in chat.ts continues to handle every request. Step 2 of the
 * plan flips this to `handled: true` for `website` projects with niche detection
 * succeeding, and progressively more types as Steps 4 and 5 land.
 */
export async function runPhases(input: RunPhasesInput): Promise<RunPhasesOutput> {
  // Step 2 will replace this with: dispatch to plan() → execute() → humanize() → polish().
  void input;
  return {
    ok:      true,
    summary: 'Phase orchestrator skeleton loaded; not yet active for any project type.',
    handled: false,
  };
}
