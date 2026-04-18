// apps/api/src/agent/tools/db.query.ts — run SQL against a project's database.
// By default read-only (SELECT only). Allowed roles: planner (read-only), backend, fixer.
import type { z } from 'zod';
import { DbQueryInput, DbQueryOutput } from '@abw/agent-core';
import { getDb } from '../../db/client';
import { sql } from 'drizzle-orm';

export type DbQueryInputType  = z.infer<typeof DbQueryInput>;
export type DbQueryOutputType = z.infer<typeof DbQueryOutput>;

/** Rudimentary check that only SELECT statements are permitted in read-only mode. */
function isReadOnlyQuery(statement: string): boolean {
  const trimmed = statement.trim().toUpperCase();
  return (
    trimmed.startsWith('SELECT') ||
    trimmed.startsWith('WITH') ||   // CTEs that start with SELECT
    trimmed.startsWith('EXPLAIN')
  );
}

export async function dbQuery(input: DbQueryInputType): Promise<DbQueryOutputType> {
  if (input.readOnly && !isReadOnlyQuery(input.sql)) {
    throw Object.assign(
      new Error('db.query: non-SELECT statement blocked in read-only mode'),
      { code: 'READ_ONLY_VIOLATION' },
    );
  }

  // TODO: In production, connect to the PROJECT's database (not the platform DB).
  // The platform Drizzle client is used here as a temporary proxy.
  const db = getDb();
  const start = Date.now();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.execute(sql.raw(input.sql));
  const durationMs = Date.now() - start;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (result as any).rows ?? [];
  return { rows, rowCount: rows.length, durationMs };
}
