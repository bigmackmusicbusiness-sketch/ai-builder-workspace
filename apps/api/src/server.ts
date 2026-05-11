// apps/api/src/server.ts — Fastify bootstrap. Registers all route plugins.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { csrfGuard } from './security/csrfGuard';
import { env } from './config/env';
import { initDb }         from './db/client';
import { runMigrations }  from './db/runMigrations';
import { filesRoutes }    from './routes/files';
import { versionsRoutes } from './routes/versions';
import { previewRoutes }  from './routes/preview';
import { projectsRoutes } from './routes/projects';
import { secretsRoutes }  from './routes/secrets';
import { jobsRoutes }     from './routes/jobs';
import { webhooksRoutes } from './routes/webhooks';
import { dbRoutes }       from './routes/db';
import { runsRoutes }     from './routes/runs';
import { testsRoutes }      from './routes/tests';
import { approvalsRoutes }  from './routes/approvals';
import { chatRoutes }       from './routes/chat';
import { publishRoutes }    from './routes/publish';
import { publishedRoutes }  from './routes/published';
import { cloudflareRoutes } from './routes/cloudflare';
import { customHostRoutes } from './routes/customHost';
import { assetsRoutes }     from './routes/assets';
import { integrationsRoutes } from './routes/integrations';
import { ebooksRoutes }    from './routes/ebooks';
import { documentsRoutes } from './routes/documents';
import { emailRoutes }     from './routes/email';
import { musicRoutes }     from './routes/music';
import { editorRoutes }    from './routes/editor';
import { higgsfieldRoutes } from './routes/higgsfield';
import { videoRoutes }      from './routes/video';
import { clipperRoutes }    from './routes/clipper';
import { providersRoutes }  from './routes/providers';
import { adsRoutes }        from './routes/ads';
import { aiEditRoutes }     from './routes/ai-edit';
import { spsHandoffRoutes } from './routes/sps-handoff';
import { ensureWorkspaceBackupsBucket } from './preview/workspace';

async function main(): Promise<void> {
  // Initialise DB before anything else so getDb() is ready for all route handlers.
  // This resolves the Supabase hostname to IPv4 (Railway cannot route IPv6 to Supabase).
  await initDb();

  // Auto-apply any pending SQL migrations. Idempotent — already-applied
  // migrations are tracked in `_migrations` and skipped. Safe across redeploys.
  // Failures log but don't crash the server; routes have defensive fallbacks.
  await runMigrations().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[migrations] runner errored, server continuing:', err instanceof Error ? err.message : String(err));
  });

  // Ensure the private workspace-backups bucket exists. Idempotent. The
  // workspace.ts backup/restore writes here so tenant text files stay
  // private (vs. the public project-assets bucket where they used to land).
  await ensureWorkspaceBackupsBucket().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[storage] ensureWorkspaceBackupsBucket errored, continuing:', err instanceof Error ? err.message : String(err));
  });

  const app = Fastify({ logger: { level: 'info' } });

  // ── Multipart (file uploads) ────────────────────────────────────────────────
  // 2 GB cap for video uploads (clipper). Coolify VPS disk is the real limiter
  // and assets are streamed straight to Supabase Storage anyway.
  await app.register(multipart, {
    limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  });

  // ── CORS ────────────────────────────────────────────────────────────────────
  // Allowlist: localhost dev, Cloudflare Pages, Railway, sslip.io (Coolify
  // demo domains), and whatever APP_URL is configured to in env. APP_URL is
  // the canonical entry — set it in Coolify so swapping to a real domain
  // later is a one-line env change without code touchups.
  await app.register(cors, {
    origin: (origin, cb) => {
      const allowed: RegExp[] = [
        /^http:\/\/localhost:\d+$/,
        /^https:\/\/.*\.pages\.dev$/,
        /^https:\/\/.*\.railway\.app$/,
        /^https:\/\/.*\.sslip\.io$/,
      ];
      if (env.APP_URL) {
        // Anchor the literal APP_URL origin (escape regex metachars) so we
        // match exact-host, not a substring.
        const escaped = env.APP_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        allowed.push(new RegExp(`^${escaped}$`));
      }
      if (!origin || allowed.some(r => r.test(origin))) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
  });

  // ── B4: Helmet — security response headers ─────────────────────────────────
  // Sets HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  // Cross-Origin-* defaults. Disable the global CSP — generated user pages
  // served via /api/preview/serve/* need framework-permissive policies (CDN
  // scripts, inline styles); the polish phase already injects an HTML-level
  // CSP meta tag for those. For the JSON-only api surface we set a tight
  // CSP via the per-route hook below.
  await app.register(helmet, {
    contentSecurityPolicy: false,                     // handled by HTML meta + per-route below
    crossOriginEmbedderPolicy: false,                 // would block legitimate iframe embeds
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // SPA on different origin needs to fetch
    crossOriginOpenerPolicy:   { policy: 'same-origin' },
    referrerPolicy:            { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity:   { maxAge: 31536000, includeSubDomains: true, preload: true },
    xFrameOptions:             { action: 'deny' },
    xContentTypeOptions:       true,
    xPoweredBy:                false,                 // hide framework banner
  });

  // Tight CSP only on /api/* (JSON responses don't need any inline scripts/styles).
  // Route-served preview HTML (under /api/preview/serve/*) gets its CSP from the
  // meta tag the polish phase injects, NOT this header.
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url ?? '';
    if (url.startsWith('/api/') && !url.startsWith('/api/preview/serve/')) {
      reply.header('Content-Security-Policy', "default-src 'none'; connect-src 'self'; frame-ancestors 'none'");
    }
  });

  // ── Iframe-friendly headers for routes the IDE legitimately embeds ──────────
  // The Preview tab loads /api/preview/serve/<slug>/ inside an iframe; the
  // public deploys at /api/published/<slug>/ are also iframe-able from the
  // Visual QA tab + share previews. /api/sps/handoff is loaded inside an
  // iframe from SPS portals (round 8 Feature A — admin + customer portal
  // "Open builder" buttons render the IDE inline rather than opening a new
  // tab). Helmet's global X-Frame-Options DENY would make Chrome show
  // "refused to connect."
  //
  // IMPORTANT: api and IDE are on DIFFERENT origins (api.* vs app.*) so
  // X-Frame-Options SAMEORIGIN won't help — that header only knows
  // exact-origin match and has no allow-list mode in modern browsers.
  // The fix is to (a) REMOVE X-Frame-Options on these routes entirely
  // and (b) replace it with CSP frame-ancestors which DOES support an
  // origin allow-list. Modern browsers prefer frame-ancestors anyway and
  // will use it when both headers are present, but removing X-F-O avoids
  // any ambiguity for older browsers.
  //
  // SPS portal origins are allow-listed via SPS_PORTAL_ORIGINS env (CSV,
  // optional). Defaults to the production hostnames per SPS round 8 spec.
  // Override per deploy if SPS moves to different domains.
  const ABW_DEFAULT_SPS_PORTAL_ORIGINS = [
    'https://app.signalpointportal.com',
    'https://client.signalpointportal.com',
  ];
  const spsPortalOrigins = (process.env['SPS_PORTAL_ORIGINS'] ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const portalAllowList = (spsPortalOrigins.length ? spsPortalOrigins : ABW_DEFAULT_SPS_PORTAL_ORIGINS).join(' ');

  app.addHook('onSend', async (req, reply, payload) => {
    const url = req.url ?? '';
    if (url.startsWith('/api/preview/serve/') || url.startsWith('/api/published/')) {
      const ideOrigin = process.env['APP_URL'] ?? 'https://app.40-160-3-10.sslip.io';
      // Strip helmet's X-Frame-Options DENY for these specific routes
      reply.removeHeader('X-Frame-Options');
      // Replace with frame-ancestors — accepts the IDE origin + same-origin
      reply.header('Content-Security-Policy', `frame-ancestors 'self' ${ideOrigin}`);
    } else if (url.startsWith('/api/sps/handoff')) {
      // SPS portal iframe entry-point. The handoff route 302-redirects to
      // the SPA. For the iframe load to follow that redirect, this 302
      // response must itself not be X-F-O DENY'd. frame-ancestors covers
      // both same-origin (the IDE's own preview iframe should anything ever
      // load handoff from inside the IDE) AND the configured SPS portals.
      reply.removeHeader('X-Frame-Options');
      reply.header('Content-Security-Policy', `frame-ancestors 'self' ${portalAllowList}`);
    }
    return payload;
  });

  // ── B3: Rate limiting ──────────────────────────────────────────────────────
  // Global default: 300 req/min/IP. Per-route overrides via routeOptions.config.rateLimit.
  // Route configs handle the tighter limits on /api/chat (model calls expensive)
  // and /api/admin/* (sensitive actions).
  await app.register(rateLimit, {
    global:     true,
    max:        300,
    timeWindow: '1 minute',
    // Use the verified tenant from JWT when available, otherwise fall back to IP.
    keyGenerator: (req) => {
      const ctx = (req as { authCtx?: { tenantId?: string } }).authCtx;
      return ctx?.tenantId ?? req.ip;
    },
    errorResponseBuilder: (_req, ctx) => ({
      error:      'rate_limited',
      message:    `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)}s.`,
      statusCode: 429,
    }),
  });

  // ── B5: CSRF guard ─────────────────────────────────────────────────────────
  // Require X-Requested-With or Sec-Fetch-Site=same-origin on non-GET routes.
  // SPA's apiFetch() already sends X-Requested-With; this rejects naive
  // form-POST CSRF attempts that browsers won't send a custom header for.
  app.addHook('preHandler', csrfGuard);

  // ── Health ──────────────────────────────────────────────────────────────────
  // __BUILD_SHA__ + __BUILD_TIME__ are inlined by esbuild's `define` at build
  // time (see apps/api/build.mjs). Surfacing them lets us verify which commit
  // is running in prod via `curl /healthz` — critical when debugging "is my
  // fix actually deployed yet?" without needing log/SSH access.
  app.get('/healthz', async () => ({
    ok:        true,
    service:   'api',
    ts:        Date.now(),
    buildSha:  typeof __BUILD_SHA__  === 'string' ? __BUILD_SHA__  : 'unknown',
    buildTime: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'unknown',
  }));

  // ── Routes ──────────────────────────────────────────────────────────────────
  await app.register(projectsRoutes);
  await app.register(secretsRoutes);
  await app.register(jobsRoutes);
  await app.register(webhooksRoutes);
  await app.register(dbRoutes);
  await app.register(runsRoutes);
  await app.register(filesRoutes);
  await app.register(versionsRoutes);
  await app.register(previewRoutes);
  await app.register(testsRoutes);
  await app.register(approvalsRoutes);
  await app.register(chatRoutes);
  await app.register(publishRoutes);
  await app.register(publishedRoutes);
  await app.register(cloudflareRoutes);
  await app.register(assetsRoutes);
  await app.register(integrationsRoutes);
  await app.register(ebooksRoutes);
  await app.register(documentsRoutes);
  await app.register(emailRoutes);
  await app.register(musicRoutes);
  await app.register(editorRoutes);
  await app.register(higgsfieldRoutes);
  await app.register(videoRoutes);
  await app.register(clipperRoutes);
  await app.register(providersRoutes);
  await app.register(adsRoutes);
  await app.register(aiEditRoutes);
  await app.register(spsHandoffRoutes);
  // customHostRoutes is a Host-header preHandler — register LAST so the
  // /api/* routes have already been matched first (the preHandler still
  // fires per-request, but this keeps registration order tidy).
  await app.register(customHostRoutes);

  // ── Start ───────────────────────────────────────────────────────────────────
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`api listening on http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
