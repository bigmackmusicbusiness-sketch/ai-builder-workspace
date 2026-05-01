// Run: node --import tsx --env-file=.env scripts/probe-minimax.mjs
import postgres from 'postgres';
const minimaxModule = await import('../src/providers/minimax.ts');
const createMinimaxAdapter = minimaxModule.createMinimaxAdapter;

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });
const t = await sql`SELECT tenant_id FROM secret_metadata WHERE name='MINIMAX' LIMIT 1`;
const tenantId = t[0]?.tenant_id;
await sql.end();
console.log('tenantId:', tenantId);

const adapter = createMinimaxAdapter(tenantId, 'dev');
const prompt = 'Write Chapter 1 of a book about choosing a doorknob. Title: "Understanding Door Hardware Basics". Target: 300 words. Return only the chapter prose, no headings, no commentary.';

for (const cfg of [
  { model: 'MiniMax-M2.7',           maxTokens: 600,  label: 'thinking @ 600 (current bug)' },
  { model: 'MiniMax-M2.7-highspeed', maxTokens: 600,  label: 'highspeed @ 600' },
  { model: 'MiniMax-M2.7-highspeed', maxTokens: 2000, label: 'highspeed @ 2000' },
]) {
  process.stdout.write(`\n[${cfg.label}] `);
  try {
    const r = await adapter.complete({ prompt, model: cfg.model, maxTokens: cfg.maxTokens, temperature: 0.85 });
    console.log(`${r.text.length} chars in ${r.latencyMs}ms`);
    console.log(`  ${r.text.slice(0, 200).replace(/\n/g, ' / ')}…`);
  } catch (e) { console.log(`ERR: ${e.message.slice(0,100)}`); }
}
