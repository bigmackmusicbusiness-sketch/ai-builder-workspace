// apps/api/src/lib/video/kinds.ts — per-kind orchestrators.
// Each function reads a brief + duration, plans scenes, generates them via
// Higgsfield, assembles a timeline, and returns it. Differences between
// kinds: scene count, default quality, optional voiceover, default aspect.
import {
  planScript, generateVideoScene, assembleTimeline,
  type OrchestratorContext, type OrchestratorInput, type OrchestratorResult,
  type Quality, type SceneSpec,
} from './orchestrator';

/** Roughly estimate cost in cents based on quality tier and scene count.
 *  These are rough — actual Higgsfield credit consumption varies by model. */
function estimateCost(sceneCount: number, quality: Quality): number {
  const perScene = quality === 'premium' ? 50 : quality === 'standard' ? 20 : 8;
  return sceneCount * perScene;
}

/** Generic implementation parameterised per kind. */
async function runKind(
  ctx: OrchestratorContext,
  input: OrchestratorInput,
  sceneCount: number,
  quality: Quality,
): Promise<OrchestratorResult> {
  // 1. Plan
  ctx.emit({ type: 'step', step: 'planning', message: `Planning ${sceneCount} scenes…` });
  const plan = await planScript(ctx, input, sceneCount);
  ctx.emit({ type: 'step', step: 'planned', message: `Planned ${plan.scenes.length} scenes` });

  // 2. Generate each scene sequentially. Sequential keeps per-tenant rate
  //    pressure low and lets us emit progress reliably.
  const generated: { assetId: string; durationSec: number; spec: SceneSpec }[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const s = plan.scenes[i]!;
    ctx.emit({
      type:        'step',
      step:        'generating-scene',
      sceneIndex:  i,
      sceneTitle:  s.title,
      pct:         i / plan.scenes.length,
      message:     `Generating scene ${i + 1}/${plan.scenes.length}: ${s.title}`,
    });
    const result = await generateVideoScene(ctx, s.prompt, s.durationSec, input.aspectRatio, quality);
    generated.push({ ...result, spec: s });
  }

  // 3. Assemble timeline
  ctx.emit({ type: 'step', step: 'assembling', message: 'Assembling timeline' });
  const timeline = assembleTimeline(generated, input.aspectRatio);

  // 4. Hook line as caption over the first scene if the planner included one
  if (plan.hookLine && timeline.overlays.length > 0) {
    timeline.overlays.unshift({
      id:    'hook',
      kind:  'caption',
      start: 0,
      end:   Math.min(3, generated[0]?.durationSec ?? 3),
      props: { text: plan.hookLine, color: '#ffffff' },
    });
  }

  return {
    timeline,
    costUsdCents: estimateCost(plan.scenes.length, quality),
    summary:     {
      durationSec:    timeline.durationSec,
      videoClipCount: timeline.tracks[0].clips.length,
      audioClipCount: timeline.tracks[1].clips.length,
      overlayCount:   timeline.overlays.length,
      aiFirstPassAt:  timeline.meta.aiFirstPassAt,
      lastEditedAt:   timeline.meta.lastEditedAt,
    },
  };
}

// ── Per-kind public entry points ─────────────────────────────────────────────

/** AI Short — one or two scenes, draft-quality (cheapest), 9:16 default. */
export async function generateShort(
  ctx:   OrchestratorContext,
  input: OrchestratorInput,
): Promise<OrchestratorResult> {
  // 30s short = 1 long scene OR 2 short ones; pick based on duration
  const sceneCount = input.durationSec <= 20 ? 1 : 2;
  return runKind(ctx, input, sceneCount, 'draft');
}

/** AI Commercial — 2 scenes (hook + payoff), standard quality. */
export async function generateCommercial(
  ctx:   OrchestratorContext,
  input: OrchestratorInput,
): Promise<OrchestratorResult> {
  const sceneCount = input.durationSec <= 30 ? 2 : 3;
  return runKind(ctx, input, sceneCount, 'standard');
}

/** AI Movie — multi-scene narrative; standard quality (premium burns credits fast). */
export async function generateMovie(
  ctx:   OrchestratorContext,
  input: OrchestratorInput,
): Promise<OrchestratorResult> {
  // ~10-15 seconds per scene seems to be the sweet spot for Higgsfield video models
  const sceneCount = Math.min(12, Math.max(3, Math.floor(input.durationSec / 12)));
  return runKind(ctx, input, sceneCount, 'standard');
}

/** AI Music Video — scenes synced to musical structure. v1: even-length scenes;
 *  v2 (later) will accept beat markers and align scene cuts to drops. */
export async function generateMusicVideo(
  ctx:   OrchestratorContext,
  input: OrchestratorInput,
): Promise<OrchestratorResult> {
  // 8-12 second scenes give 10-15 cuts in a typical 2-min track — good rhythm
  const sceneCount = Math.min(15, Math.max(4, Math.floor(input.durationSec / 10)));
  return runKind(ctx, input, sceneCount, 'standard');
}

/** Dispatch to the right kind orchestrator. */
export async function generateForKind(
  kind:  'movie' | 'commercial' | 'short' | 'music_video',
  ctx:   OrchestratorContext,
  input: OrchestratorInput,
): Promise<OrchestratorResult> {
  switch (kind) {
    case 'movie':       return generateMovie(ctx, input);
    case 'commercial':  return generateCommercial(ctx, input);
    case 'short':       return generateShort(ctx, input);
    case 'music_video': return generateMusicVideo(ctx, input);
  }
}
