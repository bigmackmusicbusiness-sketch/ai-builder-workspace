// apps/api/src/agent/phases/runPhases.ts — phase orchestrator entry point.
//
// Phase A (planner) runs FIRST as a focused MiniMax call with the per-type
// planner SOP + niche manifests. Returns a validated plan.
//
// Phase B (executor) is currently the LEGACY iteration loop in chat.ts —
// runPhases() returns the plan + an enhanced system message; chat.ts injects
// them and runs the existing loop. This is the pragmatic middle ground:
// niche-aware planning + multi-page guidance, executing through the proven
// tool-call recovery pipeline.
//
// Phases B' (humanizer) and C (polish) run as POST-process passes after the
// legacy loop completes. Inline regex-based rewrites — fast, deterministic,
// no extra MiniMax calls.

import type { ProviderAdapter, ChatMessage } from '@abw/providers';
import type { ProjectType } from '@abw/project-types';
import type { WorkspaceHandle } from '../../preview/workspace';
import { runPlanner, type PlanType } from './plan';
import { runInlineHumanizer } from './humanize';
import { runInlinePolish, type AuditFinding } from './polish';

export type PhaseEvent =
  | { type: 'plan_start';     niche?: string;                                 }
  | { type: 'plan_done';      niche: string;  pagesCount: number; assetsCount: number; voice: string; palette: string }
  | { type: 'plan_failed';    error: string                                    }
  | { type: 'humanize_done';  filesTouched: number; swaps: number              }
  | { type: 'polish_done';    findings: AuditFinding[]; filesTouched: number   };

export interface PrePhaseInput {
  brief:          string;
  projectType:    ProjectType;
  projectSlug:    string;
  adapter:        ProviderAdapter;
  model:          string;
  signal?:        AbortSignal;
  emit:           (event: PhaseEvent) => void;
}

export interface PrePhaseResult {
  /** True when planner ran successfully and returned a plan. Caller injects
   *  the plan + enhanced system message into the legacy iteration loop. */
  planAvailable: boolean;
  plan?:         PlanType;
  /** Pre-built system message to prepend to the chat history. Compresses the
   *  plan into a focused build directive. */
  enhancedSystemMessage?: string;
  error?:        string;
}

export interface PostPhaseInput {
  ws:    WorkspaceHandle;
  plan?: PlanType;
  emit:  (event: PhaseEvent) => void;
}

/**
 * Run Phase A (planner) BEFORE the legacy iteration loop. Returns the plan +
 * an enhanced system message the caller injects into the chat history.
 *
 * Returns `planAvailable: false` to signal the caller to skip planning and run
 * the legacy loop with no enhancement (e.g., when the project type has no
 * `agentInstructions` or the planner failed).
 */
export async function runPrePhase(input: PrePhaseInput): Promise<PrePhaseResult> {
  const { brief, projectType, projectSlug, adapter, model, signal, emit } = input;

  // Skip planner if the project type has no agentInstructions defined.
  if (!projectType.agentInstructions) {
    return { planAvailable: false };
  }

  emit({ type: 'plan_start' });

  const planResult = await runPlanner({
    brief,
    projectTypeId: projectType.id,
    projectSlug,
    adapter,
    model,
    signal,
  });

  if (!planResult.ok || !planResult.plan) {
    emit({ type: 'plan_failed', error: planResult.error ?? 'unknown' });
    // eslint-disable-next-line no-console
    console.warn(`[phases] planner failed for ${projectType.id}: ${planResult.error}`);
    return { planAvailable: false, error: planResult.error };
  }

  const plan = planResult.plan;
  emit({
    type:        'plan_done',
    niche:       plan.niche,
    pagesCount:  plan.sitemap.length,
    assetsCount: plan.shared_assets.length,
    voice:       plan.voice,
    palette:     plan.palette,
  });

  const enhancedSystemMessage = buildExecutionDirective(plan, projectSlug);

  return {
    planAvailable: true,
    plan,
    enhancedSystemMessage,
  };
}

/**
 * Run Phase B' (humanizer) + Phase C (polish) AFTER the legacy iteration loop
 * completes. These are inline regex-based passes — no extra MiniMax calls.
 */
export async function runPostPhase(input: PostPhaseInput): Promise<{
  humanize?: { filesTouched: number; swaps: number };
  polish?:   { findings: AuditFinding[]; filesTouched: number };
}> {
  const { ws, emit } = input;
  const result: {
    humanize?: { filesTouched: number; swaps: number };
    polish?:   { findings: AuditFinding[]; filesTouched: number };
  } = {};

  // Phase B': humanize copy in written HTML files
  const humanizeRes = await runInlineHumanizer(ws);
  if (humanizeRes.ok) {
    result.humanize = { filesTouched: humanizeRes.filesTouched, swaps: humanizeRes.totalSwaps };
    emit({ type: 'humanize_done', filesTouched: humanizeRes.filesTouched, swaps: humanizeRes.totalSwaps });
  }

  // Phase C: polish auto-fixes + audit findings
  const polishRes = await runInlinePolish(ws);
  if (polishRes.ok) {
    result.polish = { findings: polishRes.findings, filesTouched: polishRes.filesTouched };
    emit({ type: 'polish_done', findings: polishRes.findings, filesTouched: polishRes.filesTouched });
  }

  return result;
}

/** Build a focused execution directive from the plan. The legacy iteration
 *  loop sees this as a system message before its first turn — it tells the
 *  model exactly what files to write and what each should contain. */
function buildExecutionDirective(plan: PlanType, projectSlug: string): string {
  const pagesPlan = plan.sitemap.map((p) => {
    const sectionsList = p.sections.map((s) => `\`${s}\``).join(', ');
    return `### \`${p.slug === 'index' ? 'index.html' : `${p.slug}.html`}\`
- **Title:** ${p.title}
- **Role:** ${p.role}
- **Sections (in order):** ${sectionsList}
- **SEO title:** ${p.seo.title}
- **Meta description:** ${p.seo.meta_description}
- **Schema.org:** ${(p.schema_org ?? []).join(', ') || '(none)'}`;
  }).join('\n\n');

  const assetsList = plan.shared_assets.length > 0
    ? plan.shared_assets.map((a) =>
        `- \`/images/${a.id}.jpg\` (used in: ${a.used_in.join(', ')}) — prompt: "${a.prompt}"`,
      ).join('\n')
    : '(no shared assets)';

  return [
    `## BUILD PLAN (follow exactly)`,
    ``,
    `A planning subagent has analyzed the brief and produced this plan. **Build it page by page using write_file.** The plan has been validated; you do not need to re-plan.`,
    ``,
    `### Detected niche: \`${plan.niche}\``,
    `### Voice: ${plan.voice}`,
    `### Palette: \`${plan.palette}\``,
    ``,
    `### Pages to write (write each via write_file):`,
    ``,
    pagesPlan,
    ``,
    `### Shared images (call gen_image for each AFTER all pages are written):`,
    ``,
    assetsList,
    ``,
    `### Compliance blocks (include in footer):`,
    plan.compliance_blocks.length > 0 ? plan.compliance_blocks.map((b) => `- ${b}`).join('\n') : '(none)',
    ``,
    `## EXECUTION ORDER`,
    `1. \`list_files\` to see what exists.`,
    `2. \`write_file\` for each page in the sitemap above. Each page must have:`,
    `   - Tailwind via CDN: \`<script src="https://cdn.tailwindcss.com"></script>\``,
    `   - The voice and tone described above`,
    `   - The exact sections listed for that page`,
    `   - Required SEO meta tags + Schema.org JSON-LD`,
    `   - Compliance blocks in footer where applicable`,
    `3. \`gen_image\` for each shared asset, saving to \`/images/<asset-id>.jpg\``,
    `4. One short summary in chat (2-3 sentences max).`,
    ``,
    `Project slug: "${projectSlug}".`,
    ``,
    `**DO NOT** re-plan. **DO NOT** ask clarifying questions. **DO NOT** write SPEC.md or any markdown plan. Build the pages.`,
  ].join('\n');
}
