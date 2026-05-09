// packages/site-data/index.ts — Phase 3 site-data shim runtime.
//
// Generated ABW sites that bind to SignalPointSystems data import from here
// at runtime. The shim:
//
//   1. Reads `signalpoint-config.json` from the project bundle (written by
//      the publish flow when the workspace has an SPS link).
//   2. Constructs a workspace-scoped Supabase client with the
//      `x-workspace-id` header on every request.
//   3. Exposes typed read functions per binding: `getMenu()`, `getInventory()`,
//      `getSchedule()`, etc.
//   4. Caches results for the page lifecycle to avoid duplicate requests
//      from multiple template bindings.
//
// **Standalone-IDE guarantee:** this module is only injected into the
// bundle when the project has an SPS link AND the niche manifest has
// `site_data_bindings` populated. Standalone projects never see this code.
// The injection logic lives in apps/api/src/agent/phases/runPhases.ts.
//
// **v1 status:** typed skeleton with stub fetch implementations that return
// empty arrays. The real fetch path lands when SPS's signalpoint-config
// issuer endpoint is live (currently pending — see HANDOFF_NOTES.md round 3).
// Generated sites can already import the types and the shape is final;
// only the network calls swap from stubs to real `fetch()` calls in v2.

import type {
  BindingResultMap,
  ClassScheduleEntry,
  MenuItem,
  MenuSection,
  SignalPointConfig,
  SourceTable,
  Vehicle,
} from './types';

export type {
  BindingResultMap,
  ClassScheduleEntry,
  MenuItem,
  MenuSection,
  SignalPointConfig,
  SiteDataBinding,
  SourceTable,
  Vehicle,
  VerticalKind,
} from './types';

export { SignalPointConfigSchema } from './types';

// ── Page-lifecycle cache ──────────────────────────────────────────────────────

interface CacheEntry<T> { value: T; fetchedAt: number; }
const cache = new Map<string, CacheEntry<unknown[]>>();
const CACHE_TTL_MS = 60_000; // 60s — page-render cache, not a long-lived cache

function cacheKey(source: SourceTable, workspaceId: string): string {
  return `${source}:${workspaceId}`;
}

// ── Fetch primitive (v1 stub; v2 swaps in real Supabase fetch) ────────────────

/**
 * Read rows from a source table for the configured workspace. v1 returns
 * an empty array — the real implementation requires SPS's signalpoint-
 * config issuer endpoint to be live AND the per-table public-read RLS
 * policies (per OUTBOUND TO SPS round 2 §5).
 *
 * Generated sites that call this today see empty data, which the
 * generated templates render as "no items / no inventory / no
 * schedule" with whatever fallback copy the template defines. That's
 * intentional — the shim is forwards-compatible: the moment SPS ships,
 * the same generated bundle starts showing real data without rebuilds.
 *
 * Returns `unknown[]` deliberately — public per-table functions below
 * cast to their typed row shape. Keeps the type narrowing at the public
 * API surface where consumers actually see it.
 */
async function readTable(
  source: SourceTable,
  config: SignalPointConfig,
): Promise<unknown[]> {
  const key = cacheKey(source, config.workspace_id);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.value;
  }

  // v1 stub. v2 will:
  //   const client = createClient(config.supabase_url, config.anon_key, {
  //     global: { headers: { 'x-workspace-id': config.workspace_id } }
  //   });
  //   const { data, error } = await client.from(source).select('*');
  const value: unknown[] = [];

  cache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

// ── Public typed read API ─────────────────────────────────────────────────────

/** Fetch menu sections for the configured workspace. Sorted by position. */
export async function getMenuSections(config: SignalPointConfig): Promise<MenuSection[]> {
  const rows = (await readTable('menu_sections', config)) as MenuSection[];
  return [...rows].sort((a, b) => a.position - b.position);
}

/** Fetch menu items. Filters out unavailable rows; sorts by section then
 *  position. */
export async function getMenu(config: SignalPointConfig): Promise<MenuItem[]> {
  const rows = (await readTable('menu_items', config)) as MenuItem[];
  return rows
    .filter((r) => r.available)
    .sort((a, b) => {
      const sa = a.section_id ?? '';
      const sb = b.section_id ?? '';
      if (sa !== sb) return sa.localeCompare(sb);
      return a.position - b.position;
    });
}

/** Fetch the public vehicle listings (status='available'). Sorted by year DESC. */
export async function getInventory(config: SignalPointConfig): Promise<Vehicle[]> {
  const rows = (await readTable('vehicles', config)) as Vehicle[];
  return rows
    .filter((r) => r.status === 'available')
    .sort((a, b) => b.year - a.year);
}

/** Fetch the upcoming class schedule (next 14 days, status≠cancelled).
 *  Sorted by start_at ASC. */
export async function getSchedule(config: SignalPointConfig): Promise<ClassScheduleEntry[]> {
  const rows = (await readTable('class_schedule', config)) as ClassScheduleEntry[];
  const now = Date.now();
  const horizon = now + 14 * 24 * 60 * 60 * 1000;
  return rows
    .filter((r) => {
      if (r.status === 'cancelled') return false;
      const t = Date.parse(r.start_at);
      return Number.isFinite(t) && t >= now && t < horizon;
    })
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
}

// ── Cache control (mostly for tests) ──────────────────────────────────────────

/** Clear the page-lifecycle cache. Call this in tests between fixtures. */
export function clearSiteDataCache(): void {
  cache.clear();
}
