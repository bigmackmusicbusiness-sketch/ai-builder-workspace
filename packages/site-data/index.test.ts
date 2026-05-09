// packages/site-data/index.test.ts — unit tests for the v2 PostgREST fetch
// + config-refresh helpers. Mocks `globalThis.fetch` so no network is needed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSiteDataCache,
  getMenu,
  getInventory,
  getMenuSections,
  getSchedule,
  isConfigExpiringSoon,
  mergeRefreshedConfig,
  refreshConfig,
  type SignalPointConfig,
} from './index';

const NOW = Date.parse('2026-05-09T12:00:00.000Z');

const baseConfig: SignalPointConfig = {
  workspace_id:  '00000000-0000-0000-0000-000000000099',
  supabase_url:  'https://kpbaozjekixqxfeeikyw.supabase.co',
  anon_key:      'eyJ-test-anon-key-not-real',
  edge_token:    'edge-token-test',
  edge_base_url: 'https://embed.signalpointportal.com',
  // 7 days ahead → not expiring soon.
  expires_at:    new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString(),
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearSiteDataCache();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── readTable behaviors (covered via the public per-table getters) ───────────

describe('@abw/site-data readTable / public getters', () => {
  it('hits PostgREST with apikey + x-workspace-id headers', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));

    await getMenuSections(baseConfig);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${baseConfig.supabase_url}/rest/v1/menu_sections?select=*`);
    const headers = init.headers as Record<string, string>;
    expect(headers['apikey']).toBe(baseConfig.anon_key);
    expect(headers['authorization']).toBe(`Bearer ${baseConfig.anon_key}`);
    expect(headers['x-workspace-id']).toBe(baseConfig.workspace_id);
    expect(headers['accept']).toBe('application/json');
  });

  it('returns parsed rows on a successful response', async () => {
    const payload = [
      { id: 's1', workspace_id: baseConfig.workspace_id, name: 'Brunch', position: 0 },
      { id: 's2', workspace_id: baseConfig.workspace_id, name: 'Drinks', position: 1 },
    ];
    fetchMock.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

    const sections = await getMenuSections(baseConfig);
    expect(sections).toEqual(payload);
  });

  it('returns [] on non-2xx response (graceful degrade)', async () => {
    fetchMock.mockResolvedValue(new Response('forbidden', { status: 403 }));
    const sections = await getMenuSections(baseConfig);
    expect(sections).toEqual([]);
  });

  it('returns [] when body is not an array (PostgREST error envelope)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: 'rls error' }), { status: 200 }));
    const sections = await getMenuSections(baseConfig);
    expect(sections).toEqual([]);
  });

  it('returns [] on network/abort error (no throw to caller)', async () => {
    fetchMock.mockRejectedValue(new Error('connection reset'));
    const sections = await getMenuSections(baseConfig);
    expect(sections).toEqual([]);
  });

  it('caches results within the 60s window — second call does not fetch', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ id: 'a' }]), { status: 200 }));
    await getMenuSections(baseConfig);
    await getMenuSections(baseConfig);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cache key is per-(table, workspace) — different workspace re-fetches', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    await getMenuSections(baseConfig);
    await getMenuSections({ ...baseConfig, workspace_id: '11111111-1111-1111-1111-111111111111' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── Public-getter sort/filter contracts (per OUTBOUND TO SPS round 2 §"shim's read contract") ──

describe('public getters apply contract sort/filter', () => {
  it('getMenuSections sorts by position', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([
      { id: 'b', workspace_id: baseConfig.workspace_id, name: 'B', position: 2 },
      { id: 'a', workspace_id: baseConfig.workspace_id, name: 'A', position: 0 },
      { id: 'c', workspace_id: baseConfig.workspace_id, name: 'C', position: 1 },
    ]), { status: 200 }));
    const out = await getMenuSections(baseConfig);
    expect(out.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('getMenu hides unavailable rows + sorts by section then position', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([
      { id: 'i1', workspace_id: baseConfig.workspace_id, section_id: 'sB', name: 'late', price_cents: 100, currency: 'usd', available: true,  position: 1, allergens: [], photos: [] },
      { id: 'i2', workspace_id: baseConfig.workspace_id, section_id: 'sA', name: 'first', price_cents: 100, currency: 'usd', available: true,  position: 0, allergens: [], photos: [] },
      { id: 'i3', workspace_id: baseConfig.workspace_id, section_id: 'sA', name: 'hidden', price_cents: 100, currency: 'usd', available: false, position: 0, allergens: [], photos: [] },
      { id: 'i4', workspace_id: baseConfig.workspace_id, section_id: 'sB', name: 'early', price_cents: 100, currency: 'usd', available: true,  position: 0, allergens: [], photos: [] },
    ]), { status: 200 }));
    const out = await getMenu(baseConfig);
    // sA before sB; within section sorted by position
    expect(out.map((r) => r.id)).toEqual(['i2', 'i4', 'i1']);
  });

  it('getInventory hides non-available + sorts by year DESC', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([
      { id: 'v1', workspace_id: baseConfig.workspace_id, category: 'sedan', year: 2022, make: 'Honda', model: 'Civic', price_cents: 1, currency: 'usd', status: 'available', photos: [], features: [] },
      { id: 'v2', workspace_id: baseConfig.workspace_id, category: 'sedan', year: 2024, make: 'Honda', model: 'Civic', price_cents: 1, currency: 'usd', status: 'sold',      photos: [], features: [] },
      { id: 'v3', workspace_id: baseConfig.workspace_id, category: 'suv',   year: 2023, make: 'Toyota', model: 'RAV4', price_cents: 1, currency: 'usd', status: 'available', photos: [], features: [] },
    ]), { status: 200 }));
    const out = await getInventory(baseConfig);
    expect(out.map((r) => r.id)).toEqual(['v3', 'v1']); // 2023, 2022 — sold one filtered
  });

  it('getSchedule hides cancelled + past + far-future, sorts by start_at ASC', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const inFutureNear  = new Date(NOW + 1 * 24 * 60 * 60 * 1000).toISOString(); // +1d
    const inFutureLater = new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString(); // +7d
    const inPast        = new Date(NOW - 1 * 24 * 60 * 60 * 1000).toISOString(); // -1d
    const tooFar        = new Date(NOW + 30 * 24 * 60 * 60 * 1000).toISOString(); // +30d (horizon = 14d)

    fetchMock.mockResolvedValue(new Response(JSON.stringify([
      { id: 'c1', workspace_id: baseConfig.workspace_id, program_name: 'Yoga',  start_at: inFutureLater, end_at: inFutureLater, status: 'scheduled' },
      { id: 'c2', workspace_id: baseConfig.workspace_id, program_name: 'HIIT',  start_at: inFutureNear,  end_at: inFutureNear,  status: 'scheduled' },
      { id: 'c3', workspace_id: baseConfig.workspace_id, program_name: 'Yoga',  start_at: inFutureNear,  end_at: inFutureNear,  status: 'cancelled' },
      { id: 'c4', workspace_id: baseConfig.workspace_id, program_name: 'BJJ',   start_at: inPast,        end_at: inPast,        status: 'scheduled' },
      { id: 'c5', workspace_id: baseConfig.workspace_id, program_name: 'Open',  start_at: tooFar,        end_at: tooFar,        status: 'scheduled' },
    ]), { status: 200 }));

    const out = await getSchedule(baseConfig);
    expect(out.map((r) => r.id)).toEqual(['c2', 'c1']); // near future first, no cancelled, no past, no >14d
    vi.useRealTimers();
  });
});

// ── Config refresh helpers ──────────────────────────────────────────────────

describe('isConfigExpiringSoon', () => {
  it('returns false when expires_at is > 24h away', () => {
    const cfg = { ...baseConfig, expires_at: new Date(NOW + 48 * 60 * 60 * 1000).toISOString() };
    expect(isConfigExpiringSoon(cfg, NOW)).toBe(false);
  });

  it('returns true when expires_at is within 24h', () => {
    const cfg = { ...baseConfig, expires_at: new Date(NOW + 12 * 60 * 60 * 1000).toISOString() };
    expect(isConfigExpiringSoon(cfg, NOW)).toBe(true);
  });

  it('returns true when expires_at has already passed', () => {
    const cfg = { ...baseConfig, expires_at: new Date(NOW - 60_000).toISOString() };
    expect(isConfigExpiringSoon(cfg, NOW)).toBe(true);
  });

  it('returns true (defensive refresh) when expires_at is malformed', () => {
    const cfg = { ...baseConfig, expires_at: 'not-a-date' };
    expect(isConfigExpiringSoon(cfg, NOW)).toBe(true);
  });
});

describe('refreshConfig', () => {
  it('hits the embed-edge endpoint and returns the partial config on success', async () => {
    const partial = {
      workspace_id: baseConfig.workspace_id,
      supabase_url: baseConfig.supabase_url,
      anon_key:     'fresh-anon-key',
      expires_at:   new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(partial), { status: 200 }));

    const out = await refreshConfig(baseConfig);
    expect(out).toEqual(partial);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${baseConfig.edge_base_url}/v1/site-config/${encodeURIComponent(baseConfig.edge_token)}`);
  });

  it('returns null on non-2xx', async () => {
    fetchMock.mockResolvedValue(new Response('expired', { status: 401 }));
    const out = await refreshConfig(baseConfig);
    expect(out).toBeNull();
  });

  it('returns null when the body is missing required fields', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ workspace_id: 'x' }), { status: 200 }));
    const out = await refreshConfig(baseConfig);
    expect(out).toBeNull();
  });

  it('returns null on network error', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));
    const out = await refreshConfig(baseConfig);
    expect(out).toBeNull();
  });
});

describe('mergeRefreshedConfig', () => {
  it('overwrites the four refreshable fields and keeps edge_token + edge_base_url from base', () => {
    const merged = mergeRefreshedConfig(baseConfig, {
      workspace_id: 'new-ws',
      supabase_url: 'https://new.supabase.co',
      anon_key:     'fresh',
      expires_at:   '2027-01-01T00:00:00.000Z',
    });
    expect(merged.workspace_id).toBe('new-ws');
    expect(merged.supabase_url).toBe('https://new.supabase.co');
    expect(merged.anon_key).toBe('fresh');
    expect(merged.expires_at).toBe('2027-01-01T00:00:00.000Z');
    // edge_token + edge_base_url stay from base — embed-edge doesn't re-issue them.
    expect(merged.edge_token).toBe(baseConfig.edge_token);
    expect(merged.edge_base_url).toBe(baseConfig.edge_base_url);
  });
});
