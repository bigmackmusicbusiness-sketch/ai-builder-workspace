// Verify the new generateHiggsfieldMedia helper works as the agent tool +
// orchestrator now use it. ONE cheap image gen — sparing.
import postgres from 'postgres';
import { initDb } from '../src/db/client';
import { generateHiggsfieldMedia, listHiggsfieldModels, pickHiggsfieldModel } from '../src/providers/higgsfield';

async function main(): Promise<void> {
  await initDb();
  const sql = postgres(process.env['DATABASE_URL']!, { ssl: 'require', max: 1 });
  const t = await sql`SELECT tenant_id FROM secret_metadata WHERE name='HIGGSFIELD_OAUTH_TOKENS' AND env='dev' LIMIT 1`;
  await sql.end();
  const tenantId = t[0]!.tenant_id as string;

  console.log('Listing models via cached helper…');
  const models = await listHiggsfieldModels(tenantId, 'dev');
  console.log(`  ✓ ${models.length} models cached`);
  console.log(`  → Pick image (standard): ${pickHiggsfieldModel(models, 'image', 'standard')}`);
  console.log(`  → Pick video (standard): ${pickHiggsfieldModel(models, 'video', 'standard')}`);
  console.log(`  → Pick image (draft):    ${pickHiggsfieldModel(models, 'image', 'draft')}`);
  console.log(`  → Pick video (premium):  ${pickHiggsfieldModel(models, 'video', 'premium')}`);

  console.log('\nGenerating one cheap test image (proves agent + orchestrator paths)…');
  const t0 = Date.now();
  const media = await generateHiggsfieldMedia({
    tenantId,
    kind:        'image',
    prompt:      'A single black queen chess piece on a marble surface, studio lighting, hero shot',
    quality:     'draft',
    aspectRatio: '1:1',
  });
  if (!media) {
    console.log('✗ Helper returned null');
    process.exit(1);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ✓ ${media.mimeType} (${(media.buffer.length / 1024).toFixed(0)} KB) in ${elapsed}s via ${media.modelUsed}`);
  console.log(`    Source URL: ${media.sourceUrl}`);
  process.exit(0);
}

main().catch((e) => { console.error('✗', e); process.exit(1); });
