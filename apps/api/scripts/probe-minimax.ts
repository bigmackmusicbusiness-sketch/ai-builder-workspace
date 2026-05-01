// Probe MiniMax response sizes for the empty-prose bug.
// Run: node --import tsx --env-file=.env scripts/probe-minimax.ts
import postgres from 'postgres';
import { initDb } from '../src/db/client';
import { createMinimaxAdapter } from '../src/providers/minimax';
import { chapterDraftPrompt } from '../src/lib/literaryPrompts';

async function main(): Promise<void> {
  await initDb();
  const sql = postgres(process.env['DATABASE_URL']!, { ssl: 'require', max: 1 });
  const t = await sql`SELECT tenant_id FROM secret_metadata WHERE name='MINIMAX' LIMIT 1`;
  const tenantId = t[0]!.tenant_id as string;
  await sql.end();
  console.log('tenantId:', tenantId);

  const adapter = createMinimaxAdapter(tenantId, 'dev');

  // EXACT prompt the route uses (the literaryPrompts chapterDraftPrompt with full rules)
  const prompt = chapterDraftPrompt({
    bookTitle: 'How to pick a new door knob',
    genre: 'literary',
    pov: 'close_third',
    chapterNumber: 1,
    chapterTitle: 'Understanding Door Knob Types and Materials',
    chapterSummary: 'This chapter explains the variety of door knob designs—lever, knob, deadbolt—and the materials they are made from, such as brass, stainless steel, and zinc alloy. It helps readers identify which type suits their functional needs and aesthetic preferences, setting a foundation for informed decision-making.',
    targetWords: 300,
  });
  console.log('\nPrompt length:', prompt.length, 'chars');

  // Replicate the route's maxTokens calculation: min(4096, targetWords * 2) = 600 for 300-word target
  const cfgs = [
    { model: 'MiniMax-M2.5', maxTokens: 2000, label: 'NEW: M2.5 @ 2000 (route fix)' },
  ] as const;

  // Generate 3 chapter prose blocks at once (mirroring the route's loop)
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { buildEbookHtml, styleToTrim } = await import('../src/lib/ebookBuilder');
  const { renderHtmlToPdf } = await import('../src/lib/pdf');

  const chapters: { title: string; prose: string }[] = [];
  const chapterTitles = [
    'Understanding Door Knob Types and Materials',
    'Evaluating Style, Finish, and Compatibility',
    'Installation, Maintenance, and Making the Final Decision',
  ];
  for (let i = 0; i < chapterTitles.length; i++) {
    const title = chapterTitles[i]!;
    const prompt = (await import('../src/lib/literaryPrompts')).chapterDraftPrompt({
      bookTitle: 'How to pick a new door knob',
      genre: 'literary',
      pov: 'close_third',
      chapterNumber: i + 1,
      chapterTitle: title,
      chapterSummary: `Chapter ${i + 1} content for the door knob book.`,
      targetWords: 300,
    });
    process.stdout.write(`\n[Chapter ${i+1}] `);
    const r = await adapter.complete({ prompt, model: 'MiniMax-M2.5', maxTokens: 2000, temperature: 0.85 });
    console.log(`${r.text.length} chars in ${r.latencyMs}ms`);
    chapters.push({ title, prose: r.text });
  }

  // Now run through buildEbookHtml + renderHtmlToPdf
  console.log('\n[building HTML + rendering PDF]');
  const html = buildEbookHtml({
    title: 'How to Pick a New Door Knob',
    subtitle: 'A Practical Guide',
    author: 'Test Author',
    style: 'lead_magnet',
    chapters,
  });
  const pdf = await renderHtmlToPdf({ html, format: styleToTrim('lead_magnet') });
  const outPath = path.join(process.cwd(), '.smoke-out', 'doorknob-full.pdf');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, pdf);
  console.log(`✓ PDF: ${(pdf.length/1024).toFixed(1)} KB → ${outPath}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
