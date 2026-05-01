// apps/api/src/routes/video.ts — Video Studio CRUD + generation + render.
//
// Endpoints:
//   GET    /api/video?projectId=&kind=     list
//   GET    /api/video/:id                  single + timeline
//   POST   /api/video                      create (kind, title, brief, durationSec, aspectRatio, projectId?)
//   DELETE /api/video/:id                  delete
//   POST   /api/video/:id/generate         SSE — agent + Higgsfield drive scene gen → timeline
//   POST   /api/video/:id/render           SSE — ffmpeg renders timeline → final MP4 → assets
//
// The generate + render endpoints stream progress over SSE (same pattern as
// chat/ebooks/music). They both touch the `timeline` JSONB column on
// `video_projects` — the shape is defined in lib/timeline.ts.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { authMiddleware, type AuthContext } from '../security/authz';
import { getDb } from '../db/client';
import { videoProjects, assets } from '@abw/db';
import { emptyTimeline, type AspectRatio } from '../lib/timeline';
import { generateForKind } from '../lib/video/kinds';
import { renderTimeline } from '../lib/render';
import { uploadBufferAsAsset } from '../lib/assetUpload';
import { execVideoEdit } from '../agent/tools/video-edit';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

// CORS helper — needed for the SSE routes (reply.hijack() bypasses @fastify/cors)
const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/.*\.pages\.dev$/,
  /^https:\/\/.*\.railway\.app$/,
];
function resolveOrigin(origin: string | undefined): string {
  if (!origin) return '*';
  return ALLOWED_ORIGINS.some((r) => r.test(origin)) ? origin : '*';
}

const VIDEO_KINDS = ['movie', 'commercial', 'short', 'music_video'] as const;

const CreateBody = z.object({
  title:        z.string().min(1).max(200),
  kind:         z.enum(VIDEO_KINDS),
  brief:        z.string().max(4000).optional(),
  durationSec:  z.number().int().min(3).max(600).optional(),
  aspectRatio:  z.enum(['16:9', '9:16', '1:1', '4:3']).default('16:9'),
  projectId:    z.string().uuid().optional(),
});

export async function videoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── List ────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { projectId?: string; kind?: string } }>('/api/video', async (req) => {
    const ctx = req.authCtx!;
    const db = getDb();
    const where = req.query.projectId
      ? and(eq(videoProjects.tenantId, ctx.tenantId), eq(videoProjects.projectId, req.query.projectId))
      : eq(videoProjects.tenantId, ctx.tenantId);
    const rows = await db.select().from(videoProjects).where(where).orderBy(desc(videoProjects.createdAt)).limit(200);
    const filtered = req.query.kind
      ? rows.filter((r) => r.kind === req.query.kind)
      : rows;
    return { videos: filtered };
  });

  // ── Single ─────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/video/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    const db  = getDb();
    const [row] = await db.select().from(videoProjects)
      .where(and(eq(videoProjects.id, req.params.id), eq(videoProjects.tenantId, ctx.tenantId)));
    if (!row) return reply.status(404).send({ error: 'Not found' });
    return { video: row };
  });

  // ── Create ─────────────────────────────────────────────────────────────
  app.post<{ Body: unknown }>('/api/video', async (req, reply) => {
    const ctx = req.authCtx!;
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    const { title, kind, brief, durationSec, aspectRatio, projectId } = parsed.data;

    // Sensible defaults per kind so the user doesn't have to set duration.
    const defaultDuration = {
      movie:        180,
      commercial:    30,
      short:         30,
      music_video:  120,
    } as const;
    const finalDuration = durationSec ?? defaultDuration[kind];
    const finalAspect   = aspectRatio ?? (kind === 'short' ? '9:16' : '16:9');

    const db = getDb();
    const [row] = await db.insert(videoProjects).values({
      tenantId:     ctx.tenantId,
      projectId:    projectId ?? null,
      title,
      kind,
      brief:        brief ?? null,
      durationSec:  finalDuration,
      aspectRatio:  finalAspect,
      status:       'drafting',
      timeline:     emptyTimeline({ aspectRatio: finalAspect }) as unknown as object,
    }).returning();

    if (!row) return reply.status(500).send({ error: 'Failed to create video project' });
    return reply.status(201).send({ video: row });
  });

  // ── Delete ─────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/api/video/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    const db  = getDb();
    await db.delete(videoProjects)
      .where(and(eq(videoProjects.id, req.params.id), eq(videoProjects.tenantId, ctx.tenantId)));
    return reply.status(204).send();
  });

  // ── Download (redirect to asset URL) ────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { kind?: 'preview' | 'final' } }>(
    '/api/video/:id/download',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const db  = getDb();
      const [row] = await db.select().from(videoProjects)
        .where(and(eq(videoProjects.id, req.params.id), eq(videoProjects.tenantId, ctx.tenantId)));
      if (!row) return reply.status(404).send({ error: 'Not found' });
      const which = req.query.kind === 'preview' ? row.previewAssetId : row.finalAssetId;
      if (!which) return reply.status(404).send({ error: `No ${req.query.kind ?? 'final'} render yet` });
      const [a] = await db.select().from(assets).where(eq(assets.id, which));
      if (!a?.publicUrl) return reply.status(404).send({ error: 'Asset URL missing' });
      return reply.redirect(a.publicUrl);
    },
  );

  // ── Generate (SSE) ──────────────────────────────────────────────────────
  // Phase C ships the route + plumbing; the actual scene-by-scene Higgsfield
  // pipeline is fleshed out per kind in subsequent commits. Calling it now
  // returns a clean "not yet wired" event so the UI can be built end-to-end.
  app.options('/api/video/:id/generate', async (req, reply) => {
    const origin = resolveOrigin(req.headers['origin'] as string | undefined);
    return reply
      .header('Access-Control-Allow-Origin',  origin)
      .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Max-Age',       '86400')
      .header('Vary',                         'Origin')
      .status(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/video/:id/generate', async (req, reply) => {
    const ctx = req.authCtx!;
    const origin = resolveOrigin(req.headers['origin'] as string | undefined);
    reply.hijack();
    const raw = reply.raw;
    raw.setHeader('Access-Control-Allow-Origin',      origin);
    raw.setHeader('Access-Control-Allow-Credentials', 'true');
    raw.setHeader('Vary',                             'Origin');
    raw.setHeader('Content-Type',                     'text/event-stream; charset=utf-8');
    raw.setHeader('Cache-Control',                    'no-cache, no-transform');
    raw.setHeader('Connection',                       'keep-alive');
    raw.setHeader('X-Accel-Buffering',                'no');
    raw.flushHeaders?.();

    const send = (obj: unknown) => raw.write(`data: ${JSON.stringify(obj)}\n\n`);

    const db = getDb();
    const [row] = await db.select().from(videoProjects)
      .where(and(eq(videoProjects.id, req.params.id), eq(videoProjects.tenantId, ctx.tenantId)));
    if (!row) {
      send({ type: 'error', error: 'Video project not found' });
      raw.end();
      return;
    }

    try {
      send({ type: 'step', step: 'starting', message: `Starting ${row.kind} generation: "${row.title}"` });

      const result = await generateForKind(row.kind, {
        tenantId:        ctx.tenantId,
        env:             'dev',
        projectId:       row.projectId ?? null,
        videoProjectId:  row.id,
        emit:            (ev) => send(ev),
      }, {
        title:        row.title,
        brief:        row.brief ?? '',
        durationSec:  row.durationSec ?? 30,
        aspectRatio:  (row.aspectRatio as AspectRatio) ?? '16:9',
      });

      // Persist timeline to DB
      await db.update(videoProjects).set({
        timeline:     result.timeline as unknown as object,
        durationSec:  result.timeline.durationSec,
        costUsdCents: row.costUsdCents + result.costUsdCents,
        status:       'drafting',          // drafting = AI's first crack done; user can edit before rendering
        updatedAt:    new Date(),
      }).where(eq(videoProjects.id, row.id));

      send({
        type: 'done',
        videoId: row.id,
        summary: result.summary,
        costUsdCents: result.costUsdCents,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(videoProjects).set({
        status: 'failed',
        error:  msg,
        updatedAt: new Date(),
      }).where(eq(videoProjects.id, row.id));
      send({ type: 'error', error: msg });
    } finally {
      raw.end();
    }
  });

  // ── Timeline ops (used by the manual editor UI) ─────────────────────────
  // Wraps the same logic the agent tools call, so behaviour is consistent
  // whether the user mutates via the editor UI or via chat.
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/video/:id/timeline/op',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const id  = req.params.id;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const op = String(body['op'] ?? '');

      // Map UI op names → agent tool names (the executor knows these)
      const opToTool: Record<string, string> = {
        delete_clip:    'video_delete_clip',
        reorder:        'video_reorder_clips',
        add_caption:    'video_add_caption',
        cut_clip:       'video_cut_clip',
        trim_clip:      'video_trim_clip',
        set_transition: 'video_set_transition',
      };

      // delete_overlay isn't on the agent surface (intentional — overlays are
      // fluid + cheap to manage in the UI). Implement inline.
      if (op === 'delete_overlay') {
        const overlayId = String(body['overlayId'] ?? '');
        const db = getDb();
        const [row] = await db.select().from(videoProjects)
          .where(and(eq(videoProjects.id, id), eq(videoProjects.tenantId, ctx.tenantId)));
        if (!row) return reply.status(404).send({ error: 'Not found' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t: any = row.timeline;
        t.overlays = (t.overlays ?? []).filter((o: { id: string }) => o.id !== overlayId);
        t.meta = { ...(t.meta ?? {}), lastEditedAt: Date.now() };
        await db.update(videoProjects).set({ timeline: t, updatedAt: new Date() })
          .where(eq(videoProjects.id, id));
        return { ok: true };
      }

      const toolName = opToTool[op];
      if (!toolName) return reply.status(400).send({ error: `Unknown op: ${op}` });

      // Map UI body fields → tool args. Most are passthrough; a few rename
      // (e.g. UI sends `start/end`, tool wants `startSec/endSec`).
      const args: Record<string, unknown> = { videoId: id };
      if (body['clipId']  !== undefined) args['clipId']  = body['clipId'];
      if (body['clipIds'] !== undefined) args['clipIds'] = body['clipIds'];
      if (body['atSec']   !== undefined) args['atSec']   = body['atSec'];
      if (body['newIn']   !== undefined) args['newIn']   = body['newIn'];
      if (body['newOut']  !== undefined) args['newOut']  = body['newOut'];
      if (body['edge']    !== undefined) args['edge']    = body['edge'];
      if (body['kind']    !== undefined) args['kind']    = body['kind'];
      if (body['durationSec'] !== undefined) args['durationSec'] = body['durationSec'];
      if (body['text']    !== undefined) args['text']    = body['text'];
      if (body['start']   !== undefined) args['startSec'] = body['start'];
      if (body['end']     !== undefined) args['endSec']   = body['end'];

      const out = await execVideoEdit(toolName, args, { tenantId: ctx.tenantId });
      if (!out.ok) return reply.status(400).send({ error: out.summary });
      return { ok: true, summary: out.summary };
    },
  );

  // ── Render (SSE) ────────────────────────────────────────────────────────
  app.options('/api/video/:id/render', async (req, reply) => {
    const origin = resolveOrigin(req.headers['origin'] as string | undefined);
    return reply
      .header('Access-Control-Allow-Origin',  origin)
      .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Max-Age',       '86400')
      .header('Vary',                         'Origin')
      .status(204).send();
  });

  app.post<{ Params: { id: string }; Querystring: { quality?: 'preview' | 'final' } }>(
    '/api/video/:id/render',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const origin = resolveOrigin(req.headers['origin'] as string | undefined);
      reply.hijack();
      const raw = reply.raw;
      raw.setHeader('Access-Control-Allow-Origin',      origin);
      raw.setHeader('Access-Control-Allow-Credentials', 'true');
      raw.setHeader('Vary',                             'Origin');
      raw.setHeader('Content-Type',                     'text/event-stream; charset=utf-8');
      raw.setHeader('Cache-Control',                    'no-cache, no-transform');
      raw.setHeader('Connection',                       'keep-alive');
      raw.setHeader('X-Accel-Buffering',                'no');
      raw.flushHeaders?.();

      const send = (obj: unknown) => raw.write(`data: ${JSON.stringify(obj)}\n\n`);
      const quality = (req.query.quality === 'preview') ? 'preview' : 'final';

      const db = getDb();
      const [row] = await db.select().from(videoProjects)
        .where(and(eq(videoProjects.id, req.params.id), eq(videoProjects.tenantId, ctx.tenantId)));
      if (!row) {
        send({ type: 'error', error: 'Video project not found' });
        raw.end();
        return;
      }

      try {
        await db.update(videoProjects).set({ status: 'rendering', updatedAt: new Date() }).where(eq(videoProjects.id, row.id));

        send({ type: 'step', step: 'rendering', message: `Rendering ${quality} quality…` });
        const result = await renderTimeline({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          timeline: row.timeline as any,
          quality,
          onProgress: (pct) => send({ type: 'progress', pct: Math.round(pct * 100) }),
        });

        send({ type: 'step', step: 'uploading', message: `Uploading ${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB…` });
        const upload = await uploadBufferAsAsset({
          tenantId:  ctx.tenantId,
          projectId: row.projectId ?? null,
          folder:    `videos/${row.id}/renders`,
          filename:  `${quality}-${Date.now()}.mp4`,
          mimeType:  'video/mp4',
          buffer:    result.buffer,
        });

        await db.update(videoProjects).set({
          status:         'ready',
          [quality === 'preview' ? 'previewAssetId' : 'finalAssetId']: upload.assetId,
          updatedAt:      new Date(),
        }).where(eq(videoProjects.id, row.id));

        send({
          type:        'done',
          videoId:     row.id,
          quality,
          assetId:     upload.assetId,
          assetUrl:    upload.url,
          sizeBytes:   result.sizeBytes,
          durationSec: result.durationSec,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.update(videoProjects).set({
          status: 'failed',
          error:  msg,
          updatedAt: new Date(),
        }).where(eq(videoProjects.id, row.id));
        send({ type: 'error', error: msg });
      } finally {
        raw.end();
      }
    },
  );
}
