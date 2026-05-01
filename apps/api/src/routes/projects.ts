// apps/api/src/routes/projects.ts — project CRUD.
// Tenants manage projects; all data is scoped by tenantId from the JWT.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client';
import { projects } from '@abw/db';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import { writeAuditEvent } from '../security/audit';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const CreateProjectSchema = z.object({
  name:        z.string().min(1).max(120),
  slug:        z.string().regex(/^[a-z0-9-]+$/).min(1).max(60),
  type:        z.enum(['website','landing_page','dashboard','internal_tool',
                       'onboarding_flow','automation_panel','saas_app',
                       'api_service','full_stack_app',
                       'ebook','document','email_composer','music_studio',
                       'ai_movie','ai_commercial','ai_short','ai_music_video',
                       'blank']).default('blank'),
  description: z.string().max(500).optional(),
});

const UpdateProjectSchema = CreateProjectSchema.partial();

export async function projectsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /** GET /api/projects — list projects for tenant */
  app.get('/api/projects', async (req) => {
    const ctx = req.authCtx!;
    const db = getDb();
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.tenantId, ctx.tenantId))
      .orderBy(projects.createdAt);
    return { projects: rows };
  });

  /** GET /api/projects/:id */
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    const db = getDb();
    const [row] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, req.params.id), eq(projects.tenantId, ctx.tenantId)))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'Not found' });
    return { project: row };
  });

  /** POST /api/projects — create project */
  app.post<{ Body: unknown }>('/api/projects', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    const db = getDb();
    const [row] = await db.insert(projects).values({
      tenantId:    ctx.tenantId,
      createdBy:   ctx.userId,
      name:        parsed.data.name,
      slug:        parsed.data.slug,
      type:        parsed.data.type,
      description: parsed.data.description ?? null,
      config:      {},
      activeEnv:   'dev',
    }).returning();

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'project.create', target: 'project', targetId: row?.id,
      after: { name: parsed.data.name, type: parsed.data.type }, env: 'dev',
      ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.status(201).send({ project: row });
  });

  /** PATCH /api/projects/:id — update project */
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/projects/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = UpdateProjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    const db = getDb();
    const [row] = await db
      .update(projects)
      .set(parsed.data)
      .where(and(eq(projects.id, req.params.id), eq(projects.tenantId, ctx.tenantId)))
      .returning();

    if (!row) return reply.status(404).send({ error: 'Not found' });
    return { project: row };
  });

  /** DELETE /api/projects/:id — soft-delete (set deletedAt) */
  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'admin');

    const db = getDb();
    const [row] = await db
      .update(projects)
      .set({ deletedAt: new Date() } as Record<string, unknown>)
      .where(and(eq(projects.id, req.params.id), eq(projects.tenantId, ctx.tenantId)))
      .returning({ id: projects.id });

    if (!row) return reply.status(404).send({ error: 'Not found' });

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'project.delete', target: 'project', targetId: req.params.id,
      env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.send({ ok: true });
  });
}
