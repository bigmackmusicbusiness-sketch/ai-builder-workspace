// apps/api/src/lib/clipper/scenes.ts — ffmpeg scene detection.
//
// Uses ffmpeg's `select=gt(scene,N)` filter to find candidate scene breaks in
// long footage. Returns a list of (start, end, "energy") tuples that the LLM
// can score for hook potential. No LLM needed in this step — pure signal
// processing.
//
// We also pull a single thumbnail per scene to give the UI something to render.
// (Skipped here for the initial wiring; can layer on top.)

import { spawn } from 'node:child_process';

export interface SceneCandidate {
  /** Seconds into the source where the scene starts. */
  start:    number;
  /** Seconds into the source where the scene ends (next scene's start). */
  end:      number;
  /** Length in seconds. */
  durationSec: number;
  /** Higher = more "movement" / change in this scene. Heuristic only. */
  energy:   number;
}

async function ffmpegPath(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — external in build.mjs
  const installer = await import('@ffmpeg-installer/ffmpeg');
  return (installer as { default: { path: string } }).default.path;
}

/**
 * Probe duration via ffmpeg. Returns the source's total length in seconds.
 * Used by the clipper runner to know when to stop probing.
 */
export async function probeDuration(filePath: string): Promise<number> {
  const ff = await ffmpegPath();
  return await new Promise((resolve, reject) => {
    const child = spawn(ff, ['-hide_banner', '-i', filePath, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('close', () => {
      // ffmpeg prints `Duration: HH:MM:SS.MS, ...` in stderr
      const m = stderr.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return reject(new Error('Could not parse duration from ffmpeg output'));
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
    child.on('error', reject);
  });
}

/**
 * Run ffmpeg's scene-change detector and parse the resulting "showinfo" lines.
 * `threshold` 0.0–1.0 — lower = more (false-positive) scene cuts;
 * 0.4 is a good default for typical podcast/interview footage.
 */
export async function detectScenes(
  filePath:  string,
  threshold: number = 0.4,
): Promise<SceneCandidate[]> {
  const ff = await ffmpegPath();
  const cuts: number[] = [];      // timestamps where scenes BEGIN

  await new Promise<void>((resolve, reject) => {
    // -vf select='gt(scene,N)',showinfo  → ffmpeg emits a `pts_time:X.XXX`
    // for every detected scene boundary. We discard the actual frames.
    const child = spawn(ff, [
      '-hide_banner',
      '-i', filePath,
      '-vf', `select='gt(scene,${threshold})',showinfo`,
      '-f', 'null',
      '-',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // Match every `pts_time:X.XXX`
      const re = /pts_time:([\d.]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        cuts.push(Number(m[1]));
      }
    });
    child.on('close', () => resolve());
    child.on('error', reject);
  });

  // Always include 0 as the first scene start
  if (!cuts.length || cuts[0]! > 0.5) cuts.unshift(0);

  // Pair (start, end) using consecutive cuts
  const duration = await probeDuration(filePath);
  const scenes: SceneCandidate[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const start = cuts[i]!;
    const end   = cuts[i + 1] ?? duration;
    if (end - start < 1.5) continue;                  // discard sub-1.5s blips
    scenes.push({
      start,
      end,
      durationSec: end - start,
      energy:      1, // placeholder — could refine via ffmpeg `signalstats` if we want
    });
  }
  return scenes;
}

/**
 * Filter scene candidates down to those that look like good clip seeds:
 * within a target length, sufficient duration. Caller picks final clip
 * boundaries (might trim further to hit a target length).
 */
export function filterToClippable(
  scenes:           SceneCandidate[],
  targetClipSec:    number,
  countCap:         number,
): SceneCandidate[] {
  // Sort by descending duration (long scenes have more "story") — not perfect,
  // but a reasonable seed before the LLM scoring step.
  const sorted = scenes
    .filter((s) => s.durationSec >= Math.min(targetClipSec * 0.5, 8))
    .sort((a, b) => b.durationSec - a.durationSec);
  return sorted.slice(0, countCap * 3);  // 3× headroom — LLM scores the rest down
}
