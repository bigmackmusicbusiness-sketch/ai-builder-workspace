// apps/api/src/lib/youtube.ts — YouTube downloader via yt-dlp.
//
// On Coolify the API container's Dockerfile installs `yt-dlp` (apt) so this
// just spawns it. On Windows dev, the user needs yt-dlp on PATH OR we fall
// back to checking common install paths. If yt-dlp is missing entirely we
// throw a clear error so the clipper job can mark itself failed cleanly.
//
// We deliberately do NOT pipe-and-stream YouTube content into ffmpeg directly
// from the network — yt-dlp's local download handles auth quirks, age gates,
// and HLS reassembly more reliably than fetch().

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Find the yt-dlp executable on this machine. */
async function findYtDlp(): Promise<string> {
  // Allow explicit override via env (Coolify deployment can pin path)
  const envPath = process.env['YT_DLP_PATH'];
  if (envPath && existsSync(envPath)) return envPath;

  // Check PATH by trying to spawn `yt-dlp --version`
  const onPath = await new Promise<boolean>((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const child = spawn(cmd, ['yt-dlp'], { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
  if (onPath) return 'yt-dlp';

  // Common install locations
  const candidates = process.platform === 'win32'
    ? [
        'C:/Program Files/yt-dlp/yt-dlp.exe',
        `${process.env['LOCALAPPDATA'] ?? ''}/yt-dlp/yt-dlp.exe`,
      ]
    : [
        '/usr/local/bin/yt-dlp',
        '/usr/bin/yt-dlp',
        '/opt/homebrew/bin/yt-dlp',
      ];
  for (const p of candidates) if (existsSync(p)) return p;

  throw new Error(
    'yt-dlp not found. Install it (https://github.com/yt-dlp/yt-dlp) or set YT_DLP_PATH.',
  );
}

export interface DownloadOptions {
  url:        string;
  /** Where to write the downloaded mp4. Parent dir is created if missing. */
  destPath:   string;
  /** Optional progress callback (0-1). */
  onProgress?: (pct: number) => void;
  /** Cap download to N seconds of source content. Useful for hour-long lives. */
  maxDurationSec?: number;
}

/**
 * Download a YouTube (or other yt-dlp-supported) URL to a local MP4 file.
 * Throws on non-zero exit or unrecoverable error.
 */
export async function downloadYouTube(opts: DownloadOptions): Promise<{ path: string }> {
  const ytdlp = await findYtDlp();
  await mkdir(dirname(opts.destPath), { recursive: true });

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--format', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
    '--merge-output-format', 'mp4',
    '-o', opts.destPath,
    opts.url,
  ];
  if (opts.maxDurationSec) {
    // download-sections accepts ffmpeg-style time spec "*0-MAX"
    args.push('--download-sections', `*0-${opts.maxDurationSec}`);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ytdlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // yt-dlp progress lines look like: "[download]   45.2% of  120.00MiB ..."
      const m = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (m && opts.onProgress) opts.onProgress(Number(m[1]) / 100);
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(-600)}`));
    });
    child.on('error', reject);
  });

  if (!existsSync(opts.destPath)) {
    throw new Error('yt-dlp finished but output file is missing');
  }
  return { path: opts.destPath };
}

/** Quick URL test — does it look like something yt-dlp will handle? */
export function isLikelyYouTubeUrl(url: string): boolean {
  return /youtube\.com\/|youtu\.be\//.test(url);
}

/** Generic absolute URL guard — used by the clipper for the "direct video URL" mode. */
export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Build a sensible local destination path under a working dir. */
export function destForUrl(workDir: string, url: string): string {
  const safeName = url.replace(/[^a-z0-9]+/gi, '_').slice(0, 80) || 'source';
  return join(workDir, `${safeName}.mp4`);
}
