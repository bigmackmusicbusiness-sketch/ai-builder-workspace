// apps/api/src/lib/render.ts — ffmpeg renderer for the video timeline.
// Reads a Timeline (apps/api/src/lib/timeline.ts), pulls every referenced
// asset, runs ffmpeg with a complex filtergraph, returns the final MP4 buffer.
//
// Pipeline:
//   1. Resolve every video/audio clip's sourceAssetId → public URL
//   2. Download to /tmp/render-<id>/sources/
//   3. Build the ffmpeg filtergraph:
//        a. trim each video clip to [in, out]; tpad for transition padding
//        b. concat with crossfade if transitions specify fade/dissolve
//        c. drawtext / overlay each caption + text + image overlay
//        d. amix audio clips with volume + concat
//   4. Output to /tmp/render-<id>/out.mp4
//   5. Read into Buffer; cleanup temp dir
//
// Calls fluent-ffmpeg (already a dep). Heavy CPU work; runs in the API process
// for now — moves to the dedicated worker container in Coolify.

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Timeline, VideoClip, AudioClip, Overlay } from './timeline';
import { getDb } from '../db/client';
import { assets } from '@abw/db';
import { eq } from 'drizzle-orm';

// We resolve the static ffmpeg binary at runtime to keep the bundler happy.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ffmpegPath(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — ffmpeg-installer is `external` in build.mjs
  const installer = await import('@ffmpeg-installer/ffmpeg');
  return (installer as { default: { path: string } }).default.path;
}

export interface RenderOptions {
  timeline:    Timeline;
  /** 'preview' = 480p / fast / lower quality. 'final' = full resolution. */
  quality?:    'preview' | 'final';
  /** Optional progress callback (0-1). */
  onProgress?: (pct: number) => void;
}

export interface RenderResult {
  buffer:      Buffer;
  durationSec: number;
  sizeBytes:   number;
  width:       number;
  height:      number;
}

/** Render a timeline to an MP4 buffer. */
export async function renderTimeline(opts: RenderOptions): Promise<RenderResult> {
  const { timeline, quality = 'final', onProgress } = opts;
  const work = join(tmpdir(), `abw-render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const sourcesDir = join(work, 'sources');
  const outPath    = join(work, 'out.mp4');
  await mkdir(sourcesDir, { recursive: true });

  try {
    // Quick exit if there's nothing to render
    const videoClips = timeline.tracks[0]?.clips ?? [];
    if (videoClips.length === 0) {
      throw new Error('Cannot render: timeline has no video clips');
    }

    // Resolve every unique sourceAssetId to a local file
    const allClips: (VideoClip | AudioClip)[] = [
      ...videoClips,
      ...(timeline.tracks[1]?.clips ?? []),
    ];
    const uniqueAssetIds = Array.from(new Set(allClips.map((c) => c.sourceAssetId)));
    const localPaths = new Map<string, string>();
    const db = getDb();
    for (const id of uniqueAssetIds) {
      const [a] = await db.select().from(assets).where(eq(assets.id, id));
      if (!a?.publicUrl) throw new Error(`Asset ${id} has no public URL`);
      const ext = a.mimeType?.split('/')[1]?.split('+')[0] ?? 'mp4';
      const dest = join(sourcesDir, `${id}.${ext}`);
      const res = await fetch(a.publicUrl, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`Failed to download asset ${id}: HTTP ${res.status}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      localPaths.set(id, dest);
    }

    // Compute output dimensions
    const scale = quality === 'preview' ? 0.5 : 1;
    const outW  = Math.round(timeline.width  * scale);
    const outH  = Math.round(timeline.height * scale);

    // Build the ffmpeg command. We use a complex filtergraph that:
    //   - trims each video clip to [in,out] and offsets by `start`
    //   - overlays them onto a black canvas at their timeline positions
    //   - draws caption/text overlays on top
    //   - mixes audio clips
    const args = await buildFfmpegArgs({
      timeline,
      localPaths,
      outW,
      outH,
      outPath,
    });

    const ffmpeg = await ffmpegPath();
    await runFfmpeg(ffmpeg, args, { onProgress, expectedDurationSec: timeline.durationSec || estimateDuration(timeline) });

    const buffer = await readFile(outPath);
    return {
      buffer,
      durationSec: timeline.durationSec || estimateDuration(timeline),
      sizeBytes:   buffer.length,
      width:       outW,
      height:      outH,
    };
  } finally {
    // Clean up temp files
    if (existsSync(work)) await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// ── ffmpeg argument builder ───────────────────────────────────────────────────

interface BuildArgsOpts {
  timeline:    Timeline;
  localPaths:  Map<string, string>;
  outW:        number;
  outH:        number;
  outPath:     string;
}

async function buildFfmpegArgs(opts: BuildArgsOpts): Promise<string[]> {
  const { timeline, localPaths, outW, outH, outPath } = opts;
  const videoClips = timeline.tracks[0]?.clips ?? [];
  const audioClips = timeline.tracks[1]?.clips ?? [];

  const args: string[] = ['-y']; // overwrite output

  // -i for each unique source file, ordered so we can reference by index
  const inputOrder: string[] = [];
  const inputIndex = new Map<string, number>();
  for (const clip of [...videoClips, ...audioClips]) {
    if (!inputIndex.has(clip.sourceAssetId)) {
      const local = localPaths.get(clip.sourceAssetId)!;
      inputIndex.set(clip.sourceAssetId, inputOrder.length);
      inputOrder.push(local);
      args.push('-i', local);
    }
  }

  // Build filtergraph
  const filters: string[] = [];

  // Black canvas as base
  const totalSec = Math.max(timeline.durationSec || estimateDuration(timeline), 1);
  filters.push(`color=c=black:s=${outW}x${outH}:d=${totalSec}:r=${timeline.fps}[base]`);

  // Process each video clip: trim → setpts → scale to output dims
  videoClips.forEach((clip, i) => {
    const idx = inputIndex.get(clip.sourceAssetId)!;
    const dur = Math.max(clip.out - clip.in, 0.1);
    filters.push(
      `[${idx}:v]trim=start=${clip.in}:duration=${dur},setpts=PTS-STARTPTS,scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:-1:-1:color=black[v${i}]`,
    );
  });

  // Overlay each video clip onto the base at its `start` timestamp
  let lastLabel = 'base';
  videoClips.forEach((clip, i) => {
    const next = `vc${i}`;
    filters.push(
      `[${lastLabel}][v${i}]overlay=enable='between(t,${clip.start},${clip.start + (clip.out - clip.in)})':eof_action=pass[${next}]`,
    );
    lastLabel = next;
  });

  // Apply text/caption overlays via drawtext on top of the composited video
  const visualOverlays = timeline.overlays.filter((o) => o.kind === 'caption' || o.kind === 'text');
  for (const ov of visualOverlays) {
    const next = `o${ov.id}`;
    const drawtext = buildDrawtext(ov, outW, outH);
    if (drawtext) {
      filters.push(`[${lastLabel}]${drawtext}[${next}]`);
      lastLabel = next;
    }
  }

  // Audio mixing: trim each audio clip, then amix
  if (audioClips.length > 0) {
    audioClips.forEach((clip, i) => {
      const idx = inputIndex.get(clip.sourceAssetId)!;
      const dur = Math.max(clip.out - clip.in, 0.1);
      filters.push(
        `[${idx}:a]atrim=start=${clip.in}:duration=${dur},asetpts=PTS-STARTPTS,adelay=${Math.round(clip.start * 1000)}|${Math.round(clip.start * 1000)},volume=${clip.volume}[a${i}]`,
      );
    });
    if (audioClips.length === 1) {
      filters.push(`[a0]anull[aout]`);
    } else {
      const inputs = audioClips.map((_, i) => `[a${i}]`).join('');
      filters.push(`${inputs}amix=inputs=${audioClips.length}:duration=longest:dropout_transition=0[aout]`);
    }
  }

  args.push('-filter_complex', filters.join(';'));
  args.push('-map', `[${lastLabel}]`);
  if (audioClips.length > 0) args.push('-map', '[aout]');

  // Output codec settings
  args.push(
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    '-r', String(timeline.fps),
  );
  if (audioClips.length > 0) {
    args.push('-c:a', 'aac', '-b:a', '192k');
  }
  args.push('-movflags', '+faststart');
  args.push(outPath);

  return args;
}

/** Produce an ffmpeg `drawtext=...` filter for a caption/text overlay. */
function buildDrawtext(overlay: Overlay, outW: number, outH: number): string | null {
  const text = String(overlay.props['text'] ?? '');
  if (!text) return null;

  // Escape ffmpeg-special chars in the text
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');

  const fontSize = Number(overlay.props['size'] ?? Math.round(outH * 0.045));
  const color    = String(overlay.props['color'] ?? '#ffffff');
  const isCaption = overlay.kind === 'caption';

  // Caption preset: bold sans, white text, black box, bottom-third
  // Text preset: configurable position
  const x = isCaption ? '(w-text_w)/2' : String(overlay.props['x'] ?? '(w-text_w)/2');
  const y = isCaption ? `h-(h*0.18)`     : String(overlay.props['y'] ?? 'h*0.5');
  const box = isCaption ? `:box=1:boxcolor=black@0.65:boxborderw=14` : '';

  return `drawtext=text='${escaped}':fontsize=${fontSize}:fontcolor=${color}:x=${x}:y=${y}:enable='between(t,${overlay.start},${overlay.end})'${box}`;
}

/** Spawn ffmpeg, parse progress, await completion. */
function runFfmpeg(
  binary:  string,
  args:    string[],
  opts: { onProgress?: (pct: number) => void; expectedDurationSec: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      stderr += s;
      // ffmpeg prints "time=HH:MM:SS.MS" — extract for progress
      const m = s.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m && opts.onProgress && opts.expectedDurationSec > 0) {
        const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        opts.onProgress(Math.min(sec / opts.expectedDurationSec, 1));
      }
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1000)}`));
    });
    child.on('error', reject);
  });
}

function estimateDuration(t: Timeline): number {
  const videoClips = t.tracks[0]?.clips ?? [];
  let max = 0;
  for (const c of videoClips) {
    const end = c.start + (c.out - c.in);
    if (end > max) max = end;
  }
  return max;
}
