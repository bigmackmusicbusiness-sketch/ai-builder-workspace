// apps/api/src/routes/db.ts — schema editor, migration management, DB browser endpoints.
// Staging/production migration apply requires an approved action (Step 11 wires the full gate).
// All SQL runs against the TENANT's project environment — never against the platform DB directly.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { getDb, getRawSql } from '../db/client';
import { schemas, migrations } from '@abw/db';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import { writeAuditEvent } from '../security/audit';
import { validateApproval } from '../security/approvalMatrix';
import { runMigrations, getLastMigrationsReport } from '../db/runMigrations';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

// ── Schemas (user-defined table definitions) ──────────────────────────────────

const CreateSchemaSchema = z.object({
  projectId:  z.string().uuid(),
  name:       z.string().min(1).max(120),
  definition: z.record(z.unknown()).default({}),
});

const UpdateSchemaSchema = z.object({
  name:       z.string().min(1).max(120).optional(),
  definition: z.record(z.unknown()).optional(),
});

// ── Migrations ────────────────────────────────────────────────────────────────

const CreateMigrationSchema = z.object({
  projectId: z.string().uuid(),
  name:      z.string().min(1).max(200),
  sql:       z.string().min(1),
  env:       z.enum(['dev', 'staging', 'preview', 'production']).default('dev'),
});

const ApplyMigrationSchema = z.object({
  env:        z.enum(['dev', 'staging', 'preview', 'production']),
  approvalId: z.string().uuid().optional(),
});

export async function dbRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── Admin: migration introspection + manual re-run ────────────────────────
  // Surfaces the boot-time runMigrations() outcome + lets an admin re-run on
  // demand without a redeploy. Designed to diagnose "why didn't column X
  // exist" without scraping container logs.

  /** GET /api/admin/migrations — return last runMigrations() report + key
   *  schema probes (does is_shared exist on projects?). Admin-only. */
  app.get('/api/admin/migrations', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'admin');

    const report = getLastMigrationsReport();
    const sql = getRawSql();
    let appliedRows: Array<{ id: string; applied_at: string }> = [];
    let probeIsShared = 'unknown';
    let probeMigrationsTable = 'unknown';
    try {
      appliedRows = await sql.unsafe(
        `SELECT id, applied_at FROM "_migrations" ORDER BY applied_at`,
      ) as Array<{ id: string; applied_at: string }>;
      probeMigrationsTable = 'present';
    } catch (err) {
      probeMigrationsTable = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
    try {
      const cols = await sql.unsafe(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'is_shared'`,
      ) as Array<{ column_name: string }>;
      probeIsShared = cols.length > 0 ? 'present' : 'missing';
    } catch (err) {
      probeIsShared = `error: ${err instanceof Error ? err.message : String(err)}`;
    }

    return {
      lastBootReport: report,
      tracker:        { table: probeMigrationsTable, applied: appliedRows },
      probes:         { 'projects.is_shared': probeIsShared },
    };
  });

  /** POST /api/admin/migrations/run — re-run runMigrations() and return fresh
   *  report. Idempotent (already-applied are skipped). Admin-only. */
  app.post('/api/admin/migrations/run', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'admin');

    try {
      await runMigrations();
    } catch (err) {
      // Don't fail the request — the report has the error too. Caller still
      // wants to see the snapshot to diagnose.
      // eslint-disable-next-line no-console
      console.error('[admin/migrations/run] threw:', err instanceof Error ? err.message : String(err));
    }

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'migrations.run', target: 'platform', targetId: undefined,
      env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.send({ report: getLastMigrationsReport() });
  });

  // ── Schema endpoints ──────────────────────────────────────────────────────

  /** GET /api/schemas?projectId=… */
  app.get<{ Querystring: { projectId?: string } }>('/api/schemas', async (req, reply) => {
    const ctx = req.authCtx!;
    if (!req.query.projectId) return reply.status(400).send({ error: 'projectId required' });

    const db = getDb();
    const rows = await db
      .select()
      .from(schemas)
      .where(and(eq(schemas.projectId, req.query.projectId), eq(schemas.tenantId, ctx.tenantId)));
    return { schemas: rows };
  });

  /** POST /api/schemas — create a schema definition */
  app.post<{ Body: unknown }>('/api/schemas', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = CreateSchemaSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    const db = getDb();
    const [row] = await db.insert(schemas).values({
      projectId:  parsed.data.projectId,
      tenantId:   ctx.tenantId,
      name:       parsed.data.name,
      definition: parsed.data.definition,
    }).returning();

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'schema.create', target: 'schema', targetId: row?.id,
      after: { name: parsed.data.name }, env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.status(201).send({ schema: row });
  });

  /** PATCH /api/schemas/:id */
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/schemas/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = UpdateSchemaSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    const db = getDb();
    const [row] = await db
      .update(schemas)
      .set(parsed.data)
      .where(and(eq(schemas.id, req.params.id), eq(schemas.tenantId, ctx.tenantId)))
      .returning();

    if (!row) return reply.status(404).send({ error: 'Schema not found' });

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'schema.update', target: 'schema', targetId: req.params.id,
      after: parsed.data, env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.send({ schema: row });
  });

  /** DELETE /api/schemas/:id */
  app.delete<{ Params: { id: string } }>('/api/schemas/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'admin');

    const db = getDb();
    const [row] = await db
      .delete(schemas)
      .where(and(eq(schemas.id, req.params.id), eq(schemas.tenantId, ctx.tenantId)))
      .returning({ id: schemas.id });

    if (!row) return reply.status(404).send({ error: 'Schema not found' });

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'schema.delete', target: 'schema', targetId: req.params.id,
      env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.send({ ok: true });
  });

  // ── Migration endpoints ───────────────────────────────────────────────────

  /** GET /api/migrations?projectId=… — list migrations (all envs) */
  app.get<{ Querystring: { projectId?: string } }>('/api/migrations', async (req, reply) => {
    const ctx = req.authCtx!;
    if (!req.query.projectId) return reply.status(400).send({ error: 'projectId required' });

    const db = getDb();
    const rows = await db
      .select()
      .from(migrations)
      .where(and(eq(migrations.projectId, req.query.projectId), eq(migrations.tenantId, ctx.tenantId)))
      .orderBy(desc(migrations.createdAt));
    return { migrations: rows };
  });

  /** POST /api/migrations — register a migration SQL */
  app.post<{ Body: unknown }>('/api/migrations', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = CreateMigrationSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    const db = getDb();
    const [row] = await db.insert(migrations).values({
      projectId: parsed.data.projectId,
      tenantId:  ctx.tenantId,
      name:      parsed.data.name,
      sql:       parsed.data.sql,
      env:       parsed.data.env,
      status:    'pending',
    }).returning();

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'migration.create', target: 'migration', targetId: row?.id,
      after: { name: parsed.data.name, env: parsed.data.env },
      env: parsed.data.env, ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.status(201).send({ migration: row });
  });

  /** POST /api/migrations/:id/preview — return the SQL without applying */
  app.post<{ Params: { id: string } }>('/api/migrations/:id/preview', async (req, reply) => {
    const ctx = req.authCtx!;

    const db = getDb();
    const [row] = await db
      .select()
      .from(migrations)
      .where(and(eq(migrations.id, req.params.id), eq(migrations.tenantId, ctx.tenantId)))
      .limit(1);

    if (!row) return reply.status(404).send({ error: 'Migration not found' });
    return reply.send({ sql: row.sql, name: row.name, env: row.env, status: row.status });
  });

  /** POST /api/migrations/:id/apply — apply migration to an environment */
  app.post<{ Params: { id: string }; Body: unknown }>('/api/migrations/:id/apply', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = ApplyMigrationSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    // Staging + production require approval — validated server-side (UI bypass → 403)
    if (parsed.data.env === 'staging' || parsed.data.env === 'production') {
      if (!parsed.data.approvalId) {
        return reply.status(403).send({
          error: `Applying migrations to ${parsed.data.env} requires an approved action.`,
          requiresApproval: true,
          action: `migration.apply.${parsed.data.env}`,
          env: parsed.data.env,
        });
      }
      const validation = await validateApproval(parsed.data.approvalId, {
        tenantId:  ctx.tenantId,
        projectId: (req.body as Record<string, string>)['projectId'] ?? '',
        action:    `migration.apply.${parsed.data.env}` as 'migration.apply.staging',
      });
      if (!validation.valid) {
        return reply.status(403).send({ error: `Approval invalid: ${validation.reason}` });
      }
    }

    const db = getDb();
    const [migration] = await db
      .select()
      .from(migrations)
      .where(and(eq(migrations.id, req.params.id), eq(migrations.tenantId, ctx.tenantId)))
      .limit(1);

    if (!migration) return reply.status(404).send({ error: 'Migration not found' });
    if (migration.status === 'applied') return reply.status(409).send({ error: 'Migration already applied' });

    // TODO: Actually execute against the project's target database connection.
    // For now, mark as applied (real execution wired in Step 9 db.migrate tool).
    const [updated] = await db
      .update(migrations)
      .set({
        status:     'applied',
        appliedAt:  new Date(),
        appliedBy:  ctx.userId,
        approvalId: parsed.data.approvalId ?? null,
      })
      .where(and(eq(migrations.id, req.params.id), eq(migrations.tenantId, ctx.tenantId)))
      .returning();

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'migration.apply', target: 'migration', targetId: req.params.id,
      after: { env: parsed.data.env, status: 'applied' },
      approvalId: parsed.data.approvalId,
      env: parsed.data.env, ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.send({ ok: true, migration: updated });
  });

  /** POST /api/migrations/:id/rollback — mark a migration rolled back */
  app.post<{ Params: { id: string } }>('/api/migrations/:id/rollback', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'admin');

    const db = getDb();
    const [row] = await db
      .update(migrations)
      .set({ status: 'rolled_back' })
      .where(and(eq(migrations.id, req.params.id), eq(migrations.tenantId, ctx.tenantId)))
      .returning({ id: migrations.id });

    if (!row) return reply.status(404).send({ error: 'Migration not found' });

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'migration.rollback', target: 'migration', targetId: req.params.id,
      env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.send({ ok: true });
  });
}
