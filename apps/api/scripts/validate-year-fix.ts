// One-shot check that applyYearFixes catches the patterns we promised and
// leaves JSX expressions alone. Sets fake env before importing so the
// dynamic import doesn't trip env.ts validation. Delete after the round
// merges.
/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

// Set required env vars BEFORE importing polish (which transitively imports
// workspace.ts → env.ts). The values don't matter for a regex check.
process.env.SUPABASE_URL              ??= 'http://stub';
process.env.SUPABASE_ANON_KEY         ??= 'stub';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'stub';
process.env.SUPABASE_JWT_SECRET       ??= 'stub';
process.env.VAULT_MASTER_KEY          ??= 'stub-stub-stub-stub-stub-stub-stub-stub';

async function main(): Promise<void> {
  const { applyYearFixes } = await import('../src/agent/phases/polish');

  const cases: Array<{ input: string; expected: string; note: string }> = [
    // Should rewrite
    { input: '© 2024',                       expected: '© 2026',                       note: '© + year' },
    { input: '© 2024 Acme Corp',             expected: '© 2026 Acme Corp',             note: '© + year + name' },
    { input: '&copy; 2024',                  expected: '&copy; 2026',                  note: 'html entity' },
    { input: '(c) 2024',                     expected: '(c) 2026',                     note: 'paren-c' },
    { input: 'Copyright 2024',               expected: 'Copyright © 2026',             note: 'word form' },
    { input: 'Copyright © 2024',             expected: 'Copyright © 2026',             note: 'word + ©' },
    { input: '© 2020 - 2024',                expected: '© 2020 - 2026',                note: 'range (ascii dash)' },
    { input: '© 2020-2024',                  expected: '© 2020-2026',                  note: 'range (tight ascii)' },
    { input: '© 2020 – 2024',                expected: '© 2020 – 2026',                note: 'range (en dash)' },
    // Should NOT touch
    { input: 'Footer © {currentYear}',                   expected: 'Footer © {currentYear}',                   note: 'JSX expr — leave alone' },
    { input: '© {new Date().getFullYear()}',             expected: '© {new Date().getFullYear()}',             note: 'JSX inline date — leave alone' },
    { input: 'founded in 2024',                          expected: 'founded in 2024',                          note: 'body copy without © — leave alone' },
  ];

  let fail = 0;
  for (const c of cases) {
    const got = applyYearFixes(c.input, 2026);
    if (got === c.expected) {
      console.log(`OK  ${c.note} → ${JSON.stringify(got)}`);
    } else {
      fail++;
      console.error(`FAIL ${c.note}\n  input:    ${JSON.stringify(c.input)}\n  expected: ${JSON.stringify(c.expected)}\n  got:      ${JSON.stringify(got)}`);
    }
  }
  if (fail > 0) { console.error(`\n${fail} failure(s).`); process.exit(1); }
  console.log('\nAll year-fix cases pass.');
}
void main();
