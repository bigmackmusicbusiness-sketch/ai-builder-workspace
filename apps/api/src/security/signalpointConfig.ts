// apps/api/src/security/signalpointConfig.ts — resolve a project's
// signalpoint-config.json for the publish flow.
//
// When a project is tagged with sps_workspace_id (Phase 2.5 column), the
// publish step needs to embed a `signalpoint-config.json` artifact in the
// generated bundle so the @abw/site-data shim can fetch live data from SPS
// at runtime. This helper resolves that config.
//
// **v1 status:** stub. Returns null for every project. Why: SPS's
// `/v1/site-config/:token` issuer endpoint is not yet live (see HANDOFF_NOTES
// round 3 pending). Until it is, no project can have a real config minted,
// so emission is a no-op for everyone.
//
// **v2 (lands when SPS issuer is live):** queries a `signalpoint_links`
// table keyed by tenantId → SPS workspace, mints a fresh handoff token,
// hits SPS's issuer, returns the resolved config. Result cached for ~24h
// (config carries `expires_at`).
//
// **Standalone-IDE guarantee preserved:** every code path that touches this
// helper is gated on the project actually having sps_workspace_id set.
// Standalone projects skip the call entirely.

import type { SignalPointConfig } from '@abw/site-data';

/** Resolve the signalpoint-config.json blob for a project. Returns null
 *  when the project isn't SPS-linked OR when SPS's issuer isn't reachable.
 *  v1 always returns null — see file header. */
export async function resolveSignalpointConfigForProject(opts: {
  projectId:        string;
  tenantId:         string;
  spsWorkspaceId?:  string | null;
}): Promise<SignalPointConfig | null> {
  // Gate 1: standalone project. Skip entirely.
  if (!opts.spsWorkspaceId) return null;

  // v1: SPS issuer endpoint not yet live, no config can be resolved.
  // Return null — publish flow skips the artifact emission.
  // v2 will:
  //   1. Look up signalpoint_links row for tenantId
  //   2. Mint a project-create handoff token (HS256 via handoffToken.ts)
  //   3. Hit SPS_ISSUER_URL/v1/site-config/:token, parse response
  //   4. Validate against SignalPointConfigSchema
  //   5. Cache by (projectId, expires_at - 24h) so repeated publishes
  //      within the cache window skip the network call
  return null;
}

/** Serialize a config for embedding into the bundle as
 *  `signalpoint-config.json`. Stable JSON formatting (sorted keys, 2-space
 *  indent) so re-publishing the same config produces a byte-identical
 *  artifact and downstream caches don't bust. */
export function serializeSignalpointConfig(config: SignalPointConfig): Uint8Array {
  // Sort keys for stable output. The known-good order matches the contract
  // documented in HANDOFF_NOTES.md OUTBOUND TO SPS round 2 §7.
  const ordered = {
    workspace_id: config.workspace_id,
    supabase_url: config.supabase_url,
    anon_key:     config.anon_key,
    edge_token:   config.edge_token,
    expires_at:   config.expires_at,
  };
  const json = JSON.stringify(ordered, null, 2) + '\n';
  return new TextEncoder().encode(json);
}
