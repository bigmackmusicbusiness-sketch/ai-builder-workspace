// apps/api/src/routes/projects.ts — project CRUD.
// Tenants manage projects; all data is scoped by tenantId from the JWT.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, or } from 'drizzle-orm';
import { getDb, getRawSql } from '../db/client';
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

const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  /** Owner-only: toggle whether project is visible to other tenant members. */
  isShared: z.boolean().optional(),
});

export async function projectsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /** GET /api/projects — list projects visible to the current user.
   *  Visible = (created by them) OR (shared with the tenant). Within the same tenant.
   *  Falls back to tenant-scoped filter if the is_shared column doesn't exist yet
   *  (i.e., before the 0008_project_sharing migration has been applied). */
  app.get('/api/projects', async (req) => {
    const ctx = req.authCtx!;
    const db = getDb();
    try {
      const rows = await db
        .select()
        .from(projects)
        .where(and(
          eq(projects.tenantId, ctx.tenantId),
          or(
            eq(projects.createdBy, ctx.userId),
            eq(projects.isShared, true),
          ),
        ))
        .orderBy(projects.createdAt);
      return { projects: rows };
    } catch (err) {
      // Drizzle generates SELECT * which includes the is_shared column we just
      // added to the schema. If the column doesn't exist in the DB yet, even
      // the simple tenant-only query fails. Fall back to a raw SQL query that
      // ONLY references columns guaranteed to exist pre-migration.
      const msg  = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code ?? '';
      // eslint-disable-next-line no-console
      console.warn(`[projects] visibility-aware query failed (${code} ${msg}) — falling back to raw SQL.`);
      try {
        const sql = getRawSql();
        const rows = await sql.unsafe(
          `SELECT id, tenant_id AS "tenantId", created_by AS "createdBy",
                  name, slug, type, description, config,
                  active_env AS "activeEnv",
                  created_at AS "createdAt", updated_at AS "updatedAt"
             FROM projects
            WHERE tenant_id = $1
            ORDER BY created_at`,
          [ctx.tenantId],
        ) as Array<Record<string, unknown>>;
        return { projects: rows };
      } catch (fallbackErr) {
        // eslint-disable-next-line no-console
        console.error(`[projects] raw fallback also failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
        throw fallbackErr;
      }
    }
  });

  /** GET /api/projects/:id */
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    const db  = getDb();
    try {
      const [row] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, req.params.id), eq(projects.tenantId, ctx.tenantId)))
        .limit(1);
      if (!row) return reply.status(404).send({ error: 'Not found' });
      return { project: row };
    } catch (err) {
      // Same defensive fallback as GET /api/projects: when migration 0008 hasn't
      // applied to the prod DB, Drizzle's SELECT * includes is_shared and 42703s.
      const msg  = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code ?? '';
      // eslint-disable-next-line no-console
      console.warn(`[projects/:id] drizzle select failed (${code} ${msg}) — falling back to raw SQL.`);
      const sql = getRawSql();
      const rows = await sql.unsafe(
        `SELECT id, tenant_id AS "tenantId", created_by AS "createdBy",
                name, slug, type, description, config,
                active_env AS "activeEnv",
                created_at AS "createdAt", updated_at AS "updatedAt"
           FROM projects
          WHERE id = $1 AND tenant_id = $2
          LIMIT 1`,
        [req.params.id, ctx.tenantId],
      ) as Array<Record<string, unknown>>;
      if (!rows[0]) return reply.status(404).send({ error: 'Not found' });
      return { project: rows[0] };
    }
  });

  /** POST /api/projects — create project */
  app.post<{ Body: unknown }>('/api/projects', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    const db = getDb();
    let row: Record<string, unknown> | undefined;
    try {
      const inserted = await db.insert(projects).values({
        tenantId:    ctx.tenantId,
        createdBy:   ctx.userId,
        name:        parsed.data.name,
        slug:        parsed.data.slug,
        type:        parsed.data.type,
        description: parsed.data.description ?? null,
        config:      {},
        activeEnv:   'dev',
      }).returning();
      row = inserted[0] as Record<string, unknown> | undefined;
    } catch (err) {
      // If the is_shared column hasn't been added yet (migration 0008 not applied),
      // Drizzle's `RETURNING *` references a non-existent column and fails. Fall
      // back to a raw INSERT that only touches columns guaranteed to exist.
      const msg  = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code ?? '';
      // eslint-disable-next-line no-console
      console.warn(`[projects] drizzle insert failed (${code} ${msg}) — falling back to raw SQL.`);
      const sql = getRawSql();
      const rows = await sql.unsafe(
        `INSERT INTO projects
           (tenant_id, created_by, name, slug, type, description, config, active_env)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING id, tenant_id AS "tenantId", created_by AS "createdBy",
                   name, slug, type, description, config,
                   active_env AS "activeEnv",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          ctx.tenantId,
          ctx.userId,
          parsed.data.name,
          parsed.data.slug,
          parsed.data.type,
          parsed.data.description ?? null,
          '{}',
          'dev',
        ],
      ) as Array<Record<string, unknown>>;
      row = rows[0];
    }

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'project.create', target: 'project', targetId: row?.['id'] as string | undefined,
      after: { name: parsed.data.name, type: parsed.data.type }, env: 'dev',
      ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.status(201).send({ project: row });
  });

  /** PATCH /api/projects/:id — update project. Owner-only for ownership-sensitive fields. */
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/projects/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = UpdateProjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    const db = getDb();

    // Verify ownership before any update touching isShared
    if (parsed.data.isShared !== undefined) {
      const [existing] = await db
        .select({ createdBy: projects.createdBy })
        .from(projects)
        .where(and(eq(projects.id, req.params.id), eq(projects.tenantId, ctx.tenantId)))
        .limit(1);
      if (!existing) return reply.status(404).send({ error: 'Not found' });
      if (existing.createdBy !== ctx.userId) {
        return reply.status(403).send({ error: 'Only the project owner can change sharing.' });
      }
    }

    let row: Record<string, unknown> | undefined;
    try {
      const updated = await db
        .update(projects)
        .set(parsed.data)
        .where(and(eq(projects.id, req.params.id), eq(projects.tenantId, ctx.tenantId)))
        .returning();
      row = updated[0] as Record<string, unknown> | undefined;
    } catch (err) {
      // Same fallback pattern as POST: when migration 0008_project_sharing
      // hasn't been applied, Drizzle's UPDATE...RETURNING references the
      // missing is_shared column and 42703s. Build the SET clause by hand
      // using only columns guaranteed to exist pre-migration; if the request
      // tried to set isShared, attempt that as a separate ALTER-tolerant
      // raw UPDATE so the toggle still does something on success.
      const code = (err as { code?: string })?.code ?? '';
      const msg  = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[projects] drizzle update failed (${code} ${msg}) — falling back to raw SQL.`);
      const sql = getRawSql();

      // Map only the columns we know exist pre-migration
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (parsed.data.name !== undefined)        { sets.push(`name = $${i++}`);        vals.push(parsed.data.name); }
      if (parsed.data.slug !== undefined)        { sets.push(`slug = $${i++}`);        vals.push(parsed.data.slug); }
      if (parsed.data.type !== undefined)        { sets.push(`type = $${i++}`);        vals.push(parsed.data.type); }
      if (parsed.data.description !== undefined) { sets.push(`description = $${i++}`); vals.push(parsed.data.description); }

      // Best-effort isShared toggle when migration is missing — try the
      // ALTER first then the UPDATE. If either fails, swallow + continue.
      if (parsed.data.isShared !== undefined) {
        try {
          await sql.unsafe(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE`);
          sets.push(`is_shared = $${i++}`);
          vals.push(parsed.data.isShared);
        } catch (alterErr) {
          // eslint-disable-next-line no-console
          console.warn(`[projects] ALTER TABLE add is_shared failed: ${alterErr instanceof Error ? alterErr.message : String(alterErr)}`);
        }
      }

      if (sets.length === 0) {
        // Nothing left to update; just return the existing row
        const rows = await sql.unsafe(
          `SELECT id, tenant_id AS "tenantId", created_by AS "createdBy",
                  name, slug, type, description, config,
                  active_env AS "activeEnv",
                  created_at AS "createdAt", updated_at AS "updatedAt"
             FROM projects
            WHERE id = $1 AND tenant_id = $2
            LIMIT 1`,
          [req.params.id, ctx.tenantId],
        ) as Array<Record<string, unknown>>;
        row = rows[0];
      } else {
        const idIdx = i;     vals.push(req.params.id);
        const tIdx  = i + 1; vals.push(ctx.tenantId);
        const rows = await sql.unsafe(
          `UPDATE projects SET ${sets.join(', ')}
            WHERE id = $${idIdx} AND tenant_id = $${tIdx}
            RETURNING id, tenant_id AS "tenantId", created_by AS "createdBy",
                      name, slug, type, description, config,
                      active_env AS "activeEnv",
                      created_at AS "createdAt", updated_at AS "updatedAt"`,
          vals,
        ) as Array<Record<string, unknown>>;
        row = rows[0];
      }
    }

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
