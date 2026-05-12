// apps/api/src/agent/kickoffRunner.ts — eager server-side agent run
// for the round-12 SPS auto-onboarding pipeline.
//
// Triggered fire-and-forget by POST /api/sps/projects/:id/kickoff after
// the kickoff_messages row is persisted. Runs the same three phases the
// IDE chat does — planner (runPrePhase) → executor (in-line tool loop)
// → polish + humanize (runPostPhase) — but without an SSE client on
// the other end. Instead of streaming, we persist:
//
//   - status updates to the project_kickoff_messages row
//     ('queued' → 'running' → 'completed' | 'failed')
//   - agent_runs / agent_steps rows so the IDE can re-render the run
//     history when the customer eventually opens the project
//
// Why a separate runner instead of reusing chat.ts: chat.ts is built
// around SSE streaming + the user's Supabase JWT + a client connection
// that can abort the run. None of that exists in the auto-onboarding
// path. A dedicated runner keeps both paths simple; the bits worth
// sharing (runPrePhase / runPostPhase, executeToolCall, the workspace
// helpers, the OWASP prelude loader) are already exported from their
// respective modules.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { ChatMessage, ToolCall } from '@abw/providers';
import { listProjectTypes, type ProjectTypeId } from '@abw/project-types';
import { createMinimaxAdapter } from '../providers/minimax';
import {
  getWorkspace,
  writeWorkspaceFile,
  listWorkspaceFiles,
  workspaceExists,
  restoreWorkspaceFromStorage,
} from '../preview/workspace';
import { runPrePhase, runPostPhase, type PhaseEvent } from './phases/runPhases';
import { executeToolCall, getAgentTools, type ToolContext } from './tools';
import { getDb, getRawSql } from '../db/client';
import { agentRuns, agentSteps, projects } from '@abw/db';
import { eq } from 'drizzle-orm';

/** Bounded so a runaway loop can't burn the api process. Mirrors
 *  chat.ts's MAX_ITERATIONS. */
const MAX_ITERATIONS = 30;

/** MiniMax error 2013: the request body for a follow-up assistant turn
 *  rejects empty-string content alongside tool_calls. Set to null
 *  instead. Mirrors chat.ts behavior. */
const NULL_ON_EMPTY = null;

const MAX_ARGS_BYTES = 40_000;
const MAX_TOOL_RESULT_BYTES = 8_000;

interface KickoffRow {
  id:        string;
  projectId: string;
  tenantId:  string;
  content:   string;
}

interface ProjectRow {
  id:     string;
  slug:   string;
  type:   string;
}

/** Public entry point. Caller passes the kickoff row id; we load
 *  everything else from the DB. Resolves when the run finishes
 *  (success or failure); never throws — failures are persisted to
 *  the row so the SPS caller can poll status via a future endpoint
 *  (or just trust that the customer-facing IDE will surface them). */
export async function runEagerKickoff(kickoffId: string): Promise<void> {
  const sql = getRawSql();

  // Load + flip row to 'running'. Done in one round-trip so a second
  // /kickoff call for the same row can't race-fire two parallel runs.
  let row: KickoffRow | undefined;
  let project: ProjectRow | undefined;
  try {
    const rows = await sql.unsafe(
      `UPDATE project_kickoff_messages
          SET status     = 'running',
              started_at = COALESCE(started_at, now()),
              updated_at = now()
        WHERE id = $1
          AND status = 'queued'
          AND deleted_at IS NULL
      RETURNING id, project_id, tenant_id, content`,
      [kickoffId],
    ) as Array<{ id: string; project_id: string; tenant_id: string; content: string }>;
    if (rows.length === 0) {
      // Either no such row, or someone else already transitioned it out
      // of 'queued'. Either way, this runner has nothing to do.
      // eslint-disable-next-line no-console
      console.warn(`[kickoff] runner for ${kickoffId} found no queued row — skipping`);
      return;
    }
    row = {
      id:        rows[0]!.id,
      projectId: rows[0]!.project_id,
      tenantId:  rows[0]!.tenant_id,
      content:   rows[0]!.content,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[kickoff] failed to claim row ${kickoffId}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  try {
    // Load the project metadata we need (slug + type). Use Drizzle so
    // the column names match the schema (`type` is the project type
    // enum: 'website' | 'landing_page' | ...).
    const projRows = await getDb()
      .select({ id: projects.id, slug: projects.slug, type: projects.type })
      .from(projects)
      .where(eq(projects.id, row.projectId))
      .limit(1);
    project = projRows[0]
      ? { id: projRows[0].id, slug: projRows[0].slug, type: projRows[0].type as string }
      : undefined;
    if (!project) {
      await markFailed(row.id, 'project_not_found_at_run_time');
      return;
    }

    await runKickoffBody(row, project);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[kickoff] run ${row.id} threw: ${msg}`);
    await markFailed(row.id, msg.slice(0, 500));
  }
}

/** Body of the run — extracted so the top-level catch keeps the
 *  finalize/mark-failed responsibility in one place. */
async function runKickoffBody(row: KickoffRow, project: ProjectRow): Promise<void> {
  // Map the DB enum (`landing_page`, `ai_movie`, ...) to the
  // listProjectTypes() id (which is the same string today, but going
  // through the registry is the defensive read).
  const projectType = listProjectTypes().find((pt) => pt.id === (project.type as ProjectTypeId));
  if (!projectType) {
    await markFailed(row.id, `unknown_project_type:${project.type}`);
    return;
  }

  // Adapter + workspace + tool context — same setup the chat flow does.
  const adapter = createMinimaxAdapter(row.tenantId, 'dev');
  const ws = await getWorkspace(row.tenantId, project.slug);
  if (!(await workspaceExists(ws))) {
    await restoreWorkspaceFromStorage(ws).catch(() => { /* non-fatal */ });
  }

  const hasImageGen = typeof adapter.generateImage === 'function';
  const toolCtx: ToolContext = {
    ws,
    generateImage: hasImageGen
      ? (prompt: string) => adapter.generateImage!({ prompt })
      : undefined,
    tenantId:  row.tenantId,
    env:       'dev',
    projectId: project.id,
    adapter,
  };

  // Create an agent_run row so the IDE can render the kickoff run
  // alongside human-driven runs. Failures here are non-fatal — they
  // just mean the IDE won't show this run in history.
  const runId = await createAgentRun({
    tenantId:  row.tenantId,
    projectId: project.id,
    goal:      `SPS kickoff: ${row.content.slice(0, 80)}${row.content.length > 80 ? '…' : ''}`,
    model:     'MiniMax-M2.7',
  }).catch(() => null);
  if (runId) {
    await getRawSql().unsafe(
      `UPDATE project_kickoff_messages
          SET agent_run_id = $1, updated_at = now()
        WHERE id = $2`,
      [runId, row.id],
    ).catch(() => { /* non-fatal */ });
  }

  // Build history: OWASP prelude (best-effort) → tool hint → planner
  // enhanced directive → the SPS kickoff content as the user message.
  // Same layering chat.ts uses (apps/api/src/routes/chat.ts) so the
  // model sees the same context shape it does in interactive use.
  const history: ChatMessage[] = [];

  const owasp = await loadOwaspPrelude();
  if (owasp) history.push({ role: 'system', content: owasp });

  history.push({
    role:    'system',
    content: kickoffToolHint(project.slug, hasImageGen),
  });

  // Run the planner subagent (Phase A). Same call chat.ts does. If
  // the planner fails or skips (project type without
  // agentInstructions), we still proceed with the bare tool hint.
  let plannedPageSlugs: string[] = [];
  const events: PhaseEvent[] = [];
  if (projectType.agentInstructions) {
    const preResult = await runPrePhase({
      brief:       row.content,
      projectType,
      projectSlug: project.slug,
      adapter,
      model:       'MiniMax-M2.7',
      emit:        (event) => { events.push(event); },
    });
    if (preResult.planAvailable && preResult.enhancedSystemMessage && preResult.plan) {
      history.push({ role: 'system', content: preResult.enhancedSystemMessage });
      // Persist plan + page slugs (used by the incomplete-build nudge
      // below, mirroring chat.ts).
      plannedPageSlugs = preResult.plan.sitemap.map((p) => p.slug);
      await writeWorkspaceFile(ws, '_plan.json', JSON.stringify(preResult.plan, null, 2))
        .catch(() => { /* non-fatal */ });
    }
  }

  // Finally, the user message — the SPS-supplied kickoff content.
  history.push({ role: 'user', content: row.content });

  // Iterate the tool loop. Identical structure to chat.ts but writing
  // to agent_steps instead of an SSE stream.
  const toolList = getAgentTools({ designSkillsEnabled: false, replicateEnabled: false });
  // No client connection to abort; provide a placeholder signal the
  // adapter never actually uses. If we ever need to cancel a runaway
  // kickoff (e.g., from an admin endpoint), wire this to a controller.
  const ctrl = new AbortController();

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let assistantText = '';
    const toolCalls: ToolCall[] = [];
    let hadError = false;

    for await (const chunk of adapter.chat({
      messages: history, model: 'MiniMax-M2.7',
      temperature: 0.7, maxTokens: 4096,
      tools: toolList, toolChoice: 'auto',
    }, { signal: ctrl.signal })) {
      if (chunk.type === 'delta')      { assistantText += chunk.delta; }
      else if (chunk.type === 'tool_call') { toolCalls.push(chunk.toolCall); }
      else if (chunk.type === 'done')      { break; }
      else if (chunk.type === 'error')     { hadError = true; await recordStep(runId, 'planner', 'chat.error', chunk.error, 'failed'); break; }
    }
    if (hadError) break;

    // No tool calls → either the model is done or it narrated without
    // acting. Same nudge logic as chat.ts: if the sitemap planner
    // committed to N pages and the agent wrote fewer, force one more
    // iteration with an explicit "STOP — write the missing pages" nudge.
    if (toolCalls.length === 0) {
      const writtenPaths = collectWrittenPaths(history);
      const missing = plannedPageSlugs.length > 0
        ? plannedPageSlugs.filter((slug) => {
            const candidates = [`${slug}.html`, `${slug}.htm`, `${slug}/index.html`, `pages/${slug}.html`]
              .map((c) => c.toLowerCase());
            return !candidates.some((c) => writtenPaths.has(c));
          })
        : [];
      const buildIncomplete = writtenPaths.size === 0
        || (plannedPageSlugs.length > 0 && missing.length > 0);
      if (buildIncomplete && iter < MAX_ITERATIONS - 1) {
        if (assistantText) history.push({ role: 'assistant', content: assistantText });
        history.push({
          role:    'system',
          content: missing.length > 0
            ? `STOP. The build is INCOMPLETE — the plan committed to pages that aren't in the workspace yet. MISSING: ${missing.map((s) => `${s}.html`).join(', ')}. Write each one now via write_file with the same layout/styling as the pages you already produced. No reading existing files unnecessarily, no re-planning, no narration — call write_file as your very next action.`
            : `STOP. You have not yet written any pages. The BUILD PLAN above lists every page to write — start with write_file path="index.html" and full HTML content RIGHT NOW. No more reading. No more narration. WRITE THE FILES.`,
        });
        continue;
      }
      break;
    }

    // Persist the assistant turn (with tool calls) into history.
    const sanitizedCalls = toolCalls.map((tc) => {
      let safeArgs = tc.function.arguments;
      try {
        JSON.parse(safeArgs);
        if (safeArgs.length > MAX_ARGS_BYTES) {
          safeArgs = JSON.stringify({ error: 'arguments truncated — content was too large for history' });
        }
      } catch {
        safeArgs = JSON.stringify({ error: 'arguments were not valid JSON — model should retry with smaller content' });
      }
      return { ...tc, function: { ...tc.function, arguments: safeArgs } };
    });

    history.push({
      role:       'assistant',
      content:    assistantText || NULL_ON_EMPTY,
      tool_calls: sanitizedCalls,
    });

    // Execute each tool, record an agent_step, append a tool message
    // to history. Tool side-effects (writeWorkspaceFile / gen_image /
    // etc) hit the workspace directly — the IDE will see them when
    // the customer opens.
    for (const tc of toolCalls) {
      const res = await executeToolCall(toolCtx, tc.function.name, tc.function.arguments);
      await recordStep(
        runId,
        'builder',
        tc.function.name,
        res.summary,
        res.ok ? 'completed' : 'failed',
        { argsHash: hashString(tc.function.arguments), resultHash: hashString(res.result) },
      );
      const safeResult = res.result.length > MAX_TOOL_RESULT_BYTES
        ? res.result.slice(0, MAX_TOOL_RESULT_BYTES) + '\n…[truncated]'
        : res.result;
      history.push({
        role:         'tool',
        content:      safeResult,
        tool_call_id: tc.id,
        name:         tc.function.name,
      });
    }
  }

  // Polish + humanize. Mirrors the chat.ts finally-block call.
  await runPostPhase({ ws, emit: () => { /* swallowed for kickoff */ } })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`[kickoff] runPostPhase failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    });

  // Mark the run + kickoff complete.
  if (runId) {
    await getRawSql().unsafe(
      `UPDATE agent_runs SET status = 'completed', ended_at = now() WHERE id = $1`,
      [runId],
    ).catch(() => { /* non-fatal */ });
  }
  await getRawSql().unsafe(
    `UPDATE project_kickoff_messages
        SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE id = $1`,
    [row.id],
  ).catch(() => { /* non-fatal */ });
}

// ── Helpers ────────────────────────────────────────────────────────

async function markFailed(rowId: string, error: string): Promise<void> {
  try {
    await getRawSql().unsafe(
      `UPDATE project_kickoff_messages
          SET status = 'failed', error = $2, completed_at = now(), updated_at = now()
        WHERE id = $1`,
      [rowId, error],
    );
  } catch { /* don't throw out of an error handler */ }
}

async function createAgentRun(opts: {
  tenantId: string; projectId: string; goal: string; model: string;
}): Promise<string | null> {
  try {
    const [row] = await getDb().insert(agentRuns).values({
      tenantId:  opts.tenantId,
      projectId: opts.projectId,
      goal:      opts.goal,
      provider:  'minimax',
      model:     opts.model,
      status:    'running',
      startedAt: new Date(),
    }).returning({ id: agentRuns.id });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

async function recordStep(
  runId: string | null,
  role: 'planner' | 'builder' | 'runtime' | 'visual' | 'backend' | 'fixer' | 'release',
  tool: string,
  message: string,
  status: 'completed' | 'failed',
  hashes?: { argsHash?: string; resultHash?: string },
): Promise<void> {
  if (!runId) return;
  try {
    await getDb().insert(agentSteps).values({
      runId,
      // tenantId is required by the schema but agent_steps inherits it
      // from agent_runs in practice. We fetch from agent_runs to keep
      // the insert simple; failure is non-fatal because the step is
      // diagnostic.
      tenantId:   await getRunTenant(runId),
      role,
      tool,
      inputHash:  hashes?.argsHash,
      outputHash: hashes?.resultHash,
      status,
      error:      status === 'failed' ? message.slice(0, 500) : null,
    });
  } catch { /* non-fatal */ }
}

let runTenantCache: Map<string, string> | null = null;
async function getRunTenant(runId: string): Promise<string> {
  if (!runTenantCache) runTenantCache = new Map();
  const cached = runTenantCache.get(runId);
  if (cached) return cached;
  try {
    const rows = await getRawSql().unsafe(
      `SELECT tenant_id FROM agent_runs WHERE id = $1 LIMIT 1`,
      [runId],
    ) as Array<{ tenant_id: string }>;
    const id = rows[0]?.tenant_id ?? '';
    if (id) runTenantCache.set(runId, id);
    return id;
  } catch {
    return '';
  }
}

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function loadOwaspPrelude(): Promise<string | null> {
  const candidates = [
    resolve(process.cwd(), 'apps', 'api', 'src', 'agent', 'skills', 'security', 'owasp-prelude.md'),
    resolve(process.cwd(), 'src', 'agent', 'skills', 'security', 'owasp-prelude.md'),
  ];
  for (const c of candidates) {
    try { return await readFile(c, 'utf8'); } catch { /* try next */ }
  }
  return null;
}

/** Collect the set of paths the agent has already written via
 *  write_file across the run. Used by the incomplete-build nudge.
 *  Tolerant parse mirroring tools.ts/findArgString. */
function collectWrittenPaths(history: ChatMessage[]): Set<string> {
  const writtenPaths = new Set<string>();
  const PATH_ALIASES = ['path', 'filepath', 'file', 'filename', 'pathname', 'name', 'relpath', 'relativepath', 'dest', 'destination', 'target', 'to', 'out', 'output', 'outputpath'];
  const WRAPPERS = ['args', 'arguments', 'input', 'params', 'parameters', 'function', 'data', 'payload', 'tool_input', 'toolInput'];
  const norm = (k: string): string => k.toLowerCase().replace(/[_\-\s]/g, '');
  const aliasSet = new Set(PATH_ALIASES.map(norm));
  const findPath = (obj: Record<string, unknown>): string | undefined => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.trim() && aliasSet.has(norm(k))) return v.trim();
    }
    return undefined;
  };
  for (const m of history) {
    if (m.role !== 'assistant') continue;
    const calls = (m as { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> }).tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const tc of calls) {
      if (tc.function?.name !== 'write_file') continue;
      try {
        const raw = JSON.parse(tc.function.arguments ?? '{}') as unknown;
        const root: Record<string, unknown> = Array.isArray(raw)
          ? ((raw.find((el) => el && typeof el === 'object' && !Array.isArray(el)) as Record<string, unknown> | undefined) ?? {})
          : (raw as Record<string, unknown>) ?? {};
        let p = findPath(root);
        if (!p) {
          for (const w of WRAPPERS) {
            const inner = root[w];
            if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
              p = findPath(inner as Record<string, unknown>);
              if (p) break;
            }
          }
        }
        if (typeof p === 'string') writtenPaths.add(p.replace(/^\/+/, '').toLowerCase());
      } catch { /* malformed — counted as no path */ }
    }
  }
  return writtenPaths;
}

function kickoffToolHint(slug: string, hasImageGen: boolean): string {
  return [
    `You have access to project workspace tools: write_file, read_file, list_files, delete_file${hasImageGen ? ', gen_image' : ''}.`,
    ``,
    `This run is the FIRST agent run on a new project, kicked off from the SPS auto-onboarding pipeline. The user message below is a generated build brief — treat it as the customer's direct ask. Build the site by calling write_file for each page, then ${hasImageGen ? 'gen_image for each hero / illustration' : 'reference Unsplash URLs or CSS gradients'}.`,
    ``,
    `RULES — read before every response:`,
    `1. Call write_file immediately. Do NOT write SPEC.md / README.md / TODO.md / plan.md.`,
    `2. Write index.html BEFORE generating images so the site renders even if image gen fails.`,
    `3. Forbidden frameworks: Next.js, Remix, Astro, Nuxt, SvelteKit, app/ directory. Static HTML + Tailwind CDN, or Vite React SPA.`,
    `4. One short summary in chat when done.`,
    ``,
    `Project slug: "${slug}".`,
  ].join('\n');
}
