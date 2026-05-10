// apps/api/tests/unit/signalpoint-config-resolver.test.ts
//
// Locks in resolveSignalpointConfigForProject v2 (round-6 path 2). Mocks
// globalThis.fetch so no network needed; mocks the SPS env so the minter
// produces a real token we can verify is on the wire.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  process.env.SUPABASE_URL              ??= 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY         ??= 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-key';
  process.env.SUPABASE_JWT_SECRET       ??= 'test-jwt-secret';
  process.env.VAULT_MASTER_KEY          ??= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
});

import {
  __resetSignalpointConfigCache,
  resolveSignalpointConfigForProject,
} from '../../src/security/signalpointConfig';

const PROJECT_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const TENANT_ID  = '00000000-0000-0000-0000-bbbbbbbbbbbb';
const WORKSPACE  = '11111111-2222-3333-4444-555555555555';

const TEST_KEY_B64 = Buffer.alloc(32, 0x42).toString('base64');

const VALID_CONFIG = {
  workspace_id:  WORKSPACE,
  supabase_url:  'https://kpbaozjekixqxfeeikyw.supabase.co',
  anon_key:      'eyJ-test-anon-key',
  edge_token:    'edge-token-test',
  edge_base_url: 'https://embed.signalpointportal.com',
  expires_at:    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetSignalpointConfigCache();
  process.env.SPS_HANDOFF_KID_DEFAULT = 'k1';
  process.env.SPS_HANDOFF_KEY_K1      = TEST_KEY_B64;
  // SPS_API_BASE_URL is read via env.ts at module load; the default
  // (https://app.signalpointportal.com) is fine — fetch is mocked anyway.
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SPS_HANDOFF_KID_DEFAULT;
  delete process.env.SPS_HANDOFF_KEY_K1;
});

describe('resolveSignalpointConfigForProject — gate behavior', () => {
  it('returns null immediately for standalone project (no spsWorkspaceId)', async () => {
    const r = await resolveSignalpointConfigForProject({
      projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: null,
    });
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when spsWorkspaceId is undefined', async () => {
    const r = await resolveSignalpointConfigForProject({
      projectId: PROJECT_ID, tenantId: TENANT_ID,
    });
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('resolveSignalpointConfigForProject — happy path', () => {
  it('mints a bearer + POSTs the right shape + returns inner config', async () => {
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ ok: true, auth_via: 's2s', config: VALID_CONFIG }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    const r = await resolveSignalpointConfigForProject({
      projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: WORKSPACE,
    });

    expect(r).not.toBeNull();
    expect(r!.workspace_id).toBe(WORKSPACE);
    expect(r!.edge_base_url).toBe(VALID_CONFIG.edge_base_url);
    expect(r!.edge_token).toBe(VALID_CONFIG.edge_token);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/abw\/site-config-token$/);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toMatch(/^Bearer eyJ/); // JWT compact form starts with eyJ
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.workspace_id).toBe(WORKSPACE);
    expect(body.project_id).toBe(PROJECT_ID);
  });

  it('caches by workspace — second call within stale window does not re-fetch', async () => {
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ ok: true, config: VALID_CONFIG }),
      { status: 200 },
    ));

    const first  = await resolveSignalpointConfigForProject({ projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: WORKSPACE });
    const second = await resolveSignalpointConfigForProject({ projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: WORKSPACE });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cache key is per-workspace — different workspace re-fetches', async () => {
    const wsB = '99999999-2222-3333-4444-555555555555';
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ ok: true, config: { ...VALID_CONFIG, workspace_id: wsB } }),
      { status: 200 },
    ));

    await resolveSignalpointConfigForProject({ projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: WORKSPACE });
    await resolveSignalpointConfigForProject({ projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: wsB });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('resolveSignalpointConfigForProject — failure modes return null', () => {
  it('null on SPS 401 (Invalid S2S bearer)', async () => {
    fetchMock.mockResolvedValue(new Response('Invalid S2S bearer: wrong_audience', { status: 401 }));
    const r = await resolveSignalpointConfigForProject({
      projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: WORKSPACE,
    });
    expect(r).toBeNull();
  });

  it('null on SPS 403 (workspace mismatch)', async () => {
    fetchMock.mockResolvedValue(new Response('workspace mismatch', { status: 403 }));
    const r = await resolveSignalpointConfigForProject({
      projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: WORKSPACE,
    });
    expect(r).toBeNull();
  });

  it('null on SPS 500 (env not configured)', async () => {
    fetchMock.mockResolvedValue(new Response('SPS env not configured', { status: 500 }));
    const r = await resolveSignalpointConfigForProject({
      projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: WORKSPACE,
    });
    expect(r).toBeNull();
  });

  it('null on network error', async () => {
    fetchMock.mockRejectedValue(new Error('connection reset'));
    const r = await resolveSignalpointConfigForProject({
      projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: WORKSPACE,
    });
    expect(r).toBeNull();
  });

  it('null on body parse failure (non-JSON 200)', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));
    const r = await resolveSignalpointConfigForProject({
      projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: WORKSPACE,
    });
    expect(r).toBeNull();
  });

  it('null on schema mismatch (missing edge_base_url)', async () => {
    const partial = { ...VALID_CONFIG };
    delete (partial as Record<string, unknown>)['edge_base_url'];
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ ok: true, config: partial }),
      { status: 200 },
    ));
    const r = await resolveSignalpointConfigForProject({
      projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: WORKSPACE,
    });
    expect(r).toBeNull();
  });

  it('null on ok=false response', async () => {
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ ok: false, error: { code: 'sps_system_tenant_not_configured' } }),
      { status: 200 },
    ));
    const r = await resolveSignalpointConfigForProject({
      projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: WORKSPACE,
    });
    expect(r).toBeNull();
  });

  it('null when SPS_HANDOFF_KID_DEFAULT not set (env misconfig → standalone fallback)', async () => {
    delete process.env.SPS_HANDOFF_KID_DEFAULT;
    const r = await resolveSignalpointConfigForProject({
      projectId: PROJECT_ID, tenantId: TENANT_ID, spsWorkspaceId: WORKSPACE,
    });
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled(); // mint failed before fetch
  });
});
