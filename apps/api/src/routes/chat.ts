// apps/api/src/routes/chat.ts — streaming chat with agent tool loop.
// POST /api/chat  →  calls the selected provider adapter, streams SSE back.
// When a projectSlug is present, the agent loop is enabled:
//   model emits tool_calls → server executes them against the workspace →
//   tool results are fed back into the model → repeat until no more tool_calls.
// The client renders text deltas into the assistant message and renders
// tool_start / tool_result events as inline "action" cards.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, type AuthContext } from '../security/authz';
import { createMinimaxAdapter } from '../providers/minimax';
import { createOllamaAdapter } from '../providers/ollama';
import { env } from '../config/env';
import { getWorkspace, writeWorkspaceFile, writeWorkspaceFileBuffer, listWorkspaceFiles, workspaceExists, restoreWorkspaceFromStorage } from '../preview/workspace';
import { AGENT_TOOLS, executeToolCall, getAgentTools, type ToolContext } from '../agent/tools';
import { runPrePhase, runPostPhase, type PhaseEvent } from '../agent/phases/runPhases';
import { runCompletionPhase } from '../agent/phases/complete';
import type { PlanType } from '../agent/phases/plan';
import {
  appendUserMessage,
  appendAssistantMessage,
  appendToolMessage,
  loadProjectMessages,
} from '../db/chatMessages';
import type { ChatMessage, ContentPart, ToolCall } from '@abw/providers';
import { listProjectTypes } from '@abw/project-types';
import type { ProjectTypeId } from '@abw/project-types';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const MessageSchema = z.object({
  role:    z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  tool_call_id: z.string().optional(),
  name:         z.string().optional(),
});

const AttachmentSchema = z.object({
  url:      z.string().url(),
  mimeType: z.string(),
  name:     z.string(),
  assetId:  z.string().uuid().optional(),
  isLogo:   z.boolean().optional(),
  colors:   z.array(z.string()).optional(),
});

const ChatBodySchema = z.object({
  messages:    z.array(MessageSchema).min(1),
  provider:    z.string().default('minimax'),
  model:       z.string().default('MiniMax-M2.7'),
  projectEnv:  z.enum(['dev', 'staging', 'preview', 'production']).default('dev'),
  projectSlug: z.string().optional(),
  /** Project type ID (e.g. "website", "landing-page"). Optional — when provided
   *  AND the type has agentInstructions defined, the phase orchestrator runs
   *  the planner subagent first to produce a niche-aware build plan. */
  projectTypeId: z.string().optional(),
  enableTools: z.boolean().default(true),
  /** Huashu Design skill toggle. When true, agent gets the design.run_huashu tool
   *  and a system prompt prelude that biases toward visual deliverables. */
  designSkillsEnabled: z.boolean().default(false),
  /** Replicate video generation toggle (curated cost-effective models).
   *  Off by default. Gates Replicate tool registration in the agent loop. */
  replicateEnabled:    z.boolean().default(false),
  /** Higgsfield was removed from active surfaces in the 2026-05 update. The
   *  field is still accepted (with default false) for backwards compatibility
   *  with any cached SPA bundle still sending it, but it is otherwise ignored —
   *  the agent tool registry no longer registers higgsfield.* tools. */
  higgsfieldEnabled:   z.boolean().default(false),
  /** Files attached by the user in the chat composer. */
  attachments: z.array(AttachmentSchema).optional(),
});

// How many times we're willing to round-trip tool_calls → exec → back to model.
// 12 is plenty for scaffolding a small app; keeps a runaway loop bounded.
const MAX_ITERATIONS = 30;

// System hint appended when tools are active. Nudges the model to actually
// call write_file instead of emitting code as markdown in the chat.
function toolHint(slug: string, hasImageGen: boolean): string {
  return [
    `You have access to project workspace tools: write_file, read_file, list_files, delete_file${hasImageGen ? ', gen_image' : ''}.`,
    ``,
    `## CRITICAL RULES — read before every response`,
    `1. When the user asks you to build, create, scaffold, or modify ANYTHING — immediately call write_file. Do NOT ask clarifying questions. Do NOT write a plan. Do NOT write a spec. Do NOT paste code in chat. WRITE THE FILES.`,
    `2. NEVER write SPEC.md, README.md, plan.md, TODO.md, or ANY markdown planning document. The user will SEE these orphan files in the IDE and the preview will fail to render. If you find yourself reaching for write_file with a .md filename, STOP — the next file you write MUST be index.html instead. Plans live in your head.`,
    `3. ALWAYS write "index.html" BEFORE generating any images. The site must render even if image gen fails or runs out of credits.`,
    `4. If files already exist in the workspace (call list_files to check), build on them. Do not re-plan.`,
    ``,
    `## SUPPORTED PROJECT SHAPES — pick one:`,
    `  A. Static site — "index.html" at root, optional styles.css, optional script.js. Use for: landing pages, portfolios, marketing sites, one-pagers. Tailwind CDN OK: <script src="https://cdn.tailwindcss.com"></script>`,
    `  B. Vite React SPA — "index.html" at root loading "/src/main.tsx", plus "src/main.tsx" importing React + ReactDOM. Components go in src/.`,
    ``,
    `FORBIDDEN: Next.js, Remix, Astro, Nuxt, SvelteKit, app/ directory, next.config, server components. Any of these = preview fails.`,
    ``,
    hasImageGen
      ? [
          `## IMAGES`,
          `  • gen_image saves to /images/filename.jpg — reference as <img src="/images/filename.jpg" alt="...">`,
          `  • Decide image filenames UP FRONT (e.g. /images/hero.jpg, /images/about.jpg) and bake them into index.html.`,
          `  • Generate images AFTER index.html exists. The site renders even if image gen fails or hits credit limits.`,
          `  • Write detailed prompts: style, subject, lighting, colors.`,
        ].join('\n')
      : `IMAGE GENERATION: not available. Use Unsplash URLs or CSS gradients instead.`,
    ``,
    `## EXECUTION ORDER (in this order, no exceptions)`,
    `1. list_files — see what exists. Note: a "Building…" stub index.html may already exist; treat it as a placeholder you'll OVERWRITE in step 2.`,
    `2. write_file "index.html" — COMPLETE working HTML referencing planned /images/*.jpg paths. This OVERWRITES the stub. Do not truncate.`,
    `3. write_file "styles.css" if your HTML uses one.`,
    `4. ${hasImageGen ? 'gen_image for each /images/*.jpg you referenced. If any fails, the site still renders with a broken-image icon — that\'s acceptable, the user can re-run.' : 'Skip image gen'}`,
    `5. write_file any other files (script.js, components, etc.).`,
    `6. One-sentence summary in chat.`,
    ``,
    `Keep each file under 100 KB. Escape JSON correctly: newlines=\\n, quotes=\\", backslashes=\\\\.`,
    `Project slug: "${slug}".`,
  ].join('\n');
}

// CORS origins that are allowed to call the chat endpoint.
// Mirrors the allowlist in server.ts but applied manually because
// reply.hijack() bypasses Fastify's @fastify/cors plugin lifecycle.
const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/.*\.pages\.dev$/,
  /^https:\/\/.*\.railway\.app$/,
];

function resolveOrigin(origin: string | undefined): string {
  if (!origin) return '*';
  return ALLOWED_ORIGINS.some((r) => r.test(origin)) ? origin : '*';
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  // Handle CORS preflight for the SSE endpoint.
  app.options('/api/chat', async (req, reply) => {
    const origin = resolveOrigin(req.headers['origin'] as string | undefined);
    return reply
      .header('Access-Control-Allow-Origin',  origin)
      .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Max-Age',       '86400')
      .header('Vary',                         'Origin')
      .status(204)
      .send();
  });

  app.addHook('preHandler', authMiddleware);

  /**
   * GET /api/projects/:slug/chat-history
   *
   * Returns every persisted chat_messages row for this project, oldest
   * first. The SPA calls this on project open to hydrate its chat thread
   * from the server (the DB is the source of truth — not localStorage —
   * so a different browser / cleared cache / new device still sees the
   * full conversation).
   *
   * Round 15.1 (2026-05-15): introduced alongside server-side persistence
   * in the /api/chat handler. Caps at 500 rows per the loader; existing
   * pre-15.1 conversations only have rows from this point forward (older
   * IDE-side chats lived only in browser localStorage and are lost on
   * different devices — by design, not worth a backfill).
   */
  app.get<{ Params: { slug: string } }>('/api/projects/:slug/chat-history', async (req, reply) => {
    const ctx  = req.authCtx!;
    const slug = req.params.slug;
    if (!slug) {
      return reply.status(400).send({ error: 'missing slug' });
    }
    try {
      // Resolve project by (tenantId, slug). Timeout-bounded like the chat
      // route's own lookup so a wedged DB pool can't hang this either.
      const { getDb }   = await import('../db/client');
      const { projects } = await import('@abw/db');
      const { eq, and } = await import('drizzle-orm');
      const [row] = await Promise.race([
        getDb()
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.slug, slug)))
          .limit(1),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('project lookup timed out')), 15_000),
        ),
      ]);
      if (!row) {
        return reply.status(404).send({ error: 'project not found' });
      }
      const messages = await loadProjectMessages(row.id);
      return reply.send({ messages });
    } catch (err) {
      req.log.warn({ err: err instanceof Error ? err.message : String(err), slug }, 'chat-history lookup failed');
      return reply.status(500).send({ error: 'chat-history lookup failed' });
    }
  });

  /**
   * POST /api/chat
   * Body: { messages, provider, model, projectEnv?, projectSlug?, enableTools? }
   * Streams SSE events:
   *   {"type":"delta",       "delta":"..."}                   — token
   *   {"type":"tool_start",  "id":"...","name":"...","args":"..."}
   *   {"type":"tool_result", "id":"...","ok":true,"summary":"..."}
   *   {"type":"done",        "usage":{...}}
   *   {"type":"error",       "error":"..."}
   */
  app.post<{ Body: unknown }>('/api/chat', async (req, reply) => {
    const ctx    = req.authCtx!;
    const parsed = ChatBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }

    const {
      provider, projectEnv, projectSlug, projectTypeId, enableTools, attachments,
      designSkillsEnabled, higgsfieldEnabled, replicateEnabled,
    } = parsed.data;

    // Normalise model name — guard against stale persisted values from old UI.
    const MINIMAX_MODELS = ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1'];
    const model = (provider === 'minimax' && !MINIMAX_MODELS.includes(parsed.data.model))
      ? 'MiniMax-M2.7'
      : parsed.data.model;

    // ── Adapter ───────────────────────────────────────────────────────────────
    let adapter;
    if (provider === 'minimax') {
      adapter = createMinimaxAdapter(ctx.tenantId, projectEnv);
    } else if (provider === 'ollama') {
      adapter = createOllamaAdapter(env.OLLAMA_BASE_URL);
    } else {
      return reply.status(400).send({ error: `Unknown provider: ${provider}` });
    }

    // ── SSE stream setup ──────────────────────────────────────────────────────
    // Controller must be created first — toolCtx closes over its signal.
    const origin = resolveOrigin(req.headers['origin'] as string | undefined);
    reply.hijack();
    const raw = reply.raw;
    raw.setHeader('Access-Control-Allow-Origin',      origin);
    raw.setHeader('Access-Control-Allow-Credentials', 'true');
    raw.setHeader('Vary',                             'Origin');
    raw.setHeader('Content-Type',                     'text/event-stream; charset=utf-8');
    raw.setHeader('Cache-Control',                    'no-cache, no-transform');
    raw.setHeader('Connection',                       'keep-alive');
    raw.setHeader('X-Accel-Buffering',                'no');
    raw.flushHeaders?.();

    const controller = new AbortController();
    req.raw.once('close', () => controller.abort());

    // SSE writer — defined up here so the pre-loop catch below can use it.
    function send(obj: unknown): void {
      raw.write(`data: ${JSON.stringify(obj)}\n\n`);
    }

    // Round 14.8: everything from here to the iteration loop runs AFTER
    // reply.hijack(). An unhandled throw in this section (workspace restore,
    // planner subagent, prelude reads, etc.) escapes into Fastify's error
    // handler, which CANNOT write to a hijacked reply — so the SSE socket
    // stays open forever and the IDE shows "Run in progress" with no events
    // and no end. Wrap the whole pre-loop section so any failure surfaces as
    // an SSE error event + closes the stream, instead of an infinite hang.
    //
    // These are declared out here (not inside the try) because the loop's
    // own try block + the finally both reference them.
    let toolsActive = false;
    let ws: Awaited<ReturnType<typeof getWorkspace>> | null = null;
    let toolCtx!: ToolContext;
    let history: ChatMessage[] = [];
    let plannedPageSlugs: string[] = [];
    // Hoisted alongside plannedPageSlugs so the build-incomplete nudge can
    // detect "agent wrote all pages but never called gen_image" — same class
    // of premature exit as missing pages, just for binary assets. The model
    // sometimes embeds <img src="/images/X.jpg"> in pages but then declares
    // the build done without ever generating the bytes. We catch that here
    // and nudge before the loop exits. Filtered to kind === 'image' below.
    let plannedImageAssets: Array<{ id: string; prompt: string }> = [];
    let toolList: ReturnType<typeof getAgentTools> = [];
    // Hoisted for the post-loop completion phase: when the planner subagent
    // returns a validated plan, we keep a reference here so the completion
    // phase can iterate plan.sitemap and fill any missing pages on disk.
    let planForCompletion: PlanType | null = null;
    // Hoisted so the iter loop can persist assistant + tool messages to
    // chat_messages alongside the project_id once it's been resolved
    // (round 15.1 — IDE-side chat persistence).
    let resolvedProjectId: string | null = null;

    try {

    // ── Workspace + image gen for tool calls ─────────────────────────────────
    toolsActive = enableTools && !!projectSlug;
    ws = toolsActive ? await getWorkspace(ctx.tenantId, projectSlug!) : null;
    // Restore from Supabase Storage if workspace is empty (e.g. after server restart)
    if (ws && !(await workspaceExists(ws))) {
      await restoreWorkspaceFromStorage(ws).catch(() => {}); // non-fatal
    }

    // Look up the project's UUID from its slug so per-project asset writes
    // (e.g., replicate_video saving into video_projects) can associate
    // outputs with the right project. Falls back to null on lookup miss.
    // resolvedProjectId is hoisted above so the iter loop's chat_messages
    // persistence can reach it (round 15.1).
    if (toolsActive && projectSlug) {
      try {
        const { getDb } = await import('../db/client');
        const { projects } = await import('@abw/db');
        const { eq, and } = await import('drizzle-orm');
        // Timeout-bound — same bug class as Layer E (minimax getApiKey): a
        // raw `db.select()` waits for a pool connection with NO timeout, so
        // if the postgres-js pool is exhausted this hangs the pre-loop
        // unbounded (non-throwing — the try/catch can't catch a hang). Race
        // it against 15s; on timeout, fall through with resolvedProjectId
        // null (it's non-fatal — only used for asset association).
        const [row] = await Promise.race([
          getDb()
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.slug, projectSlug)))
            .limit(1),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('project-id lookup timed out after 15s (DB pool)')), 15_000),
          ),
        ]);
        if (row) resolvedProjectId = row.id;
      } catch { /* non-fatal — tools that need projectId fall back to null */ }
    }

    // Round 15.1: persist the latest user message to chat_messages so the
    // server (not just the SPA's localStorage) is the source of truth for
    // chat history. Fire-and-forget — DB blip can't take down the chat path,
    // but the SPA's next project-open hydrate call will see whatever made
    // it through. Mirrors what chatRunner.ts does on the SPS path; both
    // paths now write to the same table via the shared helper.
    if (resolvedProjectId) {
      const lastUserMsg = [...parsed.data.messages].reverse().find((m) => m.role === 'user');
      const userContent = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      if (userContent) {
        // Don't await — DB writes shouldn't gate the SSE stream startup.
        // appendUserMessage is error-tolerant (logs + returns false on fail).
        appendUserMessage({
          projectId:  resolvedProjectId,
          tenantId:   ctx.tenantId,
          content:    userContent,
          agentRunId: null,
        }).catch(() => { /* logged inside helper */ });
      }
    }

    // Auto-scaffold a stub index.html if the workspace is genuinely empty.
    // This bypasses the entire "model fails to call write_file with proper
    // schema on the first try" rabbit hole — the gate is already cleared
    // when the agent starts, so it can immediately gen images / overwrite
    // index.html with real content via subsequent calls. Without this,
    // MiniMax M2.7 has been observed to emit malformed write_file calls
    // (empty path, alias keys, JSON-in-content) for 5+ iterations before
    // finally getting it right — burning the iteration budget.
    if (ws) {
      const existing = await listWorkspaceFiles(ws);
      const hasEntry = existing.some((p) =>
        /\/(index\.html?|main\.tsx|main\.jsx)$/i.test(p),
      );
      if (!hasEntry) {
        const stubHtml = [
          `<!DOCTYPE html>`,
          `<html lang="en">`,
          `<head>`,
          `  <meta charset="UTF-8" />`,
          `  <meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
          `  <title>${projectSlug ?? 'Project'}</title>`,
          `  <script src="https://cdn.tailwindcss.com"></script>`,
          `</head>`,
          `<body class="bg-slate-50 text-slate-900">`,
          `  <main class="max-w-3xl mx-auto p-12 text-center">`,
          `    <h1 class="text-4xl font-bold mb-4">Building…</h1>`,
          `    <p class="text-slate-600">The agent is generating this site. This stub will be replaced with real content shortly.</p>`,
          `  </main>`,
          `</body>`,
          `</html>`,
          ``,
        ].join('\n');
        await writeWorkspaceFile(ws, 'index.html', stubHtml).catch(() => { /* best-effort */ });
      }
    }
    const hasImageGen = toolsActive && typeof adapter.generateImage === 'function';

    // Tool execution context — shared across all tool calls in the loop.
    // tenantId + adapter are passed so Creative Suite tools (compose_email,
    // create_ebook, create_document, generate_music) can run without HTTP round-trips.
    toolCtx = {
      ws: ws!,
      generateImage: hasImageGen
        ? (prompt: string) => adapter.generateImage!({ prompt, signal: controller.signal })
        : undefined,
      tenantId:  ctx.tenantId,
      env:       projectEnv,
      projectId: resolvedProjectId,   // resolved from slug above; tools that save assets associate with this project
      adapter,
    };

    // Build the running message history the model sees. We inject the tool hint
    // as an extra system message so the user's chat system prompt is preserved.
    history = parsed.data.messages.map((m) => ({
      role:    m.role,
      content: m.content,
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.name         ? { name:         m.name         } : {}),
    }));

    // ── Attachments: vision message + workspace copy + system hint ──────────
    if (attachments && attachments.length > 0) {
      // 1. Upgrade the last user message to a ContentPart[] (text + image_url blocks)
      let lastUserIdx = -1;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i]!.role === 'user') { lastUserIdx = i; break; }
      }
      if (lastUserIdx >= 0) {
        const lastMsg = history[lastUserIdx]!;
        const parts: ContentPart[] = [];
        const textContent = lastMsg.content as string;
        if (textContent) parts.push({ type: 'text', text: textContent });
        for (const att of attachments) {
          if (att.mimeType.startsWith('image/')) {
            parts.push({ type: 'image_url', image_url: { url: att.url } });
          }
        }
        if (parts.length > 0) {
          history[lastUserIdx] = { ...lastMsg, content: parts };
        }
      }

      // 2. Copy images into workspace so the agent can reference them as ./images/…
      if (ws) {
        for (const att of attachments) {
          if (!att.mimeType.startsWith('image/')) continue;
          try {
            const imgRes = await fetch(att.url, { signal: controller.signal });
            const imgBuf = Buffer.from(await imgRes.arrayBuffer());
            const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            await writeWorkspaceFileBuffer(ws, `images/${safeName}`, imgBuf);
          } catch { /* non-fatal: image copy failed */ }
        }
      }

      // 3. Inject an asset context system message so the agent knows what's available
      if (toolsActive) {
        const assetLines = attachments.map((att) => {
          const localPath = att.mimeType.startsWith('image/') ? `images/${att.name}` : att.name;
          const logoNote  = att.isLogo ? ' [LOGO — use in header/favicon; derive color scheme from it]' : '';
          const colorNote = att.colors?.length
            ? `\n  Dominant colors: ${att.colors.join(', ')} — use as primary/accent palette`
            : '';
          return `- ${att.name} → ./${localPath}${logoNote}${colorNote}`;
        });
        const assetHint = [
          '## Uploaded Assets',
          'The user has attached these files. Use them in the project at your discretion:',
          ...assetLines,
        ].join('\n');
        // Prepend before the tool hint (tool hint is already unshifted below)
        history.unshift({ role: 'system', content: assetHint });
      }
    }

    if (toolsActive) {
      history.unshift({ role: 'system', content: toolHint(projectSlug!, hasImageGen) });

      // ── Security teach-in (A2 of security plan) ──────────────────────────
      // Load the OWASP-aligned security prelude and put it AT THE TOP of the
      // history so it dominates context. Try multiple candidate paths so
      // both dev (cwd=apps/api) and prod (cwd=/app monorepo root) resolve.
      // Fail silently if the skill file isn't packaged — the post-write
      // scanners still catch the worst things.
      const preludeCandidates = [
        resolve(process.cwd(), 'apps', 'api', 'src', 'agent', 'skills', 'security', 'owasp-prelude.md'),
        resolve(process.cwd(), 'src', 'agent', 'skills', 'security', 'owasp-prelude.md'),
      ];
      for (const candidate of preludeCandidates) {
        try {
          const securityPrelude = await readFile(candidate, 'utf8');
          history.unshift({ role: 'system', content: securityPrelude });
          break;
        } catch { /* try next */ }
      }
    }

    // ── Phase A: Planner subagent (when projectType has agentInstructions) ──
    // Runs BEFORE the iteration loop. Produces a niche-aware build plan that
    // gets injected as a system message + plan.json file. Falls back silently
    // to the unenhanced loop if the type has no agentInstructions or planner fails.
    let planAvailable = false;
    // plannedPageSlugs (hoisted above): slugs of every page the planner
    // committed to building. Empty when the planner skipped / failed. Used by
    // the nudge logic so the agent can't silently exit after writing one page
    // when the plan calls for more.
    if (toolsActive && projectTypeId) {
      const projectType = listProjectTypes().find((pt) => pt.id === (projectTypeId as ProjectTypeId));
      if (projectType?.agentInstructions) {
        // Find the user's most recent message as the brief
        const lastUserMsg = [...parsed.data.messages].reverse().find((m) => m.role === 'user');
        const brief = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';

        if (brief) {
          const emit = (event: PhaseEvent) => send(event);
          const preResult = await runPrePhase({
            brief,
            projectType,
            projectSlug: projectSlug!,
            adapter,
            model,
            signal: controller.signal,
            emit,
          });

          if (preResult.planAvailable && preResult.enhancedSystemMessage && preResult.plan) {
            planAvailable = true;
            // Inject the build directive AFTER the tool hint but BEFORE user messages.
            // The model sees: tool rules → build plan → user prompt.
            history.splice(1, 0, { role: 'system', content: preResult.enhancedSystemMessage });
            // Persist the plan to the workspace for transparency + iterations.
            if (ws) {
              await writeWorkspaceFile(ws, '_plan.json', JSON.stringify(preResult.plan, null, 2)).catch(() => { /* non-fatal */ });
            }
            // Capture the sitemap slugs so the nudge logic can detect
            // partial completion (agent emits done after writing 1 of N pages).
            plannedPageSlugs = (preResult.plan.sitemap ?? []).map((p) => p.slug);
            // Capture the planned image assets too, so the nudge logic can
            // detect "wrote pages but never generated images" — same class
            // of premature exit as missing pages.
            plannedImageAssets = (preResult.plan.shared_assets ?? [])
              .filter((a) => a.kind === 'image')
              .map((a) => ({ id: a.id, prompt: a.prompt }));
            // Keep the full plan for the post-loop completion phase.
            planForCompletion = preResult.plan;
          }
        }
      }
    }

    // ── Capability preludes (toggled by the chat composer) ───────────────────
    // Huashu: load the skill prelude file so the model knows when/how to call it.
    if (designSkillsEnabled) {
      try {
        const prelude = await readFile(resolve(process.cwd(), 'src/agent/skills/huashu.md'), 'utf8');
        history.unshift({ role: 'system', content: prelude });
      } catch { /* skill file not packaged — non-fatal, tool still callable */ }
    }
    // Higgsfield prelude removed in the 2026-05 internal-live update. The
    // higgsfieldEnabled body field is still accepted for old SPA bundles
    // but produces no system prompt and no tool registration — see the
    // schema comment above and apps/api/src/agent/tools.ts.
    void higgsfieldEnabled;

    // Compute the per-request tool list (gates design + Replicate tools by flag).
    //
    // `creativeSuiteEnabled` gates compose_email/create_ebook/create_document/
    // generate_music. They're only useful when the user's project type is a
    // creative deliverable (ebook, document, email_composer, music_studio).
    // For build-style projects (website/landing_page/saas_app/etc.), shipping
    // those schemas inflates the MiniMax payload past a Go-side parser
    // threshold and produces "Mismatch type []*OaiToolCalls" 400s — see
    // round 14.4 INBOUND in HANDOFF_NOTES.md.
    const CREATIVE_PROJECT_TYPES = new Set(['ebook', 'document', 'email_composer', 'music_studio']);
    const creativeSuiteEnabled = !projectTypeId || CREATIVE_PROJECT_TYPES.has(projectTypeId);
    toolList = getAgentTools({ designSkillsEnabled, replicateEnabled, creativeSuiteEnabled });

    } catch (preErr) {
      // Pre-loop setup failed (workspace restore, planner subagent, prelude
      // read, attachment copy, etc.). Without this catch the throw would
      // escape the hijacked reply and hang the SSE socket forever. Surface it
      // as a normal error event so the IDE shows the failure and stops.
      // eslint-disable-next-line no-console
      console.error(`[chat] pre-loop setup failed: ${preErr instanceof Error ? (preErr.stack ?? preErr.message) : String(preErr)}`);
      send({ type: 'error', error: preErr instanceof Error ? preErr.message : String(preErr) });
      raw.end();
      return undefined;
    }

    try {
      // Single loop for both tools-off and tools-on: when tools are off we
      // simply break after iteration 0 because there can be no tool_calls.
      for (let iter = 0; iter < (toolsActive ? MAX_ITERATIONS : 1); iter++) {
        if (controller.signal.aborted) break;

        let assistantText = '';
        const toolCalls: ToolCall[] = [];
        let finalUsage: { promptTokens: number; completionTokens: number } | undefined;
        let hadError = false;

        // maxTokens: 8192 — matches chatRunner.ts:235. The earlier 4096 was
        // too tight for write_file with full-page HTML content; the model
        // would hit the ceiling mid-arguments, the JSON string would
        // truncate, and the sanitizer at line 746 would stub the call as
        // "arguments were not valid JSON — model should retry with smaller
        // content." The model then echoed that exact text back to the
        // user as its next assistant turn (visible loss bug; the user
        // shouldn't see internal plumbing). 8192 gives full pages
        // headroom; MiniMax M2.7 supports the higher ceiling.
        const chatReq = toolsActive
          ? { messages: history, model, temperature: 0.7, maxTokens: 8192, tools: toolList, toolChoice: 'auto' as const }
          : { messages: history, model, temperature: 0.7, maxTokens: 8192 };

        for await (const chunk of adapter.chat(chatReq, { signal: controller.signal })) {
          if (controller.signal.aborted) break;
          if (chunk.type === 'delta') {
            assistantText += chunk.delta;
            send(chunk);
          } else if (chunk.type === 'tool_call') {
            toolCalls.push(chunk.toolCall);
          } else if (chunk.type === 'done') {
            finalUsage = chunk.usage;
            break;
          } else if (chunk.type === 'error') {
            send(chunk);
            hadError = true;
            break;
          }
        }

        if (hadError) break;

        // No tool calls → either the model is genuinely done, OR it just
        // narrated intent without acting. If the last assistant turn was
        // refused by a hard-gate (e.g. gen_image without index.html), the
        // model often responds with text like "I'll start building the
        // website" but skips the actual write_file call — exiting the
        // loop here would leave the workspace half-built. Detect that
        // case and force one more iteration with an explicit nudge.
        if (toolCalls.length === 0 || !toolsActive || !ws) {
          const lastToolMsg = [...history].reverse().find((m) => m.role === 'tool');
          const lastWasRefusal = !!lastToolMsg
            && typeof lastToolMsg.content === 'string'
            && /^Refused:|^Refused —/m.test(lastToolMsg.content);

          // Detect three kinds of premature exit:
          //   (a) "narration without action" — model read/listed and quit
          //       without ANY write_file (closed in 46c69e6)
          //   (b) "partial sitemap" — planner committed to N pages, agent
          //       wrote fewer (caught Apex 1/4 + Driftwood stub-only in
          //       the bug-test sweep). Compare planned slugs to the slugs
          //       actually written via write_file.
          // Both nudge with a directive that names the missing files so
          // the model can't claim "I'm done" plausibly.
          let buildIncomplete = false;
          let missingPagesMsg = '';
          let missingImagesMsg = '';
          if (!lastWasRefusal && toolsActive && iter < MAX_ITERATIONS - 1) {
            // Collect the basenames of every path the agent passed to
            // write_file across the whole conversation.
            const writtenPaths = new Set<string>();
            for (const m of history) {
              if (m.role !== 'assistant') continue;
              const calls = (m as { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> }).tool_calls;
              if (!Array.isArray(calls)) continue;
              for (const tc of calls) {
                if (tc.function?.name !== 'write_file') continue;
                try {
                  // Use the same tolerant parsing as the executor — the model
                  // can wrap args ({args:{path}}, {input:{path}}) or use any
                  // case ({Path}, {filepath}, {file-path}) and we still have to
                  // track that a file was written for the build-incomplete nudge.
                  // Mirrors findArgString in apps/api/src/agent/tools.ts.
                  const raw = JSON.parse(tc.function.arguments ?? '{}') as unknown;
                  const root: Record<string, unknown> = Array.isArray(raw)
                    ? ((raw.find((el) => el && typeof el === 'object' && !Array.isArray(el)) as Record<string, unknown> | undefined) ?? {})
                    : (raw as Record<string, unknown>) ?? {};
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
            const everWrote = writtenPaths.size > 0;

            // (a) zero writes
            if (!everWrote) buildIncomplete = true;

            // (b) partial sitemap: planner had a plan + we wrote fewer html
            // files than planned. Match by slug — `index` matches index.html,
            // `listings` matches listings.html or listings/index.html, etc.
            if (everWrote && plannedPageSlugs.length > 0) {
              const missing = plannedPageSlugs.filter((slug) => {
                const candidates = [
                  `${slug}.html`,
                  `${slug}.htm`,
                  `${slug}/index.html`,
                  `pages/${slug}.html`,
                ].map((c) => c.toLowerCase());
                return !candidates.some((c) => writtenPaths.has(c));
              });
              if (missing.length > 0) {
                buildIncomplete = true;
                missingPagesMsg = missing.map((s) => `${s}.html`).join(', ');
              }
            }

            // (c) missing planned images: pages reference <img src="/images/X.jpg">
            // (the embed-discipline directive embeds them on first write) but the
            // model declared done without ever calling gen_image. Without this
            // check the build "completes" with broken-image placeholders on
            // every page that needed a generated asset. Compare planned asset IDs
            // against actual files on disk — the dispatch is by file existence,
            // not by tool_call count, so a successful generation always satisfies
            // the check regardless of how the call was wrapped.
            if (everWrote && plannedImageAssets.length > 0 && ws && !missingPagesMsg) {
              try {
                const onDisk = new Set(
                  (await listWorkspaceFiles(ws))
                    .map((p) => p.replace(/^\/+/, '').toLowerCase()),
                );
                const missingImages = plannedImageAssets.filter((a) => {
                  const candidates = [
                    `images/${a.id}.jpg`,
                    `images/${a.id}.jpeg`,
                    `images/${a.id}.png`,
                    `images/${a.id}.webp`,
                  ].map((c) => c.toLowerCase());
                  return !candidates.some((c) => onDisk.has(c));
                });
                if (missingImages.length > 0) {
                  buildIncomplete = true;
                  missingImagesMsg = missingImages
                    .slice(0, 8)  // cap the nudge so it doesn't bloat the prompt
                    .map((a) => `${a.id}.jpg (prompt: "${a.prompt.slice(0, 120)}")`)
                    .join('; ');
                }
              } catch { /* fs read failed — skip the image check */ }
            }
          }

          if ((lastWasRefusal || buildIncomplete) && iter < MAX_ITERATIONS - 1) {
            // Push the assistant's narration into history so the next turn
            // sees it (avoid duplicate-narration loop), then add a system
            // nudge that forces tool action.
            if (assistantText) {
              history.push({ role: 'assistant', content: assistantText });
            }
            let nudgeContent: string;
            if (lastWasRefusal) {
              nudgeContent =
                'STOP NARRATING. Your previous tool call was refused with a clear ' +
                'corrective instruction. You MUST now call the tool the refusal ' +
                'told you to call (almost certainly write_file with path="index.html" ' +
                'and complete HTML content). Do not respond with text. Call the tool.';
            } else if (missingPagesMsg) {
              nudgeContent =
                `STOP. The build is INCOMPLETE — the plan committed to pages that ` +
                `aren't in the workspace yet. MISSING: ${missingPagesMsg}. Write each ` +
                `one now via write_file with the same layout/styling as the pages you ` +
                `already produced. No reading existing files unnecessarily, no ` +
                `re-planning, no narration — call write_file for ${(missingPagesMsg.split(',')[0] ?? '').trim() || 'the next missing page'} ` +
                `as your very next action, then continue through the rest.`;
            } else if (missingImagesMsg) {
              nudgeContent =
                `STOP. The pages reference \`<img src="/images/...">\` tags but the ` +
                `image files were NEVER GENERATED. Your pages will render with ` +
                `broken-image placeholders. ` +
                `MISSING IMAGES: ${missingImagesMsg}. ` +
                `Call \`gen_image\` for each missing asset — ONE gen_image per response, ` +
                `not batched. Save each one to \`/images/<id>.jpg\` using the EXACT id ` +
                `that appears before \`.jpg\` in the missing list above (the \`<img src>\` ` +
                `tags in the pages already point at these filenames — do NOT rename). ` +
                `No narration, no re-planning, no asking for confirmation — call ` +
                `\`gen_image\` for the FIRST missing image as your very next action.`;
            } else {
              nudgeContent =
                'STOP. You have not yet written any pages. The BUILD PLAN above ' +
                'lists every page to write — start with write_file path="index.html" ' +
                'and full HTML content for the homepage RIGHT NOW. Then write each ' +
                'subsequent page from the sitemap. No more reading. No more narration. ' +
                'No questions. WRITE THE FILES.';
            }
            history.push({ role: 'system', content: nudgeContent });
            continue; // skip the done/break, go back to top of for-loop
          }
          send({ type: 'done', ...(finalUsage ? { usage: finalUsage } : {}) });
          break;
        }

        // Sanitize tool_call arguments before storing in history.
        // If arguments are invalid JSON or exceed 40 KB, replace with a safe
        // placeholder so the next MiniMax request doesn't get a 400 (2013).
        //
        // Stub keys deliberately look like internal status markers ("_internal_*")
        // rather than human-readable English. The previous wording
        // ("arguments were not valid JSON — model should retry with smaller
        // content") was being read by the model on its NEXT turn and echoed
        // back to the user as if it were a real assistant message — the user
        // saw the literal English error text in their chat panel. The internal-
        // looking shape combined with the tool result's explicit
        // "[internal:retry] DO NOT mention this … to the user" guidance keeps
        // the recovery silent.
        const MAX_ARGS_BYTES = 40_000;
        const sanitizedCalls = toolCalls.map((tc) => {
          let safeArgs = tc.function.arguments;
          try {
            JSON.parse(safeArgs);                          // validate
            if (safeArgs.length > MAX_ARGS_BYTES) {        // cap size
              safeArgs = JSON.stringify({ _internal_status: 'args_truncated_oversized', _retry: true });
            }
          } catch {
            // Unparseable — replace entirely so it doesn't poison the next request
            safeArgs = JSON.stringify({ _internal_status: 'args_truncated_unparseable', _retry: true });
          }
          return { ...tc, function: { ...tc.function, arguments: safeArgs } };
        });

        // Record the assistant turn that requested the tool calls. OpenAI-style:
        // the assistant message carries the tool_calls and the content (if any).
        // MiniMax rejects empty-string content when tool_calls are present (error 2013),
        // so use null in that case.
        history.push({
          role:       'assistant',
          content:    assistantText || null,
          tool_calls: sanitizedCalls,
        });

        // Round 15.1: persist this assistant turn to chat_messages. Fire-and-
        // forget — helper is error-tolerant so a DB blip can't kill the iter.
        if (resolvedProjectId) {
          appendAssistantMessage({
            projectId:  resolvedProjectId,
            tenantId:   ctx.tenantId,
            content:    assistantText || null,
            toolCalls:  sanitizedCalls,
            agentRunId: null,
          }).catch(() => { /* logged inside helper */ });
        }

        // Execute each tool, stream tool_start + tool_result, append a tool
        // message to history for each one.
        for (const tc of toolCalls) {
          send({ type: 'tool_start', id: tc.id, name: tc.function.name, args: tc.function.arguments });
          const res = await executeToolCall(toolCtx, tc.function.name, tc.function.arguments);
          send({ type: 'tool_result', id: tc.id, ok: res.ok, summary: res.summary });
          // Cap tool result size too — very long error messages can also cause 400s
          const safeResult = res.result.length > 8_000
            ? res.result.slice(0, 8_000) + '\n…[truncated]'
            : res.result;
          history.push({
            role:         'tool',
            content:      safeResult,
            tool_call_id: tc.id,
            name:         tc.function.name,
          });

          // Round 15.1: persist this tool result to chat_messages alongside
          // its tool_call_id so the SPA can reconstruct the full conversation
          // (assistant tool_calls ↔ tool results) on hydration.
          if (resolvedProjectId) {
            appendToolMessage({
              projectId:  resolvedProjectId,
              tenantId:   ctx.tenantId,
              content:    safeResult,
              toolCallId: tc.id,
              toolName:   tc.function.name,
              agentRunId: null,
            }).catch(() => { /* logged inside helper */ });
          }
        }

        // Loop continues: model sees tool results and decides next step.
        if (iter === MAX_ITERATIONS - 1) {
          send({ type: 'error', error: `Agent hit max iterations (${MAX_ITERATIONS}). Ask the user to continue.` });
        }
      }
    } catch (err) {
      send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      // ── Phase B-complete: deterministic page-completion pass ──────────────
      // The iter loop's existing nudge logic (lines ~552-647 above) tries to
      // herd the model back to writing missing pages, but it relies on prompt
      // steering — when the model refuses to comply, it can exhaust
      // MAX_ITERATIONS without finishing the build. This phase runs once
      // here, after the loop, and guarantees every planned page exists on
      // disk via one focused single-shot model call per missing page +
      // a deterministic templated stub fallback. Bounded, idempotent, and
      // a no-op when every page is already on disk. See apps/api/src/agent/
      // phases/complete.ts for the full design rationale.
      if (toolsActive && ws && planForCompletion && !controller.signal.aborted) {
        try {
          await runCompletionPhase({
            ws,
            plan:        planForCompletion,
            history,
            adapter,
            model,
            signal:      controller.signal,
            toolList,
            toolCtx,
            projectSlug: projectSlug ?? '',
            send,
          });
        } catch (completionErr) {
          // eslint-disable-next-line no-console
          console.warn(`[chat] completion phase failed (non-fatal): ${completionErr instanceof Error ? completionErr.message : String(completionErr)}`);
        }
      }

      // ── Phase B' + C: Inline post-process humanizer + polish ──────────────
      // Runs after the iteration loop completes (success or partial). Inline,
      // regex-based, no extra MiniMax calls. Surfaces audit findings as SSE.
      // Runs whenever tools were active and the workspace exists — even on
      // iteration prompts where the planner subagent didn't fire, we still
      // want to audit the agent's changes (humanize + polish flags).
      if (toolsActive && ws) {
        try {
          await runPostPhase({
            ws,
            emit: (event) => send(event),
          });
        } catch { /* non-fatal */ }
      }
      raw.end();
    }

    return undefined;
  });
}
