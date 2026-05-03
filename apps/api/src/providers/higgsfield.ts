// apps/api/src/providers/higgsfield.ts — Higgsfield MCP client + OAuth provider.
//
// Higgsfield exposes 30+ image and video models behind a hosted MCP server at
// https://mcp.higgsfield.ai/mcp. Auth: OAuth 2.0 Authorization Code + PKCE.
// We rely on the SDK's built-in auth orchestrator (auth.ts) and Dynamic Client
// Registration (RFC 7591) so we don't have to pre-register a client.
//
// Persistence (per tenant + env):
//   vault[HIGGSFIELD_OAUTH_TOKENS] = JSON({ access_token, refresh_token, expires_at, ... })
//   vault[HIGGSFIELD_OAUTH_CLIENT] = JSON(OAuthClientInformationFull)  // dynamically registered client
//
// Ephemeral OAuth state (codeVerifier, captured authorization URL, etc.)
//   ↓ kept in-process Map keyed by `state` parameter, 10-minute TTL.
//   This is fine for a single-process API. If we scale horizontally, swap to
//   Redis or a `oauth_sessions` DB table.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { vaultGet, vaultPut, vaultList, vaultDel, vaultRotate } from '../security/vault';

export const HIGGSFIELD_MCP_URL = 'https://mcp.higgsfield.ai/mcp';

/** Public base URL of THIS API server, used as the OAuth redirect target.
 *  Configured via env `PUBLIC_API_URL`. Defaults to the dev URL. */
function getRedirectUri(): string {
  const base = process.env['PUBLIC_API_URL'] ?? `http://localhost:${process.env['PORT'] ?? 3007}`;
  return `${base}/api/higgsfield/oauth/callback`;
}

// ── Vault key names ─────────────────────────────────────────────────────────
// Per-tenant entries; we read/write all of them through the vault module so
// they share the same encryption boundary as every other secret.
const TOKENS_KEY = 'HIGGSFIELD_OAUTH_TOKENS';
const CLIENT_KEY = 'HIGGSFIELD_OAUTH_CLIENT';

// ── Ephemeral state (in-process) ────────────────────────────────────────────

interface PendingOAuth {
  tenantId:    string;
  codeVerifier: string;
  authUrl?:    URL;
  startedAt:   number;
  /** Promise resolvers used by the /start route to wait for auth() to call
   *  redirectToAuthorization() and capture the URL. */
  onUrl?:      (url: URL) => void;
}

const pending: Map<string, PendingOAuth> = new Map();
const PENDING_TTL_MS = 10 * 60_000;

function gcPending(): void {
  const now = Date.now();
  for (const [state, data] of pending) {
    if (now - data.startedAt > PENDING_TTL_MS) pending.delete(state);
  }
}

// ── Vault helpers (per tenant) ──────────────────────────────────────────────

async function getStoredTokens(tenantId: string, env: string): Promise<OAuthTokens | undefined> {
  try {
    const raw = await vaultGet({ name: TOKENS_KEY, env, tenantId });
    return JSON.parse(raw) as OAuthTokens;
  } catch {
    return undefined;
  }
}

async function setStoredTokens(tenantId: string, env: string, tokens: OAuthTokens, ownerId?: string): Promise<void> {
  // Replace existing entry: find the metadata id then either rotate or insert.
  const list = await vaultList({ tenantId });
  const existing = list.find((m) => m.name === TOKENS_KEY && m.env === env);
  if (existing) {
    await vaultRotate({ metadataId: existing.id, newValue: JSON.stringify(tokens), tenantId });
  } else {
    await vaultPut({ name: TOKENS_KEY, value: JSON.stringify(tokens), scope: 'tenant', env, tenantId, ownerId });
  }
}

async function getStoredClient(tenantId: string, env: string): Promise<OAuthClientInformationFull | undefined> {
  try {
    const raw = await vaultGet({ name: CLIENT_KEY, env, tenantId });
    return JSON.parse(raw) as OAuthClientInformationFull;
  } catch {
    return undefined;
  }
}

async function setStoredClient(tenantId: string, env: string, info: OAuthClientInformationFull, ownerId?: string): Promise<void> {
  const list = await vaultList({ tenantId });
  const existing = list.find((m) => m.name === CLIENT_KEY && m.env === env);
  if (existing) {
    await vaultRotate({ metadataId: existing.id, newValue: JSON.stringify(info), tenantId });
  } else {
    await vaultPut({ name: CLIENT_KEY, value: JSON.stringify(info), scope: 'tenant', env, tenantId, ownerId });
  }
}

export async function clearHiggsfieldVault(tenantId: string, env: string): Promise<void> {
  const list = await vaultList({ tenantId });
  for (const meta of list) {
    if ((meta.name === TOKENS_KEY || meta.name === CLIENT_KEY) && meta.env === env) {
      await vaultDel({ metadataId: meta.id, tenantId });
    }
  }
}

// ── Tenant-scoped OAuth provider ────────────────────────────────────────────
//
// One instance per (tenantId, env, state) trio. The `state` parameter is the
// OAuth `state` value we generate during /start; the SDK and the callback
// route both look up the provider by state to coordinate the dance.

class HiggsfieldOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly tenantId: string,
    private readonly env: string,
    private readonly stateValue: string,
    private readonly ownerId?: string,
  ) {}

  get redirectUrl(): string {
    return getRedirectUri();
  }

  get clientMetadata(): OAuthClientMetadata {
    // Sent to Higgsfield during Dynamic Client Registration.
    // Scopes per Clerk's well-known metadata for clerk.higgsfield.ai:
    //   openid · profile · email · offline_access
    // (offline_access is required to receive a refresh_token.)
    return {
      client_name:               'AI Builder Workspace',
      redirect_uris:             [getRedirectUri()],
      grant_types:               ['authorization_code', 'refresh_token'],
      response_types:            ['code'],
      token_endpoint_auth_method: 'none',  // public client (PKCE)
      scope:                     'openid profile email offline_access',
    };
  }

  state(): string {
    return this.stateValue;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return getStoredClient(this.tenantId, this.env);
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await setStoredClient(this.tenantId, this.env, info, this.ownerId);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return getStoredTokens(this.tenantId, this.env);
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await setStoredTokens(this.tenantId, this.env, tokens, this.ownerId);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Don't actually redirect — capture the URL so the /start route can return
    // it to the frontend, which then opens it in a popup.
    const slot = pending.get(this.stateValue);
    if (slot) {
      slot.authUrl = authorizationUrl;
      slot.onUrl?.(authorizationUrl);
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const slot = pending.get(this.stateValue);
    if (slot) slot.codeVerifier = codeVerifier;
  }

  async codeVerifier(): Promise<string> {
    const slot = pending.get(this.stateValue);
    if (!slot?.codeVerifier) throw new Error('codeVerifier missing for state ' + this.stateValue);
    return slot.codeVerifier;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'all' || scope === 'tokens') {
      const list = await vaultList({ tenantId: this.tenantId });
      const meta = list.find((m) => m.name === TOKENS_KEY && m.env === this.env);
      if (meta) await vaultDel({ metadataId: meta.id, tenantId: this.tenantId });
    }
    if (scope === 'all' || scope === 'client') {
      const list = await vaultList({ tenantId: this.tenantId });
      const meta = list.find((m) => m.name === CLIENT_KEY && m.env === this.env);
      if (meta) await vaultDel({ metadataId: meta.id, tenantId: this.tenantId });
    }
    if (scope === 'all' || scope === 'verifier') {
      pending.delete(this.stateValue);
    }
  }

  async saveDiscoveryState(_state: OAuthDiscoveryState): Promise<void> {
    // No-op: we re-discover on each connect (Higgsfield is hosted, latency is fine).
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface OAuthStartResult {
  state:    string;
  authUrl:  string;
}

/**
 * Begin the OAuth dance. Generates a `state`, builds an OAuthClientProvider for
 * this session, runs the SDK's auth() orchestrator which performs RFC 9728
 * resource metadata discovery → RFC 8414 auth-server metadata → RFC 7591
 * Dynamic Client Registration (if no client info stored) → builds the
 * authorization URL with PKCE → calls our redirectToAuthorization() to
 * surface it. We capture the URL into the pending slot and return it for
 * the frontend to open in a popup.
 */
export async function beginHiggsfieldAuth(
  tenantId: string,
  env:      string,
  ownerId?: string,
): Promise<OAuthStartResult> {
  gcPending();
  const stateValue = crypto.randomUUID();
  pending.set(stateValue, { tenantId, codeVerifier: '', startedAt: Date.now() });

  const provider = new HiggsfieldOAuthProvider(tenantId, env, stateValue, ownerId);

  const { auth } = await import('@modelcontextprotocol/sdk/client/auth.js');
  const result = await auth(provider, { serverUrl: HIGGSFIELD_MCP_URL });

  if (result === 'AUTHORIZED') {
    // We already had valid tokens — no popup needed.
    pending.delete(stateValue);
    return { state: stateValue, authUrl: '' };
  }

  // result === 'REDIRECT' — the URL should have been captured by our
  // redirectToAuthorization() during auth().
  const authUrl = pending.get(stateValue)?.authUrl;
  if (!authUrl) throw new Error('SDK reported REDIRECT but did not produce an auth URL');
  return { state: stateValue, authUrl: authUrl.toString() };
}

/**
 * Complete the OAuth dance: exchange the authorization code for tokens.
 * Called from the /api/higgsfield/oauth/callback route.
 */
export async function finishHiggsfieldAuth(
  state:             string,
  authorizationCode: string,
): Promise<{ tenantId: string }> {
  const slot = pending.get(state);
  if (!slot) throw new Error('Unknown or expired OAuth state');

  const provider = new HiggsfieldOAuthProvider(slot.tenantId, 'dev', state);

  // Calling auth() again with the authorizationCode triggers the token exchange.
  const { auth } = await import('@modelcontextprotocol/sdk/client/auth.js');
  const result = await auth(provider, { serverUrl: HIGGSFIELD_MCP_URL, authorizationCode });
  if (result !== 'AUTHORIZED') throw new Error(`OAuth exchange did not authorize: ${String(result)}`);

  pending.delete(state);
  return { tenantId: slot.tenantId };
}

// ── MCP client open/close ───────────────────────────────────────────────────

export interface HiggsfieldClient {
  listTools(): Promise<{ name: string; description?: string; inputSchema?: unknown }[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close():     Promise<void>;
}

/**
 * Open an authenticated Higgsfield MCP client for a tenant. Uses the stored
 * OAuth tokens; the SDK auto-refreshes when access tokens expire.
 */
export async function openHiggsfield(
  tenantId: string,
  env:      string = 'dev',
): Promise<HiggsfieldClient> {
  // Use a "passive" provider with a dummy state — we never call redirect during
  // a normal call; if the SDK throws UnauthorizedError, the caller surfaces a
  // re-connect prompt to the user.
  const dummyState = `passive-${crypto.randomUUID()}`;
  const provider = new HiggsfieldOAuthProvider(tenantId, env, dummyState);

  // Bail early if the tenant has no tokens at all.
  const t = await getStoredTokens(tenantId, env);
  if (!t) throw new Error('Higgsfield not connected. Open /integrations and click Connect.');

  const transport = new StreamableHTTPClientTransport(new URL(HIGGSFIELD_MCP_URL), { authProvider: provider });
  const client = new Client({ name: 'abw-api', version: '0.1.0' });
  await client.connect(transport);

  return {
    async listTools() {
      const r = await client.listTools();
      return r.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    },
    async callTool(name, args) {
      return await client.callTool({ name, arguments: args });
    },
    async close() {
      await client.close().catch(() => {});
    },
  };
}

export async function isHiggsfieldConnected(tenantId: string, env: string = 'dev'): Promise<boolean> {
  const t = await getStoredTokens(tenantId, env);
  return !!t;
}

// ── Models discovery + media helpers ─────────────────────────────────────────
//
// Higgsfield's `generate_image` / `generate_video` tools require a model_id
// pulled from `models_explore`. We cache the discovered list per tenant for
// 10 min so subsequent calls don't pay the discovery round-trip.

export interface HiggsfieldModel {
  id:            string;
  name?:         string;
  output_type?:  'image' | 'video';
  provider_name?: string;
  description?:  string;
}

interface CachedModels {
  models:    HiggsfieldModel[];
  fetchedAt: number;
}
const modelsCache = new Map<string, CachedModels>();
const MODELS_TTL_MS = 10 * 60_000;

/** Fetch + cache the model catalogue. */
export async function listHiggsfieldModels(tenantId: string, env: string = 'dev'): Promise<HiggsfieldModel[]> {
  const cached = modelsCache.get(tenantId);
  if (cached && Date.now() - cached.fetchedAt < MODELS_TTL_MS) return cached.models;

  const c = await openHiggsfield(tenantId, env);
  try {
    // Note: models_explore takes top-level args, NOT { params: {...} }.
    const r = await c.callTool('models_explore', { action: 'list', limit: 100 });
    let models: HiggsfieldModel[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ra = r as any;
    for (const item of ra?.content ?? []) {
      if (item?.type === 'text' && typeof item.text === 'string') {
        try {
          const parsed = JSON.parse(item.text);
          if (Array.isArray(parsed?.items)) models = parsed.items;
          else if (Array.isArray(parsed))    models = parsed;
        } catch { /* skip non-json content */ }
      }
    }
    modelsCache.set(tenantId, { models, fetchedAt: Date.now() });
    return models;
  } finally {
    await c.close();
  }
}

export type Quality = 'draft' | 'standard' | 'premium';

/** Higgsfield subscription tiers (cheapest → most expensive). Set via env
 *  `HIGGSFIELD_TIER` so the model picker doesn't hand the agent something
 *  the user can't actually run. Defaults to `starter` because that's the
 *  most restrictive paid tier and matches "fail safe": if we don't know
 *  what the user has, assume the lowest tier and only escalate when told. */
export type HiggsfieldTier = 'free' | 'starter' | 'plus' | 'ultra' | 'business';

/** Models GATED above each tier (i.e. NOT available at this tier). Verified
 *  against higgsfield.ai/pricing on 2026-05-03. The picker skips any id whose
 *  prefix matches one of these substrings when the tier is `starter`. */
const STARTER_GATED_MODEL_PREFIXES = [
  'sora_2',           // Sora 2 / 2 Pro / 2 Max — Plus+
  'sora2',
  'veo3',             // Google Veo 3 + Veo 3.1 — Plus+
  'veo_3',
  'higgsfield_dop_turbo', // DoP Turbo — Plus+
  'speak_2',          // Higgsfield Speak 2.0 — Plus+
  'kling_speak',      // Kling Speak/Lipsync — Plus+
  'kling_lipsync',
  'infinite_talk',    // Infinite Talk — Plus+
  'sync_lipsync',     // Sync Lipsync 2 Pro — Plus+
];

const PLUS_GATED_MODEL_PREFIXES: string[] = [
  // Plus has all Starter models + Sora/Veo. No Plus-specific gates known.
];

function getCurrentTier(): HiggsfieldTier {
  const raw = (process.env['HIGGSFIELD_TIER'] ?? 'starter').toLowerCase();
  if (raw === 'free' || raw === 'starter' || raw === 'plus' || raw === 'ultra' || raw === 'business') {
    return raw;
  }
  return 'starter';
}

function isModelAllowedForTier(modelId: string, tier: HiggsfieldTier): boolean {
  const id = modelId.toLowerCase();
  if (tier === 'free' || tier === 'starter') {
    if (STARTER_GATED_MODEL_PREFIXES.some((p) => id.includes(p))) return false;
  }
  if (tier === 'plus') {
    if (PLUS_GATED_MODEL_PREFIXES.some((p) => id.includes(p))) return false;
  }
  // Ultra + Business have access to everything.
  return true;
}

/** Pick a model id given a kind + quality preference, restricted to what
 *  the configured `HIGGSFIELD_TIER` actually has access to. */
export function pickHiggsfieldModel(
  models:  HiggsfieldModel[],
  kind:    'image' | 'video',
  quality: Quality = 'standard',
): string | undefined {
  const tier = getCurrentTier();
  const matching = models
    .filter((m) => m.output_type === kind)
    .filter((m) => isModelAllowedForTier(m.id, tier));
  if (matching.length === 0) return undefined;

  // Preference order per quality. The premium tier here picks the BEST
  // model the user's account can run, not the most expensive Higgsfield
  // offers — so quality:premium on a Starter account picks Kling 3.0
  // (Starter's best video) rather than Veo 3.1 (gated to Plus+).
  const prefs: Record<Quality, string[]> = kind === 'image'
    ? {
        draft:    ['flux_2', 'seedream_v5_lite', 'image_auto', 'nano_banana_flash'],
        standard: ['flux_2', 'seedream_v4_5', 'soul_2', 'gpt_image_2'],
        premium:  ['soul_2', 'cinematic_studio_2_5', 'gpt_image_2'],
      }
    : {
        draft:    ['seedance_1_5', 'video_standard', 'hailuo_02_fast'],
        standard: ['seedance_2_0_fast', 'kling2_6', 'seedance_1_5', 'hailuo_02', 'cinematic_studio_video_v2'],
        // Premium = best available at the configured tier. Tier filter above
        // already drops Veo/Sora when on Starter, so the fallback chain finds
        // the next-best (Kling 3.0 or Seedance 2.0 Fast for Starter).
        premium:  ['veo3_1', 'sora_2_pro', 'veo3', 'kling3_0', 'seedance_2_0_fast', 'kling2_6'],
      };
  for (const want of prefs[quality]) {
    const hit = matching.find((m) => m.id === want);
    if (hit) return hit.id;
  }
  return matching[0]?.id;
}

interface MCPGenContent { type: string; text?: string; data?: string; url?: string; mimeType?: string }

/** Extract a job id from a generate_* submit response. */
function extractJobIdFromSubmit(raw: unknown): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  const sid = r?.structuredContent?.results?.[0]?.id;
  if (typeof sid === 'string') return sid;
  for (const c of r?.content ?? []) {
    if (c?.type === 'text' && c?.text) {
      const m = c.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      if (m) return m[0];
    }
  }
  return null;
}

/** Poll a Higgsfield job until it completes or fails. */
async function pollHiggsfieldJob(
  client:  HiggsfieldClient,
  jobId:   string,
  timeoutSec = 360,
): Promise<unknown> {
  const t0 = Date.now();
  let attempts = 0;
  while (Date.now() - t0 < timeoutSec * 1000) {
    attempts++;
    const r = await client.callTool('job_status', { jobId, sync: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ra = r as any;
    if (ra?.isError) return r;
    const gen = ra?.structuredContent?.generation;
    const status = gen?.status;
    if (typeof status === 'string') {
      const s = status.toLowerCase();
      if (['completed', 'success', 'finished', 'done', 'ok'].includes(s)) return r;
      if (['failed', 'error', 'cancelled', 'canceled'].includes(s))      return r;
    }
    if (Array.isArray(gen?.params?.medias) && gen.params.medias.length > 0) return r;
    const wait = ra?.structuredContent?.poll_after_seconds ?? 4;
    await new Promise((res) => setTimeout(res, Math.min(wait * 1000, 6000)));
    if (attempts > 80) break;
  }
  throw new Error(`Higgsfield job ${jobId} did not complete within ${timeoutSec}s`);
}

/** Pull a downloaded buffer from a completed job_status response. */
export async function extractHiggsfieldMedia(
  raw:         unknown,
  defaultMime: string,
): Promise<{ buffer: Buffer; mimeType: string; sourceUrl?: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  if (r?.isError) return null;
  let url:    string | undefined;
  let buffer: Buffer | undefined;
  let mime = defaultMime;

  // Primary path: structuredContent.generation.params.medias[]
  const medias = r?.structuredContent?.generation?.params?.medias;
  if (Array.isArray(medias)) {
    for (const m of medias) {
      if (typeof m === 'string' && /^https?:\/\//.test(m) && !url) url = m;
      if (m?.url && !url)          url = m.url;
      if (m?.original_url && !url) url = m.original_url;
      if (m?.media_url && !url)    url = m.media_url;
    }
  }
  // Older shape fallback
  for (const item of r?.structuredContent?.results ?? []) {
    if (item?.url && !url) url = item.url;
  }
  // content[] embedded URLs / blobs
  for (const c of (r?.content ?? []) as MCPGenContent[]) {
    if (c.type === 'image' || c.type === 'audio' || c.type === 'video' || c.type === 'resource') {
      if (c.url)       url    = c.url;
      else if (c.data) buffer = Buffer.from(c.data, 'base64');
      if (c.mimeType)  mime   = c.mimeType;
    } else if (c.type === 'text' && c.text && !url) {
      const m = c.text.match(/https?:\/\/[^\s)"']+\.(png|jpe?g|mp4|mov|webm|webp)/i);
      if (m) url = m[0];
    }
  }
  if (!buffer && url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) return null;
    buffer = Buffer.from(await res.arrayBuffer());
    const ext = url.match(/\.(png|jpe?g|mp4|mov|webm|webp)/i)?.[1]?.toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
    else if (ext === 'png') mime = 'image/png';
    else if (ext === 'webp') mime = 'image/webp';
    else if (ext === 'mp4') mime = 'video/mp4';
    else if (ext === 'mov') mime = 'video/quicktime';
    else if (ext === 'webm') mime = 'video/webm';
  }
  return buffer ? { buffer, mimeType: mime, sourceUrl: url } : null;
}

/** High-level: submit a `generate_image` or `generate_video` call, poll, return
 *  the downloaded media buffer + mimeType. Hides the schema details (params
 *  wrapper, jobId, status path, media extraction) from callers. */
export async function generateHiggsfieldMedia(opts: {
  tenantId:    string;
  env?:        string;
  kind:        'image' | 'video';
  prompt:      string;
  /** Override the auto-picked model. */
  modelId?:    string;
  quality?:    Quality;
  aspectRatio?: string;
  durationSec?: number;     // video only
  count?:       number;
}): Promise<{ buffer: Buffer; mimeType: string; sourceUrl?: string; modelUsed: string } | null> {
  const env = opts.env ?? 'dev';
  const models = await listHiggsfieldModels(opts.tenantId, env);
  const modelId = opts.modelId ?? pickHiggsfieldModel(models, opts.kind, opts.quality ?? 'standard');
  if (!modelId) throw new Error(`No Higgsfield ${opts.kind} model available for this account`);

  const toolName = opts.kind === 'image' ? 'generate_image' : 'generate_video';
  const params: Record<string, unknown> = {
    model:        modelId,
    prompt:       opts.prompt,
    aspect_ratio: opts.aspectRatio ?? (opts.kind === 'image' ? '1:1' : '16:9'),
    count:        opts.count ?? 1,
  };
  if (opts.kind === 'video' && opts.durationSec) params['duration'] = opts.durationSec;

  const c = await openHiggsfield(opts.tenantId, env);
  try {
    const submitResp = await c.callTool(toolName, { params });
    const jobId = extractJobIdFromSubmit(submitResp);
    if (!jobId) throw new Error(`Higgsfield submit returned no job id`);
    const finalResp = await pollHiggsfieldJob(c, jobId, opts.kind === 'video' ? 360 : 60);
    const defaultMime = opts.kind === 'image' ? 'image/png' : 'video/mp4';
    const media = await extractHiggsfieldMedia(finalResp, defaultMime);
    if (!media) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fr = finalResp as any;
      const errText = fr?.content?.[0]?.text ?? fr?.structuredContent?.generation?.status ?? 'unknown';
      throw new Error(`Higgsfield ${opts.kind} job ${jobId} produced no media (${String(errText).slice(0, 200)})`);
    }
    return { ...media, modelUsed: modelId };
  } finally {
    await c.close();
  }
}

// ── Tool catalogue helper (unchanged from previous impl) ────────────────────

export function categorizeHiggsfieldTools(
  tools: { name: string; description?: string }[],
): {
  images:     string[];
  videos:     string[];
  audio:      string[];
  characters: string[];
  history:    string[];
  other:      string[];
} {
  const out = { images: [] as string[], videos: [] as string[], audio: [] as string[], characters: [] as string[], history: [] as string[], other: [] as string[] };
  for (const t of tools) {
    const blob = `${t.name} ${t.description ?? ''}`.toLowerCase();
    if (/image|photo|picture|nano-banana|flux|seedream|gpt-image|soul/.test(blob) && !/video|motion|kling|veo|sora|seedance|hailuo|wan/.test(blob)) {
      out.images.push(t.name);
    } else if (/video|motion|kling|veo|sora|seedance|hailuo|wan|cinema/.test(blob)) {
      out.videos.push(t.name);
    } else if (/audio|music|voice|speech|sound/.test(blob)) {
      out.audio.push(t.name);
    } else if (/character|train|consistency/.test(blob)) {
      out.characters.push(t.name);
    } else if (/history|list|browse|asset|library/.test(blob)) {
      out.history.push(t.name);
    } else {
      out.other.push(t.name);
    }
  }
  return out;
}
