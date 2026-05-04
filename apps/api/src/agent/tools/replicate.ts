// apps/api/src/agent/tools/replicate.ts — `replicate_video` tool definition + executor.
//
// Curated catalogue of cost-effective video models on Replicate. The agent
// picks a `model` from the enum; each is normalised to a (prompt, duration,
// aspect_ratio) shape on the way in.
//
// Output handling:
//   1. Replicate returns a URL.
//   2. We fetch the bytes, upload to Supabase Storage as a tenant + project
//      asset (so it appears in the project's Video Studio Library).
//   3. Insert a row into video_projects so the Library tab can render it.
//   4. Return the asset URL to the agent.

import type { ToolDefinition } from '@abw/providers';
import { generateReplicateVideo, type ReplicateVideoModelKey } from '../../providers/replicate';
import { uploadBufferAsAsset } from '../../lib/assetUpload';
import { getDb } from '../../db/client';
import { videoProjects } from '@abw/db';

export const REPLICATE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'replicate_video',
      description:
        'Generate a video using a curated Replicate model. Pick `ltx-fast` or ' +
        '`wan-2-1-fast` for cheap previews ($0.06–0.10/run). Step up to ' +
        '`hailuo-02` (~$0.50/run, strong subject motion), `hunyuan` (~$0.45/run, ' +
        'good prompt following), `kling-1-6-std` (~$0.30/run, solid all-rounder), ' +
        'or `kling-1-6-pro` (~$0.95/run, premium 1080p) when quality matters. ' +
        'Output is uploaded to the project\'s video library automatically.',
      parameters: {
        type: 'object',
        properties: {
          prompt:           { type: 'string',  description: 'Detailed video prompt: subject, motion, style, lighting, camera move.' },
          model:            {
            type: 'string',
            description: 'Which Replicate model to use. Default to a cheap option for first-pass exploration.',
            enum: ['ltx-fast', 'wan-2-1-fast', 'hailuo-02', 'hunyuan', 'kling-1-6-std', 'kling-1-6-pro'],
          },
          duration_seconds: { type: 'integer', description: 'Length in seconds (3-10). Default 5.', minimum: 3, maximum: 10 },
          aspect_ratio:     { type: 'string',  description: 'Aspect ratio.', enum: ['16:9', '9:16', '1:1'] },
        },
        required: ['prompt'],
      },
    },
  },
];

const VALID_MODELS: ReplicateVideoModelKey[] = [
  'ltx-fast', 'wan-2-1-fast', 'hailuo-02', 'hunyuan',
  'kling-1-6-std', 'kling-1-6-pro',
];

export interface ReplicateExecuteContext {
  tenantId:   string;
  env:        string;
  projectId?: string | null;
  signal?:    AbortSignal;
}

export interface ReplicateExecuteResult {
  ok:      boolean;
  summary: string;
  result:  string;
}

export async function executeReplicateVideo(
  args: Record<string, unknown>,
  ctx:  ReplicateExecuteContext,
): Promise<ReplicateExecuteResult> {
  const prompt          = typeof args['prompt']           === 'string' ? args['prompt']           : '';
  const requestedModel  = typeof args['model']            === 'string' ? args['model']            : 'ltx-fast';
  const durationSeconds = typeof args['duration_seconds'] === 'number' ? args['duration_seconds'] : 5;
  const aspectRatio     = (args['aspect_ratio'] as '16:9' | '9:16' | '1:1' | undefined) ?? '16:9';

  if (!prompt) {
    return {
      ok:      false,
      summary: 'replicate_video refused — prompt required',
      result:  'Error: replicate_video needs a "prompt" argument.',
    };
  }
  const model = VALID_MODELS.includes(requestedModel as ReplicateVideoModelKey)
    ? (requestedModel as ReplicateVideoModelKey)
    : 'ltx-fast';

  const gen = await generateReplicateVideo({
    prompt,
    model,
    durationSeconds,
    aspectRatio,
    tenantId: ctx.tenantId,
    env:      ctx.env,
    signal:   ctx.signal,
  });

  if (!gen.ok || !gen.url) {
    return {
      ok:      false,
      summary: `replicate_video failed (${model})`,
      result:  `Error: ${gen.error ?? 'unknown'}.`,
    };
  }

  // Download + upload to Supabase Storage so the URL stays stable + project-scoped
  let assetUrl = gen.url;
  let assetId: string | undefined;
  try {
    const r = await fetch(gen.url, { signal: ctx.signal });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const upload = await uploadBufferAsAsset({
        tenantId:  ctx.tenantId,
        projectId: ctx.projectId ?? null,
        folder:    `videos/replicate/${model}`,
        filename:  `${Date.now()}.mp4`,
        mimeType:  'video/mp4',
        buffer:    buf,
      });
      assetUrl = upload.url;
      assetId  = upload.assetId;

      // Insert into video_projects so it shows up in the project's
      // Video Studio Library tab. Best-effort — failure here doesn't
      // invalidate the generation; agent gets the URL either way.
      if (ctx.projectId && assetId) {
        try {
          const db = getDb();
          await db.insert(videoProjects).values({
            tenantId:     ctx.tenantId,
            projectId:    ctx.projectId,
            title:        prompt.slice(0, 80),
            kind:         'short',
            brief:        prompt,
            durationSec:  durationSeconds,
            aspectRatio,
            status:       'ready',
            finalAssetId: assetId,
            costUsdCents: estimateCostCents(model),
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[replicate_video] failed to insert video_projects row: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } catch { /* keep gen.url */ }

  return {
    ok:      true,
    summary: `Generated ${model} video (${durationSeconds}s ${aspectRatio})`,
    result:
      `Video ready: ${assetUrl}\n` +
      `Model: ${gen.model ?? model}\n` +
      (assetId ? `Asset id: ${assetId}\n` : '') +
      (ctx.projectId ? `Saved to the project's Video Studio Library.` : ''),
  };
}

/** Rough cost estimate in USD cents per model (for the video_projects row). */
function estimateCostCents(model: ReplicateVideoModelKey): number {
  switch (model) {
    case 'ltx-fast':      return 6;
    case 'wan-2-1-fast':  return 10;
    case 'kling-1-6-std': return 30;
    case 'hunyuan':       return 45;
    case 'hailuo-02':     return 50;
    case 'kling-1-6-pro': return 95;
    default:              return 0;
  }
}
