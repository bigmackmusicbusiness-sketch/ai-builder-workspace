// apps/api/src/providers/minimax.ts — MiniMax M2.7 adapter (server-side only).
// API key fetched from vault, never from process.env in the request path.
//
// Endpoint: https://api.minimax.io/v1/chat/completions  (OpenAI-compatible)
// Models:   MiniMax-M2.7 | MiniMax-M2.7-highspeed | MiniMax-M2.5 | MiniMax-M2.1
//
// Auth: Bearer {API_KEY} — token-plan keys and pay-as-you-go keys use the same header.
// Context window: 204,800 tokens (M2.7).
// Temperature: (0, 1] only — MiniMax does not accept values > 1.

import type {
  ProviderAdapter, ModelInfo, HealthcheckResult,
  ChatRequest, ChatChunk, CompleteRequest, CompleteResponse,
} from '@abw/providers';
import { vaultGet } from '../security/vault';

// International platform endpoint — NOT api.minimax.chat (retired China endpoint).
const MINIMAX_BASE = 'https://api.minimax.io/v1';

async function getApiKey(tenantId: string, env: string): Promise<string> {
  return vaultGet({ name: 'minimax.api_key', env, tenantId });
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

export function createMinimaxAdapter(tenantId: string, env: string): ProviderAdapter {
  return {
    id:    'minimax',
    label: 'MiniMax',

    async listModels(): Promise<ModelInfo[]> {
      // MiniMax does not expose a public model-list endpoint; hardcode known models.
      return [
        { id: 'MiniMax-M2.7',           label: 'MiniMax M2.7',            sizeB: undefined },
        { id: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 (highspeed)', sizeB: undefined },
        { id: 'MiniMax-M2.5',           label: 'MiniMax M2.5',            sizeB: undefined },
        { id: 'MiniMax-M2.5-highspeed', label: 'MiniMax M2.5 (highspeed)', sizeB: undefined },
        { id: 'MiniMax-M2.1',           label: 'MiniMax M2.1',            sizeB: undefined },
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

      // MiniMax temperature range is (0, 1] — clamp to avoid rejection.
      const temperature = Math.min(req.temperature ?? 0.7, 1.0);

      const body = {
        model:       req.model,
        messages:    req.messages,
        temperature,
        top_p:       req.topP ?? 0.95,
        max_tokens:  req.maxTokens ?? 4096,
        stream:      true,
      };

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

      // OpenAI-compatible SSE: choices[0].delta.content
      for await (const event of parseSSE(response, opts.signal)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const choice = (event['choices'] as any[])?.[0];
        const delta  = choice?.['delta']?.['content'];
        if (typeof delta === 'string' && delta.length > 0) {
          yield { type: 'delta', delta };
        }
        if (choice?.['finish_reason'] === 'stop') {
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
        }
      }
    },

    async complete(req: CompleteRequest): Promise<CompleteResponse> {
      const t0 = Date.now();
      const apiKey = await getApiKey(tenantId, env);
      const temperature = Math.min(req.temperature ?? 0.3, 1.0);

      const res = await fetch(`${MINIMAX_BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:       req.model,
          messages:    [{ role: 'user', content: req.prompt }],
          temperature,
          max_tokens:  req.maxTokens ?? 2048,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`MiniMax HTTP ${res.status}: ${detail}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as any;
      return {
        text:      data['choices']?.[0]?.['message']?.['content'] ?? '',
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
