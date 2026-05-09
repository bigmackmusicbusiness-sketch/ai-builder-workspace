// apps/api/tests/integration/standalone-regression.test.ts
//
// The standalone-IDE guarantee: ABW must continue to produce fully static
// HTML+Tailwind sites for any project that doesn't have a SignalPointSystems
// link. This test is the rule-keeper for Phase 2.5 — it verifies that the
// new SPS-handoff infrastructure is genuinely opt-in.
//
// What it checks (v1, static analysis — full bundle generation lands with
// Phase 3):
//
//   1. No niche manifest has site_data_bindings populated. Those are Phase 3
//      opt-in fields; until they ship, every manifest must be standalone.
//   2. The agent + preview + bundler source paths don't reference
//      sps_workspace_id at all. The column exists on the DB but the
//      standalone build path never reads it.
//   3. The NicheManifest Zod schema is exactly the pre-Phase-3 shape. When
//      Phase 3 adds the optional `signalpoint_systems` / `vertical_kind` /
//      `site_data_bindings` fields, this test will need to be updated AND a
//      bundle-generation test will need to assert the standalone bundle
//      contains zero `signalpoint` strings even when the schema knows about
//      those fields.
//
// Run with:  pnpm --filter @abw/api test:integration

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');               // apps/api
const NICHE_DIR = resolve(ROOT, 'src/agent/skills/types/website/niches');
const PLAN_FILE = resolve(ROOT, 'src/agent/phases/plan.ts');
const AGENT_DIR = resolve(ROOT, 'src/agent');
const PREVIEW_DIR = resolve(ROOT, 'src/preview');

/** Fields that Phase 3 will add to NicheManifest. None should appear in any
 *  manifest until that phase ships. */
const PHASE3_FIELDS = [
  'signalpoint_systems',
  'site_data_bindings',
  'vertical_kind',
  'dashboard_widgets',
  'needs_systems',
];

/** Recursively walk a directory and yield .ts file paths (skip node_modules,
 *  dist, anything starting with `.`). */
function* walkTsFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
    const full = resolve(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      yield* walkTsFiles(full);
    } else if (stat.isFile() && entry.endsWith('.ts')) {
      yield full;
    }
  }
}

describe('standalone-IDE guarantee — Phase 2.5 regression check', () => {
  it('every niche manifest is standalone (no Phase 3 binding fields populated)', () => {
    const manifests = readdirSync(NICHE_DIR).filter((f) => f.endsWith('.json'));
    expect(manifests.length).toBeGreaterThanOrEqual(111);

    const violations: string[] = [];
    for (const file of manifests) {
      const raw = readFileSync(resolve(NICHE_DIR, file), 'utf8');
      const m = JSON.parse(raw) as Record<string, unknown>;
      for (const field of PHASE3_FIELDS) {
        if (m[field] !== undefined && m[field] !== null) {
          violations.push(`${file}: has ${field} = ${JSON.stringify(m[field])}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('NicheManifest Zod schema in plan.ts declares Phase 3 fields as optional', () => {
    // 2026-05-09: Phase 3 schema extension shipped. The 5 fields are now
    // present as OPTIONAL in NicheManifest; the standalone path ignores
    // them. This assertion ensures they don't accidentally get removed
    // and ensures they stay optional (not required, which would break
    // the existing 111 manifests).
    const planSrc = readFileSync(PLAN_FILE, 'utf8');
    for (const field of PHASE3_FIELDS) {
      const rx = new RegExp(`^\\s*${field}:`, 'm');
      expect(rx.test(planSrc), `plan.ts must declare ${field}: in NicheManifest`).toBe(true);
    }
    // None of the Phase 3 fields are required (z.<type>().optional() form).
    // We grep for `<field>:.*\.optional\(\)` to confirm.
    for (const field of PHASE3_FIELDS) {
      const rx = new RegExp(`^\\s*${field}:.*\\.optional\\(\\)`, 'm');
      expect(rx.test(planSrc), `${field} must be declared as .optional()`).toBe(true);
    }
  });

  it('standalone build paths never reference sps_workspace_id', () => {
    // The agent + preview + bundler source paths do the standalone build.
    // None of them should ever read from the new column. The only places
    // that may reference it are the SPS handoff routes, which are dormant
    // for non-SPS projects.
    const offenders: string[] = [];
    for (const dir of [AGENT_DIR, PREVIEW_DIR]) {
      for (const file of walkTsFiles(dir)) {
        const src = readFileSync(file, 'utf8');
        if (src.includes('sps_workspace_id') || src.includes('spsWorkspaceId')) {
          offenders.push(file.replace(ROOT + '\\', '').replace(ROOT + '/', ''));
        }
      }
    }
    expect(offenders, 'standalone build paths must not reference sps_workspace_id').toEqual([]);
  });

  it('handoffToken module is server-only (no browser imports)', () => {
    // Verify it doesn't import anything that would pull it into the web bundle.
    const src = readFileSync(resolve(ROOT, 'src/security/handoffToken.ts'), 'utf8');
    expect(src).toContain("from 'node:crypto'");
    // Should not import any web-side modules
    expect(src).not.toContain("from 'react'");
    expect(src).not.toContain("from '@abw/ui'");
    expect(src).not.toContain("from 'next/");
  });
});
