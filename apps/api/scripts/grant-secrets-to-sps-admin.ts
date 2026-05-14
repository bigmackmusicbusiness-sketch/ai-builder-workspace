// apps/api/scripts/grant-secrets-to-sps-admin.ts
//
// One-shot operator script: grant the SignalPoint Admin account (a.k.a. the
// SPS proxy user) the full set of platform secrets that another admin tenant
// already has. Solves the round-14.3 vault miss without needing the
// platform-key env-var fallback to be wired up in Coolify.
//
// What it does:
//   1. Find the "SignalPoint Admin" account by display name + email pattern.
//   2. Find the SOURCE tenant — by default the tenant with the most
//      secret_metadata rows (the operator's own tenant, populated via the
//      IDE's Env & Secrets screen).
//   3. For each (name, env) pair in SOURCE that is NOT already present in
//      the SignalPoint Admin tenant, INSERT a duplicate secret_metadata row
//      pointing at a fresh secret_values row carrying the SAME ciphertext
//      + nonce. The encryption key (VAULT_MASTER_KEY) is server-wide, so
//      the copied ciphertext decrypts identically regardless of tenant_id.
//
// Idempotent: re-running is safe. Rows that already exist in the dest
// tenant are left untouched (skipped, logged, no duplicate).
//
// Usage:
//   pnpm tsx apps/api/scripts/grant-secrets-to-sps-admin.ts            # apply
//   DRY_RUN=1 pnpm tsx apps/api/scripts/grant-secrets-to-sps-admin.ts  # preview only
//
// Requires (in apps/api/.env or shell env):
//   DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Never logs secret values — only counts + names. Safe to share output.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

// Tiny .env loader — picks up apps/api/.env so the script works without
// the user having to shell-export every secret. Same shape dotenv parses:
// `KEY=value`, ignores comments + blank lines, strips matching quotes.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    if (!key || process.env[key] !== undefined) continue;
    const trimmed = (raw ?? '').trim();
    const value = trimmed.replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

const DRY_RUN = process.env['DRY_RUN'] === '1' || process.argv.includes('--dry-run');

interface SecretMetaRow {
  id:         string;
  name:       string;
  scope:      string;
  env:        string;
  tenant_id:  string;
  project_id: string | null;
  owner_id:   string | null;
}

interface SecretValueRow {
  id:          string;
  metadata_id: string;
  ciphertext:  string;
  nonce:       string;
}

async function main(): Promise<void> {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceKey  = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const dbUrl       = process.env['DATABASE_URL'];
  if (!supabaseUrl || !serviceKey || !dbUrl) {
    throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DATABASE_URL all required.');
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const sql = postgres(dbUrl, { ssl: 'require', max: 4 });

  console.log(DRY_RUN ? '─── DRY RUN ─── (no writes)' : '─── APPLY ─── (writes will happen)');

  try {
    // ── 1. Find SignalPoint Admin's tenant_id ─────────────────────────
    const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
      page: 1, perPage: 1000,
    });
    if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);

    const candidates = list.users.filter((u) => {
      const email = (u.email ?? '').toLowerCase();
      const name  = (u.user_metadata?.['name'] ?? u.user_metadata?.['full_name'] ?? '').toLowerCase();
      return /signalpoint.*admin|sps.*admin|sps-handoff-proxy/.test(email + ' ' + name);
    });
    if (candidates.length === 0) {
      throw new Error('No user matching "SignalPoint Admin" / "sps-handoff-proxy" found.');
    }
    if (candidates.length > 1) {
      console.log('Multiple candidates found:');
      for (const c of candidates) {
        console.log(`  ${c.email} (id=${c.id}, tenant=${c.user_metadata?.['tenant_id']})`);
      }
      throw new Error('Resolve ambiguity manually; refusing to write.');
    }
    const adminUser = candidates[0]!;
    const adminTenantId = adminUser.user_metadata?.['tenant_id'] as string | undefined;
    if (!adminTenantId) {
      throw new Error(`SignalPoint Admin (${adminUser.email}) has no tenant_id in user_metadata.`);
    }
    console.log(`SignalPoint Admin: ${adminUser.email}`);
    console.log(`  auth uid:  ${adminUser.id}`);
    console.log(`  tenant_id: ${adminTenantId}`);

    // ── 2. Pick a source tenant — the non-admin tenant with the most secrets ─
    const sourceCandidates = await sql<{ tenant_id: string; secret_count: bigint }[]>`
      SELECT tenant_id, COUNT(*) AS secret_count
        FROM secret_metadata
       WHERE deleted_at IS NULL
         AND tenant_id != ${adminTenantId}
       GROUP BY tenant_id
       ORDER BY secret_count DESC
       LIMIT 5
    `;
    if (sourceCandidates.length === 0) {
      console.log('No source tenants with secrets to copy. Nothing to do.');
      return;
    }
    console.log('\nSource tenant candidates (most-secrets first):');
    for (const c of sourceCandidates) {
      console.log(`  tenant=${c.tenant_id}  secrets=${c.secret_count}`);
    }
    const sourceTenantId = sourceCandidates[0]!.tenant_id;
    console.log(`\nUsing source tenant: ${sourceTenantId}`);

    // ── 3. List all secrets in source tenant ──────────────────────────
    const sourceSecrets = await sql<SecretMetaRow[]>`
      SELECT id, name, scope, env, tenant_id, project_id, owner_id
        FROM secret_metadata
       WHERE tenant_id = ${sourceTenantId}
         AND deleted_at IS NULL
       ORDER BY name, env
    `;
    console.log(`\nFound ${sourceSecrets.length} secrets in source tenant.`);

    // ── 4. List what dest tenant already has ──────────────────────────
    const existingDest = await sql<{ name: string; env: string }[]>`
      SELECT name, env
        FROM secret_metadata
       WHERE tenant_id = ${adminTenantId}
         AND deleted_at IS NULL
    `;
    const destExisting = new Set(existingDest.map((r) => `${r.name}::${r.env}`));
    console.log(`Dest tenant already has ${existingDest.length} secrets — those will be skipped.`);

    // ── 5. Plan the copy ──────────────────────────────────────────────
    const toCopy: SecretMetaRow[] = sourceSecrets.filter(
      (s) => !destExisting.has(`${s.name}::${s.env}`),
    );
    console.log(`\nWill copy ${toCopy.length} secret(s) to dest tenant:`);
    for (const s of toCopy) console.log(`  + ${s.name} (env=${s.env}, scope=${s.scope})`);
    const skipped = sourceSecrets.length - toCopy.length;
    if (skipped > 0) {
      console.log(`  (${skipped} already in dest, skipped)`);
    }

    if (DRY_RUN) {
      console.log('\nDRY_RUN=1 — exiting without writing. Re-run without DRY_RUN to apply.');
      return;
    }
    if (toCopy.length === 0) {
      console.log('\nNothing to copy. Dest tenant already has every secret.');
      return;
    }

    // ── 6. Apply: for each, insert metadata + values inside a tx ──────
    let copied = 0;
    for (const src of toCopy) {
      await sql.begin(async (tx) => {
        // Look up the most-recent secret_values row for this metadata
        const [valRow] = await tx<SecretValueRow[]>`
          SELECT id, metadata_id, ciphertext, nonce
            FROM secret_values
           WHERE metadata_id = ${src.id}
           ORDER BY created_at DESC
           LIMIT 1
        `;
        if (!valRow) {
          console.log(`  skip ${src.name} (env=${src.env}): no value row — possibly soft-deleted`);
          return;
        }
        // Insert new metadata row pointing to admin tenant
        const [newMeta] = await tx<{ id: string }[]>`
          INSERT INTO secret_metadata (name, scope, env, tenant_id, project_id, owner_id, last_rotated_at)
          VALUES (${src.name}, ${src.scope}, ${src.env}, ${adminTenantId}, ${src.project_id}, ${src.owner_id}, NOW())
          RETURNING id
        `;
        if (!newMeta) throw new Error(`Insert returned no row for ${src.name}`);
        // Insert duplicate secret_values pointing at the new metadata
        await tx`
          INSERT INTO secret_values (metadata_id, ciphertext, nonce)
          VALUES (${newMeta.id}, ${valRow.ciphertext}, ${valRow.nonce})
        `;
        console.log(`  ✓ ${src.name} (env=${src.env})  →  new meta=${newMeta.id}`);
        copied++;
      });
    }
    console.log(`\nDone. Copied ${copied} secret(s) into tenant ${adminTenantId}.`);
    console.log('SPS-driven projects can now resolve MINIMAX_API_KEY (and the rest) via the same vaultGet path.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('grant-secrets-to-sps-admin: FAILED');
  console.error(err);
  process.exit(1);
});
