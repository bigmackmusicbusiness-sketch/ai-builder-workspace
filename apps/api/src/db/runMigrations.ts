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
  {
    // 2026-05 Ads Studio launch: backing table for image/video/carousel
    // ad creatives + the placement & kind enums. Schema mirrors
    // packages/db/schema/backend.ts (adCreatives). The table is intentionally
    // tenant-scoped with a nullable project_id so a user can produce a
    // "library" ad before scaffolding a target project — same pattern as
    // assets (assets.project_id was made nullable in migration 0006).
    id: '0013_ad_creatives',
    sql: `
      DO $$ BEGIN
        CREATE TYPE "ad_kind" AS ENUM ('image', 'video', 'carousel');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE "ad_placement" AS ENUM ('feed', 'stories', 'reels', 'marketplace');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE IF NOT EXISTS "ad_creatives" (
        "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id"      UUID NOT NULL REFERENCES "tenants"("id"),
        "project_id"     UUID REFERENCES "projects"("id"),
        "kind"           ad_kind NOT NULL,
        "placement"      ad_placement NOT NULL DEFAULT 'feed',
        "aspect_ratio"   TEXT NOT NULL,
        "headline"       TEXT NOT NULL DEFAULT '',
        "primary_text"   TEXT NOT NULL DEFAULT '',
        "description"    TEXT NOT NULL DEFAULT '',
        "call_to_action" TEXT NOT NULL DEFAULT 'Learn More',
        "asset_id"       UUID REFERENCES "assets"("id"),
        "extra"          JSONB NOT NULL DEFAULT '{}'::jsonb,
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"     TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS "ad_creatives_tenant_idx"  ON "ad_creatives" ("tenant_id");
      CREATE INDEX IF NOT EXISTS "ad_creatives_project_idx" ON "ad_creatives" ("project_id");
      CREATE INDEX IF NOT EXISTS "ad_creatives_kind_idx"    ON "ad_creatives" ("kind");
    `,
  },
  {
    // Found during the bug-test sweep: two `mountain-peak-bakery` rows
    // existed in the same tenant. Slug is used for routing
    // (/api/published/<slug>/, the workspace path on disk, the customHost
    // lookup) so duplicates create silent ambiguity. Enforce uniqueness
    // per-tenant at the DB level. App-level check in POST /api/projects
    // is the friendly 409 — this is defense-in-depth.
    id: '0012_projects_slug_unique_per_tenant',
    sql: `
      -- Best-effort dedupe: if a tenant has multiple rows with the same
      -- slug, soft-delete all but the OLDEST so the index can be created.
      -- Rare in practice; was hit during testing only.
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY tenant_id, slug
                 ORDER BY created_at ASC
               ) AS rn
        FROM projects
        WHERE deleted_at IS NULL
      )
      UPDATE projects
      SET deleted_at = now()
      FROM ranked
      WHERE projects.id = ranked.id AND ranked.rn > 1;

      CREATE UNIQUE INDEX IF NOT EXISTS projects_tenant_slug_uniq_idx
        ON projects (tenant_id, slug)
        WHERE deleted_at IS NULL;
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

      // Two-phase apply so a permission-denied on the tracker INSERT
      // doesn't spuriously mark a migration as failed when the actual
      // DDL succeeded (we've seen 42501 on _migrations on this DB —
      // service-role can run DDL but not INSERT into the renamed-broken
      // table's namespace). Migration DDL is always idempotent
      // (IF NOT EXISTS / IF EXISTS guards), so re-running on next boot
      // is safe regardless of whether the tracker write lands.

      // Phase 1 — DDL
      let ddlError: { msg: string; code: string } | null = null;
      try {
        await sql.unsafe(m.sql);
      } catch (err) {
        ddlError = {
          msg:  err instanceof Error ? err.message : String(err),
          code: (err as { code?: string })?.code ?? '',
        };
      }
      if (ddlError) {
        // eslint-disable-next-line no-console
        console.error(`[migrations] ✗ ${m.id} DDL FAILED (${ddlError.code}): ${ddlError.msg}`);
        outcomes.push({ id: m.id, status: 'failed', errorCode: ddlError.code, errorMsg: ddlError.msg });
        continue;
      }

      // Phase 2 — tracker INSERT (best-effort; permission denied is logged
      // as a warning and the migration is still reported applied, since the
      // DDL just succeeded)
      try {
        await sql`INSERT INTO "_migrations" ("id") VALUES (${m.id}) ON CONFLICT DO NOTHING`;
        // eslint-disable-next-line no-console
        console.log(`[migrations] ✓ ${m.id} applied`);
        outcomes.push({ id: m.id, status: 'applied' });
      } catch (trackErr) {
        const msg  = trackErr instanceof Error ? trackErr.message : String(trackErr);
        const code = (trackErr as { code?: string })?.code ?? '';
        // eslint-disable-next-line no-console
        console.warn(`[migrations] ✓ ${m.id} DDL applied — tracker INSERT skipped (${code}): ${msg}`);
        outcomes.push({
          id:        m.id,
          status:    'applied',
          errorCode: code,
          errorMsg:  `DDL succeeded; tracker INSERT skipped (${msg}). Migration will re-run on next boot — DDL is idempotent.`,
        });
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
