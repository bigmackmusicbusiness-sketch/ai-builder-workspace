// apps/api/src/publish/coolifyApi.ts — thin client for the Coolify v1 API.
//
// Used by the publish flow to register a custom domain on the api
// application's docker_compose_domains so Traefik routes the user's domain
// to our backend. Without this step, CF CNAME → our origin gets a 503 from
// Traefik because the host isn't in its routing table.
//
// Endpoints:
//   GET   /api/v1/applications/{uuid}            — read current config
//   PATCH /api/v1/applications/{uuid}            — update docker_compose_domains
//   POST  /api/v1/applications/{uuid}/restart    — pick up new compose labels
//
// Auth: vault[COOLIFY_API_TOKEN] (or COOLIFY_TOKEN / coolify.api_token)
//   Token must have at least `root` scope (or read+write+deploy).
// App identity: vault[COOLIFY_APP_UUID] — the api application's UUID,
//   visible in the Coolify dashboard URL.
// Coolify base URL: vault[COOLIFY_API_URL] (default http://40.160.3.10:8000)
//
// docker_compose_domains shape:
//   READ  → JSON-string: {"api":{"domain":"https://a.com,https://b.com"},"web":{...}}
//   WRITE → array of objects: [{"name":"api","domain":"https://a.com,https://b.com"},...]
//   Each service's `domain` is a comma-separated list of full URLs.

import { vaultGetOrEnv } from '../security/vault';

const TOKEN_NAMES = ['COOLIFY_API_TOKEN', 'COOLIFY_TOKEN', 'coolify.api_token'];
const UUID_NAMES  = ['COOLIFY_APP_UUID', 'COOLIFY_API_APP_UUID', 'coolify.api_app_uuid'];
const URL_NAMES   = ['COOLIFY_API_URL', 'coolify.api_url'];

const DEFAULT_COOLIFY_URL  = 'http://40.160.3.10:8000';
/** Which compose service hosts the api process — domains get appended here. */
const API_SERVICE_NAME     = 'api';

interface CoolifyConfig {
  token:    string;
  appUuid:  string;
  baseUrl:  string;
}

/** Look up Coolify creds + the api app UUID from the platform vault.
 *  Returns null if any required secret is missing — caller should treat
 *  Coolify integration as a no-op rather than failing the whole deploy. */
export async function getCoolifyConfig(tenantId: string, env: string): Promise<CoolifyConfig | null> {
  // Platform-key resolution: vault first (BYOK), then process.env (Coolify-level
  // for internal-app deploys where one operator manages a single Coolify cluster).
  const token = await vaultGetOrEnv({ names: TOKEN_NAMES, env, tenantId });
  if (!token) return null;
  const appUuid = await vaultGetOrEnv({ names: UUID_NAMES, env, tenantId });
  if (!appUuid) return null;
  const rawUrl = await vaultGetOrEnv({ names: URL_NAMES, env, tenantId });
  const baseUrl = (rawUrl ?? DEFAULT_COOLIFY_URL).replace(/\/$/, '');
  return { token, appUuid, baseUrl };
}

/** Read the application config. Returns the parsed docker_compose_domains
 *  map: { <service>: { domain: '<comma-separated urls>' } }. */
async function fetchApp(cfg: CoolifyConfig): Promise<Record<string, { domain: string }>> {
  const res = await fetch(`${cfg.baseUrl}/api/v1/applications/${cfg.appUuid}`, {
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Coolify GET /applications/${cfg.appUuid} -> ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const body = await res.json() as { docker_compose_domains?: string };
  const raw  = body.docker_compose_domains;
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, { domain: string }>; }
  catch { return {}; }
}

/** Idempotent: add `host` to the api service's domain list if absent.
 *  Returns true if a change was made and a restart will be needed. */
export async function ensureDomainBound(host: string, cfg: CoolifyConfig): Promise<boolean> {
  // Normalize to https://<host> for storage
  const target = `https://${host.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

  const current = await fetchApp(cfg);
  const existingDomains = (current[API_SERVICE_NAME]?.domain ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (existingDomains.includes(target)) {
    return false; // already bound
  }

  // Build the array shape the PATCH endpoint expects, preserving every
  // OTHER service's existing domain entries verbatim.
  const updated: Array<{ name: string; domain: string }> = [];
  for (const [name, val] of Object.entries(current)) {
    if (name === API_SERVICE_NAME) continue;
    updated.push({ name, domain: val.domain });
  }
  // Append the api row with the new host added
  updated.push({
    name:   API_SERVICE_NAME,
    domain: [...existingDomains, target].join(','),
  });

  const res = await fetch(`${cfg.baseUrl}/api/v1/applications/${cfg.appUuid}`, {
    method:  'PATCH',
    headers: {
      Authorization:   `Bearer ${cfg.token}`,
      'Content-Type':  'application/json',
      Accept:          'application/json',
    },
    body: JSON.stringify({ docker_compose_domains: updated }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Coolify PATCH /applications/${cfg.appUuid} -> ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return true;
}

/** Trigger a redeploy so Coolify regenerates the compose file (with the
 *  new docker_compose_domains entries) and Traefik registers the new host.
 *
 *  Note: /restart alone is NOT enough — it cycles the existing container
 *  without regenerating the compose file from form values, so Traefik
 *  doesn't see the new domain. /deploy mirrors the dashboard's "Save +
 *  Redeploy" click, which is what actually flows the new domain into
 *  the live Traefik routing table. (Verified end-to-end against a fake
 *  host before shipping this code.) */
export async function restartApplication(cfg: CoolifyConfig): Promise<void> {
  const res = await fetch(
    `${cfg.baseUrl}/api/v1/deploy?uuid=${encodeURIComponent(cfg.appUuid)}`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
      signal:  AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    throw new Error(`Coolify deploy -> ${res.status}: ${await res.text().catch(() => '')}`);
  }
}
