// Quick poll an existing Higgsfield job. Run:
//   node --import tsx --env-file=.env scripts/probe-job.ts <jobId>
import postgres from 'postgres';
import { initDb } from '../src/db/client';
import { openHiggsfield } from '../src/providers/higgsfield';

async function main(): Promise<void> {
  const jobId = process.argv[2];
  if (!jobId) { console.error('Usage: probe-job.ts <jobId>'); process.exit(1); }

  await initDb();
  const sql = postgres(process.env['DATABASE_URL']!, { ssl: 'require', max: 1 });
  const t = await sql`SELECT tenant_id FROM secret_metadata WHERE name='HIGGSFIELD_OAUTH_TOKENS' AND env='dev' ORDER BY last_rotated_at DESC LIMIT 1`;
  await sql.end();
  const tenantId = t[0]!.tenant_id as string;

  const c = await openHiggsfield(tenantId, 'dev');
  try {
    const r = await c.callTool('job_status', { jobId, sync: false });
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await c.close();
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
