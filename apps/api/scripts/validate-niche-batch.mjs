// validate-niche-batch.mjs — gates each niche batch before commit.
//
// Usage:
//   node scripts/validate-niche-batch.mjs <slug> <slug> ...
//
// Validates each manifest against the NicheManifest Zod schema (mirrored
// from apps/api/src/agent/phases/plan.ts) and runs the slop-blocker word
// list against voice_template, image_directives, AND the matching ad copy
// patterns in routes/ads/copyPatterns.ts.
//
// Exits 0 on full pass, 1 on any failure. Used during the 12-batch niche
// expansion to gate each commit.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(HERE, '..');

const NicheManifest = z.object({
  niche:               z.string(),
  label:               z.string(),
  triggers:            z.array(z.string()).min(1),
  default_sitemap:     z.array(z.object({ slug: z.string(), role: z.string() })).optional(),
  compliance_blocks:   z.array(z.string()).default([]),
  schema_org_primary:  z.string().optional(),
  voice_template:      z.string().optional(),
  palettes:            z.array(z.object({ name: z.string(), hexes: z.array(z.string()) })).default([]),
  section_library:     z.array(z.string()).default([]),
  image_directives:    z.string().optional(),
  voice_pet_words:     z.array(z.string()).optional(),
  primary_keywords:    z.array(z.string()).default([]),
}).passthrough();

const SLOP_PHRASES = [
  'amazing','incredible','awesome','world-class','cutting-edge','state-of-the-art',
  'next level','next-level','take it to the next','game-changing','game changing',
  'revolutionary','transform your business','transform your life','unlock your potential',
  'unleash','elevate your','one-stop shop','taking the world','best-in-class','industry-leading',
  'synergies','paradigm shift','click here',"don't miss out",'dont miss out',
  'limited time only','act now','so much more','and more!','just for you',
];

const slugs = process.argv.slice(2);
if (slugs.length === 0) {
  console.error('usage: node validate-niche-batch.mjs <slug> [<slug> ...]');
  process.exit(2);
}

const NICHE_DIR = resolve(API_ROOT, 'src/agent/skills/types/website/niches');
const COPY_PATH = resolve(API_ROOT, 'src/routes/ads/copyPatterns.ts');
const copyPatterns = readFileSync(COPY_PATH, 'utf8');

let errors = 0;

console.log('=== Manifest validation ===');
for (const slug of slugs) {
  let raw;
  try {
    raw = readFileSync(resolve(NICHE_DIR, `${slug}.json`), 'utf8');
  } catch {
    console.error(`X ${slug}: file missing`);
    errors++;
    continue;
  }
  const parsed = NicheManifest.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error(`X ${slug}: ${JSON.stringify(parsed.error.issues)}`);
    errors++;
    continue;
  }
  const text = `${parsed.data.voice_template ?? ''} ${parsed.data.image_directives ?? ''}`.toLowerCase();
  const hits = SLOP_PHRASES.filter((p) => text.includes(p.toLowerCase()));
  if (hits.length > 0) {
    console.error(`X ${slug} slop in voice/image_directives: ${hits.join(', ')}`);
    errors++;
    continue;
  }
  const badHex = parsed.data.palettes.flatMap((p) =>
    p.hexes.filter((h) => !/^#[0-9A-Fa-f]{6}$/.test(h) && !/^#[0-9A-Fa-f]{8}$/.test(h))
  );
  if (badHex.length > 0) {
    console.error(`X ${slug} invalid hex codes: ${badHex.join(', ')}`);
    errors++;
    continue;
  }
  console.log(`. ${slug} (${parsed.data.triggers.length} triggers, ${parsed.data.palettes.length} palettes, ${parsed.data.compliance_blocks.length} compliance blocks)`);
}

console.log('\n=== Ad copy slop check ===');
for (const slug of slugs) {
  const idx = copyPatterns.indexOf(`'${slug}': [`);
  if (idx < 0) {
    console.error(`X ${slug}: no ad copy block found in copyPatterns.ts`);
    errors++;
    continue;
  }
  const blockEnd = copyPatterns.indexOf('  ],', idx);
  const block = copyPatterns.slice(idx, blockEnd).toLowerCase();
  const hits = SLOP_PHRASES.filter((p) => block.includes(p.toLowerCase()));
  if (hits.length > 0) {
    console.error(`X ${slug} ad copy slop: ${hits.join(', ')}`);
    errors++;
  } else {
    console.log(`. ${slug} ad copy clean`);
  }
}

console.log(`\n${errors === 0 ? 'ALL PASS' : errors + ' errors'}`);
process.exit(errors > 0 ? 1 : 0);
