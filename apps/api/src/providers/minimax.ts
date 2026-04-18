// apps/api/src/providers/minimax.ts — MiniMax 2.7 adapter (server-side only).
// API key fetched from vault, never from process.env in the request path.
// Correct MiniMax /v1/text/chatcompletion_v2 request shape.
import type {
  ProviderAdapter, ModelInfo, HealthcheckResult,
  ChatRequest, ChatChunk, CompleteRequest, CompleteResponse,
} from '@abw/providers';
import { vaultGet } from '../security/vault';

const MINIMAX_BASE = 'https://api.minimax.chat/v1';

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
          } catch { /* malformed SSE line */ }
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
      // MiniMax doesn't expose a public model list endpoint; return known models.
      return [
        { id: 'abab6.5-chat', label: 'MiniMax 2.7 (abab6.5)', sizeB: 6.5 },
        { id: 'abab5.5-chat', label: 'MiniMax (abab5.5)',      sizeB: 5.5 },
      ];
    },

    async healthcheck(): Promise<HealthcheckResult> {
      const t0 = Date.now();
      try {
        const apiKey = await getApiKey(tenantId, env);
        const res = await fetch(`${MINIMAX_BASE}/text/chatcompletion_v2`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'abab5.5-chat',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(8000),
        });
        return { ok: res.ok, latencyMs: Date.now() - t0, detail: res.ok ? undefined : `HTTP ${res.status}` };
      } catch (err) {
        return { ok: false, latencyMs: Date.now() - t0, detail: String(err) };
      }
    },

    async *chat(req: ChatRequest, opts: { signal: AbortSignal }): AsyncIterable<ChatChunk> {
      const apiKey = await getApiKey(tenantId, env);
      const body = {
        model:       req.model,
        messages:    req.messages,
        temperature: req.temperature ?? 0.7,
        top_p:       req.topP ?? 0.9,
        max_tokens:  req.maxTokens ?? 2048,
        stream:      true,
      };

      let response: Response;
      try {
        response = await fetch(`${MINIMAX_BASE}/text/chatcompletion_v2`, {
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

      for await (const event of parseSSE(response, opts.signal)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const choices = (event['choices'] as any[])?.[0];
        const delta   = choices?.['delta']?.['content'];
        if (typeof delta === 'string') yield { type: 'delta', delta };
        const finishReason = choices?.['finish_reason'];
        if (finishReason === 'stop') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const usage = event['usage'] as any;
          yield {
            type: 'done',
            usage: usage
              ? { promptTokens: usage['prompt_tokens'] ?? 0, completionTokens: usage['completion_tokens'] ?? 0 }
              : undefined,
          };
        }
      }
    },

    async complete(req: CompleteRequest): Promise<CompleteResponse> {
      const t0 = Date.now();
      const apiKey = await getApiKey(tenantId, env);
      const res = await fetch(`${MINIMAX_BASE}/text/chatcompletion_v2`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:       req.model,
          messages:    [{ role: 'user', content: req.prompt }],
          temperature: req.temperature ?? 0.3,
          max_tokens:  req.maxTokens ?? 1024,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`MiniMax HTTP ${res.status}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as any;
      return {
        text:      data['choices']?.[0]?.['message']?.['content'] ?? '',
        model:     req.model,
        usage:     { promptTokens: data['usage']?.['prompt_tokens'] ?? 0, completionTokens: data['usage']?.['completion_tokens'] ?? 0 },
        latencyMs: Date.now() - t0,
      };
    },
  };
}
