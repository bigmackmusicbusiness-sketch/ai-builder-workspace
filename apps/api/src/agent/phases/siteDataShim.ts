// apps/api/src/agent/phases/siteDataShim.ts — Phase 3 shim injection (v1 stub).
//
// After the executor writes all the HTML files (Phase B), this function
// optionally injects the @abw/site-data shim into the generated bundle so
// the customer site can read live SignalPointSystems data at runtime.
//
// **Standalone-IDE guarantee — load-bearing rule:** this function is the
// gatekeeper. It returns early (a no-op) unless:
//   1. The project has a SignalPoint config attached (project.signalpointConfig)
//   2. The matched niche manifest has site_data_bindings populated
//
// Both conditions must be true. Standalone projects (no SPS config) AND
// SPS-tagged projects whose niche isn't binding-eligible (e.g. an SPS
// workspace owns a barbershop site that has no live data needs) both fall
// through to "no-op" and produce a fully static bundle.
//
// **v1 status:** typed stub. Walks the manifest, decides whether to inject,
// LOGS the intent, but doesn't actually rewrite HTML files yet. v2 lands
// when SPS's signalpoint-config issuer endpoint is live (see HANDOFF_NOTES.md
// round 3 pending). At that point the function will:
//   - Append <script type="module"> to each HTML file that imports
//     @abw/site-data and exposes resolved data on window.__signalpoint
//   - Embed signalpoint-config.json reference (the publish flow writes
//     this file alongside the HTML — see apps/api/src/routes/publish.ts)
//
// **Tested by:** apps/api/tests/integration/standalone-regression.test.ts
// (asserts the agent + preview source paths never reference sps_workspace_id
// outside the SPS-handoff routes — this file is in src/agent so it must
// keep its access to SPS data behind the gate function).

import { loadNicheManifests, type NicheManifestType, type PlanType } from './plan';

/** Minimal subset of the project record this function needs. The actual
 *  SignalPointConfig type lives in @abw/site-data; we accept any object
 *  with the workspace_id present as the gate signal. */
export interface ProjectSignalPointHandle {
  /** SPS workspace id the project is tagged with. NULL/undefined for
   *  ordinary standalone-IDE projects (the vast majority). */
  spsWorkspaceId?: string | null;
  /** When the publish flow has resolved a full config from SPS's issuer,
   *  this is populated. NULL until SPS_HANDOFF_KID + the issuer endpoint
   *  are live + a valid config has been minted for this tenant. */
  signalpointConfig?: {
    workspace_id: string;
    supabase_url: string;
    anon_key:     string;
    edge_token:   string;
    expires_at:   string;
  } | null;
}

export interface InjectSiteDataShimInput {
  /** Project type id (e.g. 'website'). Used to load niche manifests. */
  projectTypeId: string;
  /** The plan returned from Phase A. The niche slug is what we look up
   *  to find the manifest's site_data_bindings. */
  plan:          PlanType;
  /** Project record's SPS handle. Standalone projects pass an object with
   *  spsWorkspaceId / signalpointConfig both null — function returns a
   *  no-op result. */
  project:       ProjectSignalPointHandle;
}

export interface InjectSiteDataShimResult {
  /** Whether the shim was injected (or would be — v1 stubs the actual
   *  HTML modification). False = no-op took the standalone path. */
  injected: boolean;
  /** Reason the function took its branch. Logged by the caller. */
  reason:   string;
  /** Bindings resolved from the niche manifest. Empty when injected=false. */
  bindings: Array<{ source: string; target: string }>;
}

/**
 * The gate. Returns early when the project doesn't have an SPS link OR
 * when the niche manifest doesn't have site_data_bindings populated.
 *
 * v1 returns the resolved bindings + a flag for the caller to log; the
 * actual HTML rewrite is deferred to v2 when SPS's issuer is live.
 */
export async function maybeInjectSiteDataShim(
  input: InjectSiteDataShimInput,
): Promise<InjectSiteDataShimResult> {
  const { projectTypeId, plan, project } = input;

  // Gate 1: no SPS workspace tag → standalone bundle, no-op.
  if (!project.spsWorkspaceId) {
    return {
      injected: false,
      reason:   'standalone (no spsWorkspaceId)',
      bindings: [],
    };
  }

  // Gate 2: no resolved signalpoint config → can't actually fetch data
  // even if we wanted to. Standalone-quality bundle, no-op.
  if (!project.signalpointConfig) {
    return {
      injected: false,
      reason:   'spsWorkspaceId set but signalpointConfig is null (issuer not yet wired)',
      bindings: [],
    };
  }

  // Gate 3: load the niche manifest, look up site_data_bindings.
  let manifests: NicheManifestType[];
  try {
    manifests = await loadNicheManifests(projectTypeId);
  } catch {
    return {
      injected: false,
      reason:   `failed to load niche manifests for ${projectTypeId}`,
      bindings: [],
    };
  }

  const matched = manifests.find((m) => m.niche === plan.niche) ?? null;
  if (!matched) {
    return {
      injected: false,
      reason:   `no manifest matched plan.niche=${plan.niche}`,
      bindings: [],
    };
  }

  // The bindings field is optional on the schema (Phase 3 opt-in). Read
  // through .passthrough() — TypeScript doesn't see it on the inferred
  // type, but the JSON has it for binding-eligible niches.
  const rawBindings = (matched as unknown as { site_data_bindings?: Array<{ source: string; target: string }> })
    .site_data_bindings ?? [];

  if (rawBindings.length === 0) {
    return {
      injected: false,
      reason:   `niche ${plan.niche} has no site_data_bindings (not binding-eligible)`,
      bindings: [],
    };
  }

  // ── All gates passed — would inject in v2 ────────────────────────────────
  //
  // v2 will:
  //   1. For each HTML file in `ws.dir`, append a <script type="module"> tag
  //      before </body> that:
  //         a. imports getMenu / getInventory / getSchedule / etc from
  //            the bundled @abw/site-data
  //         b. fetches signalpoint-config.json from the same origin
  //         c. resolves the bindings and exposes them on window.__signalpoint
  //   2. Write signalpoint-config.json alongside index.html (publish step
  //      reads project.signalpointConfig and serializes).
  //
  // v1 just records the intent. The bundle stays static.

  return {
    injected: true,
    reason:   `would inject ${rawBindings.length} binding(s) for niche ${plan.niche} (v1 stub — actual HTML rewrite deferred)`,
    bindings: rawBindings,
  };
}
