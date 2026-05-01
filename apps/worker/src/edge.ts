// apps/worker/src/edge.ts — cache headers + security response transformations.
// Applied to every response served by the preview worker.

export interface EdgeOptions {
  projectSlug: string;
  isHtml: boolean;
}

/** Inject sandbox security headers onto every response. */
export function applyEdgeHeaders(res: Response, opts: EdgeOptions): Response {
  const headers = new Headers(res.headers);

  // Security: preview iframes are sandboxed by the workspace UI's iframe sandbox
  // attribute, so we keep CSP permissive here to allow CDN scripts/fonts/images
  // in user-generated sites (Tailwind CDN, Google Fonts, Unsplash, etc.).
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set(
    'Content-Security-Policy',
    [
      "default-src *  'unsafe-inline' 'unsafe-eval' data: blob:",
      // Allow the workspace UI (localhost dev or Pages prod) to embed this in an iframe
      "frame-ancestors 'self' http://localhost:* https://*.pages.dev https://*.workers.dev",
    ].join('; '),
  );

  // Cache: HTML uncached so changes show immediately; assets cached by hash
  if (opts.isHtml) {
    headers.set('Cache-Control', 'no-store');
  } else {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }

  // CORS: allow loading from the workspace UI
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/** Map file extension to MIME type. */
export function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    htm:  'text/html; charset=utf-8',
    js:   'application/javascript; charset=utf-8',
    mjs:  'application/javascript; charset=utf-8',
    css:  'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg:  'image/svg+xml',
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    gif:  'image/gif',
    ico:  'image/x-icon',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2:'font/woff2',
    ttf:  'font/ttf',
    txt:  'text/plain; charset=utf-8',
    map:  'application/json',
  };
  return map[ext] ?? 'application/octet-stream';
}
