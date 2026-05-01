// apps/api/src/lib/ffmpeg.ts — ffmpeg helpers for Music Studio.
// Uses @ffmpeg-installer/ffmpeg (static binary, Railway-compatible).
//
// Operations:
//   - concat with crossfade (chain multiple music-01 clips into one track)
//   - MP3 → WAV (for stem separation via Replicate)
//   - ensure predictable sample rate + bit depth

import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function getFfmpegPath(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import('@ffmpeg-installer/ffmpeg');
  return mod.path ?? mod.default?.path;
}

async function getFluentFfmpeg(): Promise<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (input?: string) => any
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import('fluent-ffmpeg');
  const fn = mod.default ?? mod;
  const path = await getFfmpegPath();
  if (path) fn.setFfmpegPath(path);
  return fn;
}

async function scratch(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `abw-${prefix}-`));
}

/**
 * Concatenate multiple MP3 buffers into a single MP3 with 500ms crossfades.
 * Uses ffmpeg's acrossfade filter.
 */
export async function concatMp3WithCrossfade(
  segments: Buffer[],
  crossfadeSec = 0.5,
): Promise<Buffer> {
  if (segments.length === 0) throw new Error('No segments');
  if (segments.length === 1) return segments[0]!;

  const dir = await scratch('concat');
  try {
    const paths: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const p = join(dir, `seg-${i}.mp3`);
      await writeFile(p, segments[i]!);
      paths.push(p);
    }
    const outPath = join(dir, 'out.mp3');
    const ff = await getFluentFfmpeg();
    const cmd = ff();
    for (const p of paths) cmd.input(p);

    // Build a chained acrossfade graph: [0][1]acrossfade=d=0.5[a1]; [a1][2]acrossfade=d=0.5[a2]; ...
    const filters: string[] = [];
    let last = '[0:a]';
    for (let i = 1; i < paths.length; i++) {
      const out = i === paths.length - 1 ? '[aout]' : `[a${i}]`;
      filters.push(`${last}[${i}:a]acrossfade=d=${crossfadeSec}:c1=tri:c2=tri${out}`);
      last = out;
    }

    await new Promise<void>((resolve, reject) => {
      cmd
        .complexFilter(filters)
        .outputOptions(['-map', '[aout]'])
        .audioBitrate('256k')
        .format('mp3')
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .save(outPath);
    });

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => null);
  }
}

/** Convert an MP3 buffer to a WAV buffer (44.1 kHz, 16-bit stereo). */
export async function mp3ToWav(mp3: Buffer): Promise<Buffer> {
  const dir = await scratch('wav');
  try {
    const inPath  = join(dir, 'in.mp3');
    const outPath = join(dir, 'out.wav');
    await writeFile(inPath, mp3);
    const ff = await getFluentFfmpeg();

    await new Promise<void>((resolve, reject) => {
      ff(inPath)
        .audioFrequency(44100)
        .audioChannels(2)
        .audioCodec('pcm_s16le')
        .format('wav')
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .save(outPath);
    });

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => null);
  }
}
