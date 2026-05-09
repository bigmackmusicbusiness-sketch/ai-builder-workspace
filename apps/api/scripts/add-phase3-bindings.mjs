// add-phase3-bindings.mjs — one-shot script to add Phase 3 site_data_bindings
// to the 17 binding-eligible niche manifests. Run once during Phase 3 prep.
//
// Categories:
//   - Food (7): restaurant, bakery, food-truck, catering-service, brewery-
//     taproom, bar-lounge, ice-cream-shop → vertical_kind='restaurant',
//     bindings = menu_sections + menu_items
//   - Auto-with-inventory (3): car-dealership, motorcycle-dealer, boat-marine-
//     service → vertical_kind='auto-dealer', bindings = vehicles
//   - Fitness-with-class-schedule (7): gym-fitness, combat-gym, yoga-studio,
//     pilates-studio, crossfit-box, dance-studio, martial-arts-school →
//     vertical_kind='gym', bindings = class_schedule
//
// Idempotent: re-running on already-updated manifests is a no-op.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NICHE_DIR = resolve(HERE, '..', 'src/agent/skills/types/website/niches');

const FOOD = [
  'restaurant', 'bakery', 'food-truck', 'catering-service',
  'brewery-taproom', 'bar-lounge', 'ice-cream-shop',
];
const AUTO = ['car-dealership', 'motorcycle-dealer', 'boat-marine-service'];
const FITNESS = [
  'gym-fitness', 'combat-gym', 'yoga-studio', 'pilates-studio',
  'crossfit-box', 'dance-studio', 'martial-arts-school',
];

/** Phase 3 binding spec per category. */
function bindingSpec(slug) {
  if (FOOD.includes(slug)) {
    return {
      vertical_kind: 'restaurant',
      bindings: [
        { source: 'menu_sections', target: 'sections' },
        { source: 'menu_items',    target: 'menu' },
      ],
    };
  }
  if (AUTO.includes(slug)) {
    return {
      vertical_kind: 'auto-dealer',
      bindings: [
        { source: 'vehicles', target: 'inventory' },
      ],
    };
  }
  if (FITNESS.includes(slug)) {
    return {
      vertical_kind: 'gym',
      bindings: [
        { source: 'class_schedule', target: 'schedule' },
      ],
    };
  }
  return null;
}

const ELIGIBLE = new Set([...FOOD, ...AUTO, ...FITNESS]);
let updated = 0;
let skipped = 0;
let unchanged = 0;

for (const file of readdirSync(NICHE_DIR).sort()) {
  if (!file.endsWith('.json')) continue;
  const slug = file.replace(/\.json$/, '');
  if (!ELIGIBLE.has(slug)) {
    skipped++;
    continue;
  }
  const path = resolve(NICHE_DIR, file);
  const raw = readFileSync(path, 'utf8');
  const m = JSON.parse(raw);
  const spec = bindingSpec(slug);
  if (!spec) continue;

  // Idempotency check: skip if already populated correctly
  if (m.signalpoint_systems === true &&
      m.vertical_kind === spec.vertical_kind &&
      JSON.stringify(m.site_data_bindings) === JSON.stringify(spec.bindings)) {
    unchanged++;
    continue;
  }

  m.signalpoint_systems = true;
  m.vertical_kind       = spec.vertical_kind;
  m.site_data_bindings  = spec.bindings;

  // Preserve key ordering: write the new fields right after primary_keywords
  // by reconstructing the object in the canonical Phase-1 ordering.
  const out = {
    niche:               m.niche,
    label:               m.label,
    triggers:            m.triggers,
    default_sitemap:     m.default_sitemap,
    compliance_blocks:   m.compliance_blocks,
    schema_org_primary:  m.schema_org_primary,
    voice_template:      m.voice_template,
    palettes:            m.palettes,
    section_library:     m.section_library,
    image_directives:    m.image_directives,
    voice_pet_words:     m.voice_pet_words,
    primary_keywords:    m.primary_keywords,
    signalpoint_systems: m.signalpoint_systems,
    vertical_kind:       m.vertical_kind,
    site_data_bindings:  m.site_data_bindings,
  };
  // Strip any keys that came back undefined (manifests that didn't have all fields).
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];

  writeFileSync(path, JSON.stringify(out, null, 2) + '\n', 'utf8');
  updated++;
  console.log(`. ${slug} → ${spec.vertical_kind} (${spec.bindings.length} binding${spec.bindings.length === 1 ? '' : 's'})`);
}

console.log(`\n${updated} updated, ${unchanged} unchanged, ${skipped} skipped (out of ${updated + unchanged + skipped} total).`);
