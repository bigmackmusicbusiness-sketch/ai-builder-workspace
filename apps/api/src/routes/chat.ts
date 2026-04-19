// apps/api/src/routes/chat.ts — streaming chat completions proxy.
// POST /api/chat  →  calls the selected provider adapter, streams SSE back.
// The client reads delta tokens and appends them to the last chat message.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, type AuthContext } from '../security/authz';
import { createMinimaxAdapter } from '../providers/minimax';
import { createOllamaAdapter } from '../providers/ollama';
import { env } from '../config/env';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const MessageSchema = z.object({
  role:    z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

const ChatBodySchema = z.object({
  messages:  z.array(MessageSchema).min(1),
  provider:  z.string().default('minimax'),
  model:     z.string().default('MiniMax-M2.7'),
  projectEnv: z.enum(['dev', 'staging', 'preview', 'production']).default('dev'),
});

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
  // @fastify/cors handles OPTIONS for normal routes, but we need an explicit
  // handler here so the preflight succeeds before the POST is attempted.
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
   * Body: { messages, provider, model, projectEnv? }
   * Streams SSE: data: {"type":"delta","delta":"..."}\n\n
   *              data: {"type":"done"}\n\n
   *              data: {"type":"error","error":"..."}\n\n
   */
  app.post<{ Body: unknown }>('/api/chat', async (req, reply) => {
    const ctx    = req.authCtx!;
    const parsed = ChatBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }

    const { messages, provider, model, projectEnv } = parsed.data;

    // ── Select adapter ────────────────────────────────────────────────────────
    let adapter;
    if (provider === 'minimax') {
      adapter = createMinimaxAdapter(ctx.tenantId, projectEnv);
    } else if (provider === 'ollama') {
      adapter = createOllamaAdapter(env.OLLAMA_BASE_URL);
    } else {
      return reply.status(400).send({ error: `Unknown provider: ${provider}` });
    }

    // ── SSE stream setup ──────────────────────────────────────────────────────
    // hijack() bypasses Fastify's response lifecycle so we can write raw chunks.
    // We must set CORS headers manually — @fastify/cors won't run after hijack().
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

    function send(obj: unknown): void {
      raw.write(`data: ${JSON.stringify(obj)}\n\n`);
    }

    try {
      for await (const chunk of adapter.chat(
        { messages, model, temperature: 0.7, maxTokens: 4096 },
        { signal: controller.signal },
      )) {
        if (controller.signal.aborted) break;
        send(chunk);
        if (chunk.type === 'done' || chunk.type === 'error') break;
      }
    } catch (err) {
      send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      raw.end();
    }

    // Return undefined — reply is already hijacked
    return undefined;
  });
}
