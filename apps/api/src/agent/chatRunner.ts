// apps/api/src/agent/chatRunner.ts — server-side agent loop for SPS's
// build-driver chat path (round 14).
//
// Difference from kickoffRunner (round 12):
//   - kickoffRunner is one-shot: a single seed message fires runPlanner
//     + tool loop + polish + done. No persistence of messages.
//   - chatRunner is multi-turn: SPS posts a message via POST
//     /api/sps/projects/:id/chat, this runner appends it to
//     chat_messages, optionally invokes the agent (which writes its
//     own assistant + tool messages to chat_messages), then returns.
//     SPS polls GET /api/sps/projects/:id/chat?since=<cursor> to see
//     responses and detect "done."
//
// The conversation history is hydrated from chat_messages on every
// run (so the agent has continuity across SPS posts). For
// projects that ALSO had a kickoff (round 12), the kickoff's user
// message is replayed too — chat_messages and project_kickoff_messages
// are separate tables but the runner walks the kickoff row's
// `content` and prepends it as the first user message if no
// chat_messages exist yet.
//
// Why a separate runner from kickoffRunner: kickoffRunner runs
// in fire-and-forget mode after a 200 returns to SPS. chatRunner runs
// synchronously inside the POST request so the route can return the
// `agent_run_id`. The shape is similar but the lifecycles differ.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ChatMessage, ToolCall } from '@abw/providers';
import { listProjectTypes, type ProjectTypeId } from '@abw/project-types';
import { createMinimaxAdapter } from '../providers/minimax';
import {
  getWorkspace,
  writeWorkspaceFile,
  workspaceExists,
  restoreWorkspaceFromStorage,
} from '../preview/workspace';
import { runPrePhase, runPostPhase, type PhaseEvent } from './phases/runPhases';
import { executeToolCall, getAgentTools, type ToolContext } from './tools';
import { getDb, getRawSql } from '../db/client';
import { agentRuns, agentSteps, projects } from '@abw/db';
import { eq } from 'drizzle-orm';

const MAX_ITERATIONS = 30;
const MAX_ARGS_BYTES = 40_000;
const MAX_TOOL_RESULT_BYTES = 8_000;

interface ProjectRow {
  id:     string;
  tenantId: string;
  slug:   string;
  type:   string;
}

/** Public entry point. Called from POST /api/sps/projects/:id/chat
 *  after the user message has been persisted. Returns the
 *  agent_run_id so the route can echo it back to SPS.
 *
 *  Errors are non-fatal: they're logged + persisted to a final
 *  assistant message ("Run failed: ...") + the agent_run row is
 *  marked failed. The route still returns 200 with the message_id
 *  it persisted before calling this function. SPS's poll loop will
 *  see the failure message and the agent_status='failed' and react. */
export async function runChatTurn(opts: {
  projectId:      string;
  newUserMessageId: string;  // the message we just persisted
}): Promise<{ agentRunId: string | null }> {
  const proj = await loadProject(opts.projectId);
  if (!proj) {
    await appendAssistantMessage(opts.projectId, '', `Run failed: project_not_found`, null);
    return { agentRunId: null };
  }

  const runId = await openAgentRun({
    tenantId:  proj.tenantId,
    projectId: proj.id,
    goal:      'SPS chat turn',
  });

  try {
    await runChatBody(proj, runId);
    if (runId) {
      await getRawSql().unsafe(
        `UPDATE agent_runs SET status = 'completed', ended_at = now() WHERE id = $1`,
        [runId],
      ).catch(() => { /* non-fatal */ });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[chatRunner] run ${runId} threw: ${msg}`);
    await appendAssistantMessage(proj.id, proj.tenantId, `Run failed: ${msg.slice(0, 500)}`, runId);
    if (runId) {
      await getRawSql().unsafe(
        `UPDATE agent_runs SET status = 'failed', ended_at = now(), summary = $2 WHERE id = $1`,
        [runId, msg.slice(0, 500)],
      ).catch(() => { /* non-fatal */ });
    }
  }

  // Suppress unused-var lint on the new user message id — kept in the
  // signature for future use (e.g., correlation in agent_steps).
  void opts.newUserMessageId;

  return { agentRunId: runId };
}

async function runChatBody(proj: ProjectRow, runId: string | null): Promise<void> {
  const projectType = listProjectTypes().find((pt) => pt.id === (proj.type as ProjectTypeId));

  const adapter = createMinimaxAdapter(proj.tenantId, 'dev');
  const ws = await getWorkspace(proj.tenantId, proj.slug);
  if (!(await workspaceExists(ws))) {
    await restoreWorkspaceFromStorage(ws).catch(() => { /* non-fatal */ });
  }

  const hasImageGen = typeof adapter.generateImage === 'function';
  const toolCtx: ToolContext = {
    ws,
    generateImage: hasImageGen
      ? (prompt: string) => adapter.generateImage!({ prompt })
      : undefined,
    tenantId:  proj.tenantId,
    env:       'dev',
    projectId: proj.id,
    adapter,
  };

  // Hydrate conversation history from chat_messages. Includes the
  // just-appended user message. ALSO prepend any kickoff message
  // from round 12 so the agent has the original brief even on
  // follow-up turns.
  const history: ChatMessage[] = [];

  const owasp = await loadOwaspPrelude();
  if (owasp) history.push({ role: 'system', content: owasp });

  history.push({
    role:    'system',
    content: chatToolHint(proj.slug, hasImageGen),
  });

  // Replay kickoff message (round 12) if present and not already in
  // chat_messages history.
  const kickoffContent = await loadKickoffContent(proj.id);
  if (kickoffContent) {
    history.push({ role: 'user', content: kickoffContent });
  }

  // Load existing chat_messages for this project.
  //
  // `normalizeToolCalls` handles rows written by the pre-round-14.6 double-encode
  // bug — those have `tool_calls` stored as a jsonb *string* and come back from
  // the driver as a string. We parse them back to arrays here so the
  // assistant↔tool message pairing survives. Without this, the strict
  // Array.isArray check in messagesToApi drops the malformed value and the
  // following `tool` messages get sent to MiniMax orphaned.
  const existing = await loadProjectMessages(proj.id);
  for (const m of existing) {
    if (m.role === 'system') continue; // we already injected system prelude/hint
    const toolCalls = normalizeToolCalls(m.tool_calls);
    history.push({
      role:    m.role,
      content: m.content,
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    });
  }

  // Optionally run planner on the very first turn (no agent_run_id
  // history yet). Same pattern as kickoffRunner.
  const isFirstTurn = await isFirstAgentRun(proj.id, runId);
  if (isFirstTurn && projectType?.agentInstructions) {
    const briefMsg = [...history].reverse().find((m) => m.role === 'user');
    const brief = typeof briefMsg?.content === 'string' ? briefMsg.content : '';
    if (brief) {
      const events: PhaseEvent[] = [];
      const preResult = await runPrePhase({
        brief,
        projectType,
        projectSlug: proj.slug,
        adapter,
        model:       'MiniMax-M2.7',
        emit:        (event) => { events.push(event); },
      });
      if (preResult.planAvailable && preResult.enhancedSystemMessage && preResult.plan) {
        // Inject the build directive AFTER the tool hint, BEFORE the user message.
        history.splice(2, 0, { role: 'system', content: preResult.enhancedSystemMessage });
        await writeWorkspaceFile(ws, '_plan.json', JSON.stringify(preResult.plan, null, 2))
          .catch(() => { /* non-fatal */ });
      }
    }
  }

  // Tool loop. Each assistant + tool message gets appended to
  // chat_messages so SPS's GET poll sees it.
  //
  // `creativeSuiteEnabled: false` strips compose_email/create_ebook/
  // create_document/generate_music — neither website nor webapp builds
  // call those, and shipping their schemas inflated the MiniMax request
  // past a serialization threshold (see round 14.4 INBOUND).
  const toolList = getAgentTools({
    designSkillsEnabled:  false,
    replicateEnabled:     false,
    creativeSuiteEnabled: false,
  });
  const ctrl = new AbortController();

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let assistantText = '';
    const toolCalls: ToolCall[] = [];
    let hadError = false;

    for await (const chunk of adapter.chat({
      messages: history, model: 'MiniMax-M2.7',
      // 4096 was too small: a full single-file Tailwind page is ~16 KB
      // (~4 K tokens of content) and the model also spends tokens on its
      // <think> trace, so write_file calls truncated mid-arguments — which
      // then poisoned the persisted history. 8192 covers a typical page in
      // one shot; M2.7's context window is 204 K so headroom is fine, and
      // the adapter's 240 s hang-guard absorbs the extra latency.
      temperature: 0.7, maxTokens: 8192,
      tools: toolList, toolChoice: 'auto',
    }, { signal: ctrl.signal })) {
      if (chunk.type === 'delta')      { assistantText += chunk.delta; }
      else if (chunk.type === 'tool_call') { toolCalls.push(chunk.toolCall); }
      else if (chunk.type === 'done')      { break; }
      else if (chunk.type === 'error')     {
        hadError = true;
        await appendAssistantMessage(proj.id, proj.tenantId, `Adapter error: ${chunk.error}`, runId);
        break;
      }
    }
    if (hadError) break;

    // Sanitize tool_call arguments BEFORE anything else. A truncated /
    // invalid-JSON `arguments` string (model hit the output token limit
    // mid-call) must never be persisted raw — once it lands in
    // chat_messages it poisons every later run's hydrated history and
    // MiniMax rejects the whole conversation ("invalid chat setting
    // (2013)"). messagesToApi also guards this at the wire; persisting
    // clean keeps the DB honest so future hydrations start sane.
    const sanitizedCalls = toolCalls.map((tc) => {
      let safeArgs = tc.function.arguments;
      try {
        JSON.parse(safeArgs);
        if (safeArgs.length > MAX_ARGS_BYTES) {
          safeArgs = JSON.stringify({ error: 'arguments truncated' });
        }
      } catch {
        safeArgs = JSON.stringify({ error: 'arguments were not valid JSON' });
      }
      return { ...tc, function: { ...tc.function, arguments: safeArgs } };
    });

    // Persist the assistant turn to chat_messages so SPS sees it.
    // Empty assistantText is OK (model can emit only tool_calls).
    // Persist the SANITIZED calls, never the raw ones.
    if (assistantText || sanitizedCalls.length > 0) {
      await appendAssistantMessage(
        proj.id,
        proj.tenantId,
        assistantText,
        runId,
        sanitizedCalls.length > 0 ? sanitizedCalls : null,
      );
    }

    if (toolCalls.length === 0) {
      // Agent ended its turn (no tool calls). Loop exits — SPS's
      // poll will see assistant message + agent_status='idle' and
      // can decide whether to follow up or call it done.
      history.push({ role: 'assistant', content: assistantText });
      return;
    }

    history.push({
      role:       'assistant',
      content:    assistantText || null,
      tool_calls: sanitizedCalls,
    });

    // Execute tools + persist results.
    for (const tc of toolCalls) {
      const res = await executeToolCall(toolCtx, tc.function.name, tc.function.arguments);
      const safeResult = res.result.length > MAX_TOOL_RESULT_BYTES
        ? res.result.slice(0, MAX_TOOL_RESULT_BYTES) + '\n…[truncated]'
        : res.result;

      // Persist tool result to chat_messages so SPS sees it.
      await appendToolMessage(proj.id, proj.tenantId, safeResult, tc.id, tc.function.name, runId);

      // Persist agent_step for IDE history.
      if (runId) {
        await getDb().insert(agentSteps).values({
          runId,
          tenantId:  proj.tenantId,
          role:      'builder',
          tool:      tc.function.name,
          status:    res.ok ? 'completed' : 'failed',
          error:     res.ok ? null : safeResult.slice(0, 500),
        }).catch(() => { /* non-fatal */ });
      }

      history.push({
        role:         'tool',
        content:      safeResult,
        tool_call_id: tc.id,
        name:         tc.function.name,
      });
    }
  }

  // Polish + humanize at the end.
  await runPostPhase({ ws, emit: () => { /* swallowed */ } })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(`[chatRunner] runPostPhase failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    });
}

// ── Persistence helpers ──────────────────────────────────────────

async function loadProject(projectId: string): Promise<ProjectRow | null> {
  try {
    const rows = await getDb()
      .select({
        id:       projects.id,
        tenantId: projects.tenantId,
        slug:     projects.slug,
        type:     projects.type,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows[0]
      ? { id: rows[0].id, tenantId: rows[0].tenantId, slug: rows[0].slug, type: rows[0].type as string }
      : null;
  } catch {
    return null;
  }
}

interface DbChatMessage {
  role:         'user' | 'assistant' | 'tool' | 'system';
  content:      string;
  tool_calls:   unknown;
  tool_call_id: string | null;
}

/** Coerce a chat_messages.tool_calls value into a clean ToolCall[] or null.
 *  Handles three shapes:
 *    - null / undefined            → null (no tool calls on this turn)
 *    - ToolCall[]                  → returned as-is (the correct, post-fix shape)
 *    - string (double-encode bug)  → JSON.parse'd back to an array
 *  Anything that doesn't resolve to a non-empty array becomes null so it's
 *  simply omitted from the outgoing MiniMax payload. */
function normalizeToolCalls(raw: unknown): ToolCall[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.length > 0 ? (raw as ToolCall[]) : null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length > 0 ? (parsed as ToolCall[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function loadProjectMessages(projectId: string): Promise<DbChatMessage[]> {
  try {
    const rows = await getRawSql().unsafe(
      `SELECT role, content, tool_calls, tool_call_id
         FROM chat_messages
        WHERE project_id = $1
        ORDER BY created_at ASC
        LIMIT 200`,
      [projectId],
    ) as Array<DbChatMessage>;
    return rows;
  } catch {
    return [];
  }
}

async function loadKickoffContent(projectId: string): Promise<string | null> {
  try {
    const rows = await getRawSql().unsafe(
      `SELECT content FROM project_kickoff_messages
        WHERE project_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1`,
      [projectId],
    ) as Array<{ content: string }>;
    return rows[0]?.content ?? null;
  } catch {
    return null;
  }
}

async function isFirstAgentRun(projectId: string, currentRunId: string | null): Promise<boolean> {
  try {
    const rows = await getRawSql().unsafe(
      `SELECT COUNT(*)::int AS n FROM agent_runs
        WHERE project_id = $1
          AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [projectId, currentRunId],
    ) as Array<{ n: number }>;
    return (rows[0]?.n ?? 0) === 0;
  } catch {
    return false;
  }
}

async function openAgentRun(opts: {
  tenantId: string; projectId: string; goal: string;
}): Promise<string | null> {
  try {
    const [row] = await getDb().insert(agentRuns).values({
      tenantId:  opts.tenantId,
      projectId: opts.projectId,
      goal:      opts.goal,
      provider:  'minimax',
      model:     'MiniMax-M2.7',
      status:    'running',
      startedAt: new Date(),
    }).returning({ id: agentRuns.id });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

// jsonb insert note (round 14.6 fix): postgres-js double-encodes when you
// pass `JSON.stringify(value)` into a `$n::jsonb` param — the already-stringified
// text gets JSON-encoded a SECOND time, so the column ends up holding a jsonb
// *string* (`"[{...}]"`) instead of a jsonb *array* (`[{...}]`). On read-back
// the value comes out as a string, messagesToApi's Array.isArray check drops
// it, and the paired `tool` messages become orphaned → MiniMax "invalid chat
// setting (2013)". The fix is `sql.json(value)` with NO `::jsonb` cast — that
// marks the param as JSON so postgres-js serializes it exactly once.

async function appendAssistantMessage(
  projectId: string,
  tenantId:  string,
  content:   string,
  agentRunId: string | null,
  toolCalls: ToolCall[] | null = null,
): Promise<void> {
  try {
    const sql = getRawSql();
    // `sql.json(...)` cast through unknown — postgres-js's JSONValue type is
    // stricter than ToolCall[] (no string index signature) but the runtime
    // shape is plain JSON, so the cast is safe.
    const tcParam = toolCalls
      ? sql.json(toolCalls as unknown as Parameters<typeof sql.json>[0])
      : null;
    await sql.unsafe(
      `INSERT INTO chat_messages (project_id, tenant_id, role, content, tool_calls, agent_run_id)
       VALUES ($1, $2, 'assistant', $3, $4, $5)`,
      [projectId, tenantId, content, tcParam, agentRunId],
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[chatRunner] failed to append assistant message: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function appendToolMessage(
  projectId:  string,
  tenantId:   string,
  content:    string,
  toolCallId: string,
  toolName:   string,
  agentRunId: string | null,
): Promise<void> {
  try {
    const sql = getRawSql();
    await sql.unsafe(
      `INSERT INTO chat_messages (project_id, tenant_id, role, content, tool_call_id, agent_run_id, metadata)
       VALUES ($1, $2, 'tool', $3, $4, $5, $6)`,
      [projectId, tenantId, content, toolCallId, agentRunId, sql.json({ tool_name: toolName })],
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[chatRunner] failed to append tool message: ${err instanceof Error ? err.message : String(err)}`);
  }
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

function chatToolHint(slug: string, hasImageGen: boolean): string {
  return [
    `You have access to project workspace tools: write_file, read_file, list_files, delete_file${hasImageGen ? ', gen_image' : ''}.`,
    ``,
    `You are responding in a CHAT loop driven by an external client. Treat each user message as a request that may build, iterate, or refine the project. When the build is complete and ready for owner review, your final assistant turn (after all tool calls finish) should include a phrase like "the site is ready" or "build complete" so the external driver can detect completion.`,
    ``,
    `RULES:`,
    `1. Call write_file immediately when asked to build. Do NOT write SPEC.md / README.md / plan.md.`,
    `2. Write index.html BEFORE generating images.`,
    `3. Forbidden frameworks: Next.js, Remix, Astro, Nuxt, SvelteKit, app/ directory. Static HTML + Tailwind CDN, or Vite React SPA.`,
    `4. When build is done, write ONE short summary message including a completion phrase ("site is ready", "build complete", "ready to publish", or "draft is live"). No tool calls in the final assistant turn.`,
    ``,
    `Project slug: "${slug}".`,
  ].join('\n');
}
