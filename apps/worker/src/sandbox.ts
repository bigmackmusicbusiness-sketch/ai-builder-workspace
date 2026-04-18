// apps/worker/src/sandbox.ts — per-project isolation primitives.
// Each project gets its own KV namespace prefix; no cross-project access.

export interface Env {
  PREVIEW_ROOT_DOMAIN: string;
  /** KV namespace: stores bundled project assets keyed by `<projectSlug>/<path>` */
  PREVIEW_KV: KVNamespace;
}

/** Parse the project slug from the request hostname.
 *  Expects: `<projectSlug>.preview.<rootDomain>`
 *  Falls back to query param `?project=<slug>` for local dev.
 */
export function parseProjectSlug(req: Request, env: Env): string | null {
  const url = new URL(req.url);

  // Hostname-based routing (production)
  const rootDomain = env.PREVIEW_ROOT_DOMAIN;
  const hostname = url.hostname;
  const suffix = `.preview.${rootDomain}`;
  if (hostname.endsWith(suffix)) {
    return hostname.slice(0, -suffix.length) || null;
  }

  // Query-param fallback for local dev (wrangler dev doesn't support subdomains easily)
  const qp = url.searchParams.get('project');
  if (qp) return qp;

  return null;
}

/** KV key for a project asset. */
export function assetKey(projectSlug: string, assetPath: string): string {
  // Normalize: strip leading slash, collapse double slashes
  const clean = assetPath.replace(/^\/+/, '').replace(/\/+/g, '/');
  return `${projectSlug}/${clean}`;
}

/** List all asset keys for a project (for debugging/admin). */
export async function listProjectAssets(
  kv: KVNamespace,
  projectSlug: string,
): Promise<string[]> {
  const prefix = `${projectSlug}/`;
  const list = await kv.list({ prefix });
  return list.keys.map((k) => k.name.slice(prefix.length));
}
