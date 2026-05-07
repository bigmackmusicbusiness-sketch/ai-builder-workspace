// apps/api/src/routes/customHost.ts — catch-all for custom-domain traffic.
//
// When a user attaches their own domain (e.g. halcyonestates.com) via the
// publish flow, we record the host in publishTargets.config.customDomain
// and create a CNAME at their CF zone pointing to our api origin. CF
// proxies the request through to us with `Host: halcyonestates.com`. This
// route looks that host up + serves the deploy via the shared
// serveStaticDeploy helper.
//
// Registration order matters — see server.ts. This route is a Fastify
// hook (preHandler), NOT a regular path-based handler — that way
// platform routes (/api/*, /healthz) keep their precedence and only
// requests with a non-platform Host header get intercepted.
//
// Lookup is direct SQL (no Drizzle) because we need to query the JSON
// config column with `->>` and the schema doesn't model that natively.
//
// Fast path: an in-memory cache keyed by host. The cache TTL is 60s so
// domain changes propagate quickly without thrashing the DB on every
// hit. If a request arrives for a host not in the cache, we miss-then-
// query-then-cache.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getRawSql } from '../db/client';
import { serveStaticDeploy } from '../publish/serveStaticDeploy';

interface CacheEntry {
  slug:     string | null; // null = "no binding for this host" (negative cache)
  expires:  number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function platformHosts(): Set<string> {
  // Hosts that should NEVER be intercepted as custom domains. Includes the
  // configured public api host plus the local dev fallbacks.
  const out = new Set<string>([
    'localhost',
    '127.0.0.1',
  ]);
  const publicHost = process.env['PUBLIC_API_HOST'];
  if (publicHost) out.add(publicHost.toLowerCase());
  // PUBLIC_API_URL is the canonical url; derive the host from it
  const publicUrl = process.env['PUBLIC_API_URL'];
  if (publicUrl) {
    try { out.add(new URL(publicUrl).host.toLowerCase()); } catch { /* ignore */ }
  }
  // The Coolify-issued sslip.io host always passes through
  out.add('api.40-160-3-10.sslip.io');
  return out;
}

const PLATFORM_HOSTS = platformHosts();

/** Look up the project slug bound to a custom-domain host. Returns null
 *  if no publishTarget has this host attached (and caches that fact). */
async function resolveHost(host: string): Promise<string | null> {
  const cached = cache.get(host);
  if (cached && cached.expires > Date.now()) return cached.slug;

  const sql = getRawSql();
  const rows = await sql.unsafe(
    `SELECT p.slug
       FROM publish_targets pt
       JOIN projects p ON p.id = pt.project_id
      WHERE pt.config->>'customDomain' = $1
        AND p.deleted_at IS NULL
      LIMIT 1`,
    [host],
  ) as Array<{ slug: string }>;

  const slug = rows[0]?.slug ?? null;
  cache.set(host, { slug, expires: Date.now() + CACHE_TTL_MS });
  return slug;
}

/** Invalidate the cache for one host. Call this from the deploy handler
 *  when a new customDomain is bound so the very next request resolves
 *  correctly without waiting for TTL. */
export function invalidateHostCache(host: string): void {
  cache.delete(host.toLowerCase());
}

export async function customHostRoutes(app: FastifyInstance): Promise<void> {
  // No path-based routes — we work via a preHandler that intercepts
  // requests whose Host header isn't one of our platform hosts.

  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    // GET only — POST/PUT/etc to a custom domain don't make sense for
    // static-export deploys (they're read-only sites)
    if (req.method !== 'GET' && req.method !== 'HEAD') return;

    const hostHeader = (req.headers.host ?? '').split(':')[0]?.toLowerCase() ?? '';
    if (!hostHeader) return;
    if (PLATFORM_HOSTS.has(hostHeader)) return;

    // Only intercept if it actually looks like a domain (has at least one dot)
    if (!hostHeader.includes('.')) return;

    const slug = await resolveHost(hostHeader).catch(() => null);
    if (!slug) {
      // Unknown host — let the request fall through. Fastify will 404 it
      // via its normal not-found handler, which surfaces a JSON error.
      return;
    }

    // Pull the path off the URL (strip query string)
    const url = req.url;
    const qIdx = url.indexOf('?');
    const pathOnly = qIdx >= 0 ? url.slice(0, qIdx) : url;
    // Strip the leading '/' for serveStaticDeploy's relPath contract
    const relPath = pathOnly.replace(/^\/+/, '');

    await serveStaticDeploy(slug, relPath, reply);
    // serveStaticDeploy has already called .send(); short-circuit any
    // further handlers
    return reply;
  });
}
