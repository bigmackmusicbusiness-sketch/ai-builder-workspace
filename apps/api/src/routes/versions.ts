// apps/api/src/routes/versions.ts — snapshot list + restore.
// Restore is never destructive: it creates a new snapshot pointing at old blobs.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import { writeAuditEvent } from '../security/audit';
import { listSnapshots, createSnapshot, restoreSnapshot } from '../db/repositories/filesRepo';

declare module 'fastify' {
  interface FastifyRequest {
    authCtx?: AuthContext;
  }
}

const ListQuerySchema = z.object({
  projectId: z.string().uuid(),
});

const CreateBodySchema = z.object({
  projectId: z.string().uuid(),
  label: z.string().max(200).optional(),
});

const RestoreBodySchema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
});

export async function versionsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /** GET /api/versions?projectId=… — list snapshots, newest first */
  app.get<{ Querystring: { projectId?: string } }>('/api/versions', async (req, reply) => {
    const ctx = req.authCtx!;
    const parsed = ListQuerySchema.safeParse({ projectId: req.query.projectId });
    if (!parsed.success) return reply.status(400).send({ error: 'projectId required' });

    const rows = await listSnapshots(parsed.data.projectId, ctx.tenantId);
    return { versions: rows };
  });

  /** POST /api/versions — create a manual snapshot ("Snapshot now") */
  app.post<{ Body: unknown }>('/api/versions', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = CreateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }

    const versionId = await createSnapshot(
      parsed.data.projectId,
      ctx.tenantId,
      ctx.userId,
      parsed.data.label,
    );

    await writeAuditEvent({
      actor: ctx.userId,
      tenantId: ctx.tenantId,
      action: 'version.create',
      target: 'project',
      targetId: parsed.data.projectId,
      after: { versionId },
      env: 'dev',
      ip: req.ip,
      ua: req.headers['user-agent'] ?? '',
    });

    return reply.status(201).send({ versionId });
  });

  /** POST /api/versions/restore — restore project files to a previous snapshot */
  app.post<{ Body: unknown }>('/api/versions/restore', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = RestoreBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }

    await restoreSnapshot(
      parsed.data.versionId,
      parsed.data.projectId,
      ctx.tenantId,
      ctx.userId,
    );

    await writeAuditEvent({
      actor: ctx.userId,
      tenantId: ctx.tenantId,
      action: 'version.restore',
      target: 'project',
      targetId: parsed.data.projectId,
      after: { restoredTo: parsed.data.versionId },
      env: 'dev',
      ip: req.ip,
      ua: req.headers['user-agent'] ?? '',
    });

    return reply.status(200).send({ ok: true });
  });
}
