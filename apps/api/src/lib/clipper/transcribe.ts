// apps/api/src/lib/clipper/transcribe.ts — audio → text transcription.
//
// Primary: OpenAI Whisper (model `whisper-1`). Cheap, fast, accurate, and
// hosted — no GPU on our side. Requires `OPENAI_API_KEY` in the vault.
//
// We also expose a `transcribeAvailable()` probe so the runner can short-circuit
// the LLM-scoring step if no transcribe key is present (and instead score by
// scene energy alone, with a clear "transcripts disabled" warning).

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { vaultGet } from '../../security/vault';

async function ffmpegPath(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const installer = await import('@ffmpeg-installer/ffmpeg');
  return (installer as { default: { path: string } }).default.path;
}

const KEY_NAMES = ['OPENAI_API_KEY', 'OPENAI', 'openai.api_key'];

async function getOpenAIKey(tenantId: string, env: string): Promise<string | null> {
  for (const name of KEY_NAMES) {
    try { return await vaultGet({ name, env, tenantId }); } catch { /* try next */ }
  }
  return null;
}

export async function transcribeAvailable(tenantId: string, env: string): Promise<boolean> {
  return !!(await getOpenAIKey(tenantId, env));
}

export interface TranscriptSegment {
  start: number;
  end:   number;
  text:  string;
}

export interface TranscribeResult {
  fullText: string;
  segments: TranscriptSegment[];
}

/**
 * Extract mono 16kHz WAV from a video for Whisper. Whisper accepts mp4 directly
 * but we prefer to send WAV — smaller for audio-only content + faster network.
 */
async function extractAudio(sourcePath: string, destPath: string): Promise<void> {
  const ff = await ffmpegPath();
  await mkdir(dirname(destPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ff, [
      '-y', '-i', sourcePath,
      '-vn', '-ac', '1', '-ar', '16000',
      '-c:a', 'pcm_s16le',
      destPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`audio extract failed: ${stderr.slice(-400)}`)));
    child.on('error', reject);
  });
}

/**
 * Transcribe a video file. Returns null if no OpenAI key is configured —
 * caller treats this as "transcripts unavailable; score on energy only".
 */
export async function transcribe(opts: {
  tenantId: string;
  env:      string;
  sourcePath: string;
  workDir:    string;
}): Promise<TranscribeResult | null> {
  const apiKey = await getOpenAIKey(opts.tenantId, opts.env);
  if (!apiKey) return null;

  const wavPath = join(opts.workDir, 'audio.wav');
  await extractAudio(opts.sourcePath, wavPath);

  // Whisper's API takes ~25 MB max per request. Long videos exceed that —
  // we'd normally split, but for an MVP we cap at ~25 min of audio per call.
  // (16-bit mono 16 kHz ≈ 32 KB/s → 25 MB ≈ 13 min; we let larger files
  // try once and surface the failure.)
  const buf = await readFile(wavPath);
  const formData = new FormData();
  // Construct an ArrayBuffer copy so TS's stricter Blob types are satisfied
  // regardless of whether Node's Buffer is backed by SharedArrayBuffer.
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  formData.append('file', new Blob([ab], { type: 'audio/wav' }), 'audio.wav');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body:    formData,
    signal:  AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI Whisper HTTP ${res.status}: ${detail.slice(0, 240)}`);
  }
  const data = await res.json() as {
    text:     string;
    segments: { id: number; start: number; end: number; text: string }[];
  };
  // Persist a copy alongside the work dir for debugging / reuse
  await writeFile(join(opts.workDir, 'transcript.json'), JSON.stringify(data, null, 2));
  return {
    fullText: data.text,
    segments: data.segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })),
  };
}

/** Filter transcript segments to those overlapping a given time window. */
export function segmentsInWindow(
  segments: TranscriptSegment[],
  startSec: number,
  endSec:   number,
): TranscriptSegment[] {
  return segments.filter((s) => s.end > startSec && s.start < endSec);
}
