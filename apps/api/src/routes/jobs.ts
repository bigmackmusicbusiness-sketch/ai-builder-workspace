// apps/api/src/routes/jobs.ts — job/queue management (Upstash QStash bindings).
// Jobs are typed handlers with an optional cron schedule + retry policy in config.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client';
import { jobs } from '@abw/db';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import { writeAuditEvent } from '../security/audit';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const CreateJobSchema = z.object({
  projectId:   z.string().uuid(),
  name:        z.string().min(1).max(120),
  handler:     z.string().min(1),        // e.g. "src/jobs/sendReport.ts"
  cron:        z.string().optional(),    // cron expression e.g. "0 * * * *"
  config: z.object({
    maxRetries: z.number().int().min(0).max(10).default(3),
    timeoutMs:  z.number().int().min(1000).max(300_000).default(30_000),
    queue:      z.string().optional(),
  }).default({}),
});

const UpdateJobSchema = z.object({
  name:    z.string().min(1).max(120).optional(),
  handler: z.string().min(1).optional(),
  cron:    z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  config:  z.record(z.unknown()).optional(),
});

export async function jobsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /** GET /api/jobs?projectId=… */
  app.get<{ Querystring: { projectId?: string } }>('/api/jobs', async (req, reply) => {
    const ctx = req.authCtx!;
    if (!req.query.projectId) return reply.status(400).send({ error: 'projectId required' });

    const db = getDb();
    const rows = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.projectId, req.query.projectId), eq(jobs.tenantId, ctx.tenantId)));
    return { jobs: rows };
  });

  /** POST /api/jobs — create a job */
  app.post<{ Body: unknown }>('/api/jobs', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = CreateJobSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    const db = getDb();
    const [row] = await db.insert(jobs).values({
      projectId: parsed.data.projectId,
      tenantId:  ctx.tenantId,
      name:      parsed.data.name,
      handler:   parsed.data.handler,
      cron:      parsed.data.cron ?? null,
      config:    parsed.data.config,
      enabled:   true,
    }).returning();

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'job.create', target: 'job', targetId: row?.id,
      after: { name: parsed.data.name, handler: parsed.data.handler },
      env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.status(201).send({ job: row });
  });

  /** PATCH /api/jobs/:id — update job settings */
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/jobs/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = UpdateJobSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    const db = getDb();
    const [row] = await db
      .update(jobs)
      .set(parsed.data)
      .where(and(eq(jobs.id, req.params.id), eq(jobs.tenantId, ctx.tenantId)))
      .returning();

    if (!row) return reply.status(404).send({ error: 'Job not found' });
    return reply.send({ job: row });
  });

  /** POST /api/jobs/:id/trigger — manually trigger a job */
  app.post<{ Params: { id: string } }>('/api/jobs/:id/trigger', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const db = getDb();
    const [row] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, req.params.id), eq(jobs.tenantId, ctx.tenantId)))
      .limit(1);

    if (!row) return reply.status(404).send({ error: 'Job not found' });

    // TODO: enqueue via Upstash QStash when UPSTASH_QSTASH_TOKEN is set
    // For now: update lastRunAt and return a stub run ID
    await db
      .update(jobs)
      .set({ lastRunAt: new Date() })
      .where(and(eq(jobs.id, req.params.id), eq(jobs.tenantId, ctx.tenantId)));

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'job.trigger', target: 'job', targetId: row.id,
      env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.send({ ok: true, jobId: row.id, queued: false });
  });

  /** DELETE /api/jobs/:id */
  app.delete<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const db = getDb();
    const [row] = await db
      .delete(jobs)
      .where(and(eq(jobs.id, req.params.id), eq(jobs.tenantId, ctx.tenantId)))
      .returning({ id: jobs.id });

    if (!row) return reply.status(404).send({ error: 'Job not found' });

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'job.delete', target: 'job', targetId: req.params.id,
      env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.send({ ok: true });
  });
}
