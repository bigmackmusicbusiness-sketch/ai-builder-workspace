// apps/api/src/security/csrfGuard.ts — lightweight CSRF protection.
//
// We don't use cookie-based session auth on /api/* (clients send a Bearer
// token from Supabase). That alone makes traditional CSRF mostly moot —
// browsers don't send the token to a third-party origin automatically.
// But the api also accepts cookies for some legacy paths, and the SPA
// composer sends Bearer + (potentially) cookie. To close the gap, require
// non-GET requests to carry a custom `X-Requested-With: fetch` header.
//
// Why this works: a malicious page in another origin can submit an HTML
// form to your api (which produces a simple POST with cookies) but cannot
// add a custom header without triggering a CORS preflight that the api's
// origin allowlist would reject. So requiring the header makes the
// non-preflight cross-origin form-POST CSRF impossible.
//
// SKIPPED for:
//   - GET / HEAD / OPTIONS — no state change
//   - /api/preview/serve/* — public asset serve, no mutation
//   - /api/webhooks/* — external services can't add custom headers; auth via HMAC sig
//   - /api/oauth/* — third-party redirect callbacks
//   - /api/higgsfield/oauth/* — same (Higgsfield OAuth callback)
//   - /api/clipper/upload — multipart from <form enctype="multipart/form-data">,
//     which traditionally is a CSRF target — but the route also requires a
//     Bearer token, so the cross-origin attack would need to leak the token
//     first. Acceptable trade-off; tighten later if needed.
//   - /healthz — public liveness probe

import type { FastifyRequest, FastifyReply } from 'fastify';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Path prefixes / patterns that bypass the X-Requested-With check. */
const SKIP_PATHS: RegExp[] = [
  /^\/healthz$/,
  /^\/api\/preview\/serve\//,
  /^\/api\/webhooks\//,
  /^\/api\/oauth\//,
  /^\/api\/higgsfield\/oauth\//,
  /^\/api\/clipper\/upload(?:$|\?)/,
  // /api/sps/* — Phase 2.5 cross-project handoff. Auth is HS256 token in
  // Authorization header / token query param, not a cookie, so traditional
  // CSRF doesn't apply. Server-to-server callers (SPS) can't reliably set
  // X-Requested-With from every language's HTTP client.
  /^\/api\/sps\//,
];

export async function csrfGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return;

  const url = req.url ?? '';
  if (SKIP_PATHS.some((re) => re.test(url))) return;

  // Accept either:
  //   X-Requested-With: fetch / XMLHttpRequest / abw-web (any non-empty value)
  //   Sec-Fetch-Site: same-origin / same-site (browser-set, not spoofable cross-origin)
  const xrw = req.headers['x-requested-with'];
  const sfs = req.headers['sec-fetch-site'];

  if (xrw && typeof xrw === 'string' && xrw.length > 0) return;
  if (sfs === 'same-origin' || sfs === 'same-site' || sfs === 'none') return;

  // Reject. Use 403 (not 401) so clients don't retry with a fresh token.
  reply.status(403).send({
    error:   'CSRF guard',
    message: 'State-changing requests must carry an X-Requested-With header. ' +
             'In your client code: fetch(url, { headers: { "X-Requested-With": "fetch" } }).',
  });
}
