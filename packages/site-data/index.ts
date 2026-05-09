// packages/site-data/index.ts — Phase 3 site-data shim runtime.
//
// Generated ABW sites that bind to SignalPointSystems data import from here
// at runtime. The shim:
//
//   1. Reads `signalpoint-config.json` from the project bundle (written by
//      the publish flow when the workspace has an SPS link — see
//      apps/api/src/routes/publish.ts).
//   2. Issues PostgREST GET requests against the SPS Supabase project,
//      authed with the workspace-scoped anon key + `x-workspace-id` header
//      (the public-read RLS shipped in SPS migration 0059 keys on this
//      header to scope rows).
//   3. Exposes typed read functions per binding: `getMenu()`, `getInventory()`,
//      `getSchedule()`, etc. Each filters/sorts client-side per the
//      contract documented in OUTBOUND TO SPS round 2 §"ABW shim's read
//      contract" (e.g. inventory hides status≠'available'; schedule shows
//      next 14 days non-cancelled).
//   4. Caches results for ~60s of page lifecycle to avoid duplicate
//      requests when multiple template bindings hit the same source table.
//
// **Standalone-IDE guarantee:** this module is only injected into the
// bundle when the project has an SPS link AND the niche manifest has
// `site_data_bindings` populated. Standalone projects never see this code.
// The injection logic lives in apps/api/src/agent/phases/siteDataShim.ts.
//
// **No `@supabase/supabase-js` dependency on purpose.** Plain `fetch()` to
// PostgREST keeps the shim ~3 KB minified instead of pulling the SDK
// (~50 KB). Customer sites are loaded by end-users; bundle size matters.
//
// **v2 status:** real PostgREST reads, with graceful empty-array fallback
// on network/parse errors. Refresh-from-edge helpers exposed for the shim
// to call when `expires_at` approaches. The `resolveSignalpointConfigForProject`
// flow in apps/api/src/security/signalpointConfig.ts is still v1 (returns
// null) — gated on SPS picking an auth pattern (see HANDOFF_NOTES.md
// OUTBOUND TO SPS round 3).

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

// ── Fetch primitive (v2 — real PostgREST GET) ────────────────────────────────

/** PostgREST select-all column projection. We don't bother enumerating the
 *  exact columns we care about — Supabase responses are flat JSON and the
 *  excluded columns aren't sensitive (RLS already gated them). Trimming the
 *  payload here is a v3 optimization, not a correctness concern. */
const SELECT_ALL = '*';

/** Read rows from a source table for the configured workspace.
 *
 *  Returns `unknown[]` deliberately — public per-table functions below
 *  cast to their typed row shape. Keeps the type narrowing at the public
 *  API surface where consumers actually see it.
 *
 *  Failure modes (all return `[]` rather than throwing — generated
 *  templates render "no items" / etc. fallbacks so a transient network
 *  blip doesn't blank the page):
 *    - non-2xx response (RLS denial, server error, etc.)
 *    - non-array response body (PostgREST error envelope, malformed JSON)
 *    - network/abort error
 *
 *  Cache: 60s page-lifecycle. Set CACHE_TTL_MS=0 in tests to disable. */
async function readTable(
  source: SourceTable,
  config: SignalPointConfig,
): Promise<unknown[]> {
  const key = cacheKey(source, config.workspace_id);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.value;
  }

  // PostgREST URL: ${supabase_url}/rest/v1/${table}?select=*
  // Auth: apikey header with the anon JWT.
  // Scope: `x-workspace-id` header — the public-read RLS policies SPS
  //        shipped in migration 0059 require this header to match the
  //        row's `workspace_id` column. Missing header → 0 rows.
  const url = `${config.supabase_url.replace(/\/+$/, '')}/rest/v1/${source}?select=${SELECT_ALL}`;
  let value: unknown[] = [];
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey':           config.anon_key,
        'authorization':    `Bearer ${config.anon_key}`, // PostgREST tolerates this; some proxies require it
        'x-workspace-id':   config.workspace_id,
        'accept':           'application/json',
      },
    });
    if (res.ok) {
      const body: unknown = await res.json();
      if (Array.isArray(body)) {
        value = body;
      }
    }
    // Non-OK or non-array body → empty array. Don't log to console; the
    // shim runs in the customer's browser and noisy logs there are bad UX.
  } catch {
    // Network / abort / parse error — same fallback. Keep silent.
    value = [];
  }

  cache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

// ── Config refresh (used by the injected shim wrapper) ───────────────────────

/** Time before `expires_at` at which the shim should refresh. 24h matches
 *  the contract in HANDOFF_NOTES.md round 4 §"Shim integration shape". */
const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Returns true when the config is within `REFRESH_THRESHOLD_MS` of expiry
 *  (or already past it). The injected shim calls this on every page load
 *  and refreshes via `refreshConfig` if true. */
export function isConfigExpiringSoon(config: SignalPointConfig, now: number = Date.now()): boolean {
  const expiresAt = Date.parse(config.expires_at);
  if (!Number.isFinite(expiresAt)) return true; // malformed → refresh defensively
  return (expiresAt - now) < REFRESH_THRESHOLD_MS;
}

/** Fetch a fresh config from embed-edge using the current edge_token.
 *  Returns the new partial config (workspace_id, supabase_url, anon_key,
 *  expires_at — embed-edge does NOT re-issue edge_token / edge_base_url
 *  per round 4's §6 contract; the shim merges the partial back over the
 *  current config).
 *
 *  On any failure returns null — the shim should keep using the current
 *  config until the next page load. RLS will start denying once the
 *  current `anon_key` actually expires server-side, which the templates
 *  render as "no items"; not great UX but recoverable on next nav. */
export async function refreshConfig(config: SignalPointConfig): Promise<{
  workspace_id: string;
  supabase_url: string;
  anon_key:     string;
  expires_at:   string;
} | null> {
  const url = `${config.edge_base_url.replace(/\/+$/, '')}/v1/site-config/${encodeURIComponent(config.edge_token)}`;
  try {
    const res = await fetch(url, { method: 'GET', headers: { 'accept': 'application/json' } });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!body || typeof body !== 'object') return null;
    const obj = body as Record<string, unknown>;
    if (
      typeof obj['workspace_id'] === 'string' &&
      typeof obj['supabase_url'] === 'string' &&
      typeof obj['anon_key']     === 'string' &&
      typeof obj['expires_at']   === 'string'
    ) {
      return {
        workspace_id: obj['workspace_id'] as string,
        supabase_url: obj['supabase_url'] as string,
        anon_key:     obj['anon_key']     as string,
        expires_at:   obj['expires_at']   as string,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Merge a refreshed partial config back over a base config. The base
 *  retains `edge_token` + `edge_base_url` (embed-edge doesn't re-issue
 *  these — they're long-lived, capped at 7 days per round 4). */
export function mergeRefreshedConfig(
  base: SignalPointConfig,
  refreshed: { workspace_id: string; supabase_url: string; anon_key: string; expires_at: string },
): SignalPointConfig {
  return {
    ...base,
    workspace_id: refreshed.workspace_id,
    supabase_url: refreshed.supabase_url,
    anon_key:     refreshed.anon_key,
    expires_at:   refreshed.expires_at,
  };
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
