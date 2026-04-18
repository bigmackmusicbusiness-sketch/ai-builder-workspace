// apps/worker/src/preview.ts — per-project preview sandbox worker.
// Serves bundled project assets from KV, scoped strictly per project slug.
// Each project runs in its own subdomain: <slug>.preview.<rootDomain>
import { parseProjectSlug, assetKey, type Env } from './sandbox';
import { applyEdgeHeaders, mimeFromPath } from './edge';

// SPA shell injected when no index.html is found in KV (boot placeholder).
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

    // Resolve project slug from subdomain or ?project= query param
    const projectSlug = parseProjectSlug(req, env);
    if (!projectSlug) {
      return new Response('No project specified', { status: 400 });
    }

    // Resolve asset path; SPA fallback for extensionless routes
    let assetPath = url.pathname === '/' ? '/index.html' : url.pathname;
    let content = await env.PREVIEW_KV.get(assetKey(projectSlug, assetPath), 'arrayBuffer');

    if (!content && !assetPath.includes('.')) {
      content = await env.PREVIEW_KV.get(assetKey(projectSlug, '/index.html'), 'arrayBuffer');
      assetPath = '/index.html';
    }

    // Not yet booted: serve loading placeholder for HTML routes
    if (!content) {
      if (url.pathname === '/' || !assetPath.includes('.')) {
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
