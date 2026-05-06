// apps/api/src/db/runMigrations.ts — auto-apply pending SQL migrations on api boot.
//
// Reads .sql files inlined as a string constant (esbuild bundles this file, so
// readdir from disk wouldn't work — the migrations dir isn't part of the bundle).
// Tracks applied migrations in a `_migrations` table so we never re-run.
//
// Idempotent: every migration in this list is written with IF NOT EXISTS / IF EXISTS
// guards so even if the tracker table is wiped, re-applying is a no-op.
//
// Failure policy: if a migration fails, log loudly but DO NOT crash the api.
// The endpoints have their own defensive fallbacks for missing columns.

import postgres from 'postgres';
import { lookup } from 'node:dns/promises';

/** Migrations applied by this runner. Each is keyed by id (filename slug) and
 *  carries inline SQL. To add a new migration, append a new entry here AND drop
 *  the matching .sql file in packages/db/migrations/ for reference. */
const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: '0008_project_sharing',
    sql: `
      -- Backfill created_by for any pre-existing rows so the visibility filter works.
      -- Picks the first admin user (lowest created_at) as the owner — this matches
      -- the user's "all private to creator" decision in the logic-update plan.
      UPDATE projects
      SET created_by = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1)
      WHERE created_by IS NULL;

      -- Add the is_shared column (default false = private to creator)
      ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE;

      -- Index for the (tenant, creator, sharing) filter combo
      CREATE INDEX IF NOT EXISTS projects_visibility_idx
        ON projects (tenant_id, created_by, is_shared);
    `,
  },
  {
    // B2 of the security plan: enable RLS on the three tables that hold the
    // most sensitive data and revoke direct access from anon/authenticated.
    // The api uses service-role for legitimate access (bypasses RLS); this
    // is defense-in-depth in case the service key leaks or a future code
    // path forgets to filter by tenant_id.
    id: '0010_rls_sensitive_tables',
    sql: `
      ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON "audit_events" FROM anon, authenticated;
      DROP POLICY IF EXISTS "audit_events_select_own_tenant" ON "audit_events";
      CREATE POLICY "audit_events_select_own_tenant" ON "audit_events"
        FOR SELECT
        TO authenticated
        USING (
          tenant_id = (
            coalesce(
              current_setting('request.jwt.claims', true)::json
                -> 'user_metadata' ->> 'tenant_id',
              ''
            )
          )::uuid
        );

      ALTER TABLE "secret_metadata" ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON "secret_metadata" FROM anon, authenticated;

      ALTER TABLE "secret_values" ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON "secret_values" FROM anon, authenticated;
    `,
  },
];

/** Diagnostic snapshot from the most recent runMigrations() call.
 *  Surfaced via GET /api/admin/migrations so we can see whether a migration
 *  applied, was skipped, or failed — without scraping container logs. */
export interface MigrationOutcome {
  id:        string;
  status:    'already-applied' | 'applied' | 'failed' | 'skipped';
  errorCode?: string;
  errorMsg?:  string;
}
export interface MigrationsReport {
  ranAt:     string;          // ISO timestamp of last runMigrations() call
  bootError?: string;          // top-level failure (e.g. DATABASE_URL missing)
  outcomes:  MigrationOutcome[];
}
let LAST_REPORT: MigrationsReport = { ranAt: 'never', outcomes: [] };
export function getLastMigrationsReport(): MigrationsReport {
  return LAST_REPORT;
}

/**
 * Apply all pending migrations. Safe to call repeatedly — already-applied
 * migrations are skipped via the `_migrations` tracker table.
 */
export async function runMigrations(): Promise<void> {
  const outcomes: MigrationOutcome[] = [];
  const ranAt    = new Date().toISOString();

  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    // eslint-disable-next-line no-console
    console.warn('[migrations] DATABASE_URL not set, skipping');
    LAST_REPORT = { ranAt, bootError: 'DATABASE_URL not set', outcomes };
    return;
  }

  // Use the same IPv4 + SNI dance as the main client (Railway can't route IPv6).
  const url = new URL(connectionString.replace(/^postgresql:\/\//, 'http://'));
  const hostname = url.hostname;
  let resolvedHost = hostname;
  try {
    const { address } = await lookup(hostname, { family: 4 });
    resolvedHost = address;
  } catch {
    resolvedHost = hostname;
  }

  const sql = postgres(connectionString, {
    max: 1,
    idle_timeout: 5,
    prepare: false,
    host: resolvedHost,
    ssl: { rejectUnauthorized: false, servername: hostname },
  });

  try {
    // Ensure tracker table exists with the expected (id, applied_at) shape.
    // CREATE TABLE IF NOT EXISTS is a no-op if the table is already there
    // with a DIFFERENT schema — and we've seen that happen on this DB
    // (probably a leftover from a prior migration runner). When the
    // expected `id` column is missing, drop and recreate so the rest of
    // the runner can proceed instead of erroring out at the first SELECT.
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "_migrations" (
        "id"          TEXT        PRIMARY KEY,
        "applied_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const cols = await sql.unsafe(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '_migrations'`,
    ) as Array<{ column_name: string }>;
    const colNames = new Set(cols.map((c) => c.column_name));
    if (!colNames.has('id') || !colNames.has('applied_at')) {
      // eslint-disable-next-line no-console
      console.warn(`[migrations] _migrations table has unexpected schema (cols=${[...colNames].join(',')}) — recreating`);
      await sql.unsafe(`ALTER TABLE "_migrations" RENAME TO "_migrations_broken_${Date.now()}"`);
      await sql.unsafe(`
        CREATE TABLE "_migrations" (
          "id"          TEXT        PRIMARY KEY,
          "applied_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
    }

    // Find which migrations are already applied.
    const applied = await sql<{ id: string }[]>`SELECT id FROM "_migrations"`;
    const appliedSet = new Set(applied.map((r) => r.id));

    for (const m of MIGRATIONS) {
      if (appliedSet.has(m.id)) {
        // eslint-disable-next-line no-console
        console.log(`[migrations] ${m.id} already applied, skipping`);
        outcomes.push({ id: m.id, status: 'already-applied' });
        continue;
      }

      // eslint-disable-next-line no-console
      console.log(`[migrations] applying ${m.id}…`);
      try {
        await sql.unsafe(m.sql);
        await sql`INSERT INTO "_migrations" ("id") VALUES (${m.id})`;
        // eslint-disable-next-line no-console
        console.log(`[migrations] ✓ ${m.id} applied`);
        outcomes.push({ id: m.id, status: 'applied' });
      } catch (err) {
        const msg  = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string })?.code ?? '';
        // eslint-disable-next-line no-console
        console.error(`[migrations] ✗ ${m.id} FAILED (${code}): ${msg}`);
        outcomes.push({ id: m.id, status: 'failed', errorCode: code, errorMsg: msg });
        // Don't insert into _migrations on failure — next boot retries.
        // Don't throw — let server start; defensive fallbacks in routes cover the gap.
      }
    }
    LAST_REPORT = { ranAt, outcomes };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    LAST_REPORT = { ranAt, bootError: msg, outcomes };
    throw err;
  } finally {
    await sql.end();
  }
}
