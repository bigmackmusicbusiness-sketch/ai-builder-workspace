// packages/publish/cloudflare-pages.ts — Cloudflare Pages deploy adapter.
// Ensures the Pages project exists, then uploads files via Cloudflare's
// 2-step Direct Upload API (the legacy single-multipart flow was retired
// in 2024 — the deployment endpoint now requires a `manifest` field).
//
// Flow:
//   1. ensurePagesProject() — create the project if not exists
//   2. POST /pages/projects/<name>/upload-token  → JWT
//   3. POST /pages/assets/check-missing with {hashes: [...]} (auth=JWT) → list of missing hashes
//   4. POST /pages/assets/upload with batched payload of missing assets (auth=JWT)
//   5. POST /accounts/<acct>/pages/projects/<name>/deployments multipart with `manifest` (auth=account token)
//      The manifest is a JSON map of file path → 32-char hex hash key.
//
// Hash format: lowercase hex sha256(content + extension), truncated to 32 chars.
// Files batched in groups of <= 5000 keys / <= 100 MiB per /pages/assets/upload call.

import type { DeployResult, PublishAdapter } from './types';
import { createHash } from 'node:crypto';

const CF_API = 'https://api.cloudflare.com/client/v4';

/** Per-batch limits for /pages/assets/upload (Cloudflare-imposed). */
const MAX_BATCH_KEYS  = 5_000;
const MAX_BATCH_BYTES = 100 * 1024 * 1024;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch JSON from Cloudflare API with auth header. Throws on non-2xx. */
async function cfFetch<T = unknown>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  const json = (await res.json()) as { success: boolean; result: T; errors?: { message: string }[] };
  if (!res.ok || !json.success) {
    const msg = json.errors?.[0]?.message ?? res.statusText;
    throw new Error(`Cloudflare API error (${res.status}): ${msg}`);
  }
  return json.result;
}

// ── Project provisioning ──────────────────────────────────────────────────────

/**
 * Ensure a Cloudflare Pages project exists for this slug.
 * Creates one if it does not exist yet. Returns the project name.
 */
export async function ensurePagesProject(
  projectSlug: string,
  accountId: string,
  token: string,
): Promise<string> {
  const projectName = projectSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  try {
    // Check if the project already exists
    await cfFetch(`/accounts/${accountId}/pages/projects/${projectName}`, token);
    return projectName; // already exists
  } catch {
    // Does not exist — create it
    await cfFetch<unknown>(`/accounts/${accountId}/pages/projects`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:              projectName,
        production_branch: 'main',
      }),
    });
    return projectName;
  }
}

// ── Deploy ────────────────────────────────────────────────────────────────────

/** Compute a Cloudflare Pages asset key — lowercase hex SHA-256 of
 *  (content || extension), truncated to 32 chars. Matches wrangler. */
function computeAssetKey(path: string, bytes: Uint8Array): string {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
  const hash = createHash('sha256');
  hash.update(bytes);
  hash.update(ext);
  return hash.digest('hex').slice(0, 32);
}

/** Get a per-deployment JWT for /pages/assets/* uploads.
 *  CF's upload-token endpoint returns either a plain string in `result`
 *  or an object `{ jwt }` depending on API age. Handle both. */
async function fetchUploadJwt(
  accountId: string,
  projectName: string,
  token: string,
): Promise<string> {
  const result = await cfFetch<unknown>(
    `/accounts/${accountId}/pages/projects/${projectName}/upload-token`,
    token,
    { method: 'GET' },
  );
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'jwt' in result) {
    const jwt = (result as { jwt?: unknown }).jwt;
    if (typeof jwt === 'string') return jwt;
  }
  throw new Error(`CF Pages: upload-token endpoint returned unexpected shape: ${JSON.stringify(result).slice(0, 200)}`);
}

/** Ask CF which of these hashes it doesn't already have. */
async function checkMissingHashes(
  hashes: string[],
  jwt: string,
): Promise<string[]> {
  const res = await fetch(`${CF_API}/pages/assets/check-missing`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ hashes }),
  });
  const json = (await res.json()) as {
    success: boolean;
    result?: string[];
    errors?: { message: string }[];
  };
  if (!res.ok || !json.success) {
    const msg = json.errors?.[0]?.message ?? res.statusText;
    throw new Error(`CF Pages check-missing failed (${res.status}): ${msg}`);
  }
  return json.result ?? hashes;
}

/** Upload a batch of assets. Each payload entry mirrors wrangler's:
 *  { base64: true, key, value (base64), metadata: { contentType } }.
 *  The base64 flag is REQUIRED — CF rejects with a 500 if absent. */
async function uploadAssetBatch(
  payload: Array<{ base64: true; key: string; value: string; metadata: { contentType: string } }>,
  jwt: string,
): Promise<void> {
  const res = await fetch(`${CF_API}/pages/assets/upload`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ payload }),
  });
  // Read body once — may be JSON on success/managed errors, HTML on edge errors.
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    // Pull just the visible error sentence(s) out of CF's HTML page if any.
    const cleanLines = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const cfRayMatch = text.match(/Cloudflare Ray ID: <strong>([^<]+)/);
    const ray = cfRayMatch ? ` ray=${cfRayMatch[1]}` : '';
    throw new Error(`CF Pages /assets/upload failed (${res.status})${ray}: ${cleanLines.slice(0, 600)}`);
  }
  let json: { success?: boolean; errors?: { message: string }[] };
  try { json = JSON.parse(text); } catch {
    throw new Error(`CF Pages /assets/upload returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!json.success) {
    const msg = json.errors?.[0]?.message ?? 'unknown';
    throw new Error(`CF Pages /assets/upload error: ${msg}`);
  }
}

/**
 * Push bundled assets to Cloudflare Pages using the Direct Upload API.
 * 2-step flow: hash + upload via JWT, then create deployment with manifest.
 */
export async function deployToCFPages(
  projectSlug: string,
  assets: Map<string, Uint8Array>,
  accountId: string,
  token: string,
): Promise<DeployResult> {
  const t0 = Date.now();

  // 1. Ensure the project exists (or create it)
  const projectName = await ensurePagesProject(projectSlug, accountId, token);

  // 2. Build manifest: path → 32-char hex hash. Path always starts with '/'.
  const manifest: Record<string, string> = {};
  const byHash = new Map<string, { path: string; bytes: Uint8Array }>();
  for (const [path, bytes] of assets.entries()) {
    const normPath = path.startsWith('/') ? path : `/${path}`;
    const key = computeAssetKey(normPath, bytes);
    manifest[normPath] = key;
    if (!byHash.has(key)) byHash.set(key, { path: normPath, bytes });
  }

  // 3. Get a per-deployment JWT (for the asset bulk-upload endpoints)
  const jwt = await fetchUploadJwt(accountId, projectName, token);

  // 4. Ask CF which hashes are missing — only upload those
  const allHashes = [...byHash.keys()];
  const missing = allHashes.length === 0 ? [] : await checkMissingHashes(allHashes, jwt);

  // 5. Batch + upload missing assets
  let batch: Array<{ base64: true; key: string; value: string; metadata: { contentType: string } }> = [];
  let batchBytes = 0;
  for (const hash of missing) {
    const entry = byHash.get(hash);
    if (!entry) continue;
    const { path, bytes } = entry;
    const b64 = Buffer.from(bytes).toString('base64');
    const item: { base64: true; key: string; value: string; metadata: { contentType: string } } = {
      base64:   true,
      key:      hash,
      value:    b64,
      metadata: { contentType: mimeFromPath(path) },
    };
    const itemBytes = b64.length;
    if (batch.length >= MAX_BATCH_KEYS || batchBytes + itemBytes > MAX_BATCH_BYTES) {
      await uploadAssetBatch(batch, jwt);
      batch = [];
      batchBytes = 0;
    }
    batch.push(item);
    batchBytes += itemBytes;
  }
  if (batch.length > 0) await uploadAssetBatch(batch, jwt);

  // 6. Create the deployment with the manifest. multipart/form-data; the
  //    manifest JSON travels in a single field of the same name. CF then
  //    looks up each path's hash against the assets it has on file.
  const form = new FormData();
  form.append('manifest', JSON.stringify(manifest));

  const res = await fetch(
    `${CF_API}/accounts/${accountId}/pages/projects/${projectName}/deployments`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` },
      body:    form,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`CF Pages deploy failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const json = (await res.json()) as {
    success: boolean;
    result?: { url?: string; id?: string };
    errors?: { message: string }[];
  };

  if (!json.success) {
    const msg = json.errors?.[0]?.message ?? 'Unknown error';
    throw new Error(`CF Pages deploy error: ${msg}`);
  }

  const deployUrl = json.result?.url ?? `https://${projectName}.pages.dev`;
  return {
    url:          deployUrl,
    durationMs:   Date.now() - t0,
    deploymentId: json.result?.id,
  };
}

// ── Adapter implementation ────────────────────────────────────────────────────

export const cloudflarePagesAdapter: PublishAdapter = {
  id: 'cloudflare-pages',

  async deploy(projectSlug, assets, accountId, token): Promise<DeployResult> {
    return deployToCFPages(projectSlug, assets, accountId, token);
  },
};

// ── MIME helper ───────────────────────────────────────────────────────────────

function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    html: 'text/html',
    htm:  'text/html',
    js:   'application/javascript',
    mjs:  'application/javascript',
    css:  'text/css',
    json: 'application/json',
    svg:  'image/svg+xml',
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    gif:  'image/gif',
    ico:  'image/x-icon',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
    txt:  'text/plain',
  };
  return map[ext] ?? 'application/octet-stream';
}
