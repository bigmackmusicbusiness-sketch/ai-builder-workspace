// apps/api/scripts/validate-logic-round.ts — one-shot validator for the
// 2026-05-11 logic-gap round. Confirms the 3 new niche manifests parse
// against the live Zod schema AND the 9 new ad-copy patterns pass the
// slop blocker. Delete after the round merges.
//
// Run: `pnpm --filter @abw/api exec tsx scripts/validate-logic-round.ts`

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NicheManifest } from '../src/agent/phases/plan';
import { COPY_PATTERNS } from '../src/routes/ads/copyPatterns';
import { checkAdCopyForSlop } from '../src/routes/ads/slopBlocker';

const NEW_NICHES = ['upholstery-cleaning', 'dryer-vent-cleaning', 'gutter-cleaning-maintenance'] as const;

async function main(): Promise<void> {
  let failed = 0;

  for (const slug of NEW_NICHES) {
    const path = resolve(__dirname, '..', 'src', 'agent', 'skills', 'types', 'website', 'niches', `${slug}.json`);
    const raw = JSON.parse(await readFile(path, 'utf8'));
    const result = NicheManifest.safeParse(raw);
    if (result.success) {
      // eslint-disable-next-line no-console
      console.log(`OK  ${slug}: Zod validation passed`);
    } else {
      failed++;
      // eslint-disable-next-line no-console
      console.error(`FAIL ${slug}: Zod validation failed`);
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(result.error.format(), null, 2));
    }
  }

  for (const slug of NEW_NICHES) {
    const patterns = COPY_PATTERNS[slug];
    if (!patterns) { console.error(`FAIL ${slug}: no copy patterns`); failed++; continue; }
    if (patterns.length !== 3) { console.error(`FAIL ${slug}: expected 3 patterns, got ${patterns.length}`); failed++; continue; }
    for (const p of patterns) {
      const slop = checkAdCopyForSlop({ headline: p.headline, primaryText: p.primary });
      if (slop.ok) {
        // eslint-disable-next-line no-console
        console.log(`OK  ${slug}/${p.framework}: slop blocker clean`);
      } else {
        failed++;
        // eslint-disable-next-line no-console
        console.error(`FAIL ${slug}/${p.framework}: ${slop.summary}`);
      }
    }
  }

  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed} failure(s).`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log('\nAll 3 manifests + 9 patterns pass.');
}

void main();
