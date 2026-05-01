// apps/api/src/lib/video/orchestrator.ts — high-level video generation entry point.
//
// Each kind has its own orchestrator that turns a brief into a populated
// Timeline. The orchestrator:
//   1. Plans (single LLM call to MiniMax for script + scene list)
//   2. Generates (calls Higgsfield image/video tools per scene)
//   3. Stitches (assembles scenes into the timeline as clips)
//   4. Captions (auto-overlays from the script)
// The result is stored on video_projects.timeline. The user can then review
// the AI's first crack in the editor before clicking Render.
//
// Cost-conscious model selection:
//   • Movies: standard quality (Seedance/Kling/Hailuo) — cheap multi-scene
//   • Commercials: standard
//   • Shorts: draft (Hailuo cheapest) — high volume use case
//   • Music videos: standard
// Premium models (Sora 2 / Veo 3.1) only when the user explicitly upgrades.

import type { Timeline, VideoClip, Overlay, AspectRatio } from '../timeline';
import { emptyTimeline, summariseTimeline, type TimelineSummary } from '../timeline';
import { generateHiggsfieldMedia } from '../../providers/higgsfield';
import { createMinimaxAdapter } from '../../providers/minimax';
import { uploadBufferAsAsset } from '../assetUpload';

// ── Types shared by all per-kind orchestrators ──────────────────────────────

export interface OrchestratorContext {
  tenantId:    string;
  env:         string;
  projectId:   string | null;
  videoProjectId: string;
  /** Stream a progress event back to the SSE client. */
  emit(ev: { type: string; step?: string; pct?: number; message?: string; sceneIndex?: number; sceneTitle?: string }): void;
}

export interface OrchestratorInput {
  title:       string;
  brief:       string;
  durationSec: number;
  aspectRatio: AspectRatio;
}

export interface OrchestratorResult {
  timeline:    Timeline;
  /** Costs reported by underlying APIs (rough). */
  costUsdCents: number;
  /** Compact summary of what was produced. */
  summary:     TimelineSummary;
}

export type Quality = 'draft' | 'standard' | 'premium';

/** Generate a video clip via Higgsfield, upload as asset, return assetId + duration.
 *  Uses the shared `generateHiggsfieldMedia` helper which handles model
 *  discovery, the { params: ... } wrap, job submit + poll, and media extract. */
export async function generateVideoScene(
  ctx:      OrchestratorContext,
  prompt:   string,
  durationSec: number,
  aspectRatio: AspectRatio,
  quality:  Quality = 'standard',
): Promise<{ assetId: string; durationSec: number; modelUsed: string }> {
  const media = await generateHiggsfieldMedia({
    tenantId:    ctx.tenantId,
    env:         ctx.env,
    kind:        'video',
    prompt,
    quality,
    aspectRatio,
    durationSec,
  });
  if (!media) throw new Error(`Higgsfield video produced no media`);
  const upload = await uploadBufferAsAsset({
    tenantId:  ctx.tenantId,
    projectId: ctx.projectId,
    folder:    `videos/${ctx.videoProjectId}/scenes`,
    filename:  `scene-${Date.now()}.mp4`,
    mimeType:  media.mimeType,
    buffer:    media.buffer,
  });
  return { assetId: upload.assetId, durationSec, modelUsed: media.modelUsed };
}

// ── Script planning (MiniMax) ───────────────────────────────────────────────

export interface SceneSpec {
  index:       number;
  title:       string;
  prompt:      string;       // Higgsfield video prompt
  durationSec: number;
  caption?:    string;       // Optional spoken/text overlay
}

export interface ScriptPlan {
  scenes:    SceneSpec[];
  hookLine?: string;
  cta?:      string;
}

/** Use MiniMax M2.5 (non-thinking, fast) to produce a structured script. */
export async function planScript(
  ctx:       OrchestratorContext,
  input:     OrchestratorInput,
  sceneCount: number,
): Promise<ScriptPlan> {
  const adapter = createMinimaxAdapter(ctx.tenantId, ctx.env);
  const sceneDur = Math.max(3, Math.round(input.durationSec / sceneCount));

  const prompt = `You are planning a ${input.durationSec}-second video titled "${input.title}".

Brief: ${input.brief}

Aspect: ${input.aspectRatio}.
Produce ${sceneCount} scenes, each roughly ${sceneDur} seconds.

Return ONLY JSON in this exact shape (no markdown fences, no commentary):
{
  "hookLine": "<optional 5-9 word hook for the first 3 seconds>",
  "cta": "<optional call-to-action for the final scene>",
  "scenes": [
    {
      "index": 0,
      "title": "Brief scene title",
      "prompt": "Detailed visual prompt for the AI video model: subject, action, camera, lighting, mood.",
      "durationSec": ${sceneDur},
      "caption": "Optional on-screen caption text shown during this scene"
    }
  ]
}`;

  const res = await adapter.complete({
    prompt,
    model:       'MiniMax-M2.5',
    maxTokens:   2048,
    temperature: 0.6,
  });

  const cleaned = stripJsonFences(res.text ?? '');
  let parsed: ScriptPlan;
  try {
    parsed = JSON.parse(cleaned) as ScriptPlan;
  } catch (err) {
    throw new Error(`Script planner returned invalid JSON: ${(err as Error).message}. Raw: ${cleaned.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error('Script planner produced no scenes');
  }
  return parsed;
}

function stripJsonFences(s: string): string {
  let out = s.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
  out = out.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  if (!out.startsWith('{') && !out.startsWith('[')) {
    const idx = out.search(/[{[]/);
    if (idx > 0) out = out.slice(idx);
  }
  return out;
}

// ── Timeline assembly ────────────────────────────────────────────────────────

/** Convert a list of generated scenes into a Timeline. */
export function assembleTimeline(
  scenes:      { assetId: string; durationSec: number; spec: SceneSpec }[],
  aspectRatio: AspectRatio,
  fps:         number = 30,
): Timeline {
  const t = emptyTimeline({ aspectRatio, fps });
  let cursor = 0;

  for (const s of scenes) {
    const clip: VideoClip = {
      id:            `clip-${s.spec.index}`,
      sourceAssetId: s.assetId,
      in:            0,
      out:           s.durationSec,
      start:         cursor,
      transitionIn:  s.spec.index === 0 ? undefined : { kind: 'cut', durationSec: 0 },
    };
    t.tracks[0].clips.push(clip);

    if (s.spec.caption) {
      const overlay: Overlay = {
        id:    `cap-${s.spec.index}`,
        kind:  'caption',
        start: cursor,
        end:   cursor + s.durationSec,
        props: { text: s.spec.caption, color: '#ffffff' },
      };
      t.overlays.push(overlay);
    }
    cursor += s.durationSec;
  }

  t.durationSec      = cursor;
  t.meta.aiFirstPassAt = Date.now();
  return t;
}

// Re-export the summariser so routes can return compact agent-friendly state
export { summariseTimeline };
