// apps/api/src/lib/clipper/cut.ts — ffmpeg cut + reformat to vertical.
//
// Given (sourcePath, start, end) → produces a 9:16 mp4 of just that segment,
// center-cropped from a 16:9 (or any) source. Optionally burns SRT-style
// captions in via drawtext while we're already running ffmpeg.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

async function ffmpegPath(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — external in build.mjs
  const installer = await import('@ffmpeg-installer/ffmpeg');
  return (installer as { default: { path: string } }).default.path;
}

export interface CaptionSegment {
  start: number;     // seconds, RELATIVE to the cut clip (0 = clip start)
  end:   number;
  text:  string;
}

export interface CutOptions {
  sourcePath: string;
  /** Time in source where the clip starts. */
  startSec:   number;
  /** Time in source where the clip ends. */
  endSec:     number;
  destPath:   string;
  /** "viral" = bottom-third bold white w/ black box, animated by segment.
   *  "subtle" = small white text, bottom, no box. */
  captionStyle?: 'viral' | 'subtle' | 'none';
  /** Pre-segmented captions to burn in. Pass [] to skip. */
  captions?:    CaptionSegment[];
  /** Output dimensions. Default 1080x1920 (vertical 9:16). */
  outWidth?:    number;
  outHeight?:   number;
}

/** Build the drawtext filter string for a caption with the chosen style. */
function captionDrawtext(c: CaptionSegment, style: 'viral' | 'subtle', outH: number): string {
  const escaped = c.text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
  const fontSize = Math.round(outH * (style === 'viral' ? 0.05 : 0.035));
  const yPos     = `h-(h*${style === 'viral' ? '0.18' : '0.10'})`;
  const box      = style === 'viral' ? `:box=1:boxcolor=black@0.7:boxborderw=18` : '';
  const color    = style === 'viral' ? 'white' : 'white';
  return `drawtext=text='${escaped}':fontsize=${fontSize}:fontcolor=${color}:x=(w-text_w)/2:y=${yPos}:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'${box}`;
}

export async function cutAndReformat(opts: CutOptions): Promise<{ path: string }> {
  const ff = await ffmpegPath();
  await mkdir(dirname(opts.destPath), { recursive: true });

  const outW = opts.outWidth  ?? 1080;
  const outH = opts.outHeight ?? 1920;
  const dur  = opts.endSec - opts.startSec;
  if (dur <= 0) throw new Error('Clip must have positive duration');

  // Filter chain:
  //   1. scale + crop to vertical (9:16) — keeps the centre of the source,
  //      which is where speakers usually are.
  //   2. drawtext overlays for each caption segment.
  const scaleCrop = `scale=-1:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}`;
  const drawtexts = (opts.captions ?? [])
    .filter((c) => opts.captionStyle && opts.captionStyle !== 'none' && c.text.trim())
    .map((c) => captionDrawtext(c, opts.captionStyle === 'subtle' ? 'subtle' : 'viral', outH))
    .join(',');
  const vf = drawtexts ? `${scaleCrop},${drawtexts}` : scaleCrop;

  const args = [
    '-y',
    '-ss', String(opts.startSec),
    '-i', opts.sourcePath,
    '-t', String(dur),
    '-vf', vf,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    opts.destPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ff, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg cut exited ${code}: ${stderr.slice(-500)}`));
    });
    child.on('error', reject);
  });
  return { path: opts.destPath };
}
