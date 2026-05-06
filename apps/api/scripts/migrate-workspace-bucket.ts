// apps/api/scripts/migrate-workspace-bucket.ts — one-shot migration.
//
// Move workspace text-file backups from the public `project-assets` bucket
// to the private `workspace-backups` bucket. Path layout is preserved:
//   project-assets/<tenantId>/workspaces/<slug>/<file>
//   →
//   workspace-backups/<tenantId>/workspaces/<slug>/<file>
//
// Then delete the workspaces/ prefix from project-assets so it stops being
// publicly readable.
//
// Run via: pnpm --filter @abw/api exec tsx scripts/migrate-workspace-bucket.ts
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Idempotent: re-running after partial failure resumes from where it left off.

import { createClient } from '@supabase/supabase-js';

const SRC_BUCKET = 'project-assets';
const DST_BUCKET = 'workspace-backups';

async function main(): Promise<void> {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env');
  }

  const supabase = createClient(url, key);

  // Ensure destination exists.
  // eslint-disable-next-line no-console
  console.log(`[migrate] ensuring "${DST_BUCKET}" exists…`);
  const { error: createErr } = await supabase.storage.createBucket(DST_BUCKET, { public: false });
  if (createErr && !/already exists|409/i.test(createErr.message)) {
    throw new Error(`Failed to create destination bucket: ${createErr.message}`);
  }

  // Walk every tenant folder under project-assets/. For each tenant, walk
  // their workspaces/ subdirectory, then each project, then each file.
  // Supabase storage list() is paginated; we use offset/limit to scan all.
  // eslint-disable-next-line no-console
  console.log(`[migrate] scanning "${SRC_BUCKET}" for workspace files…`);

  const { data: tenantDirs, error: rootErr } = await supabase.storage.from(SRC_BUCKET).list('', { limit: 1000 });
  if (rootErr) throw new Error(`List root failed: ${rootErr.message}`);
  if (!tenantDirs?.length) {
    // eslint-disable-next-line no-console
    console.log(`[migrate] source bucket is empty — nothing to do`);
    return;
  }

  let copied = 0;
  let deleted = 0;
  const failures: string[] = [];

  for (const tenant of tenantDirs) {
    if (!tenant.name) continue;
    const tenantId = tenant.name;
    const workspacesPrefix = `${tenantId}/workspaces`;

    const { data: projectDirs } = await supabase.storage.from(SRC_BUCKET).list(workspacesPrefix, { limit: 1000 });
    if (!projectDirs?.length) continue;

    for (const project of projectDirs) {
      if (!project.name) continue;
      const projectPrefix = `${workspacesPrefix}/${project.name}`;

      const { data: files } = await supabase.storage.from(SRC_BUCKET).list(projectPrefix, { limit: 1000 });
      if (!files?.length) continue;

      for (const f of files) {
        if (!f.name || f.name.endsWith('/')) continue;
        const srcPath = `${projectPrefix}/${f.name}`;
        const dstPath = srcPath; // same layout in the new bucket

        const { data: blob, error: dlErr } = await supabase.storage.from(SRC_BUCKET).download(srcPath);
        if (dlErr || !blob) { failures.push(`download ${srcPath}: ${dlErr?.message ?? 'no blob'}`); continue; }

        const { error: upErr } = await supabase.storage.from(DST_BUCKET).upload(dstPath, blob, {
          contentType: 'text/plain; charset=utf-8',
          upsert:      true,
        });
        if (upErr) { failures.push(`upload ${dstPath}: ${upErr.message}`); continue; }
        copied++;

        const { error: rmErr } = await supabase.storage.from(SRC_BUCKET).remove([srcPath]);
        if (rmErr) { failures.push(`delete ${srcPath}: ${rmErr.message}`); continue; }
        deleted++;
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[migrate] done. copied=${copied} deleted_from_src=${deleted} failures=${failures.length}`);
  if (failures.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[migrate] first 10 failures:\n${failures.slice(0, 10).join('\n')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[migrate] FAILED:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
