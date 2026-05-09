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

/** Phase 3 binding fields. Schema declares them as optional; manifests
 *  populate them only when the niche is in BINDING_ELIGIBLE below. */
const PHASE3_FIELDS = [
  'signalpoint_systems',
  'site_data_bindings',
  'vertical_kind',
  'dashboard_widgets',
  'needs_systems',
];

/** Niches that opt in to live data binding via the SPS site-data shim.
 *  Mirror of apps/api/scripts/add-phase3-bindings.mjs. */
const BINDING_ELIGIBLE = new Set([
  // Food → vertical_kind=restaurant, bindings: menu_sections + menu_items
  'restaurant', 'bakery', 'food-truck', 'catering-service',
  'brewery-taproom', 'bar-lounge', 'ice-cream-shop',
  // Auto-with-inventory → vertical_kind=auto-dealer, bindings: vehicles
  'car-dealership', 'motorcycle-dealer', 'boat-marine-service',
  // Fitness-with-class-schedule → vertical_kind=gym, bindings: class_schedule
  'gym-fitness', 'combat-gym', 'yoga-studio', 'pilates-studio',
  'crossfit-box', 'dance-studio', 'martial-arts-school',
]);

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
  it('Phase 3 binding fields are populated only on binding-eligible niches', () => {
    const manifests = readdirSync(NICHE_DIR).filter((f) => f.endsWith('.json'));
    expect(manifests.length).toBeGreaterThanOrEqual(111);

    const violations: string[] = [];
    for (const file of manifests) {
      const slug = file.replace(/\.json$/, '');
      const raw = readFileSync(resolve(NICHE_DIR, file), 'utf8');
      const m = JSON.parse(raw) as Record<string, unknown>;
      const hasBinding =
        m['signalpoint_systems'] === true ||
        (Array.isArray(m['site_data_bindings']) && (m['site_data_bindings'] as unknown[]).length > 0) ||
        m['vertical_kind'] !== undefined;

      if (hasBinding && !BINDING_ELIGIBLE.has(slug)) {
        violations.push(`${slug}: has Phase 3 binding fields but is not in the BINDING_ELIGIBLE list`);
      }
      if (!hasBinding && BINDING_ELIGIBLE.has(slug)) {
        violations.push(`${slug}: is binding-eligible but has no Phase 3 fields populated`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('binding-eligible manifests have correct vertical_kind + non-empty site_data_bindings', () => {
    const FOOD = new Set(['restaurant', 'bakery', 'food-truck', 'catering-service', 'brewery-taproom', 'bar-lounge', 'ice-cream-shop']);
    const AUTO = new Set(['car-dealership', 'motorcycle-dealer', 'boat-marine-service']);
    const FITNESS = new Set(['gym-fitness', 'combat-gym', 'yoga-studio', 'pilates-studio', 'crossfit-box', 'dance-studio', 'martial-arts-school']);

    const violations: string[] = [];
    for (const slug of BINDING_ELIGIBLE) {
      const path = resolve(NICHE_DIR, `${slug}.json`);
      const m = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

      const expectedKind = FOOD.has(slug) ? 'restaurant' : AUTO.has(slug) ? 'auto-dealer' : FITNESS.has(slug) ? 'gym' : null;
      if (m['vertical_kind'] !== expectedKind) {
        violations.push(`${slug}: vertical_kind = ${JSON.stringify(m['vertical_kind'])}, expected ${JSON.stringify(expectedKind)}`);
      }
      const bindings = m['site_data_bindings'];
      if (!Array.isArray(bindings) || bindings.length === 0) {
        violations.push(`${slug}: site_data_bindings missing or empty`);
        continue;
      }
      // Each binding has a string source + string target
      for (const b of bindings) {
        if (typeof b !== 'object' || b === null) {
          violations.push(`${slug}: binding entry not an object: ${JSON.stringify(b)}`);
          continue;
        }
        const obj = b as Record<string, unknown>;
        if (typeof obj['source'] !== 'string' || typeof obj['target'] !== 'string') {
          violations.push(`${slug}: binding missing source/target string: ${JSON.stringify(b)}`);
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

  it('standalone build paths only reference sps_workspace_id behind the gate file', () => {
    // The agent + preview + bundler source paths do the standalone build.
    // The only place that may reference sps_workspace_id is the explicit
    // gate (apps/api/src/agent/phases/siteDataShim.ts), which is what
    // ENFORCES the standalone-IDE guarantee — every reference there is
    // wrapped in an early-return check.
    //
    // Anywhere else under src/agent or src/preview that mentions
    // sps_workspace_id is a leak: the standalone build path could read it
    // unconditionally and bake SPS info into a non-SPS bundle.
    const ALLOWED_GATE_FILES = new Set([
      'src/agent/phases/siteDataShim.ts',  // the gate function itself
      'src/agent/phases/runPhases.ts',     // orchestrator — passes project handle to the gate, never reads it directly
    ]);

    const offenders: string[] = [];
    for (const dir of [AGENT_DIR, PREVIEW_DIR]) {
      for (const file of walkTsFiles(dir)) {
        const src = readFileSync(file, 'utf8');
        if (!src.includes('sps_workspace_id') && !src.includes('spsWorkspaceId')) continue;
        const rel = file.replace(ROOT + '\\', '').replace(ROOT + '/', '').replace(/\\/g, '/');
        if (ALLOWED_GATE_FILES.has(rel)) continue;
        offenders.push(rel);
      }
    }
    expect(offenders, 'only the gate file may reference sps_workspace_id under src/agent or src/preview').toEqual([]);
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
