#!/usr/bin/env node
// scripts/wire-niche-paths.mjs — patch agentInstructions on Tier 2 types to
// include nicheManifestPath now that niche libraries exist for them.
//
// Idempotent: skips types that already have nicheManifestPath set.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Types that should get nicheManifestPath set. Niche directories must exist.
const TYPES = [
  'internal-tool',
  'document',
  'music-studio',
  'automation-panel',
  'api-service',
  'onboarding-flow',
  'full-stack-app',
  'ai-movie',
  'ai-commercial',
  'ai-short',
  'ai-music-video',
];

let updated = 0;
let skipped = 0;

for (const typeId of TYPES) {
  const filePath = resolve(ROOT, 'packages', 'project-types', typeId, 'index.ts');
  const nicheDir = resolve(ROOT, 'apps', 'api', 'src', 'agent', 'skills', 'types', typeId, 'niches');

  if (!existsSync(filePath)) {
    console.log(`SKIP ${typeId}: project-type file missing`);
    skipped++;
    continue;
  }
  if (!existsSync(nicheDir)) {
    console.log(`SKIP ${typeId}: niche directory missing at ${nicheDir}`);
    skipped++;
    continue;
  }

  let src = readFileSync(filePath, 'utf8');
  if (src.includes('nicheManifestPath')) {
    console.log(`SKIP ${typeId}: nicheManifestPath already set`);
    skipped++;
    continue;
  }

  // Replace the empty block: `multiPageStrategy: {\n    },`
  const oldBlock = /multiPageStrategy:\s*\{\s*\},/;
  if (!oldBlock.test(src)) {
    console.log(`MISS ${typeId}: empty multiPageStrategy block not found`);
    skipped++;
    continue;
  }

  const newBlock = `multiPageStrategy: {
      nicheManifestPath: 'types/${typeId}/niches/',
      detectFromPrompt:  true,
    },`;

  src = src.replace(oldBlock, newBlock);
  writeFileSync(filePath, src, 'utf8');
  console.log(`✓ ${typeId} (niches at ${nicheDir})`);
  updated++;
}

console.log(`\nDone: ${updated} updated, ${skipped} skipped`);
