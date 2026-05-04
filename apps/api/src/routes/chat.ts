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
  /** Higgsfield premium image/video gen toggle (cost control). When false, the agent
   *  has NO access to Higgsfield tools. When true, higgsfield.* tools are exposed
   *  alongside a cost-conscious model-selection prelude. */
  higgsfieldEnabled:   z.boolean().default(false),
  /** Replicate video generation toggle (curated cost-effective models). Same gating model as Higgsfield. */
  replicateEnabled:    z.boolean().default(false),
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

    // ── Workspace + image gen for tool calls ─────────────────────────────────
    const toolsActive = enableTools && !!projectSlug;
    const ws = toolsActive ? await getWorkspace(ctx.tenantId, projectSlug!) : null;
    // Restore from Supabase Storage if workspace is empty (e.g. after server restart)
    if (ws && !(await workspaceExists(ws))) {
      await restoreWorkspaceFromStorage(ws).catch(() => {}); // non-fatal
    }

    // Look up the project's UUID from its slug so per-project asset writes
    // (e.g., replicate_video saving into video_projects) can associate
    // outputs with the right project. Falls back to null on lookup miss.
    let resolvedProjectId: string | null = null;
    if (toolsActive && projectSlug) {
      try {
        const { getDb } = await import('../db/client');
        const { projects } = await import('@abw/db');
        const { eq, and } = await import('drizzle-orm');
        const [row] = await getDb()
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.slug, projectSlug)))
          .limit(1);
        if (row) resolvedProjectId = row.id;
      } catch { /* non-fatal — tools that need projectId fall back to null */ }
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
    const toolCtx: ToolContext = {
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
    const history: ChatMessage[] = parsed.data.messages.map((m) => ({
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
    }

    // ── Phase A: Planner subagent (when projectType has agentInstructions) ──
    // Runs BEFORE the iteration loop. Produces a niche-aware build plan that
    // gets injected as a system message + plan.json file. Falls back silently
    // to the unenhanced loop if the type has no agentInstructions or planner fails.
    let planAvailable = false;
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
    // Higgsfield: cost-aware prelude (only emitted when toggle is on; tools are
    // registered in Phase B). Until Higgsfield tools exist, this is a no-op.
    if (higgsfieldEnabled) {
      history.unshift({
        role: 'system',
        content:
          '## Premium image/video generation\n' +
          'You have access to Higgsfield (higgsfield.* tools, registered separately). ' +
          'These consume the user\'s paid credits — be cost-conscious:\n' +
          '  • Prefer cheaper models (Hailuo 02, Flux) over premium (Sora 2, Veo) unless the user asked for top quality.\n' +
          '  • Prefer one decisive call over multiple iterations.\n' +
          '  • For static images, prefer Flux/Seedream over Soul/Cinema Studio.\n' +
          '  • Mention the chosen model in your reply so the user can audit.',
      });
    }
    // Compute the per-request tool list (gates Higgsfield + design tools by flag).
    const toolList = getAgentTools({ designSkillsEnabled, higgsfieldEnabled, replicateEnabled });

    function send(obj: unknown): void {
      raw.write(`data: ${JSON.stringify(obj)}\n\n`);
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

        const chatReq = toolsActive
          ? { messages: history, model, temperature: 0.7, maxTokens: 4096, tools: toolList, toolChoice: 'auto' as const }
          : { messages: history, model, temperature: 0.7, maxTokens: 4096 };

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

          // Detect "narration without action" when a build plan was supplied:
          // if planAvailable AND no write_file ever fired AND we still have
          // iterations left, the model has read the plan or listed files but
          // decided it's "done" without producing pages. Force a hard nudge.
          let buildIncomplete = false;
          if (!lastWasRefusal && toolsActive && planAvailable && iter < MAX_ITERATIONS - 1) {
            const everWrote = history.some((m) => {
              if (m.role !== 'assistant') return false;
              const calls = (m as { tool_calls?: Array<{ function?: { name?: string } }> }).tool_calls;
              return Array.isArray(calls)
                && calls.some((tc) => tc.function?.name === 'write_file');
            });
            if (!everWrote) buildIncomplete = true;
          }

          if ((lastWasRefusal || buildIncomplete) && iter < MAX_ITERATIONS - 1) {
            // Push the assistant's narration into history so the next turn
            // sees it (avoid duplicate-narration loop), then add a system
            // nudge that forces tool action.
            if (assistantText) {
              history.push({ role: 'assistant', content: assistantText });
            }
            history.push({
              role:    'system',
              content: lastWasRefusal
                ? 'STOP NARRATING. Your previous tool call was refused with a clear ' +
                  'corrective instruction. You MUST now call the tool the refusal ' +
                  'told you to call (almost certainly write_file with path="index.html" ' +
                  'and complete HTML content). Do not respond with text. Call the tool.'
                : 'STOP. You have not yet written any pages. The BUILD PLAN above ' +
                  'lists every page to write — start with write_file path="index.html" ' +
                  'and full HTML content for the homepage RIGHT NOW. Then write each ' +
                  'subsequent page from the sitemap. No more reading. No more narration. ' +
                  'No questions. WRITE THE FILES.',
            });
            continue; // skip the done/break, go back to top of for-loop
          }
          send({ type: 'done', ...(finalUsage ? { usage: finalUsage } : {}) });
          break;
        }

        // Sanitize tool_call arguments before storing in history.
        // If arguments are invalid JSON or exceed 40 KB, replace with a safe
        // placeholder so the next MiniMax request doesn't get a 400 (2013).
        const MAX_ARGS_BYTES = 40_000;
        const sanitizedCalls = toolCalls.map((tc) => {
          let safeArgs = tc.function.arguments;
          try {
            JSON.parse(safeArgs);                          // validate
            if (safeArgs.length > MAX_ARGS_BYTES) {        // cap size
              safeArgs = JSON.stringify({ error: 'arguments truncated — content was too large for history' });
            }
          } catch {
            // Unparseable — replace entirely so it doesn't poison the next request
            safeArgs = JSON.stringify({ error: 'arguments were not valid JSON — model should retry with smaller content' });
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
        }

        // Loop continues: model sees tool results and decides next step.
        if (iter === MAX_ITERATIONS - 1) {
          send({ type: 'error', error: `Agent hit max iterations (${MAX_ITERATIONS}). Ask the user to continue.` });
        }
      }
    } catch (err) {
      send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      // ── Phase B' + C: Inline post-process humanizer + polish ──────────────
      // Runs after the iteration loop completes (success or partial). Inline,
      // regex-based, no extra MiniMax calls. Surfaces audit findings as SSE.
      if (toolsActive && ws && planAvailable) {
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
