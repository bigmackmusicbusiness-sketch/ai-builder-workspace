// apps/api/src/agent/tools/sora.ts — `sora_video` tool definition + executor.
//
// Mirrors higgsfield_video shape so the agent can call either provider.
// Uploaded result lands in Supabase Storage as a tenant-scoped asset.

import type { ToolDefinition } from '@abw/providers';
import { generateSoraVideo } from '../../providers/sora';
import { uploadBufferAsAsset } from '../../lib/assetUpload';

export const SORA_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name:        'sora_video',
      description:
        'Generate a video using OpenAI Sora 2. Use for high-quality cinematic shots, ' +
        'product demos, hero videos. Costs OpenAI credits — use sparingly.',
      parameters: {
        type: 'object',
        properties: {
          prompt:           { type: 'string',  description: 'Detailed video prompt: subject, motion, style, lighting, camera move.' },
          duration_seconds: { type: 'integer', description: 'Length in seconds (3-12). Default 5.', minimum: 3, maximum: 12 },
          aspect_ratio:     { type: 'string',  description: 'Aspect ratio.', enum: ['16:9', '9:16', '1:1'] },
          model:            { type: 'string',  description: 'Sora model tier.',  enum: ['sora-2', 'sora-2-pro'] },
        },
        required: ['prompt'],
      },
    },
  },
];

export interface SoraExecuteContext {
  tenantId:  string;
  env:       string;
  projectId?: string | null;
  signal?:   AbortSignal;
}

export interface SoraExecuteResult {
  ok:       boolean;
  summary:  string;
  result:   string;
}

export async function executeSoraVideo(
  args: Record<string, unknown>,
  ctx:  SoraExecuteContext,
): Promise<SoraExecuteResult> {
  const prompt          = typeof args.prompt === 'string' ? args.prompt : '';
  const durationSeconds = typeof args.duration_seconds === 'number' ? args.duration_seconds : 5;
  const aspectRatio     = (args.aspect_ratio as '16:9' | '9:16' | '1:1' | undefined) ?? '16:9';
  const model           = (args.model as 'sora-2' | 'sora-2-pro' | undefined) ?? 'sora-2';

  if (!prompt) {
    return { ok: false, summary: 'sora_video refused — prompt required', result: 'Error: sora_video needs a "prompt" argument.' };
  }

  const gen = await generateSoraVideo({
    prompt,
    durationSeconds,
    aspectRatio,
    model,
    tenantId: ctx.tenantId,
    env:      ctx.env,
    signal:   ctx.signal,
  });

  if (!gen.ok || !gen.url) {
    return {
      ok:      false,
      summary: `sora_video failed (${model})`,
      result:  `Error: ${gen.error ?? 'unknown'}.`,
    };
  }

  // Download + upload to our asset bucket so the URL stays stable
  let assetUrl = gen.url;
  let assetId: string | undefined;
  try {
    const r = await fetch(gen.url, { signal: ctx.signal });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const upload = await uploadBufferAsAsset({
        tenantId:  ctx.tenantId,
        projectId: ctx.projectId ?? null,
        folder:    'videos/sora',
        filename:  `${Date.now()}.mp4`,
        mimeType:  'video/mp4',
        buffer:    buf,
      });
      assetUrl = upload.url;
      assetId  = upload.assetId;
    }
  } catch { /* keep gen.url */ }

  return {
    ok:      true,
    summary: `Generated ${model} video (${durationSeconds}s ${aspectRatio})`,
    result:  `Video ready: ${assetUrl}${assetId ? ` (asset_id: ${assetId})` : ''}`,
  };
}
