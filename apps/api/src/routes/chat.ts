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
import { getWorkspace, writeWorkspaceFileBuffer, workspaceExists, restoreWorkspaceFromStorage } from '../preview/workspace';
import { AGENT_TOOLS, executeToolCall, getAgentTools, type ToolContext } from '../agent/tools';
import type { ChatMessage, ContentPart, ToolCall } from '@abw/providers';
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
  enableTools: z.boolean().default(true),
  /** Huashu Design skill toggle. When true, agent gets the design.run_huashu tool
   *  and a system prompt prelude that biases toward visual deliverables. */
  designSkillsEnabled: z.boolean().default(false),
  /** Higgsfield premium image/video gen toggle (cost control). When false, the agent
   *  has NO access to Higgsfield tools. When true, higgsfield.* tools are exposed
   *  alongside a cost-conscious model-selection prelude. */
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
    `1. list_files — see what exists.`,
    `2. write_file "index.html" — COMPLETE working HTML referencing planned /images/*.jpg paths. Do not truncate.`,
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
      provider, projectEnv, projectSlug, enableTools, attachments,
      designSkillsEnabled, higgsfieldEnabled,
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
      projectId: null,   // creative tools create tenant-scoped content; no project association from chat
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
    const toolList = getAgentTools({ designSkillsEnabled, higgsfieldEnabled });

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

        // No tool calls → model is done talking. Emit done and exit.
        if (toolCalls.length === 0 || !toolsActive || !ws) {
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
      raw.end();
    }

    return undefined;
  });
}
