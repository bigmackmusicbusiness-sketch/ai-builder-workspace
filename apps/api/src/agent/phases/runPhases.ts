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

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ProviderAdapter, ChatMessage } from '@abw/providers';
import type { ProjectType } from '@abw/project-types';
import type { WorkspaceHandle } from '../../preview/workspace';
import { runPlanner, type PlanType } from './plan';
import { runInlineHumanizer } from './humanize';
import { runInlinePolish, type AuditFinding } from './polish';
import { maybeInjectSiteDataShim, type ProjectSignalPointHandle } from './siteDataShim';

export type PhaseEvent =
  | { type: 'plan_start';     niche?: string;                                 }
  | { type: 'plan_done';      niche: string;  pagesCount: number; assetsCount: number; voice: string; palette: string }
  | { type: 'plan_failed';    error: string                                    }
  | { type: 'humanize_done';  filesTouched: number; swaps: number              }
  | { type: 'polish_done';    findings: AuditFinding[]; filesTouched: number   }
  | { type: 'shim_check';     injected: boolean; reason: string; bindingCount: number };

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
  /** Project's SPS handle (optional). Standalone projects pass nothing or
   *  an object with both spsWorkspaceId and signalpointConfig null —
   *  maybeInjectSiteDataShim returns a no-op in that case. */
  project?: ProjectSignalPointHandle;
  /** Project type id used to load niche manifests when checking bindings.
   *  Defaults to 'website' when omitted. */
  projectTypeId?: string;
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

  const enhancedSystemMessage = await buildExecutionDirective(plan, projectSlug, projectType.id);

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
  shim?:     { injected: boolean; reason: string; bindingCount: number };
}> {
  const { ws, plan, project, projectTypeId, emit } = input;
  const result: {
    humanize?: { filesTouched: number; swaps: number };
    polish?:   { findings: AuditFinding[]; filesTouched: number };
    shim?:     { injected: boolean; reason: string; bindingCount: number };
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

  // Phase 3: optional site-data shim injection. The gate function
  // (maybeInjectSiteDataShim) early-returns a no-op for any project that
  // doesn't have an SPS link AND a binding-eligible niche manifest.
  // Standalone-IDE guarantee: this code path produces zero side-effects on
  // workspaces without project.signalpointConfig set.
  if (plan && project) {
    const shimRes = await maybeInjectSiteDataShim({
      ws,                               // v2: actually rewrite HTML files
      projectTypeId: projectTypeId ?? 'website',
      plan,
      project,
    });
    result.shim = {
      injected:     shimRes.injected,
      reason:       shimRes.reason,
      bindingCount: shimRes.bindings.length,
    };
    emit({
      type:         'shim_check',
      injected:     shimRes.injected,
      reason:       shimRes.reason,
      bindingCount: shimRes.bindings.length,
    });
  }

  return result;
}

/** Load the per-type security checklist if one exists. Returns empty string
 *  when no checklist is shipped for the type (most types — only the 6 high-
 *  risk types have one today: saas-app, api-service, full-stack-app,
 *  dashboard, internal-tool, automation-panel). */
async function loadTypeSecurityChecklist(typeId: string): Promise<string> {
  const candidates = [
    resolve(process.cwd(), 'apps', 'api', 'src', 'agent', 'skills', 'types', typeId, 'security_checklist.md'),
    resolve(process.cwd(), 'src', 'agent', 'skills', 'types', typeId, 'security_checklist.md'),
  ];
  for (const path of candidates) {
    try { return await readFile(path, 'utf8'); } catch { /* try next */ }
  }
  return '';
}

/** Project types that produce an interactive web app (not a static
 *  marketing site). For these types, the EXECUTION directive injects a
 *  hard "interactivity mandate" — every button must have a working
 *  onclick, every form must submit + persist + update visible state,
 *  state lives in localStorage. The mandate exists because the planner
 *  output (sitemap + assets) is the same shape for all types, and
 *  without explicit interactivity guidance the model defaults to the
 *  Website pattern: static HTML with non-functional decorative buttons.
 *
 *  WHY VANILLA HTML + INLINE JS instead of React/Vite:
 *  - The preview pipeline (bundler.ts collectStaticFiles) reliably
 *    serves static HTML byte-for-byte. React/Vite needs deps installed
 *    in the monorepo's node_modules which the scaffold doesn't ship;
 *    the bundler's degrade-to-static fallback then produces SOME page
 *    but loses every onClick handler.
 *  - Vanilla HTML + Tailwind CDN + inline <script> + localStorage is a
 *    fully self-contained pattern: no build step, no dependency on
 *    framework loading, every button works on first render.
 *  - This was the pattern that produced the proven-working Reverb Tasks
 *    E2E earlier in round 16 (4 pages, working form, localStorage
 *    persistence, dashboard auto-updates).
 *
 *  Explicitly NOT included: full-stack-app + api-service. Those types
 *  need a real build pipeline (Node/Fastify) and aren't served as
 *  interactive previews.
 */
const INTERACTIVE_PROJECT_TYPES = new Set<string>([
  'saas-app',
  'saas_app',           // both casings — project_types use kebab, DB uses snake
  'dashboard',
  'internal-tool',
  'internal_tool',
  'onboarding-flow',
  'onboarding_flow',
  'automation-panel',
  'automation_panel',
]);

function isInteractiveProjectType(id: string): boolean {
  return INTERACTIVE_PROJECT_TYPES.has(id);
}

/** Hard mandate for interactive project types. Inserted into the
 *  execution directive AFTER the page list and BEFORE the EXECUTION
 *  ORDER section. The model has been observed building decorative
 *  buttons (no onclick) when this isn't explicitly required. */
function buildInteractivityMandate(plan: PlanType, projectSlug: string): string {
  // Compute a sensible localStorage key prefix from the slug — used in
  // the examples below so the model copies the same pattern across pages.
  const storageKey = `${projectSlug.replace(/-/g, '_')}_state`;

  // First-non-index page is usually the primary "list/manage" surface —
  // mention by name so the model anchors the example to the actual sitemap.
  const examplePage = plan.sitemap.find((p) => p.slug !== 'index')?.slug ?? 'items';

  return [
    `## INTERACTIVITY MANDATE — this is a webapp, not a marketing site`,
    ``,
    `This project type is an **interactive web application**. Every page must work — buttons click, forms submit, state persists across navigation. A "looks-right but does-nothing" page is a hard failure: the user has explicitly flagged that webapps and dashboards where "the buttons inside them never work" are the #1 blocker on shipping.`,
    ``,
    `### Required tech stack (do NOT use React/Vite/Next for this build)`,
    ``,
    `- **Vanilla HTML per page** — multi-page site, real \`<a href="other-page.html">\` links between pages (NOT a router).`,
    `- **Tailwind via CDN:** \`<script src="https://cdn.tailwindcss.com"></script>\` in \`<head>\` of every page.`,
    `- **Inline \`<script>\` at the end of \`<body>\`** for state + handlers. ES2020+ syntax (arrow functions, optional chaining, template literals).`,
    `- **\`localStorage\`** as the only persistence layer. Key pattern: \`"${storageKey}"\` holding a JSON-stringified object/array. Read on every page load, mutate on every interaction.`,
    ``,
    `React, Vue, Vite, npm packages, framework routers, JSX — **do not use any of these**. The preview pipeline does not install third-party node modules; a React build will degrade to non-interactive static HTML. Vanilla + Tailwind CDN renders correctly every time.`,
    ``,
    `### Required interactivity per page`,
    ``,
    `Every interactive element MUST do something visible. The contract:`,
    ``,
    `- **Every \`<button>\`** must have either (a) \`onclick="…"\` with real behavior (state mutation + re-render of the affected DOM region) OR (b) \`type="submit"\` inside a \`<form onsubmit="…">\` that calls \`event.preventDefault()\` then persists + navigates / re-renders. A button that only changes styling on hover is **not** interactive.`,
    `- **Every \`<form>\`** must \`event.preventDefault()\`, collect form data via \`new FormData(form)\` (or per-field \`document.getElementById\`), validate (at minimum: non-empty required fields), persist to localStorage, and either redirect (\`window.location.href = "dashboard.html"\`) or re-render visible UI.`,
    `- **Every list/table** must render from localStorage state, not from hard-coded HTML. Use \`document.getElementById('list-root').innerHTML = ...\` (NOT React) or \`createElement\` loops.`,
    `- **Delete/edit actions** must mutate the localStorage array and immediately re-render the list.`,
    ``,
    `### State management pattern (use this exactly)`,
    ``,
    `\`\`\`html`,
    `<script>`,
    `  // Read state (returns a fresh array, never mutate the parsed value directly without writeState)`,
    `  function readState() {`,
    `    try { return JSON.parse(localStorage.getItem('${storageKey}') || '{}'); }`,
    `    catch { return {}; }`,
    `  }`,
    `  function writeState(next) {`,
    `    localStorage.setItem('${storageKey}', JSON.stringify(next));`,
    `  }`,
    `  // Seed example data on first ever page load, so the UI has something to show.`,
    `  // Without seeding the dashboard renders an empty state and the user thinks it's broken.`,
    `  (function seedIfEmpty() {`,
    `    const s = readState();`,
    `    if (!s.${examplePage} || s.${examplePage}.length === 0) {`,
    `      s.${examplePage} = [/* 3-5 realistic sample objects appropriate for this app */];`,
    `      writeState(s);`,
    `    }`,
    `  })();`,
    `</script>`,
    `\`\`\``,
    ``,
    `### Forbidden patterns (will be flagged as broken)`,
    ``,
    `- Buttons styled like buttons but missing an event handler.`,
    `- Forms that submit but don't persist anywhere (the next page load shows zero new data).`,
    `- Lists of items hard-coded in HTML when they should re-render from state.`,
    `- "Coming soon" placeholders on what should be a working feature.`,
    `- Decorative \`<select>\` / \`<input type="checkbox">\` with no change handlers.`,
    ``,
    `### Sanity check before each \`write_file\``,
    ``,
    `Before writing a page, ask: "Can a real user click every visible interactive element and see something change?" If any answer is no, add the handler before writing.`,
    ``,
  ].join('\n');
}

/** Build a focused execution directive from the plan. The legacy iteration
 *  loop sees this as a system message before its first turn — it tells the
 *  model exactly what files to write and what each should contain. */
async function buildExecutionDirective(plan: PlanType, projectSlug: string, projectTypeId: string): Promise<string> {
  const pagesPlan = plan.sitemap.map((p) => {
    const sectionsList = p.sections.map((s) => `\`${s}\``).join(', ');
    // Per-page image list — every shared_asset whose `used_in` includes this
    // page slug. Rendered inline so the model knows exactly which `<img src>`
    // references belong on this specific page WHEN IT IS FIRST WRITTEN.
    // The image bytes are filled in later by gen_image (the paths are
    // deterministic and stable across runs), but the HTML must reference
    // them from the initial write — that's the difference between a real
    // page with photos and a page that needs a second rewrite-pass to add
    // images (which is where the model's JSON-escape failure mode lives).
    const pageImages = (plan.shared_assets ?? []).filter((a) => a.used_in.includes(p.slug));
    const pageImagesBlock = pageImages.length > 0
      ? pageImages.map((a) => `    - \`<img src="/images/${a.id}.jpg" alt="${a.prompt.replace(/"/g, '\\"').slice(0, 80)}" />\``).join('\n')
      : '    (no images for this page)';
    // NOTE on `role`: this is structural metadata (a `+`-separated list of
    // section-type tokens like "hero+wod-of-day+free-intro-cta"). It's the
    // planner's shorthand for what the page IS, not copy to render. Prior
    // wording was `- **Role:** ${p.role}` which the model occasionally
    // copy-pasted verbatim into hero eyebrow text. The label below makes
    // the intent unmistakable so the model uses it for structural decisions
    // only and never writes it into rendered HTML.
    return `### \`${p.slug === 'index' ? 'index.html' : `${p.slug}.html`}\`
- **Title:** ${p.title}
- _Internal page-type hint (DO NOT render this token in HTML, use it only for structural decisions):_ \`${p.role}\`
- **Sections (in order):** ${sectionsList}
- **SEO title:** ${p.seo.title}
- **Meta description:** ${p.seo.meta_description}
- **Schema.org:** ${(p.schema_org ?? []).join(', ') || '(none)'}
- **Embed these img tags in this page's HTML on the FIRST write — exact src paths required, don't invent your own:**
${pageImagesBlock}`;
  }).join('\n\n');

  const assetsList = plan.shared_assets.length > 0
    ? plan.shared_assets.map((a) =>
        `- \`/images/${a.id}.jpg\` (used in: ${a.used_in.join(', ')}) — prompt: "${a.prompt}"`,
      ).join('\n')
    : '(no shared assets)';

  // Security guidance has 3 layers, each progressively more concrete:
  //   1. The OWASP prelude (loaded by chat.ts as a separate system msg) —
  //      universal principles, applied to every chat.
  //   2. The plan.security_notes from the niche manifest — what the planner
  //      decided this specific build needs (pulled in below).
  //   3. The per-type checklist file — concrete, project-shape-specific
  //      patterns the model must implement (loaded below for the 6 types
  //      that have one).
  const securityNotes = plan.security_notes.length > 0
    ? plan.security_notes.map((n) => `- ${n}`).join('\n')
    : '(none specified by planner)';
  const typeChecklist = await loadTypeSecurityChecklist(projectTypeId);

  // Today's date — same line the planner sees, mirrored here so the
  // executor doesn't fall back to training-cutoff defaults when writing
  // copyright footers / "as of YYYY" lines / seasonal copy. Without this
  // the LLM consistently writes "© 2024" in 2026.
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = today.slice(0, 4);

  const interactive = isInteractiveProjectType(projectTypeId);
  const interactivityBlock = interactive
    ? buildInteractivityMandate(plan, projectSlug)
    : '';

  return [
    `## Today: ${today}`,
    ``,
    `## BUILD PLAN (follow exactly)`,
    ``,
    `A planning subagent has analyzed the brief and produced this plan. **Build it page by page using write_file.** The plan has been validated; you do not need to re-plan.`,
    ``,
    `### Detected niche: \`${plan.niche}\``,
    `### Voice: ${plan.voice}`,
    `### Palette: \`${plan.palette}\``,
    `### Project type: \`${projectTypeId}\`${interactive ? '  ← **INTERACTIVE WEBAPP** — see Interactivity Mandate below' : ''}`,
    ``,
    `### Pages to write (write each via write_file):`,
    ``,
    pagesPlan,
    ``,
    ...(interactive ? [interactivityBlock] : []),
    `### Shared images`,
    `Each \`<img src>\` path below is **deterministic and stable** — the file shows up at that path after \`gen_image\` runs. **Reference these paths directly when you write each page**; do NOT wait until images are generated and then rewrite pages to add \`<img>\` tags (that requires a full file re-emit, which is the path most likely to fail with truncated tool args).`,
    ``,
    assetsList,
    ``,
    `### Compliance blocks (include in footer):`,
    plan.compliance_blocks.length > 0 ? plan.compliance_blocks.map((b) => `- ${b}`).join('\n') : '(none)',
    ``,
    `### Security notes from planner (must reflect in code):`,
    securityNotes,
    ``,
    ...(typeChecklist
      ? [`### Type-specific security checklist (\`${projectTypeId}\`)`, ``, typeChecklist, ``]
      : []),
    `### Content rules`,
    `- **Use the brief as the source of truth.** If the user gave a phone, email, address, or business name in the brief, use those values exactly. Do not paraphrase or "polish" real contact info.`,
    `- **When the brief omits contact info** (common in test builds), use these clearly-marked placeholders so the user knows what to swap before going live:`,
    `    - phone:   \`(555) 010-1234\`  ← the NANP reserved-for-fiction range. **Never** \`555-555-5555\`, \`555-1234\`, or any other made-up number.`,
    `    - email:   \`hello@yourbusiness.com\`. **Never** \`info@example.com\`, \`contact@example.org\`, \`@placeholder.com\`, or \`@test.com\`.`,
    `    - address: \`Your Business Address\` (or \`Your City, ST 00000\` if a multi-line address is needed). **Never** \`123 Main Street\`, \`123 Main St\`, or \`1234 Anywhere Ave\`.`,
    `- **Never write Lorem ipsum, TODO, FIXME, "[your text here]", "coming soon", or "lorem"** in user-facing copy. Write real niche-appropriate sentences from the planner's voice + section spec above.`,
    `- **Copyright footer:** use **${currentYear}** (the year from \`## Today\` above). Never hardcode \`2024\` or any other stale year.`,
    ``,
    `## EXECUTION ORDER`,
    `1. \`list_files\` to see what exists.`,
    `2. \`write_file\` for each page in the sitemap above. **CRITICAL: emit EXACTLY ONE \`write_file\` tool call per assistant response.** Do not batch multiple \`write_file\` calls into a single turn — full-page HTML serializes to 15-25 KB of JSON-escaped string, and stacking two calls in one response truncates the second call's \`arguments\` mid-string against the output-token budget (observable: the SECOND call comes back as \`{"_internal_status":"args_truncated_unparseable"}\`). One page per turn, wait for the \`File written: …\` tool result, then write the next. Each page must have:`,
    `   - Tailwind via CDN: \`<script src="https://cdn.tailwindcss.com"></script>\``,
    `   - The voice and tone described above`,
    `   - The exact sections listed for that page`,
    `   - Required SEO meta tags + Schema.org JSON-LD`,
    `   - **The \`<img src="/images/...">\` tags listed for that page above — embedded directly in the appropriate sections (hero, feature, gallery, etc.) on this FIRST write. Don't write the page first and rewrite it later to add images; that's the path that fails with truncated args.**`,
    `   - Compliance blocks in footer where applicable`,
    `   - Security patterns from the checklist above (where applicable to a static or dynamic page)`,
    `3. \`gen_image\` for each shared asset, saving to \`/images/<asset-id>.jpg\` — also **one \`gen_image\` per turn**, same reasoning. This generates the bytes the \`<img src>\` references already point at; no page rewrites needed afterward.`,
    `4. One short summary in chat (2-3 sentences max).`,
    ``,
    `Project slug: "${projectSlug}".`,
    ``,
    `**DO NOT** re-plan. **DO NOT** ask clarifying questions. **DO NOT** write SPEC.md or any markdown plan. **DO NOT** inline real API keys. Build the pages.`,
  ].join('\n');
}
