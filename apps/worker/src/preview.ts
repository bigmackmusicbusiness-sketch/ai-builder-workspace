// apps/worker/src/preview.ts — per-project preview sandbox worker.
// Serves bundled project assets from KV, scoped strictly per project slug.
//
// Routing strategies (tried in order):
//   1. Subdomain:  <slug>.preview.<rootDomain>/<asset>   (custom domain, production)
//   2. Path-based: <workerHost>/<slug>/<asset>            (workers.dev, no custom domain needed)
import { assetKey, type Env } from './sandbox';
import { applyEdgeHeaders, mimeFromPath } from './edge';

// Placeholder served when no assets are found in KV for a project.
const BOOT_PLACEHOLDER = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview booting\u2026</title>
  <style>
    body { margin:0; display:flex; align-items:center; justify-content:center;
           height:100vh; background:#0f1117; color:#718096;
           font-family:system-ui,sans-serif; flex-direction:column; gap:16px; }
    .dot { width:8px; height:8px; border-radius:50%; background:#7c3aed;
           animation:pulse 1.2s ease infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  </style>
</head>
<body>
  <div class="dot"></div>
  <span>Booting preview\u2026</span>
</body>
</html>`;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === '/healthz') {
      return new Response(JSON.stringify({ ok: true, service: 'preview-worker' }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // ── Slug + asset path resolution ─────────────────────────────────────────
    const { projectSlug, assetPath: rawPath } = resolveRequest(req, env);
    if (!projectSlug) {
      return new Response('No project specified. Use /<slug>/ path or <slug>.preview.<domain>.', {
        status: 400,
        headers: { 'content-type': 'text/plain' },
      });
    }

    // Normalise asset path; default to index.html
    let assetPath = !rawPath || rawPath === '/' ? '/index.html' : rawPath;

    // KV lookup
    let content = await env.PREVIEW_KV.get(assetKey(projectSlug, assetPath), 'arrayBuffer');

    // SPA fallback: extensionless paths (client-side routes) → serve index.html
    if (!content && !assetPath.includes('.')) {
      content = await env.PREVIEW_KV.get(assetKey(projectSlug, '/index.html'), 'arrayBuffer');
      assetPath = '/index.html';
    }

    // Nothing in KV → project not yet booted
    if (!content) {
      if (!assetPath.includes('.') || assetPath.endsWith('.html')) {
        const res = new Response(BOOT_PLACEHOLDER, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
        return applyEdgeHeaders(res, { projectSlug, isHtml: true });
      }
      return new Response('Not found', { status: 404 });
    }

    const mime = mimeFromPath(assetPath);
    const isHtml = mime.startsWith('text/html');
    const res = new Response(content, { headers: { 'content-type': mime } });
    return applyEdgeHeaders(res, { projectSlug, isHtml });
  },
};

// ── Routing ──────────────────────────────────────────────────────────────────

function resolveRequest(
  req: Request,
  env: Env,
): { projectSlug: string | null; assetPath: string } {
  const url = new URL(req.url);

  // Strategy 1 — subdomain: <slug>.preview.<rootDomain>
  const rootDomain = env.PREVIEW_ROOT_DOMAIN;
  const hostname   = url.hostname;
  const suffix     = `.preview.${rootDomain}`;
  if (hostname.endsWith(suffix)) {
    const slug = hostname.slice(0, -suffix.length) || null;
    return { projectSlug: slug, assetPath: url.pathname };
  }

  // Strategy 2 — path: /<slug>/<asset-path>  (works on workers.dev)
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length >= 1) {
    const slug      = parts[0]!;
    const assetPath = parts.length > 1 ? '/' + parts.slice(1).join('/') : '/';
    return { projectSlug: slug, assetPath };
  }

  return { projectSlug: null, assetPath: '/' };
}
