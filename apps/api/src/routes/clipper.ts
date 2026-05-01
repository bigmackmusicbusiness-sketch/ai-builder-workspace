// apps/api/src/routes/clipper.ts — AI Clipper job CRUD + status streaming.
//
// Endpoints:
//   POST   /api/clipper/jobs               body { sourceKind, sourceRef, ... }
//   GET    /api/clipper/jobs?projectId=    list
//   GET    /api/clipper/jobs/:id           single (with current candidates+clips)
//   GET    /api/clipper/jobs/:id/stream    SSE progress feed (polls DB every 1s)
//   DELETE /api/clipper/jobs/:id
//
// The actual pipeline runs via runClipper() — kicked off in-process for now
// (move to dedicated worker container in Coolify deploy). SSE just polls the
// DB for status changes — simplest reliable progress mechanism, doesn't
// require pub/sub.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { authMiddleware, type AuthContext } from '../security/authz';
import { getDb } from '../db/client';
import { clipperJobs } from '@abw/db';
import { runClipper } from '../lib/clipper/runner';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/.*\.pages\.dev$/,
  /^https:\/\/.*\.railway\.app$/,
];
function resolveOrigin(origin: string | undefined): string {
  if (!origin) return '*';
  return ALLOWED_ORIGINS.some((r) => r.test(origin)) ? origin : '*';
}

const CreateBody = z.object({
  sourceKind:          z.enum(['upload', 'youtube', 'url']),
  sourceRef:           z.string().min(1),
  targetClipCount:     z.number().int().min(1).max(20).default(5),
  targetClipLengthSec: z.number().int().min(10).max(180).default(30),
  captionStyle:        z.enum(['viral', 'subtle']).default('viral'),
  projectId:           z.string().uuid().optional(),
  /** "I have rights to use this content" — required for youtube/url to discourage misuse. */
  acknowledgeRights:   z.boolean().default(false),
});

export async function clipperRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── List ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { projectId?: string } }>('/api/clipper/jobs', async (req) => {
    const ctx = req.authCtx!;
    const db = getDb();
    const where = req.query.projectId
      ? and(eq(clipperJobs.tenantId, ctx.tenantId), eq(clipperJobs.projectId, req.query.projectId))
      : eq(clipperJobs.tenantId, ctx.tenantId);
    const rows = await db.select().from(clipperJobs).where(where).orderBy(desc(clipperJobs.createdAt)).limit(100);
    return { jobs: rows };
  });

  // ── Single ──────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/clipper/jobs/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    const db = getDb();
    const [row] = await db.select().from(clipperJobs)
      .where(and(eq(clipperJobs.id, req.params.id), eq(clipperJobs.tenantId, ctx.tenantId)));
    if (!row) return reply.status(404).send({ error: 'Not found' });
    return { job: row };
  });

  // ── Create + kick off pipeline ──────────────────────────────────────
  app.post<{ Body: unknown }>('/api/clipper/jobs', async (req, reply) => {
    const ctx = req.authCtx!;
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    const body = parsed.data;

    if ((body.sourceKind === 'youtube' || body.sourceKind === 'url') && !body.acknowledgeRights) {
      return reply.status(400).send({ error: 'You must acknowledge you have rights to use this content for non-uploaded sources.' });
    }

    const db = getDb();
    const [row] = await db.insert(clipperJobs).values({
      tenantId:            ctx.tenantId,
      projectId:           body.projectId ?? null,
      sourceKind:          body.sourceKind,
      sourceRef:           body.sourceRef,
      targetClipCount:     body.targetClipCount,
      targetClipLengthSec: body.targetClipLengthSec,
      captionStyle:        body.captionStyle,
      status:              'uploading',
      progressPct:         0,
    }).returning();
    if (!row) return reply.status(500).send({ error: 'Failed to create job' });

    // Kick off the pipeline IN-PROCESS for now. In Coolify this moves to a
    // dedicated worker service so heavy ffmpeg jobs don't hog API request
    // handlers. For now the API will be busy but functional.
    void runClipper({ jobId: row.id, tenantId: ctx.tenantId, env: 'dev' })
      .catch((err) => {
        // Errors are written into clipper_jobs.error by the runner itself.
        req.log.error({ err: (err as Error).message, jobId: row.id }, 'Clipper run failed');
      });

    return reply.status(201).send({ job: row });
  });

  // ── Delete ──────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/api/clipper/jobs/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    const db = getDb();
    await db.delete(clipperJobs)
      .where(and(eq(clipperJobs.id, req.params.id), eq(clipperJobs.tenantId, ctx.tenantId)));
    return reply.status(204).send();
  });

  // ── SSE progress stream ─────────────────────────────────────────────
  // Simple polling loop — checks the DB every 1s and emits when something
  // changed. Disconnects automatically when the job finishes.
  app.options('/api/clipper/jobs/:id/stream', async (req, reply) => {
    const origin = resolveOrigin(req.headers['origin'] as string | undefined);
    return reply
      .header('Access-Control-Allow-Origin',  origin)
      .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
      .header('Vary',                         'Origin')
      .status(204).send();
  });

  app.get<{ Params: { id: string } }>('/api/clipper/jobs/:id/stream', async (req, reply) => {
    const ctx = req.authCtx!;
    const id  = req.params.id;
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
    let closed = false;
    req.raw.once('close', () => { closed = true; });

    const db = getDb();
    let lastSerialized = '';
    while (!closed) {
      const [row] = await db.select().from(clipperJobs)
        .where(and(eq(clipperJobs.id, id), eq(clipperJobs.tenantId, ctx.tenantId)));
      if (!row) {
        send({ type: 'error', error: 'Job not found' });
        break;
      }
      const summary = {
        status:      row.status,
        progressPct: row.progressPct,
        clipsCount:  Array.isArray(row.clips) ? (row.clips as unknown[]).length : 0,
        error:       row.error,
      };
      const serialized = JSON.stringify(summary);
      if (serialized !== lastSerialized) {
        send({ type: 'progress', ...summary });
        lastSerialized = serialized;
      }
      if (row.status === 'done' || row.status === 'failed') {
        send({ type: 'done', status: row.status, clipsCount: summary.clipsCount });
        break;
      }
      // Poll cadence: 1s. Cheap query (single row).
      await new Promise((r) => setTimeout(r, 1000));
    }
    raw.end();
  });
}
