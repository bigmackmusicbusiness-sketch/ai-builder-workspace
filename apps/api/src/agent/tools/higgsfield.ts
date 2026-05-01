// apps/api/src/agent/tools/higgsfield.ts — agent-facing Higgsfield tools.
//
// We expose four LOGICAL tools to the agent that are stable across whatever
// underlying Higgsfield model tools exist:
//   higgsfield_image  — generate one or more images
//   higgsfield_video  — generate a short video clip
//   higgsfield_audio  — generate a music/audio track (if Higgsfield audio is available)
//   higgsfield_history — browse past generations from the user's Higgsfield asset library
//
// On first invocation per process, we list Higgsfield's actual tool catalogue
// and pick a sensible underlying tool for each logical category (cheapest model
// by default; agent can override via `quality: 'premium'`). This avoids hard-coding
// model names that might change on Higgsfield's side.

import type { ToolDefinition } from '@abw/providers';
import { openHiggsfield, categorizeHiggsfieldTools, generateHiggsfieldMedia } from '../../providers/higgsfield';
import { uploadBufferAsAsset } from '../../lib/assetUpload';

// ── Schemas (exposed to the LLM via the tool definitions below) ────────────────

export const higgsfieldImageToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'higgsfield_image',
    description:
      'Generate a high-quality image via Higgsfield. Uses a fast model (Flux/Seedream) by default; ' +
      'pass quality:"premium" only when the user asked for top quality (Soul, Cinema Studio).',
    parameters: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt:       { type: 'string', description: 'Detailed image prompt: subject, style, lighting, colors.' },
        aspectRatio:  { type: 'string', description: '"16:9" | "9:16" | "1:1" | "4:3" — default "1:1".' },
        quality:      { type: 'string', enum: ['draft', 'standard', 'premium'], description: 'Cost vs quality. Default "standard".' },
        negative:     { type: 'string', description: 'Things to avoid in the image.' },
      },
    },
  },
};

export const higgsfieldVideoToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'higgsfield_video',
    description:
      'Generate a short video clip via Higgsfield (Hailuo 02 by default; Sora 2 / Veo 3.1 if quality:"premium"). ' +
      'EXPENSIVE — use sparingly. Each call typically costs 20-50 credits.',
    parameters: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt:        { type: 'string', description: 'Detailed video prompt with action, camera, mood.' },
        durationSec:   { type: 'number', description: 'Clip length in seconds, 3-10 typical. Default 5.' },
        aspectRatio:   { type: 'string', description: '"16:9" | "9:16" | "1:1" — default "16:9".' },
        quality:       { type: 'string', enum: ['draft', 'standard', 'premium'], description: 'Cost vs quality. Default "standard".' },
      },
    },
  },
};

export const higgsfieldAudioToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'higgsfield_audio',
    description:
      'Generate a music/audio track via Higgsfield. Falls back gracefully if Higgsfield does not currently expose an audio tool.',
    parameters: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt:      { type: 'string', description: 'What kind of music: genre, mood, instrumentation.' },
        durationSec: { type: 'number', description: 'Track length, 30-180s. Default 30.' },
      },
    },
  },
};

export const higgsfieldHistoryToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'higgsfield_history',
    description: 'Browse the user\'s past Higgsfield generations (assets they have already paid for). Use to reuse instead of regenerating.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max items to return (default 10).' },
      },
    },
  },
};

export const HIGGSFIELD_TOOL_DEFINITIONS: ToolDefinition[] = [
  higgsfieldImageToolDefinition,
  higgsfieldVideoToolDefinition,
  higgsfieldAudioToolDefinition,
  higgsfieldHistoryToolDefinition,
];

// ── Per-process cache of categorised tool catalogue ────────────────────────────

interface Catalogue {
  images:     string[];
  videos:     string[];
  audio:      string[];
  characters: string[];
  history:    string[];
  fetchedAt:  number;
}
const catalogueByTenant = new Map<string, Catalogue>();
const CATALOGUE_TTL_MS = 10 * 60_000; // 10 min

async function getCatalogue(tenantId: string, env: string): Promise<Catalogue> {
  const cached = catalogueByTenant.get(tenantId);
  if (cached && Date.now() - cached.fetchedAt < CATALOGUE_TTL_MS) return cached;

  const c = await openHiggsfield(tenantId, env);
  try {
    const tools = await c.listTools();
    const cats = categorizeHiggsfieldTools(tools);
    const fresh: Catalogue = { ...cats, fetchedAt: Date.now() };
    catalogueByTenant.set(tenantId, fresh);
    return fresh;
  } finally {
    await c.close();
  }
}

/** Pick an underlying Higgsfield tool name for a logical category + quality. */
function pickTool(catalogue: Catalogue, kind: 'images' | 'videos' | 'audio' | 'history', quality: 'draft' | 'standard' | 'premium'): string | undefined {
  const list = catalogue[kind];
  if (list.length === 0) return undefined;
  // Heuristic preference per quality. Lower index = cheaper.
  const preferences: Record<typeof kind, Record<typeof quality, RegExp[]>> = {
    images: {
      draft:    [/flux/i, /seedream/i, /nano-banana/i, /gpt-image/i, /soul/i],
      standard: [/seedream.*5/i, /flux.*2/i, /nano-banana.*pro/i, /soul.*2/i, /gpt-image/i],
      premium:  [/soul.*2/i, /cinema.*studio/i, /gpt-image.*2/i],
    },
    videos: {
      draft:    [/hailuo.*02/i, /wan/i, /seedance/i, /kling/i, /veo/i, /sora/i],
      standard: [/seedance.*2/i, /kling.*3/i, /hailuo.*02/i, /wan.*2/i],
      premium:  [/sora.*2/i, /veo.*3/i, /kling.*3/i],
    },
    audio:   { draft: [/.*/], standard: [/.*/], premium: [/.*/] },
    history: { draft: [/.*/], standard: [/.*/], premium: [/.*/] },
  };
  const prefs = preferences[kind][quality];
  for (const rx of prefs) {
    const hit = list.find((n) => rx.test(n));
    if (hit) return hit;
  }
  return list[0];
}

// ── Executors (called from agent/tools.ts dispatcher) ──────────────────────────

export interface HiggsfieldExecCtx {
  tenantId: string;
  projectId?: string | null;
  env: string;
}

export interface HiggsfieldExecResult {
  ok: boolean;
  summary: string;
  result: string;          // JSON string fed back to the model
  assetId?: string;
  assetUrl?: string;
}

export async function execHiggsfieldImage(
  args: Record<string, unknown>,
  ctx:  HiggsfieldExecCtx,
): Promise<HiggsfieldExecResult> {
  const prompt      = String(args['prompt'] ?? '');
  const aspectRatio = String(args['aspectRatio'] ?? '1:1');
  const quality     = (args['quality'] as 'draft' | 'standard' | 'premium' | undefined) ?? 'standard';
  if (!prompt) return { ok: false, summary: 'higgsfield_image needs a prompt', result: 'Error: prompt is required' };

  try {
    const media = await generateHiggsfieldMedia({
      tenantId:    ctx.tenantId,
      env:         ctx.env,
      kind:        'image',
      prompt,
      quality,
      aspectRatio,
    });
    if (!media) {
      return { ok: false, summary: 'Higgsfield image returned no media', result: 'Error: empty result' };
    }
    const upload = await uploadBufferAsAsset({
      tenantId:  ctx.tenantId,
      projectId: ctx.projectId ?? null,
      folder:    `higgsfield/image`,
      filename:  `${Date.now()}.${media.mimeType.split('/')[1]?.split('+')[0] ?? 'png'}`,
      mimeType:  media.mimeType,
      buffer:    media.buffer,
    });
    return {
      ok:       true,
      summary:  `Image generated via ${media.modelUsed} (${(media.buffer.length / 1024).toFixed(0)} KB)`,
      result:   JSON.stringify({ assetId: upload.assetId, url: upload.url, model: media.modelUsed, sourceUrl: media.sourceUrl }),
      assetId:  upload.assetId,
      assetUrl: upload.url,
    };
  } catch (err) {
    return { ok: false, summary: 'Higgsfield image gen failed', result: `Error: ${(err as Error).message}` };
  }
}

export async function execHiggsfieldVideo(
  args: Record<string, unknown>,
  ctx:  HiggsfieldExecCtx,
): Promise<HiggsfieldExecResult> {
  const prompt      = String(args['prompt'] ?? '');
  const durationSec = Number(args['durationSec'] ?? 5);
  const aspectRatio = String(args['aspectRatio'] ?? '16:9');
  const quality     = (args['quality'] as 'draft' | 'standard' | 'premium' | undefined) ?? 'standard';
  if (!prompt) return { ok: false, summary: 'higgsfield_video needs a prompt', result: 'Error: prompt is required' };

  try {
    const media = await generateHiggsfieldMedia({
      tenantId:    ctx.tenantId,
      env:         ctx.env,
      kind:        'video',
      prompt,
      quality,
      aspectRatio,
      durationSec,
    });
    if (!media) {
      return { ok: false, summary: 'Higgsfield video returned no media', result: 'Error: empty result' };
    }
    const upload = await uploadBufferAsAsset({
      tenantId:  ctx.tenantId,
      projectId: ctx.projectId ?? null,
      folder:    `higgsfield/video`,
      filename:  `${Date.now()}.mp4`,
      mimeType:  media.mimeType,
      buffer:    media.buffer,
    });
    return {
      ok:       true,
      summary:  `Video generated via ${media.modelUsed} (${(media.buffer.length / 1024 / 1024).toFixed(2)} MB)`,
      result:   JSON.stringify({ assetId: upload.assetId, url: upload.url, model: media.modelUsed, sourceUrl: media.sourceUrl }),
      assetId:  upload.assetId,
      assetUrl: upload.url,
    };
  } catch (err) {
    return { ok: false, summary: 'Higgsfield video gen failed', result: `Error: ${(err as Error).message}` };
  }
}

export async function execHiggsfieldAudio(
  args: Record<string, unknown>,
  ctx:  HiggsfieldExecCtx,
): Promise<HiggsfieldExecResult> {
  // Higgsfield does not currently expose an audio tool (verified empirically:
  // 0 audio tools in the catalogue). Surface the explicit fallback path.
  void args; void ctx;
  return {
    ok: false,
    summary: 'Higgsfield does not expose an audio tool for this account',
    result:  'Error: no audio tool available. Use the Music Studio (MiniMax + Replicate) for music generation.',
  };
}

export async function execHiggsfieldHistory(
  args: Record<string, unknown>,
  ctx:  HiggsfieldExecCtx,
): Promise<HiggsfieldExecResult> {
  const limit = Number(args['limit'] ?? 10);
  const catalogue = await getCatalogue(ctx.tenantId, ctx.env);
  const toolName = pickTool(catalogue, 'history', 'standard');
  if (!toolName) return { ok: false, summary: 'No history tool', result: 'Error: catalogue does not include a history tool' };

  const c = await openHiggsfield(ctx.tenantId, ctx.env);
  try {
    const r = await c.callTool(toolName, { params: { limit } });
    return {
      ok: true,
      summary: 'Listed Higgsfield history',
      result: JSON.stringify(r).slice(0, 4000), // cap context
    };
  } catch (err) {
    return { ok: false, summary: 'Higgsfield history failed', result: `Error: ${(err as Error).message}` };
  } finally {
    await c.close();
  }
}

// ── Result packaging: extract bytes/URL from MCP response, save as asset ───────

interface MCPResultContent {
  type:     string;
  text?:    string;
  data?:    string;
  url?:     string;
  mimeType?: string;
}

async function packageMediaResult(
  raw: unknown,
  kind: 'image' | 'video' | 'audio',
  ctx: HiggsfieldExecCtx,
): Promise<HiggsfieldExecResult> {
  // MCP returns { content: [{ type, text|data|url, ... }], isError? }
  const r = raw as { content?: MCPResultContent[]; isError?: boolean };
  if (r?.isError) {
    const msg = r.content?.find((c) => c.type === 'text')?.text ?? 'Higgsfield call returned isError';
    return { ok: false, summary: `Higgsfield ${kind} error`, result: `Error: ${msg.slice(0, 240)}` };
  }

  // Look for a URL or base64 blob in the content array
  let url: string | undefined;
  let buffer: Buffer | undefined;
  let mimeType = kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'audio/mpeg';

  for (const c of r?.content ?? []) {
    if (c.type === 'image' || c.type === 'audio' || c.type === 'video' || c.type === 'resource') {
      if (c.url)       url = c.url;
      else if (c.data) buffer = Buffer.from(c.data, 'base64');
      if (c.mimeType)  mimeType = c.mimeType;
    } else if (c.type === 'text' && c.text) {
      // Some MCP servers embed a URL in the text content
      const m = c.text.match(/https?:\/\/[^\s)]+\.(png|jpe?g|mp4|mov|mp3|wav|webm)/i);
      if (m && !url) url = m[0];
    }
  }

  // Mirror to our own storage so the user owns a copy. If we only got a URL,
  // fetch it; if we got bytes, just upload them.
  if (!buffer && url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      buffer = Buffer.from(await res.arrayBuffer());
    } catch {
      // Couldn't mirror — return the original URL in summary.
      return {
        ok: true,
        summary: `Higgsfield ${kind} ready (external URL): ${url}`,
        result: JSON.stringify({ url }),
        assetUrl: url,
      };
    }
  }

  if (!buffer) {
    return {
      ok: false,
      summary: `Higgsfield returned ${kind} but no data could be extracted`,
      result: `Error: response shape was ${JSON.stringify(r).slice(0, 240)}`,
    };
  }

  const ext = mimeType.split('/')[1]?.split('+')[0] ?? 'bin';
  const upload = await uploadBufferAsAsset({
    tenantId:  ctx.tenantId,
    projectId: ctx.projectId ?? null,
    folder:    `higgsfield/${kind}`,
    filename:  `${Date.now()}.${ext}`,
    mimeType,
    buffer,
  });

  return {
    ok:       true,
    summary:  `Higgsfield ${kind} generated (${(buffer.length / 1024).toFixed(1)} KB)`,
    result:   JSON.stringify({ assetId: upload.assetId, url: upload.url, kind, sizeBytes: buffer.length }),
    assetId:  upload.assetId,
    assetUrl: upload.url,
  };
}
