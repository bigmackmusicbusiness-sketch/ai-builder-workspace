// apps/api/src/routes/music.ts — Music Studio: SSE orchestration for beat and cinematic tracks.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, type AuthContext } from '../security/authz';
import { getDb } from '../db/client';
import { musicTracks, assets } from '@abw/db';
import { eq, and, desc } from 'drizzle-orm';
import { createMinimaxAdapter } from '../providers/minimax';
import { createOllamaAdapter }  from '../providers/ollama';
import { env }                  from '../config/env';
import { vaultGet }             from '../security/vault';
import { concatMp3WithCrossfade, mp3ToWav } from '../lib/ffmpeg';
import { buildZip }             from '../lib/zipper';
import { uploadBufferAsAsset }  from '../lib/assetUpload';
import { separateStems }        from '../providers/replicate';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

// ── CORS helpers (mirrors chat.ts — needed because reply.hijack() bypasses @fastify/cors) ──
const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/.*\.pages\.dev$/,
  /^https:\/\/.*\.railway\.app$/,
];
function resolveOrigin(origin: string | undefined): string {
  if (!origin) return '*';
  return ALLOWED_ORIGINS.some((r) => r.test(origin)) ? origin : '*';
}

// ── Schema ────────────────────────────────────────────────────────────────────

const GenerateBody = z.object({
  mode:            z.enum(['beat', 'cinematic']),
  title:           z.string().min(1),
  // beat inputs
  vibe:            z.enum(['trap', 'boom_bap', 'drill', 'lo_fi', 'west_coast', 'melodic']).optional(),
  bpm:             z.number().int().min(60).max(200).optional(),
  key:             z.string().optional(),
  // cinematic inputs
  mood:            z.enum(['heroic', 'tense', 'melancholy', 'uplifting', 'dark', 'romantic', 'mysterious']).optional(),
  instrumentation: z.enum(['orchestral', 'electronic', 'hybrid', 'piano_only', 'ambient']).optional(),
  // shared
  durationSec:     z.number().int().min(30).max(300).default(60),
  prompt:          z.string().optional(),
  provider:        z.string().default('minimax'),
  model:           z.string().default('MiniMax-M2.7'),
  projectId:       z.string().uuid().optional(),
});

type GenerateInput = z.infer<typeof GenerateBody>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'track';
}

function stripFences(text: string): string {
  return text.replace(/^```(?:json|)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

interface MusicPlan {
  fullPrompt: string;
  segments:   { durationSec: number; prompt: string }[];
  bpm?:       number;
  key?:       string;
  structure?: string;
}

function planPrompt(input: GenerateInput): string {
  const segCount = Math.ceil(input.durationSec / 60);
  const modeCtx = input.mode === 'beat'
    ? [
        input.vibe   ? `Vibe: ${input.vibe}`   : '',
        input.bpm    ? `BPM: ${input.bpm}`     : '',
        input.key    ? `Key: ${input.key}`     : '',
      ].filter(Boolean).join(', ')
    : [
        input.mood            ? `Mood: ${input.mood}`                       : '',
        input.instrumentation ? `Instrumentation: ${input.instrumentation}` : '',
      ].filter(Boolean).join(', ');

  return [
    `You are a professional music producer planning a ${input.mode} track titled "${input.title}".`,
    modeCtx ? `Style context: ${modeCtx}` : '',
    input.prompt ? `User brief: ${input.prompt}` : '',
    `Total duration: ${input.durationSec} seconds.`,
    ``,
    `Return ONLY JSON in exactly this shape:`,
    `{`,
    `  "fullPrompt": "string — complete music description for the full track",`,
    `  "segments": [`,
    `    { "durationSec": number (max 60), "prompt": "string — segment-specific generation prompt" }`,
    `  ],`,
    `  "bpm": number or null,`,
    `  "key": "string or null",`,
    `  "structure": "string — e.g. intro/verse/hook/bridge/outro"`,
    `}`,
    ``,
    `Produce exactly ${segCount} segment(s). Each segment max 60 seconds. Total must equal ${input.durationSec}s.`,
    `No markdown, no commentary — JSON only.`,
  ].filter(Boolean).join('\n');
}

// ── Music generation via MiniMax music-01 ────────────────────────────────────

/** Try the same name+env fallback chain the chat-side getApiKey uses,
 *  so music doesn't fail with "MINIMAX_API_KEY not found" when the vault
 *  has the key under MINIMAX / MINIMAX_KEY / minimax.api_key instead. */
const MINIMAX_KEY_NAMES = ['MINIMAX_API_KEY', 'MINIMAX', 'minimax.api_key', 'MINIMAX_KEY'];
async function getMinimaxKey(tenantId: string): Promise<string> {
  for (const name of MINIMAX_KEY_NAMES) {
    try {
      return await vaultGet({ name, env: 'dev', tenantId });
    } catch { /* try next */ }
  }
  throw new Error(
    `MiniMax API key not found in vault (tried ${MINIMAX_KEY_NAMES.join(', ')}). ` +
    `Add it under Env & Secrets, then retry.`,
  );
}

async function generateMp3Segment(opts: {
  prompt:     string;
  durationSec: number;
  tenantId:   string;
}): Promise<Buffer> {
  const apiKey = await getMinimaxKey(opts.tenantId);
  const res = await fetch('https://api.minimaxi.chat/v1/music_generation', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'music-01',
      prompt: opts.prompt,
      audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`MiniMax music-01 HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await res.json() as any;

  // Try multiple response shapes — MiniMax has shipped at least three:
  //   { data: { audio: <base64> } }
  //   { audio: <base64> }
  //   { data: { audio: <hex string> } }   ← newer; needs hex decode
  //   { trace_id, base_resp: { status_code, status_msg }, audio }
  // If all miss, surface the keys + a status_msg if present so the bug is
  // diagnosable without code changes.
  const b64Or  = json?.['data']?.['audio'] ?? json?.['audio'];
  if (b64Or && typeof b64Or === 'string') {
    // Heuristic: hex strings only contain [0-9a-f]; base64 has +, /, =, A-Z
    const looksHex = /^[0-9a-fA-F]+$/.test(b64Or) && b64Or.length % 2 === 0;
    return Buffer.from(b64Or, looksHex ? 'hex' : 'base64');
  }
  const statusMsg  = json?.['base_resp']?.['status_msg'];
  const statusCode = json?.['base_resp']?.['status_code'];
  const trace      = json?.['trace_id'];
  const keys       = Object.keys(json ?? {}).join(',');
  throw new Error(
    `MiniMax music-01: no audio in response. ` +
    (statusCode != null ? `status=${statusCode} msg="${statusMsg}" ` : '') +
    (trace ? `trace=${trace} ` : '') +
    `keys=[${keys}]`,
  );
}

// Cost: 0.04 cents per second of audio
function musicCostCents(durationSec: number): number {
  return Math.round(durationSec * 0.04);
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function musicRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── List ──────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { projectId?: string } }>('/api/music', async (req) => {
    const ctx = req.authCtx!;
    const db  = getDb();
    const where = req.query.projectId
      ? and(eq(musicTracks.tenantId, ctx.tenantId), eq(musicTracks.projectId, req.query.projectId))
      : eq(musicTracks.tenantId, ctx.tenantId);
    const rows = await db.select().from(musicTracks).where(where).orderBy(desc(musicTracks.createdAt)).limit(200);
    return { tracks: rows };
  });

  // ── Delete ────────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/api/music/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    const db  = getDb();
    await db.delete(musicTracks)
      .where(and(eq(musicTracks.id, req.params.id), eq(musicTracks.tenantId, ctx.tenantId)));
    return reply.status(204).send();
  });

  // ── Download (redirect) ───────────────────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/api/music/:id/download',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const db  = getDb();
      const [row] = await db.select().from(musicTracks)
        .where(and(eq(musicTracks.id, req.params.id), eq(musicTracks.tenantId, ctx.tenantId)));
      if (!row) return reply.status(404).send({ error: 'Track not found' });

      const format   = req.query.format ?? 'mp3';
      const assetId  = format === 'zip' ? row.zipAssetId : row.mp3AssetId;
      if (!assetId)  return reply.status(404).send({ error: `No ${format} asset for this track` });

      const [a] = await db.select().from(assets).where(eq(assets.id, assetId));
      if (!a?.publicUrl) return reply.status(404).send({ error: 'Asset URL missing' });
      return reply.redirect(a.publicUrl);
    },
  );

  // ── Generate (SSE) ────────────────────────────────────────────────────────
  // OPTIONS preflight — needed because reply.hijack() bypasses @fastify/cors
  app.options('/api/music/generate', async (req, reply) => {
    const origin = resolveOrigin(req.headers['origin'] as string | undefined);
    return reply
      .header('Access-Control-Allow-Origin',  origin)
      .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Max-Age',       '86400')
      .header('Vary',                         'Origin')
      .status(204).send();
  });

  app.post<{ Body: unknown }>('/api/music/generate', async (req, reply) => {
    const ctx = req.authCtx!;
    const parsed = GenerateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }
    const body = parsed.data;

    // SSE setup
    const origin = resolveOrigin(req.headers['origin'] as string | undefined);
    reply.hijack();
    const raw = reply.raw;
    raw.setHeader('Access-Control-Allow-Origin',      origin);
    raw.setHeader('Access-Control-Allow-Credentials', 'true');
    raw.setHeader('Vary',                             'Origin');
    raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    raw.setHeader('Cache-Control', 'no-cache, no-transform');
    raw.setHeader('Connection', 'keep-alive');
    raw.setHeader('X-Accel-Buffering', 'no');
    raw.flushHeaders?.();
    const send = (obj: unknown) => raw.write(`data: ${JSON.stringify(obj)}\n\n`);

    const controller = new AbortController();
    req.raw.once('close', () => controller.abort());

    const adapter = body.provider === 'ollama'
      ? createOllamaAdapter(env.OLLAMA_BASE_URL)
      : createMinimaxAdapter(ctx.tenantId, 'dev');

    const db = getDb();
    const inputs = {
      mode:            body.mode,
      vibe:            body.vibe,
      bpm:             body.bpm,
      key:             body.key,
      mood:            body.mood,
      instrumentation: body.instrumentation,
      durationSec:     body.durationSec,
      prompt:          body.prompt,
    };

    const [row] = await db.insert(musicTracks).values({
      tenantId:   ctx.tenantId,
      projectId:  body.projectId ?? null,
      title:      body.title,
      mode:       body.mode,
      inputs:     inputs as unknown as object,
      durationSec: body.durationSec,
      status:     'generating',
    }).returning();
    if (!row) { send({ type: 'error', error: 'Failed to create track row' }); raw.end(); return; }

    send({ type: 'created', trackId: row.id });

    let totalCostCents = 0;

    try {
      // ── Step 1: plan ──────────────────────────────────────────────────────
      send({ type: 'step', step: 'plan' });
      const planRes = await adapter.complete({
        prompt:      planPrompt(body),
        model:       body.model,
        maxTokens:   1024,
        temperature: 0.5,
      });
      const plan = JSON.parse(stripFences(String(planRes.text ?? ''))) as MusicPlan;
      if (!Array.isArray(plan.segments) || plan.segments.length === 0) {
        throw new Error('Music plan has no segments');
      }

      await db.update(musicTracks).set({
        generationPlan: plan as unknown as object,
        bpm:            plan.bpm   ?? body.bpm   ?? null,
        key:            plan.key   ?? body.key   ?? null,
        updatedAt:      new Date(),
      }).where(eq(musicTracks.id, row.id));

      // ── Step 2: generate segments ─────────────────────────────────────────
      // 'generating' matches the client-side event.step check in MusicStudioScreen
      send({ type: 'step', step: 'generating', segments: plan.segments.length });

      const mp3Buffers: Buffer[] = [];
      for (let i = 0; i < plan.segments.length; i++) {
        if (controller.signal.aborted) throw new Error('Cancelled by client');
        const seg = plan.segments[i]!;
        send({ type: 'step', step: 'generating', segments: plan.segments.length, segmentIndex: i });

        // Use adapter.generateMusic if available, else call MiniMax music-01 directly
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const adapterAny = adapter as any;
        let mp3Buf: Buffer;
        if (typeof adapterAny.generateMusic === 'function') {
          const result = await adapterAny.generateMusic({
            prompt:      seg.prompt,
            durationSec: seg.durationSec,
            model:       body.model,
          }) as { mp3Buffer: Buffer; latencyMs: number };
          mp3Buf = result.mp3Buffer;
        } else {
          mp3Buf = await generateMp3Segment({
            prompt:      seg.prompt,
            durationSec: seg.durationSec,
            tenantId:    ctx.tenantId,
          });
        }

        mp3Buffers.push(mp3Buf);
        totalCostCents += musicCostCents(seg.durationSec);
        await db.update(musicTracks).set({ costUsdCents: totalCostCents, updatedAt: new Date() }).where(eq(musicTracks.id, row.id));
      }

      // ── Step 3: stitch ────────────────────────────────────────────────────
      send({ type: 'step', step: 'stitch' });
      const stitchedMp3 = mp3Buffers.length > 1
        ? await concatMp3WithCrossfade(mp3Buffers)
        : mp3Buffers[0]!;

      // ── Step 4: convert to WAV ────────────────────────────────────────────
      send({ type: 'step', step: 'convert' });
      const wavBuffer = await mp3ToWav(stitchedMp3);

      // ── Step 5: stem separation ───────────────────────────────────────────
      send({ type: 'step', step: 'separate' });
      await db.update(musicTracks).set({ status: 'separating', updatedAt: new Date() }).where(eq(musicTracks.id, row.id));

      let stems: Awaited<ReturnType<typeof separateStems>> | null = null;
      let replicateToken: string | null = null;
      try {
        replicateToken = await vaultGet({ name: 'MUSIC_REPLICATE_TOKEN', env: 'dev', tenantId: ctx.tenantId });
      } catch { /* key missing */ }

      if (replicateToken) {
        try {
          stems = await separateStems({ wavBuffer, replicateToken });
          totalCostCents += 1; // stem separation: 1 cent
          await db.update(musicTracks).set({ costUsdCents: totalCostCents, updatedAt: new Date() }).where(eq(musicTracks.id, row.id));
        } catch (stemErr) {
          send({ type: 'warn', message: `Stem separation failed: ${String(stemErr)}` });
        }
      } else {
        send({ type: 'warn', message: 'MUSIC_REPLICATE_TOKEN not configured — skipping stem separation' });
      }

      // ── Step 6: package ───────────────────────────────────────────────────
      send({ type: 'step', step: 'package' });
      await db.update(musicTracks).set({ status: 'packaging', updatedAt: new Date() }).where(eq(musicTracks.id, row.id));

      const metadata = {
        title:       body.title,
        mode:        body.mode,
        bpm:         plan.bpm ?? body.bpm ?? null,
        key:         plan.key ?? body.key ?? null,
        durationSec: body.durationSec,
        segments:    plan.segments,
        generatedAt: new Date().toISOString(),
      };

      const zipEntries: { path: string; content: Buffer | string }[] = [
        { path: 'final.wav',       content: wavBuffer },
        { path: 'metadata.json',   content: JSON.stringify(metadata, null, 2) },
      ];

      if (stems) {
        zipEntries.push({ path: 'stems/drums.wav',   content: stems.drums  });
        zipEntries.push({ path: 'stems/bass.wav',    content: stems.bass   });
        zipEntries.push({ path: 'stems/melody.wav',  content: stems.other  });
        // Only include vocals if non-silent (buffer length > 1000 bytes)
        if (stems.vocals.length > 1000) {
          zipEntries.push({ path: 'stems/vocals.wav', content: stems.vocals });
        }
      }

      const zipBuffer = await buildZip(zipEntries);

      // ── Step 7: upload ────────────────────────────────────────────────────
      send({ type: 'step', step: 'upload' });

      const [mp3Upload, zipUpload] = await Promise.all([
        uploadBufferAsAsset({
          tenantId:  ctx.tenantId,
          projectId: body.projectId ?? null,
          folder:    `music/${row.id}`,
          filename:  `${slugify(body.title)}.mp3`,
          mimeType:  'audio/mpeg',
          buffer:    stitchedMp3,
        }),
        uploadBufferAsAsset({
          tenantId:  ctx.tenantId,
          projectId: body.projectId ?? null,
          folder:    `music/${row.id}`,
          filename:  `${slugify(body.title)}-stems.zip`,
          mimeType:  'application/zip',
          buffer:    zipBuffer,
        }),
      ]);

      await db.update(musicTracks).set({
        status:       'ready',
        mp3AssetId:   mp3Upload.assetId,
        zipAssetId:   zipUpload.assetId,
        costUsdCents: totalCostCents,
        updatedAt:    new Date(),
      }).where(eq(musicTracks.id, row.id));

      send({
        type:       'done',
        trackId:    row.id,
        mp3AssetId: mp3Upload.assetId,
        zipAssetId: zipUpload.assetId,
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(musicTracks).set({ status: 'failed', error: msg, updatedAt: new Date() }).where(eq(musicTracks.id, row.id));
      send({ type: 'error', error: msg });
    } finally {
      raw.end();
    }

    return undefined;
  });
}
