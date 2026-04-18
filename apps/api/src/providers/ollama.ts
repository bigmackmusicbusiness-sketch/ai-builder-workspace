// apps/api/src/providers/ollama.ts — Ollama local model adapter.
// baseUrl from provider_configs (defaults to http://localhost:11434).
// Timeout surfaced to UI. Fallback is OFF by default.
import type {
  ProviderAdapter, ModelInfo, HealthcheckResult,
  ChatRequest, ChatChunk, CompleteRequest, CompleteResponse,
} from '@abw/providers';

export function createOllamaAdapter(baseUrl: string): ProviderAdapter {
  const base = baseUrl.replace(/\/$/, '');

  return {
    id:    'ollama',
    label: 'Ollama (local)',

    async listModels(): Promise<ModelInfo[]> {
      try {
        const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await res.json() as { models?: any[] };
        return (data.models ?? []).map((m) => ({
          id:    m.name as string,
          label: m.name as string,
        }));
      } catch {
        return [];
      }
    },

    async healthcheck(): Promise<HealthcheckResult> {
      const t0 = Date.now();
      try {
        const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
        return { ok: res.ok, latencyMs: Date.now() - t0 };
      } catch (err) {
        const msg = String(err);
        const isTimeout = msg.includes('TimeoutError') || msg.includes('abort');
        return {
          ok:        false,
          latencyMs: Date.now() - t0,
          detail:    isTimeout ? 'Connection timed out — is Ollama running?' : msg,
        };
      }
    },

    async *chat(req: ChatRequest, opts: { signal: AbortSignal }): AsyncIterable<ChatChunk> {
      let response: Response;
      try {
        response = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model:    req.model,
            messages: req.messages,
            stream:   true,
            options: {
              temperature: req.temperature ?? 0.7,
              top_p:       req.topP ?? 0.9,
              num_predict: req.maxTokens ?? 2048,
            },
          }),
          signal: opts.signal,
        });
      } catch (err) {
        const msg = String(err);
        const isTimeout = msg.includes('TimeoutError') || msg.includes('abort');
        yield { type: 'error', error: isTimeout ? 'Ollama timed out.' : `Ollama unreachable: ${msg}` };
        return;
      }

      if (!response.ok) {
        yield { type: 'error', error: `Ollama HTTP ${response.status}` };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) { yield { type: 'error', error: 'No response body from Ollama' }; return; }
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!opts.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const obj = JSON.parse(line) as any;
              const delta = obj?.message?.content;
              if (typeof delta === 'string' && delta) yield { type: 'delta', delta };
              if (obj?.done) {
                yield {
                  type: 'done',
                  usage: {
                    promptTokens:     obj.prompt_eval_count ?? 0,
                    completionTokens: obj.eval_count ?? 0,
                  },
                };
              }
            } catch { /* malformed line */ }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },

    async complete(req: CompleteRequest): Promise<CompleteResponse> {
      const t0 = Date.now();
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:    req.model,
          messages: [{ role: 'user', content: req.prompt }],
          stream:   false,
          options: { temperature: req.temperature ?? 0.3, num_predict: req.maxTokens ?? 1024 },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as any;
      return {
        text:      data?.message?.content ?? '',
        model:     req.model,
        usage:     { promptTokens: data.prompt_eval_count ?? 0, completionTokens: data.eval_count ?? 0 },
        latencyMs: Date.now() - t0,
      };
    },
  };
}
