// apps/api/src/providers/replicate.ts — Replicate client.
//
// Two surfaces in this file:
//   1. separateStems() — Demucs stem separation (Music Studio feature)
//   2. generateReplicateVideo() — curated video model catalogue exposed
//      through the agent's `replicate_video` tool
//
// Stem separation uses the raw REST API. Video gen uses the SDK
// (`replicate.run`) so versions auto-resolve — community models don't
// have to be explicitly pinned.
//
// Auth: vault[REPLICATE_API_TOKEN] (or REPLICATE_KEY / replicate.api_token).

import Replicate from 'replicate';
import { vaultGet } from '../security/vault';

const REPLICATE_BASE = 'https://api.replicate.com/v1';
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 5 * 60 * 1_000; // 5 minutes

export interface StemBuffers {
  drums:  Buffer;
  bass:   Buffer;
  other:  Buffer;
  vocals: Buffer;
}

/** Upload a WAV buffer to Replicate's Demucs model and return the 4 stem buffers. */
export async function separateStems(opts: {
  wavBuffer:      Buffer;
  replicateToken: string;
}): Promise<StemBuffers> {
  const { wavBuffer, replicateToken } = opts;
  const authHeader = `Token ${replicateToken}`;

  // Encode WAV as data URI so we don't need a separate upload step
  const b64 = wavBuffer.toString('base64');
  const audioDataUri = `data:audio/wav;base64,${b64}`;

  // Create prediction
  const createRes = await fetch(
    `${REPLICATE_BASE}/models/ryan5453/demucs/predictions`,
    {
      method: 'POST',
      headers: {
        Authorization:  authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: { audio: audioDataUri } }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => '');
    throw new Error(`Replicate create prediction failed (HTTP ${createRes.status}): ${detail}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prediction = await createRes.json() as any;
  const predictionId: string = prediction['id'];
  if (!predictionId) throw new Error('Replicate: no prediction id in response');

  // Poll until succeeded or timed out
  const deadline = Date.now() + MAX_POLL_MS;
  let output: { drums: string; bass: string; other: string; vocals: string } | undefined;

  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(
      `${REPLICATE_BASE}/predictions/${predictionId}`,
      {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!pollRes.ok) {
      const detail = await pollRes.text().catch(() => '');
      throw new Error(`Replicate poll failed (HTTP ${pollRes.status}): ${detail}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poll = await pollRes.json() as any;
    const status: string = poll['status'];

    if (status === 'failed' || status === 'canceled') {
      const err: string = poll['error'] ?? status;
      throw new Error(`Replicate prediction ${status}: ${err}`);
    }

    if (status === 'succeeded') {
      output = poll['output'] as typeof output;
      break;
    }
    // status === 'starting' | 'processing' — keep polling
  }

  if (!output) {
    throw new Error('Replicate stem separation timed out after 5 minutes');
  }

  // Fetch each stem URL → Buffer
  const [drums, bass, other, vocals] = await Promise.all([
    fetchStem(output.drums,  authHeader),
    fetchStem(output.bass,   authHeader),
    fetchStem(output.other,  authHeader),
    fetchStem(output.vocals, authHeader),
  ]);

  return { drums, bass, other, vocals };
}

async function fetchStem(url: string, _authHeader: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Failed to fetch stem from ${url}: HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// ── Video generation surface ─────────────────────────────────────────────────
//
// Curated catalogue of cost-effective text-to-video models on Replicate.
// Each entry is the "owner/name" path Replicate expects in /v1/predictions.
// Pinning to specific versions is OPTIONAL — Replicate auto-resolves the
// latest version of a model when no `:hash` is given. We accept that
// trade-off for the catalogue's convenience; user upgrades a model by
// editing one map entry below.

export const REPLICATE_VIDEO_MODELS = {
  /** Cheapest. Good for previews. ~$0.06/run, 5s @ 768x512. */
  'ltx-fast':      'lightricks/ltx-video',
  /** Fast + cheap. Decent quality. ~$0.10/run, 5s @ 480p. */
  'wan-2-1-fast':  'wavespeedai/wan-2.1-t2v-480p',
  /** Strong subject motion + camera moves. ~$0.50/run, 6-10s @ 720p. */
  'hailuo-02':     'minimax/hailuo-02',
  /** Excellent prompt following, open-source weights. ~$0.45/run, ~5s @ 720p. */
  'hunyuan':       'tencent/hunyuan-video',
  /** Solid all-rounder. ~$0.30/run, 5s @ 720p. */
  'kling-1-6-std': 'kwaivgi/kling-v1.6-standard',
  /** Premium cinematic quality. ~$0.95/run, 5s @ 1080p. */
  'kling-1-6-pro': 'kwaivgi/kling-v1.6-pro',
} as const;

export type ReplicateVideoModelKey = keyof typeof REPLICATE_VIDEO_MODELS;

const VIDEO_KEY_NAMES = ['REPLICATE_API_TOKEN', 'REPLICATE_KEY', 'REPLICATE', 'replicate.api_token'];

async function getReplicateKey(tenantId: string, env: string): Promise<string | null> {
  for (const name of VIDEO_KEY_NAMES) {
    try { return await vaultGet({ name, env, tenantId }); } catch { /* try next */ }
  }
  return null;
}

export async function replicateAvailable(tenantId: string, env: string): Promise<boolean> {
  return !!(await getReplicateKey(tenantId, env));
}

export interface ReplicateVideoInput {
  prompt:           string;
  model:            ReplicateVideoModelKey;
  durationSeconds?: number;                          // default 5
  aspectRatio?:     '16:9' | '9:16' | '1:1';         // default 16:9
  tenantId:         string;
  env:              string;
  signal?:          AbortSignal;
}

export interface ReplicateVideoResult {
  ok:        boolean;
  /** Public URL of the rendered video. */
  url?:      string;
  /** Replicate prediction id, useful for diagnostics. */
  predictionId?: string;
  /** Which model was used (full owner/name path). */
  model?:    string;
  error?:    string;
}

/**
 * Each Replicate video model has its own input shape. This normalises ours
 * into theirs (prompt, duration, aspect ratio) per model.
 */
function buildVideoInput(
  modelKey: ReplicateVideoModelKey,
  prompt: string,
  durationSeconds: number,
  aspectRatio: string,
): Record<string, unknown> {
  switch (modelKey) {
    case 'ltx-fast':
      return {
        prompt,
        num_frames:   Math.min(Math.max(Math.round(durationSeconds * 25), 25), 257),
        aspect_ratio: aspectRatio,
      };
    case 'wan-2-1-fast':
      return {
        prompt,
        aspect_ratio: aspectRatio,
        num_frames:   Math.min(Math.round(durationSeconds * 16), 81),
      };
    case 'hailuo-02':
      return {
        prompt,
        duration:         Math.min(Math.max(Math.round(durationSeconds), 6), 10),
        prompt_optimizer: true,
      };
    case 'hunyuan':
      return {
        prompt,
        video_length: Math.min(Math.round(durationSeconds * 24), 129),
        aspect_ratio: aspectRatio,
      };
    case 'kling-1-6-std':
    case 'kling-1-6-pro':
      return {
        prompt,
        duration:     Math.min(Math.max(Math.round(durationSeconds), 5), 10),
        aspect_ratio: aspectRatio,
        cfg_scale:    0.5,
      };
    default:
      return { prompt };
  }
}

/**
 * Generate a video via Replicate. Polls until the prediction completes.
 * Returns the public URL of the rendered video.
 */
export async function generateReplicateVideo(input: ReplicateVideoInput): Promise<ReplicateVideoResult> {
  const apiKey = await getReplicateKey(input.tenantId, input.env);
  if (!apiKey) {
    return {
      ok:    false,
      error: 'REPLICATE_API_TOKEN not in vault — add it via Env & Secrets to enable Replicate',
    };
  }

  const modelPath = REPLICATE_VIDEO_MODELS[input.model];
  if (!modelPath) {
    return { ok: false, error: `Unknown Replicate model: ${input.model}` };
  }

  const prepared = buildVideoInput(
    input.model,
    input.prompt,
    input.durationSeconds ?? 5,
    input.aspectRatio     ?? '16:9',
  );

  // Use the SDK's `run()` which auto-resolves the latest version of the
  // model and handles polling internally. Way more robust than hitting the
  // model-namespaced endpoint manually (which 404s for community models).
  const replicate = new Replicate({ auth: apiKey });

  try {
    const output = await replicate.run(
      modelPath as `${string}/${string}`,
      { input: prepared, signal: input.signal },
    );

    const url = extractFirstUrl(output);
    if (!url) {
      return {
        ok:    false,
        model: modelPath,
        error: `Replicate succeeded but no URL in output: ${JSON.stringify(output).slice(0, 240)}`,
      };
    }
    return { ok: true, url, model: modelPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok:    false,
      model: modelPath,
      error: `Replicate run failed: ${msg}`,
    };
  }
}

/** Pluck the first http URL from various Replicate output shapes.
 *  Handles: bare string, array of strings, FileOutput object (with .url() getter),
 *  { url, video, output } objects. */
function extractFirstUrl(output: unknown): string | undefined {
  if (typeof output === 'string' && output.startsWith('http')) return output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const u = extractFirstUrl(item);
      if (u) return u;
    }
  }
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>;
    // SDK v1 FileOutput: object with .url() method that returns a URL object/string
    if (typeof o['url'] === 'function') {
      try {
        const u = (o['url'] as () => unknown)();
        if (typeof u === 'string' && u.startsWith('http')) return u;
        if (u && typeof u === 'object' && 'href' in u) return String((u as { href: string }).href);
      } catch { /* ignore */ }
    }
    if (typeof o['url'] === 'string' && (o['url'] as string).startsWith('http')) {
      return o['url'] as string;
    }
    if (typeof o['video'] === 'string' && (o['video'] as string).startsWith('http')) {
      return o['video'] as string;
    }
    if (typeof o['output'] !== 'undefined') {
      return extractFirstUrl(o['output']);
    }
  }
  return undefined;
}
