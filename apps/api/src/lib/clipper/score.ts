// apps/api/src/lib/clipper/score.ts — LLM hook scoring.
//
// Per scene candidate, we send a tiny prompt to MiniMax M2.5 (non-thinking,
// fast, cheap) with just that scene's transcript snippet + duration. We get
// back a 0-100 score and a 1-line reason. We never send the full transcript
// — keeps the agent context cost flat regardless of source length.

import { createMinimaxAdapter } from '../../providers/minimax';
import type { SceneCandidate } from './scenes';
import type { TranscriptSegment } from './transcribe';

export interface ScoredCandidate extends SceneCandidate {
  score:  number;             // 0-100
  reason: string;             // 1-sentence why
  transcriptSnippet?: string; // up to ~200 chars
}

const SCORE_PROMPT_TPL = (snippet: string, durationSec: number): string => `
You score short-form video clip candidates for VIRAL POTENTIAL on TikTok / Reels / Shorts.

Clip duration: ${durationSec.toFixed(1)}s
Transcript: """${snippet}"""

Return ONLY JSON in this exact shape:
{ "score": 0-100, "reason": "one short sentence" }

Rubric (no fluff):
- 90+ : strong hook in first 3s, emotional/visual payoff, quotable
- 70-89: clear story beat, ends on a moment
- 40-69: useful but unremarkable
- below 40: lacks hook / mid-conversation / setup-only
`;

/** Strip MiniMax's <think> blocks + JSON fences before parsing. */
function clean(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!t.startsWith('{')) {
    const i = t.indexOf('{');
    if (i > 0) t = t.slice(i);
  }
  return t;
}

/**
 * Score N candidates in parallel (capped at concurrency=4 to keep MiniMax happy).
 * Skips the LLM call entirely for candidates with no transcript snippet —
 * those get a default mid-tier energy-based score.
 */
export async function scoreCandidates(
  tenantId:    string,
  env:         string,
  candidates:  SceneCandidate[],
  segmentsByScene: Map<string, TranscriptSegment[]>,
): Promise<ScoredCandidate[]> {
  const adapter = createMinimaxAdapter(tenantId, env);
  const concurrency = 4;
  const results: ScoredCandidate[] = [];

  async function scoreOne(c: SceneCandidate): Promise<ScoredCandidate> {
    const segs = segmentsByScene.get(`${c.start.toFixed(2)}-${c.end.toFixed(2)}`) ?? [];
    const snippet = segs.map((s) => s.text).join(' ').trim().slice(0, 600);
    if (!snippet) {
      // No transcript — return a neutral score so the candidate still has a chance
      return { ...c, score: 50, reason: 'No transcript available; energy-based fallback', transcriptSnippet: undefined };
    }
    try {
      const r = await adapter.complete({
        prompt:      SCORE_PROMPT_TPL(snippet, c.durationSec),
        model:       'MiniMax-M2.5',
        maxTokens:   200,
        temperature: 0.3,
      });
      const parsed = JSON.parse(clean(r.text ?? '')) as { score: number; reason: string };
      return {
        ...c,
        score:             Math.max(0, Math.min(100, Number(parsed.score) || 0)),
        reason:            String(parsed.reason ?? '').slice(0, 240),
        transcriptSnippet: snippet.slice(0, 200),
      };
    } catch (err) {
      return { ...c, score: 40, reason: `Score parse failed: ${(err as Error).message.slice(0, 60)}`, transcriptSnippet: snippet.slice(0, 200) };
    }
  }

  // Simple manual concurrency limiter
  const queue = [...candidates];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (queue.length) {
        const next = queue.shift();
        if (!next) break;
        const r = await scoreOne(next);
        results.push(r);
      }
    })());
  }
  await Promise.all(workers);

  // Sort by score desc, then by duration desc as a tie-break
  return results.sort((a, b) => (b.score - a.score) || (b.durationSec - a.durationSec));
}

/** Pick the top N scored candidates that fit a target duration window. */
export function pickTopClips(
  scored:        ScoredCandidate[],
  count:         number,
  targetSec:     number,
): ScoredCandidate[] {
  // Trim each candidate to roughly `targetSec` (centred). Picks top by score.
  const window = Math.min(60, Math.max(8, targetSec));
  return scored.slice(0, count).map((c) => {
    if (c.durationSec <= window) return c;
    // Centre the window in the original scene
    const mid = c.start + c.durationSec / 2;
    const half = window / 2;
    return {
      ...c,
      start: Math.max(c.start, mid - half),
      end:   Math.min(c.end,   mid + half),
      durationSec: window,
    };
  });
}
