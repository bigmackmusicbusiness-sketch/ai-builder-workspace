// apps/api/src/lib/clipper/runner.ts — orchestrates the clipper pipeline.
//
// Stages:
//   1. fetch    — download source (yt-dlp / direct URL) OR resolve uploaded asset
//   2. detect   — ffmpeg scene detection → SceneCandidate[]
//   3. transcribe — Whisper (skipped if no OpenAI key)
//   4. score    — MiniMax LLM scores each candidate's hook potential
//   5. cut      — ffmpeg cuts the top-N to vertical 9:16 with optional captions
//   6. upload   — push each clip to Supabase Storage as an asset
//   7. finalize — write the final clips array onto clipper_jobs and mark done
//
// Each stage updates the DB job's `status` and `progress_pct` so the UI's
// SSE stream can show meaningful progress for runs that take 5-10 minutes.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { clipperJobs, assets } from '@abw/db';
import { detectScenes, filterToClippable, probeDuration, type SceneCandidate } from './scenes';
import { transcribe, segmentsInWindow, transcribeAvailable, type TranscriptSegment } from './transcribe';
import { scoreCandidates, pickTopClips, type ScoredCandidate } from './score';
import { cutAndReformat } from './cut';
import { downloadYouTube, isLikelyYouTubeUrl, isHttpUrl, destForUrl } from '../youtube';
import { uploadBufferAsAsset } from '../assetUpload';
import { readFile } from 'node:fs/promises';

export interface RunClipperCtx {
  jobId:    string;
  tenantId: string;
  env:      string;
}

interface JobUpdate {
  status?:      string;
  progressPct?: number;
  candidates?:  unknown;
  clips?:       unknown;
  error?:       string | null;
  sourceDurationSec?: number;
}

async function updateJob(jobId: string, update: JobUpdate): Promise<void> {
  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set: any = { updatedAt: new Date() };
  if (update.status            !== undefined) set.status            = update.status;
  if (update.progressPct       !== undefined) set.progressPct       = update.progressPct;
  if (update.error             !== undefined) set.error             = update.error;
  if (update.sourceDurationSec !== undefined) set.sourceDurationSec = update.sourceDurationSec;
  if (update.candidates        !== undefined) set.candidates        = update.candidates;
  if (update.clips             !== undefined) set.clips             = update.clips;
  await db.update(clipperJobs).set(set).where(eq(clipperJobs.id, jobId));
}

/** Resolve the source video to a local file path, downloading if needed. */
async function fetchSource(
  jobId:        string,
  sourceKind:   string,
  sourceRef:    string,
  workDir:      string,
  tenantId:     string,
): Promise<string> {
  const db = getDb();
  if (sourceKind === 'upload') {
    // sourceRef is an asset id
    const [a] = await db.select().from(assets).where(eq(assets.id, sourceRef));
    if (!a?.publicUrl) throw new Error('Upload asset has no public URL');
    const dest = join(workDir, 'source.mp4');
    const res = await fetch(a.publicUrl, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`Failed to fetch uploaded asset: HTTP ${res.status}`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  }
  if (sourceKind === 'youtube' || (sourceKind === 'url' && isLikelyYouTubeUrl(sourceRef))) {
    const dest = destForUrl(workDir, sourceRef);
    await downloadYouTube({ url: sourceRef, destPath: dest, onProgress: (pct) => {
      void updateJob(jobId, { progressPct: Math.round(pct * 15) }); // 0-15% for download
    }});
    return dest;
  }
  if (sourceKind === 'url' && isHttpUrl(sourceRef)) {
    const dest = destForUrl(workDir, sourceRef);
    const res = await fetch(sourceRef, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`Direct URL fetch HTTP ${res.status}`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    void updateJob(jobId, { tenantId } as JobUpdate); // touch updated_at
    return dest;
  }
  throw new Error(`Unsupported source kind: ${sourceKind}`);
}

export async function runClipper(ctx: RunClipperCtx): Promise<void> {
  const db = getDb();
  const [job] = await db.select().from(clipperJobs)
    .where(and(eq(clipperJobs.id, ctx.jobId), eq(clipperJobs.tenantId, ctx.tenantId)));
  if (!job) throw new Error(`Clipper job ${ctx.jobId} not found`);

  const workDir = join(tmpdir(), `abw-clipper-${ctx.jobId}`);
  await mkdir(workDir, { recursive: true });

  try {
    // ── 1. Fetch source ────────────────────────────────────────────────
    await updateJob(ctx.jobId, { status: 'uploading', progressPct: 2 });
    const sourcePath = await fetchSource(ctx.jobId, job.sourceKind, job.sourceRef, workDir, ctx.tenantId);
    const totalDur   = await probeDuration(sourcePath);
    await updateJob(ctx.jobId, { sourceDurationSec: Math.round(totalDur), progressPct: 18 });

    // ── 2. Scene detection ─────────────────────────────────────────────
    await updateJob(ctx.jobId, { status: 'analyzing', progressPct: 22 });
    const allScenes = await detectScenes(sourcePath, 0.4);
    const candidates: SceneCandidate[] = filterToClippable(allScenes, job.targetClipLengthSec, job.targetClipCount);
    await updateJob(ctx.jobId, { candidates: candidates as unknown as object, progressPct: 30 });

    if (candidates.length === 0) {
      throw new Error('No scene candidates detected. The source may be very short, very static, or unsupported by ffmpeg scene-detect.');
    }

    // ── 3. Transcribe (optional) ───────────────────────────────────────
    let transcript: { fullText: string; segments: TranscriptSegment[] } | null = null;
    if (await transcribeAvailable(ctx.tenantId, ctx.env)) {
      await updateJob(ctx.jobId, { status: 'transcribing', progressPct: 35 });
      transcript = await transcribe({ tenantId: ctx.tenantId, env: ctx.env, sourcePath, workDir });
      await updateJob(ctx.jobId, { progressPct: 55 });
    } else {
      // No OpenAI key — note in job and skip
      await updateJob(ctx.jobId, { progressPct: 55 });
    }

    // Pre-bucket transcript segments per candidate (keyed by start-end)
    const segByScene = new Map<string, TranscriptSegment[]>();
    if (transcript) {
      for (const c of candidates) {
        segByScene.set(`${c.start.toFixed(2)}-${c.end.toFixed(2)}`, segmentsInWindow(transcript.segments, c.start, c.end));
      }
    }

    // ── 4. Score candidates ───────────────────────────────────────────
    await updateJob(ctx.jobId, { status: 'analyzing', progressPct: 60 });
    const scored: ScoredCandidate[] = await scoreCandidates(ctx.tenantId, ctx.env, candidates, segByScene);
    const winners = pickTopClips(scored, job.targetClipCount, job.targetClipLengthSec);
    await updateJob(ctx.jobId, { progressPct: 70 });

    // ── 5+6. Cut + upload each winner ──────────────────────────────────
    await updateJob(ctx.jobId, { status: 'cutting', progressPct: 72 });
    const finalClips: Array<{ assetId: string; assetUrl: string; start: number; end: number; score: number; reason: string; transcriptSnippet?: string }> = [];
    for (let i = 0; i < winners.length; i++) {
      const w = winners[i]!;
      const clipPath = join(workDir, `clip-${i}.mp4`);

      // Transcript-segment captions inside this clip's window, rebased to clip-local time
      const localCaps = transcript
        ? segmentsInWindow(transcript.segments, w.start, w.end).map((s) => ({
            start: Math.max(0, s.start - w.start),
            end:   Math.min(w.end - w.start, s.end - w.start),
            text:  s.text,
          })).filter((c) => c.end > c.start && c.text.trim())
        : [];

      await cutAndReformat({
        sourcePath,
        startSec:    w.start,
        endSec:      w.end,
        destPath:    clipPath,
        captionStyle: (job.captionStyle === 'subtle' ? 'subtle' : 'viral'),
        captions:     localCaps,
      });

      // Upload as an asset row
      const buffer = await readFile(clipPath);
      const upload = await uploadBufferAsAsset({
        tenantId:  ctx.tenantId,
        projectId: job.projectId ?? null,
        folder:    `clipper/${ctx.jobId}`,
        filename:  `clip-${i + 1}.mp4`,
        mimeType:  'video/mp4',
        buffer,
      });

      finalClips.push({
        assetId:           upload.assetId,
        assetUrl:          upload.url,
        start:             w.start,
        end:               w.end,
        score:             w.score,
        reason:            w.reason,
        transcriptSnippet: w.transcriptSnippet,
      });

      await updateJob(ctx.jobId, {
        status:      'cutting',
        progressPct: 72 + Math.round(((i + 1) / winners.length) * 22),
        clips:       finalClips as unknown as object,
      });
    }

    // ── 7. Done ────────────────────────────────────────────────────────
    await updateJob(ctx.jobId, { status: 'done', progressPct: 100, clips: finalClips as unknown as object });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateJob(ctx.jobId, { status: 'failed', error: msg });
    throw err;
  } finally {
    if (existsSync(workDir)) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
