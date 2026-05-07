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
  app.get('/healthz', async () => ({ ok: true, service: 'api', ts: Date.now() }));

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
