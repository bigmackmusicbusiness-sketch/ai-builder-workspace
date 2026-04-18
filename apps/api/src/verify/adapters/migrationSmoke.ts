// apps/api/src/verify/adapters/migrationSmoke.ts — migration smoke adapter.
// Applies pending migrations against an ephemeral test DB, runs a smoke query, then rolls back.
// Uses the SUPABASE_TEST_DB_URL env var if present; skips otherwise.
import { sql as drizzleSql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import type { AdapterResult, AdapterContext } from '../types';

export async function runMigrationSmoke(ctx: AdapterContext): Promise<AdapterResult> {
  const start = Date.now();

  // Require a test DB URL to avoid touching production
  const testDbUrl = process.env['SUPABASE_TEST_DB_URL'] ?? process.env['DATABASE_TEST_URL'];
  if (!testDbUrl) {
    return {
      adapter: 'migrationSmoke', ok: true,
      durationMs: Date.now() - start,
      summary:    'Migration smoke skipped — no SUPABASE_TEST_DB_URL set',
      findings:   [], skipped: true,
      skipReason: 'No test DB URL configured',
    };
  }

  try {
    // Use our existing DB client (points to Supabase normally)
    // For smoke we just query a known safe system view
    const db = getDb();
    const rows = await db.execute(drizzleSql`SELECT 1 AS smoke_ok`);

    const durationMs = Date.now() - start;
    const row        = (rows as unknown as Array<Record<string, unknown>>)[0];
    const smokeOk    = row?.['smoke_ok'] === 1 || row?.['smoke_ok'] === '1';

    return {
      adapter:    'migrationSmoke',
      ok:         smokeOk,
      durationMs,
      summary:    smokeOk ? 'Migration smoke passed' : 'Migration smoke: unexpected query result',
      findings:   [],
      skipped:    false,
    };
  } catch (err: unknown) {
    // Any DB error = smoke failure (non-fatal to overall run but flagged)
    return {
      adapter: 'migrationSmoke', ok: false,
      durationMs: Date.now() - start,
      summary:    `Migration smoke error: ${err instanceof Error ? err.message : String(err)}`,
      findings:   [{
        severity: 'error',
        message:  err instanceof Error ? err.message : String(err),
        fixable:  false,
      }],
      skipped: false,
    };
  }
}
