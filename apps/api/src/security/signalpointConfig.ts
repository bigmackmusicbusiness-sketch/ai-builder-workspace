// apps/api/src/security/signalpointConfig.ts — resolve a project's
// signalpoint-config.json for the publish flow.
//
// When a project is tagged with sps_workspace_id (Phase 2.5 column), the
// publish step needs to embed a `signalpoint-config.json` artifact in the
// generated bundle so the @abw/site-data shim can fetch live data from SPS
// at runtime. This helper resolves that config.
//
// **v2 status (round 6 — path 2 service-to-service):**
//   1. Caller supplies project.spsWorkspaceId; if null → return null (standalone path).
//   2. Mint a 60s HS256 S2S token via mintAbwS2sToken (round-6 contract).
//   3. POST to `${SPS_API_BASE_URL}/api/abw/site-config-token` with
//      Authorization: Bearer <token> and body { workspace_id, project_id?, ttl_seconds? }.
//   4. SPS returns { ok, auth_via, config: { workspace_id, supabase_url,
//      anon_key, edge_token, edge_base_url, expires_at } }. Validate via
//      SignalPointConfigSchema and return the inner config.
//   5. Cache by spsWorkspaceId until expires_at - 24h so repeated publishes
//      within the cache window skip the network call (the cache stores the
//      result of one round-trip; if invalidated, the next publish refreshes).
//
// **Standalone-IDE guarantee preserved:** every code path that touches this
// helper is gated on the project actually having sps_workspace_id set.
// Standalone projects skip the call entirely. SPS being offline / returning
// any non-200 → return null and publish emits no signalpoint-config.json
// (the shim then falls through to gate 2 and the bundle stays static).
//
// **Failure modes are silent at this layer.** Callers that want to surface
// SPS errors to the user should layer on top; the resolver itself returns
// null for "no config available" so the standalone fallback always
// engages cleanly.

import { z } from 'zod';
import { SignalPointConfigSchema, type SignalPointConfig } from '@abw/site-data';
import { env } from '../config/env';
import { mintAbwS2sToken, SpsServiceTokenError } from './spsServiceToken';

/** Cache entry: a resolved config + the moment we should treat it as stale.
 *  We refresh ~24h before expires_at so the published-site refresh path
 *  (round-4 contract: refetch within 24h of expiry) usually never fires —
 *  publishes during normal release cadence emit fresh tokens automatically. */
interface CacheEntry {
  config:    SignalPointConfig;
  staleAt:   number; // ms epoch when we should re-fetch even if not expired
}

/** Module-scope cache. Keyed by spsWorkspaceId — a single workspace's
 *  config is the same regardless of which ABW project is publishing. */
const cache = new Map<string, CacheEntry>();

/** Refresh threshold: 24h ahead of expires_at, matching the published-site
 *  refresh contract from SPS round 4 §"Shim integration shape". */
const CACHE_REFRESH_LEAD_MS = 24 * 60 * 60 * 1000;

/** Issuer-response wrapper. SPS returns the config nested under `config`,
 *  with `ok: true` and `auth_via: 's2s'` for the path-2 endpoint. */
const IssuerResponseSchema = z.object({
  ok:       z.literal(true),
  auth_via: z.string().optional(),
  config:   SignalPointConfigSchema,
});

/** Test-only cache reset. Prod resets via process restart. */
export function __resetSignalpointConfigCache(): void {
  cache.clear();
}

/** Resolve the signalpoint-config.json blob for a project. Returns null
 *  when the project isn't SPS-linked OR when SPS's issuer can't be
 *  reached / returns an unexpected shape.
 *
 *  v2 (round 6 path 2): mints a fresh S2S bearer per call (cheap —
 *  HMAC-SHA256 of ~150 bytes), POSTs to SPS, parses + validates, caches.
 *
 *  Failure modes that return null:
 *   - !opts.spsWorkspaceId (standalone project)
 *   - mintAbwS2sToken throws (SPS_HANDOFF_KID/KEY env not configured)
 *   - SPS non-200 (401 / 403 / 500 / network)
 *   - SPS body parse fails or fails IssuerResponseSchema validation
 *
 *  In every case, the publish flow's gate `if (config) { writeArtifact() }`
 *  takes the standalone path and the bundle stays purely static.
 */
export async function resolveSignalpointConfigForProject(opts: {
  projectId:        string;
  tenantId:         string;
  spsWorkspaceId?:  string | null;
}): Promise<SignalPointConfig | null> {
  // Gate 1: standalone project. Skip entirely.
  if (!opts.spsWorkspaceId) return null;

  // Cache hit? Use it if it's still fresh (well clear of expiry).
  const cached = cache.get(opts.spsWorkspaceId);
  if (cached && Date.now() < cached.staleAt) {
    return cached.config;
  }

  // Mint the S2S bearer.
  let bearer: string;
  try {
    bearer = mintAbwS2sToken({ spsWorkspaceId: opts.spsWorkspaceId });
  } catch (err) {
    if (err instanceof SpsServiceTokenError) {
      // env config missing / malformed → standalone fallback. Logged so
      // operators can spot misconfigs in Coolify; not surfaced to user.
      // eslint-disable-next-line no-console
      console.warn(`[signalpoint-config] mint failed: ${err.reason}`);
    }
    return null;
  }

  // POST to SPS issuer.
  const url = `${env.SPS_API_BASE_URL.replace(/\/+$/, '')}/api/abw/site-config-token`;
  let res: Response;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization':  `Bearer ${bearer}`,
        'Content-Type':   'application/json',
        'Accept':         'application/json',
      },
      body: JSON.stringify({
        workspace_id: opts.spsWorkspaceId,
        project_id:   opts.projectId,
      }),
    });
  } catch (err) {
    // Network error, abort, DNS failure, etc.
    // eslint-disable-next-line no-console
    console.warn(`[signalpoint-config] SPS issuer fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  if (!res.ok) {
    // SPS returns specific reasons we'd rather see in logs to diagnose
    // mint-side mistakes (wrong_audience, lifetime_too_long, etc.). Cap
    // the body read so a misbehaving SPS can't hand us 100MB.
    let bodyHint = '';
    try {
      const text = await res.text();
      bodyHint = ` body=${text.slice(0, 300)}`;
    } catch { /* ignore */ }
    // eslint-disable-next-line no-console
    console.warn(`[signalpoint-config] SPS issuer returned ${res.status}${bodyHint}`);
    return null;
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[signalpoint-config] SPS issuer body parse failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const parsed = IssuerResponseSchema.safeParse(json);
  if (!parsed.success) {
    // Schema drift on SPS side — flag loudly because it indicates a
    // contract mismatch we should align on, not just a transient miss.
    // eslint-disable-next-line no-console
    console.error(`[signalpoint-config] SPS issuer response failed schema: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    return null;
  }

  const config = parsed.data.config;

  // Cache by workspace. staleAt = expires_at - 24h, but never less than
  // now+60s (a short floor so a near-expired token still reads from cache
  // briefly rather than triggering N parallel re-mints under load).
  const expiresAtMs = Date.parse(config.expires_at);
  const staleAt = Number.isFinite(expiresAtMs)
    ? Math.max(expiresAtMs - CACHE_REFRESH_LEAD_MS, Date.now() + 60_000)
    : Date.now() + 60_000;
  cache.set(opts.spsWorkspaceId, { config, staleAt });

  return config;
}

/** Serialize a config for embedding into the bundle as
 *  `signalpoint-config.json`. Stable JSON formatting (sorted keys, 2-space
 *  indent) so re-publishing the same config produces a byte-identical
 *  artifact and downstream caches don't bust.
 *
 *  Order matches SPS round-4 issuer response (`POST /api/abw/site-config-token`)
 *  byte-for-byte except for the `ok` envelope, which the publish flow strips. */
export function serializeSignalpointConfig(config: SignalPointConfig): Uint8Array {
  const ordered = {
    workspace_id:  config.workspace_id,
    supabase_url:  config.supabase_url,
    anon_key:      config.anon_key,
    edge_token:    config.edge_token,
    edge_base_url: config.edge_base_url,
    expires_at:    config.expires_at,
  };
  const json = JSON.stringify(ordered, null, 2) + '\n';
  return new TextEncoder().encode(json);
}
