// apps/api/src/agent/phases/siteDataShim.ts — Phase 3 shim injection (v2 — real).
//
// After the executor writes all the HTML files (Phase B), this function
// optionally injects the SignalPoint site-data shim into every HTML file
// in the workspace so the customer site can read live SignalPointSystems
// data at runtime.
//
// **Standalone-IDE guarantee — load-bearing rule:** this function is the
// gatekeeper. It returns early (a no-op) unless ALL of:
//   1. The project has a SignalPoint workspace tag (project.spsWorkspaceId)
//   2. The project has a resolved SignalPoint config (project.signalpointConfig)
//   3. The matched niche manifest has site_data_bindings populated
//
// If any of those is falsy → no-op, identical to v1, identical to standalone.
//
// **The injected script is fully self-contained.** No imports, no module
// system, ~30 lines minified. Browser-safe. On every page load:
//   - Fetches `/signalpoint-config.json` from the same origin (the publish
//     flow writes this alongside index.html when the project is SPS-bound)
//   - Reads each declared binding from PostgREST with the workspace-scoped
//     anon key + `x-workspace-id` header (the public-read RLS shipped in
//     SPS migration 0059 keys on this header)
//   - Exposes resolved data on `window.__signalpoint` keyed by the
//     binding's `target` name
//   - Dispatches a `signalpoint:ready` CustomEvent for templates that
//     prefer event-driven hydration over polling `window.__signalpoint`
//   - Silently no-ops on every failure mode — generated templates render
//     "no items" fallbacks. A blank page is much worse UX than a missing
//     menu, so we err strongly toward graceful degrade.
//
// **Idempotent:** the injected block starts with a `<!-- abw:signalpoint-shim
// :v1 -->` marker. If we encounter it during a subsequent injection pass
// (re-publish, agent re-run, etc.) we skip the file. Re-injection would
// otherwise duplicate the script and fire double events.
//
// **Tested by:** apps/api/tests/integration/standalone-regression.test.ts
// (the file is whitelisted in ALLOWED_GATE_FILES because it's the
// orchestrator that handles SPS state — the gate function below is what
// keeps standalone projects free of SPS references).

import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile, type WorkspaceHandle } from '../../preview/workspace';
import { loadNicheManifests, type NicheManifestType, type PlanType } from './plan';

/** Marker comment placed at the start of the injected script block.
 *  Used to detect prior injections so we don't double-inject. The version
 *  suffix lets us evolve the script later — bumping it forces a re-inject
 *  with the new payload while leaving v1-marked sites untouched. */
const SHIM_MARKER = '<!-- abw:signalpoint-shim:v1 -->';

/** Minimal subset of the project record this function needs. The actual
 *  SignalPointConfig type lives in @abw/site-data; we accept any object
 *  with the workspace_id present as the gate signal. */
export interface ProjectSignalPointHandle {
  /** SPS workspace id the project is tagged with. NULL/undefined for
   *  ordinary standalone-IDE projects (the vast majority). */
  spsWorkspaceId?: string | null;
  /** When the publish flow has resolved a full config from SPS's issuer,
   *  this is populated. NULL until SPS_HANDOFF_KID + the issuer endpoint
   *  are live + a valid config has been minted for this tenant.
   *
   *  Shape matches SPS round-4 issuer response (`POST /api/abw/site-config-token`)
   *  inner `config` object. `edge_base_url` was added in round 4 so the shim
   *  knows where to refresh from. */
  signalpointConfig?: {
    workspace_id:  string;
    supabase_url:  string;
    anon_key:      string;
    edge_token:    string;
    edge_base_url: string;
    expires_at:    string;
  } | null;
}

export interface InjectSiteDataShimInput {
  /** The workspace to mutate. Idempotent — re-running on an already-injected
   *  workspace is a no-op for the affected files. Pass undefined or a
   *  workspace with no HTML files to skip injection while still reporting
   *  what would have been injected. */
  ws?:           WorkspaceHandle;
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
  /** Whether the shim was injected. False = no-op took the standalone path
   *  OR no HTML files were present to inject into. */
  injected:    boolean;
  /** Reason the function took its branch. Logged by the caller. */
  reason:      string;
  /** Bindings resolved from the niche manifest. Empty when injected=false. */
  bindings:    Array<{ source: string; target: string }>;
  /** Number of HTML files actually rewritten. May be 0 even when
   *  `injected=true` if the workspace happened to contain no .html files
   *  (e.g. the agent only wrote .md or .json so far). */
  filesTouched: number;
}

/**
 * Build the script block we'll inject before `</body>` in every HTML file.
 *
 * Embeds the bindings array as a literal JSON value. Self-contained: no
 * imports, no module system, browser-safe. The script handles every
 * failure mode silently to avoid breaking the page.
 */
export function buildShimScript(bindings: Array<{ source: string; target: string }>): string {
  // Single quotes inside JSON.stringify output → safe to inline. We escape
  // the closing tag to defend against an unlikely "</script>" appearing
  // inside a binding's source/target string (we control the input, but
  // belt-and-suspenders).
  const bindingsJson = JSON.stringify(bindings).replace(/<\/script/gi, '<\\/script');
  return `${SHIM_MARKER}
<script>(function(){
if(typeof window==='undefined'||window.__signalpoint)return;
var B=${bindingsJson};
if(!Array.isArray(B)||!B.length)return;
function gj(u,h){return fetch(u,{headers:h||{}}).then(function(r){return r.ok?r.json():null}).catch(function(){return null})}
gj('/signalpoint-config.json').then(function(c){
if(!c||typeof c!=='object'||!c.supabase_url||!c.anon_key||!c.workspace_id)return;
var H={'apikey':c.anon_key,'authorization':'Bearer '+c.anon_key,'x-workspace-id':c.workspace_id,'accept':'application/json'};
var D={};
var P=B.map(function(b){
var u=String(c.supabase_url).replace(/\\/+$/,'')+'/rest/v1/'+encodeURIComponent(b.source)+'?select=*';
return gj(u,H).then(function(r){D[b.target]=Array.isArray(r)?r:[]})
});
Promise.all(P).then(function(){
window.__signalpoint=D;
try{document.dispatchEvent(new CustomEvent('signalpoint:ready',{detail:D}))}catch(_){}
})});
})();</script>`;
}

/** Inject the shim block before the LAST `</body>` in `html`. If no
 *  closing body tag is present, append at end. Returns the rewritten
 *  HTML, or null when the marker is already present (idempotent skip). */
export function injectShimIntoHtml(html: string, script: string): string | null {
  if (html.includes(SHIM_MARKER)) return null;
  // Find the LAST occurrence of </body> case-insensitively.
  const re = /<\/body\s*>/gi;
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) lastIdx = m.index;
  if (lastIdx < 0) {
    // No </body> tag — append at end with a leading newline.
    return html.endsWith('\n') ? html + script + '\n' : html + '\n' + script + '\n';
  }
  return html.slice(0, lastIdx) + script + '\n' + html.slice(lastIdx);
}

/**
 * The gate. Returns early when the project doesn't have an SPS link OR
 * when the niche manifest doesn't have site_data_bindings populated.
 *
 * When all gates pass AND a workspace is provided, walks every .html /
 * .htm file in the workspace and injects the shim script before
 * `</body>`. Idempotent — files already carrying the SHIM_MARKER are
 * skipped.
 */
export async function maybeInjectSiteDataShim(
  input: InjectSiteDataShimInput,
): Promise<InjectSiteDataShimResult> {
  const { ws, projectTypeId, plan, project } = input;

  // Gate 1: no SPS workspace tag → standalone bundle, no-op.
  if (!project.spsWorkspaceId) {
    return { injected: false, reason: 'standalone (no spsWorkspaceId)', bindings: [], filesTouched: 0 };
  }

  // Gate 2: no resolved signalpoint config → can't actually fetch data
  // even if we wanted to. Standalone-quality bundle, no-op.
  if (!project.signalpointConfig) {
    return {
      injected: false,
      reason:   'spsWorkspaceId set but signalpointConfig is null (issuer not yet wired)',
      bindings: [],
      filesTouched: 0,
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
      filesTouched: 0,
    };
  }

  const matched = manifests.find((m) => m.niche === plan.niche) ?? null;
  if (!matched) {
    return {
      injected: false,
      reason:   `no manifest matched plan.niche=${plan.niche}`,
      bindings: [],
      filesTouched: 0,
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
      filesTouched: 0,
    };
  }

  // ── All gates passed ─────────────────────────────────────────────────────
  // If no ws was provided (e.g. unit-testing the gate logic without a
  // real workspace), report the resolved bindings but skip the file write.
  if (!ws) {
    return {
      injected: true,
      reason:   `would inject ${rawBindings.length} binding(s) for niche ${plan.niche} (no ws provided — skipping write)`,
      bindings: rawBindings,
      filesTouched: 0,
    };
  }

  // Walk the workspace, filter to HTML files, inject into each.
  const allFiles = await listWorkspaceFiles(ws);
  const htmlFiles = allFiles.filter((p) => /\.(html?|htm)$/i.test(p));
  const script = buildShimScript(rawBindings);
  let touched = 0;
  for (const relPath of htmlFiles) {
    const html = await readWorkspaceFile(ws, relPath);
    if (!html) continue;
    const next = injectShimIntoHtml(html, script);
    if (next === null) continue; // marker already present — idempotent skip
    await writeWorkspaceFile(ws, relPath, next);
    touched++;
  }

  return {
    injected: true,
    reason:   `injected shim into ${touched}/${htmlFiles.length} html file(s) for niche ${plan.niche}`,
    bindings: rawBindings,
    filesTouched: touched,
  };
}
