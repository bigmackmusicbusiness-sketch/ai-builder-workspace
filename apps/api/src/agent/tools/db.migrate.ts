// apps/api/src/agent/tools/db.migrate.ts — apply a migration (dev env only without approval).
// Allowed roles: backend.
import type { z } from 'zod';
import { DbMigrateInput, DbMigrateOutput } from '@abw/agent-core';
import { getDb } from '../../db/client';
import { migrations } from '@abw/db';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { writeAuditEvent } from '../../security/audit';

export type DbMigrateInputType  = z.infer<typeof DbMigrateInput>;
export type DbMigrateOutputType = z.infer<typeof DbMigrateOutput>;

export async function dbMigrate(
  input: DbMigrateInputType,
  ctx: { tenantId: string; actorId: string; runId: string },
): Promise<DbMigrateOutputType> {
  const db = getDb();
  const start = Date.now();

  const [migration] = await db
    .select()
    .from(migrations)
    .where(and(eq(migrations.id, input.migrationId), eq(migrations.tenantId, ctx.tenantId)))
    .limit(1);

  if (!migration) {
    throw new Error(`db.migrate: migration ${input.migrationId} not found`);
  }
  if (migration.status === 'applied') {
    throw new Error(`db.migrate: migration ${input.migrationId} already applied`);
  }
  if (migration.env !== 'dev') {
    throw new Error(`db.migrate: tool only allowed in dev; ${migration.env} requires approval`);
  }

  // Execute the migration SQL (against the platform DB for now; Step 13 wires per-project DB)
  await db.execute(sql.raw(migration.sql));

  const appliedAt = new Date();
  await db
    .update(migrations)
    .set({ status: 'applied', appliedAt, appliedBy: ctx.actorId })
    .where(eq(migrations.id, input.migrationId));

  await writeAuditEvent({
    actor:    ctx.actorId,
    tenantId: ctx.tenantId,
    action:   'agent.db_migrate',
    target:   'migration',
    targetId: input.migrationId,
    after:    { status: 'applied', env: input.env },
    runId:    ctx.runId,
    env:      'dev',
  });

  return { ok: true, appliedAt: appliedAt.toISOString(), durationMs: Date.now() - start };
}
