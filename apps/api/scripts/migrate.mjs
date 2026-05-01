#!/usr/bin/env node
// apps/api/scripts/migrate.mjs — applies SQL files in packages/db/migrations/ in lexical order.
//
// Usage: node apps/api/scripts/migrate.mjs   (or `pnpm db:migrate` from repo root)
//
// Reads DATABASE_URL from apps/api/.env. Tracks applied migrations in a `_migrations`
// table (created on first run). Idempotent: safe to re-run; only applies pending files.
//
// Requires the connecting user to have CREATE/USAGE on schema public. The one-time
// SQL block in HANDOFF_2026-04-30.md grants that to abw_app, after which this script
// can apply all future migrations without manual paste-into-Supabase.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname     = dirname(fileURLToPath(import.meta.url));
const apiRoot       = resolve(__dirname, '..');
const repoRoot      = resolve(apiRoot, '..', '..');
const migrationsDir = join(repoRoot, 'packages', 'db', 'migrations');
const envFile       = join(apiRoot, '.env');

// ── Load DATABASE_URL from apps/api/.env (no dotenv dep needed) ─────────────────
function loadEnv() {
  if (process.env.DATABASE_URL) return;
  if (!existsSync(envFile)) {
    console.error(`✗ No .env at ${envFile} and DATABASE_URL not in process.env`);
    process.exit(1);
  }
  const text = readFileSync(envFile, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

loadEnv();

if (!process.env.DATABASE_URL) {
  console.error('✗ DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  connect_timeout: 30,
  max: 1,
});

async function main() {
  console.log(`→ Connecting to database…`);
  const [{ current_user }] = await sql`SELECT current_user`;
  console.log(`  Connected as: ${current_user}`);

  // Ensure tracking table
  await sql`
    CREATE TABLE IF NOT EXISTS "_migrations" (
      "name"       text PRIMARY KEY,
      "applied_at" timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql`SELECT name FROM _migrations`).map(r => r.name),
  );

  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  ⏭  ${file} (already applied)`);
      continue;
    }
    console.log(`→ Applying ${file}…`);
    const content = readFileSync(join(migrationsDir, file), 'utf8');
    try {
      await sql.begin(async tx => {
        await tx.unsafe(content);
        await tx`INSERT INTO _migrations (name) VALUES (${file})`;
      });
      console.log(`  ✓ ${file} applied`);
      count++;
    } catch (err) {
      console.error(`  ✗ ${file} failed:`, err.message);
      if (err.detail) console.error(`    Detail: ${err.detail}`);
      if (err.hint)   console.error(`    Hint:   ${err.hint}`);
      throw err;
    }
  }

  if (count === 0) {
    console.log(`✓ No pending migrations.`);
  } else {
    console.log(`✓ Applied ${count} migration${count === 1 ? '' : 's'}.`);
  }
}

main()
  .then(() => sql.end())
  .catch(async err => {
    console.error('Migration failed:', err.message ?? err);
    await sql.end().catch(() => {});
    process.exit(1);
  });
