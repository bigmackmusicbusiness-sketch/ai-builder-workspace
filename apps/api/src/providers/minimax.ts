// apps/api/src/providers/minimax.ts — MiniMax M2.7 adapter (server-side only).
// API key resolved via `vaultGetOrEnv`: vault first (per-tenant BYOK override),
// then process.env (platform-level — typical for this internal app where a
// single Coolify env var serves every tenant).
//
// Endpoint: https://api.minimax.io/v1/chat/completions  (OpenAI-compatible)
// Models:   MiniMax-M2.7 | MiniMax-M2.7-highspeed | MiniMax-M2.5 | MiniMax-M2.1
//
// Auth: Bearer {API_KEY} — token-plan keys and pay-as-you-go keys use the same header.
// Context window: 204,800 tokens (M2.7).
// Temperature: (0, 1] only — MiniMax does not accept values > 1.
// Tool calling: OpenAI-compatible — tools[] param, streamed tool_calls in delta.

import type {
  ProviderAdapter, ModelInfo, HealthcheckResult,
  ChatRequest, ChatChunk, CompleteRequest, CompleteResponse,
  ImageGenRequest, ImageGenResponse,
  ToolCall,
} from '@abw/providers';
import { vaultGetOrEnv } from '../security/vault';

const MINIMAX_BASE = 'https://api.minimax.io/v1';

/** Map an OpenAI-style "WxH" size string to the nearest MiniMax aspect_ratio. */
function sizeToAspectRatio(size: string): string {
  const [w, h] = size.split('x').map(Number);
  if (!w || !h) return '1:1';
  const ratio = w / h;
  if (ratio >= 2)    return '21:9';
  if (ratio >= 1.6)  return '16:9';
  if (ratio >= 1.3)  return '4:3';
  if (ratio >= 1.1)  return '3:2';
  if (ratio >= 0.9)  return '1:1';
  if (ratio >= 0.75) return '2:3';
  if (ratio >= 0.6)  return '3:4';
  return '9:16';
}

const KEY_NAMES = ['MINIMAX_API_KEY', 'MINIMAX', 'minimax.api_key', 'MINIMAX_KEY'];

/**
 * Strip <think>...</think> blocks from a MiniMax M2.7 response.
 * Handles three cases:
 *   1. Closed: `<think>…</think>actual content` → returns "actual content"
 *   2. Unclosed but JSON follows: `<think>partial...{...}` → returns "{...}"
 *   3. No think tags → returns text unchanged
 */
function stripThinkBlocks(text: string): string {
  // Case 1: strip all properly-closed think blocks
  let out = text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '');

  // Case 2: if an unclosed <think> remains, try to recover JSON that may follow it.
  // We look for the first top-level { or [ — the model often emits thinking, then JSON.
  const lastThink = out.lastIndexOf('<think>');
  if (lastThink >= 0) {
    const tail = out.slice(lastThink);
    const firstObj = tail.search(/[{[]/);
    if (firstObj > 0) {
      out = out.slice(0, lastThink) + tail.slice(firstObj);
    } else {
      // No JSON salvageable; drop everything from <think> on so caller sees empty/clean text
      out = out.slice(0, lastThink);
    }
  }

  return out.trim();
}

async function getApiKey(tenantId: string, env: string): Promise<string> {
  const key = await vaultGetOrEnv({ names: KEY_NAMES, env, tenantId });
  if (key) return key;
  throw new Error(
    `MiniMax API key not found. Set MINIMAX_API_KEY as a Coolify env var (platform-wide) or store it in the Env & Secrets screen (per-tenant BYOK).`,
  );
}

async function* parseSSE(
  response: Response,
  signal: AbortSignal,
): AsyncIterable<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data) as Record<string, unknown>;
          } catch { /* malformed SSE line — skip */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Messages passed to the model include optional tool_calls + tool_call_id.
 *  MiniMax rejects empty-string content on assistant messages that carry
 *  tool_calls with "invalid chat setting (2013)". OpenAI-compat wants `null`
 *  in that case, so we explicitly emit null instead of "".
 *
 *  When content is ContentPart[], it is passed as-is (MiniMax is OpenAI-compat
 *  and understands image_url blocks for vision inputs). */
function messagesToApi(messages: ChatRequest['messages']): unknown[] {
  return messages.map((m) => {
    // Strict array check — protects against malformed tool_calls leaking in
    // from DB roundtrips, accidental string coercion, or null values. MiniMax's
    // Go-side parser rejects with "Mismatch type []*OaiToolCalls" when this
    // field isn't a proper array of OpenAI-shaped tool_call objects.
    const hasToolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any = {
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content                            // vision: pass ContentPart[] directly
        : (hasToolCalls && !m.content ? null : m.content),  // text: null on empty+tool_calls
    };
    if (hasToolCalls)    out.tool_calls   = m.tool_calls;
    if (m.tool_call_id)  out.tool_call_id = m.tool_call_id;
    if (m.name)          out.name         = m.name;
    return out;
  });
}

export function createMinimaxAdapter(tenantId: string, env: string): ProviderAdapter {
  return {
    id:    'minimax',
    label: 'MiniMax',

    async listModels(): Promise<ModelInfo[]> {
      return [
        { id: 'MiniMax-M2.7',           label: 'MiniMax M2.7',             sizeB: undefined },
        { id: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 (highspeed)', sizeB: undefined },
        { id: 'MiniMax-M2.5',           label: 'MiniMax M2.5',             sizeB: undefined },
        { id: 'MiniMax-M2.5-highspeed', label: 'MiniMax M2.5 (highspeed)', sizeB: undefined },
        { id: 'MiniMax-M2.1',           label: 'MiniMax M2.1',             sizeB: undefined },
      ];
    },

    async healthcheck(): Promise<HealthcheckResult> {
      const t0 = Date.now();
      try {
        const apiKey = await getApiKey(tenantId, env);
        const res = await fetch(`${MINIMAX_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model:      'MiniMax-M2.7',
            messages:   [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(8000),
        });
        const detail = res.ok ? undefined : `HTTP ${res.status}: ${await res.text().catch(() => '')}`;
        return { ok: res.ok, latencyMs: Date.now() - t0, detail };
      } catch (err) {
        return { ok: false, latencyMs: Date.now() - t0, detail: String(err) };
      }
    },

    async *chat(req: ChatRequest, opts: { signal: AbortSignal }): AsyncIterable<ChatChunk> {
      const apiKey = await getApiKey(tenantId, env);
      const temperature = Math.min(req.temperature ?? 0.7, 1.0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = {
        model:       req.model,
        messages:    messagesToApi(req.messages),
        temperature,
        top_p:       req.topP ?? 0.95,
        max_tokens:  req.maxTokens ?? 4096,
        stream:      true,
      };
      if (req.tools && req.tools.length > 0) {
        body.tools       = req.tools;
        body.tool_choice = req.toolChoice ?? 'auto';
      }

      let response: Response;
      try {
        response = await fetch(`${MINIMAX_BASE}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: opts.signal,
        });
      } catch (err) {
        yield { type: 'error', error: `MiniMax fetch failed: ${err}` };
        return;
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        yield { type: 'error', error: `MiniMax HTTP ${response.status}: ${detail}` };
        return;
      }

      // Accumulate tool calls across SSE chunks (OpenAI-compatible pattern).
      // Each chunk may contribute a function name + partial arguments by index.
      const toolAcc = new Map<number, { id: string; name: string; args: string }>();

      for await (const event of parseSSE(response, opts.signal)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const choice = (event['choices'] as any[])?.[0];
        if (!choice) continue;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const delta: any = choice['delta'] ?? {};

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          yield { type: 'delta', delta: delta.content };
        }

        // Streamed tool call: { index, id?, function: { name?, arguments? } }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = typeof tc.index === 'number' ? tc.index : 0;
            const prev = toolAcc.get(idx) ?? { id: '', name: '', args: '' };
            if (typeof tc.id === 'string' && tc.id.length > 0) prev.id = tc.id;
            if (tc.function?.name)       prev.name  = tc.function.name;
            if (tc.function?.arguments)  prev.args += tc.function.arguments;
            toolAcc.set(idx, prev);
          }
        }

        const finish = choice['finish_reason'];
        if (finish === 'tool_calls') {
          // Emit each accumulated tool call, then done
          for (const acc of toolAcc.values()) {
            const call: ToolCall = {
              id:   acc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
              type: 'function',
              function: { name: acc.name, arguments: acc.args || '{}' },
            };
            yield { type: 'tool_call', toolCall: call };
          }
          yield { type: 'done' };
          return;
        }

        if (finish === 'stop' || finish === 'length') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const usage = event['usage'] as any;
          yield {
            type: 'done',
            usage: usage
              ? {
                  promptTokens:     usage['prompt_tokens']     ?? 0,
                  completionTokens: usage['completion_tokens'] ?? 0,
                }
              : undefined,
          };
          return;
        }
      }
    },

    async generateImage(req: ImageGenRequest): Promise<ImageGenResponse> {
      const apiKey = await getApiKey(tenantId, env);

      // MiniMax image-01 — correct endpoint per MiniMax platform docs:
      // POST https://api.minimax.io/v1/image_generation
      // Response: { data: { image_base64: ["<base64>", ...] } }
      // aspect_ratio replaces size; "1:1" is closest to 1024×1024.
      const aspectRatio = sizeToAspectRatio(req.size ?? '1024x1024');

      const res = await fetch(`${MINIMAX_BASE}/image_generation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:           'image-01',
          prompt:          req.prompt,
          aspect_ratio:    aspectRatio,
          response_format: 'base64',
        }),
        signal: req.signal ?? AbortSignal.timeout(90_000),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`MiniMax image HTTP ${res.status}: ${detail}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as any;

      // Primary shape: { data: { image_base64: ["..."] } }
      const b64: string | undefined =
        data?.['data']?.['image_base64']?.[0] ??
        // Fallback shapes (in case API evolves)
        data?.['data']?.[0]?.['b64_json'] ??
        data?.['images']?.[0]?.['b64'];

      if (!b64) {
        throw new Error(
          `MiniMax image API returned no image data. Response keys: ${Object.keys(data ?? {}).join(', ')}`,
        );
      }

      return { buffer: Buffer.from(b64, 'base64'), ext: 'jpg' };
    },

    async complete(req: CompleteRequest): Promise<CompleteResponse> {
      const t0 = Date.now();
      const apiKey = await getApiKey(tenantId, env);
      const temperature = Math.min(req.temperature ?? 0.3, 1.0);

      // MiniMax M2.7 is a thinking model — outlines and chapter prose can take 30–90s.
      // 30s was too aggressive (caused "operation aborted" on outline generation).
      // 180s gives chapter generation ample headroom; outlines usually finish well under.
      const res = await fetch(`${MINIMAX_BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:       req.model,
          messages:    [{ role: 'user', content: req.prompt }],
          temperature,
          max_tokens:  req.maxTokens ?? 2048,
        }),
        signal: AbortSignal.timeout(180_000),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`MiniMax HTTP ${res.status}: ${detail}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as any;
      const rawText: string = data['choices']?.[0]?.['message']?.['content'] ?? '';
      // MiniMax M2.7 is a reasoning model — strip <think>...</think> blocks so
      // downstream JSON parsers don't choke on the model's thinking trace.
      const cleaned = stripThinkBlocks(rawText);
      return {
        text:      cleaned,
        model:     req.model,
        usage: {
          promptTokens:     data['usage']?.['prompt_tokens']     ?? 0,
          completionTokens: data['usage']?.['completion_tokens'] ?? 0,
        },
        latencyMs: Date.now() - t0,
      };
    },
  };
}
