// apps/api/src/providers/sora.ts — OpenAI Sora 2 video generation client.
//
// Direct OpenAI API — uses OPENAI_API_KEY from vault. The Sora API surface
// has shifted as OpenAI rolled it out; this client tries the modern endpoint
// path with a defensive fallback to handle different release stages.
//
// Activation: set SORA_ENABLED=1 in env. The chat route then exposes the
// `sora_video` tool; the Video Studio UI shows the Sora slider next to
// Higgsfield.

import { vaultGet } from '../security/vault';

const OPENAI_BASE = 'https://api.openai.com/v1';
const KEY_NAMES   = ['OPENAI_API_KEY', 'OPENAI', 'openai.api_key'];

async function getOpenAIKey(tenantId: string, env: string): Promise<string | null> {
  for (const name of KEY_NAMES) {
    try { return await vaultGet({ name, env, tenantId }); } catch { /* try next */ }
  }
  return null;
}

export async function soraAvailable(tenantId: string, env: string): Promise<boolean> {
  return process.env.SORA_ENABLED !== '0' && !!(await getOpenAIKey(tenantId, env));
}

export interface SoraGenerationInput {
  prompt:        string;
  durationSeconds?: number;        // default 5
  aspectRatio?:    '16:9' | '9:16' | '1:1';   // default 16:9
  model?:          'sora-2' | 'sora-2-pro';   // default sora-2
  tenantId:        string;
  env:             string;
  signal?:         AbortSignal;
}

export interface SoraGenerationResult {
  ok:        boolean;
  /** Video URL when generation completed. */
  url?:      string;
  /** OpenAI job ID, useful for status polling. */
  jobId?:    string;
  /** Status: 'completed' | 'pending' | 'failed'. */
  status?:   string;
  error?:    string;
  /** Diagnostic — what HTTP path actually responded. */
  endpoint?: string;
}

/**
 * Generate a video via OpenAI's Sora 2 API.
 *
 * Defensive: tries the most-likely endpoint path. If OpenAI's Sora endpoint
 * isn't enabled on the org, returns a clear error message rather than a
 * cryptic 404.
 */
export async function generateSoraVideo(input: SoraGenerationInput): Promise<SoraGenerationResult> {
  const apiKey = await getOpenAIKey(input.tenantId, input.env);
  if (!apiKey) {
    return { ok: false, error: 'OPENAI_API_KEY not in vault — add it via Env & Secrets to enable Sora' };
  }

  const model           = input.model ?? 'sora-2';
  const durationSeconds = input.durationSeconds ?? 5;
  const aspectRatio     = input.aspectRatio ?? '16:9';

  // Map aspect ratio to OpenAI's size shorthand if needed.
  const sizeMap: Record<string, string> = {
    '16:9': '1280x720',
    '9:16': '720x1280',
    '1:1':  '1024x1024',
  };
  const size = sizeMap[aspectRatio] ?? '1280x720';

  // Endpoint 1: /videos/generations (most current per OpenAI docs)
  const body = {
    model,
    prompt:           input.prompt,
    seconds:          durationSeconds,
    size,
  };

  const endpointsToTry = [
    `${OPENAI_BASE}/videos/generations`,
    `${OPENAI_BASE}/videos`,        // alternate name some docs reference
    `${OPENAI_BASE}/video/generations`,
  ];

  let lastErr: string | null = null;
  for (const endpoint of endpointsToTry) {
    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json',
        },
        body:   JSON.stringify(body),
        signal: input.signal,
      });

      if (res.status === 404) { lastErr = `${endpoint} returned 404`; continue; }
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          ok:    false,
          error: `OpenAI Sora ${res.status} from ${endpoint}: ${errText.slice(0, 300)}`,
          endpoint,
        };
      }

      // Parse response. Could be a job (status=pending) or a completed URL.
      const data = await res.json() as Record<string, unknown>;
      const jobId  = data['id'] as string | undefined;
      const status = data['status'] as string | undefined ?? 'completed';
      // Try multiple field names for the video URL across API versions
      const url    = (data['url'] as string | undefined)
                  ?? ((data['data'] as Record<string, unknown> | undefined)?.['url'] as string | undefined)
                  ?? ((data['video'] as Record<string, unknown> | undefined)?.['url'] as string | undefined)
                  ?? ((data['output'] as Record<string, unknown> | undefined)?.['url'] as string | undefined);

      if (status === 'completed' && url) {
        return { ok: true, url, jobId, status, endpoint };
      }

      // Pending — return job info so the caller can poll.
      if (jobId && (status === 'pending' || status === 'processing' || status === 'queued')) {
        const polled = await pollSoraJob({ jobId, apiKey, signal: input.signal });
        if (polled.ok) return { ...polled, endpoint };
        return { ok: false, error: polled.error ?? 'polling failed', jobId, status, endpoint };
      }

      return {
        ok:       false,
        error:    `Unexpected Sora response: status=${status} url=${url ?? 'missing'}`,
        jobId,
        status,
        endpoint,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      // Try next endpoint
    }
  }

  return {
    ok:    false,
    error: `All Sora endpoints failed. Last error: ${lastErr ?? 'unknown'}. The Sora 2 API may not be enabled on this OpenAI org yet, or the endpoint path has changed.`,
  };
}

/** Poll for a Sora job to complete. Caps at 5 minutes. */
async function pollSoraJob(input: {
  jobId:   string;
  apiKey:  string;
  signal?: AbortSignal;
}): Promise<SoraGenerationResult> {
  const startedAt = Date.now();
  const TIMEOUT   = 5 * 60 * 1000;
  const INTERVAL  = 5_000;

  while (Date.now() - startedAt < TIMEOUT) {
    if (input.signal?.aborted) return { ok: false, error: 'aborted' };

    await new Promise((r) => setTimeout(r, INTERVAL));

    const endpointsToTry = [
      `${OPENAI_BASE}/videos/generations/${input.jobId}`,
      `${OPENAI_BASE}/videos/${input.jobId}`,
      `${OPENAI_BASE}/video/generations/${input.jobId}`,
    ];

    for (const endpoint of endpointsToTry) {
      try {
        const res = await fetch(endpoint, {
          headers: { 'Authorization': `Bearer ${input.apiKey}` },
          signal:  input.signal,
        });
        if (res.status === 404) continue;
        if (!res.ok) continue;

        const data   = await res.json() as Record<string, unknown>;
        const status = (data['status'] as string | undefined) ?? '';
        const url    = (data['url'] as string | undefined)
                    ?? ((data['data'] as Record<string, unknown> | undefined)?.['url'] as string | undefined)
                    ?? ((data['video'] as Record<string, unknown> | undefined)?.['url'] as string | undefined);

        if (status === 'completed' && url) return { ok: true, url, jobId: input.jobId, status };
        if (status === 'failed')           return { ok: false, error: 'Sora job failed', jobId: input.jobId, status };
        // else still pending; loop continues
        break;  // got a valid response, no need to try other endpoints this round
      } catch { /* try next endpoint */ }
    }
  }

  return { ok: false, error: 'Sora poll timed out after 5 minutes', jobId: input.jobId };
}
