// apps/api/src/routes/preview.ts — preview session boot/stop/logs/sync.
// Bundles the project with esbuild, writes assets to Cloudflare KV, then
// returns the preview URL. Logs stream through this endpoint.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { z } from 'zod';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import {
  createSession, getSession, listSessions, updateSession,
  appendLog, getLogs, stopSession, deleteSession,
  storeAssets, getAssets, getSessionBySlug,
} from '../preview/sessionManager';
import { bundleProject } from '../preview/bundler';
import { scaffoldHelloWorld } from '../preview/scaffold';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const BootBodySchema = z.object({
  projectId:   z.string().uuid(),
  projectSlug: z.string().regex(/^[a-z0-9-]+$/),
  rootDir:     z.string().min(1),
  entryPoint:  z.string().default('src/main.tsx'),
  framework:   z.enum(['react-vite', 'vanilla', 'static']).default('react-vite'),
});

const LogsQuerySchema = z.object({
  sessionId: z.string().uuid(),
  after:     z.coerce.number().optional(),
});

export async function previewRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /** POST /api/preview/boot — bundle + push to KV + return preview URL */
  app.post<{ Body: unknown }>('/api/preview/boot', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = BootBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }
    const { projectId, projectSlug, rootDir, entryPoint, framework } = parsed.data;

    const sessionId = randomUUID();

    // For local dev: serve from the API itself.
    // For production with CF credentials: serve from the worker subdomain.
    const hasCF = !!(process.env['CF_ACCOUNT_ID'] && process.env['CF_API_TOKEN'] && process.env['CF_KV_PREVIEW_NAMESPACE_ID']);
    const rootDomain = process.env['PREVIEW_ROOT_DOMAIN'] ?? 'preview.local.test';
    const apiBase   = process.env['API_URL'] ?? `http://localhost:${process.env['PORT'] ?? 3007}`;
    const previewUrl = hasCF
      ? `https://${projectSlug}.${rootDomain}`
      : `${apiBase}/api/preview/serve/${projectSlug}`;

    const session = createSession({ sessionId, projectId, projectSlug, tenantId: ctx.tenantId, previewUrl });
    updateSession(sessionId, { status: 'bundling' });
    appendLog(sessionId, { level: 'info', source: 'bundler', message: `Starting bundle for ${projectSlug}…` });

    // Fire and forget — client polls /api/preview/logs or uses Realtime
    void (async () => {
      try {
        // If rootDir doesn't exist on disk (stub/no project yet), scaffold a Hello World.
        let resolvedRoot = rootDir;
        const dirExists = await stat(rootDir).then((s) => s.isDirectory()).catch(() => false);
        if (!dirExists) {
          appendLog(sessionId, { level: 'info', source: 'bundler', message: 'No project files found — scaffolding Hello World…' });
          resolvedRoot = await scaffoldHelloWorld(projectSlug);
        }

        const result = await bundleProject({ projectId, projectSlug, rootDir: resolvedRoot, entryPoint, framework });

        for (const w of result.warnings) {
          appendLog(sessionId, { level: 'warn', source: 'bundler', message: w });
        }
        if (result.errors.length > 0) {
          for (const e of result.errors) {
            appendLog(sessionId, { level: 'error', source: 'bundler', message: e });
          }
          updateSession(sessionId, { status: 'error', error: result.errors[0] ?? 'Bundle failed' });
          return;
        }

        appendLog(sessionId, {
          level: 'info', source: 'bundler',
          message: `Bundle complete: ${result.assets.size} assets in ${result.durationMs}ms`,
        });

        // Always store assets in memory for local-dev serving.
        storeAssets(sessionId, result.assets);

        if (hasCF) {
          // Production: push to Cloudflare KV
          updateSession(sessionId, { status: 'syncing' });
          await syncAssetsToKV(projectSlug, result.assets, sessionId);
        } else {
          appendLog(sessionId, { level: 'info', source: 'bundler', message: 'Local mode — serving from API (no CF KV)' });
        }

        updateSession(sessionId, { status: 'booted' });
        appendLog(sessionId, { level: 'info', source: 'bundler', message: `Preview live: ${previewUrl}` });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        updateSession(sessionId, { status: 'error', error: msg });
        appendLog(sessionId, { level: 'error', source: 'bundler', message: msg });
      }
    })();

    return reply.status(202).send({ sessionId, previewUrl });
  });

  /** POST /api/preview/stop — stop a session */
  app.post<{ Body: unknown }>('/api/preview/stop', async (req, reply) => {
    const ctx = req.authCtx!;
    const body = req.body as Record<string, unknown>;
    const sessionId = typeof body?.['sessionId'] === 'string' ? body['sessionId'] : null;
    if (!sessionId) return reply.status(400).send({ error: 'sessionId required' });

    const session = getSession(sessionId);
    if (!session || session.tenantId !== ctx.tenantId) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    stopSession(sessionId);
    return reply.send({ ok: true });
  });

  /** GET /api/preview/sessions — list active sessions for tenant */
  app.get('/api/preview/sessions', async (req) => {
    const ctx = req.authCtx!;
    const activeSessions = listSessions(ctx.tenantId).map((s) => ({
      sessionId: s.sessionId,
      projectId: s.projectId,
      projectSlug: s.projectSlug,
      status: s.status,
      previewUrl: s.previewUrl,
      processes: s.processes,
      startedAt: s.startedAt,
      error: s.error,
    }));
    return { sessions: activeSessions };
  });

  /** GET /api/preview/logs?sessionId=…&after=… — poll runtime logs */
  app.get<{ Querystring: { sessionId?: string; after?: string } }>(
    '/api/preview/logs',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const parsed = LogsQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.status(400).send({ error: 'sessionId required' });

      const session = getSession(parsed.data.sessionId);
      if (!session || session.tenantId !== ctx.tenantId) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const logs = getLogs(parsed.data.sessionId, parsed.data.after);
      return { logs, sessionStatus: session.status };
    },
  );

  /** DELETE /api/preview/sessions/:id — evict a session */
  app.delete<{ Params: { id: string } }>('/api/preview/sessions/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    const session = getSession(req.params.id);
    if (!session || session.tenantId !== ctx.tenantId) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    deleteSession(req.params.id);
    return reply.send({ ok: true });
  });

  /**
   * GET /api/preview/serve/:slug/*
   * Local-dev asset server — no auth (serves public bundled HTML/JS/CSS).
   * In production, assets are served from the Cloudflare Worker instead.
   */
  app.get<{ Params: { slug: string; '*': string } }>(
    '/api/preview/serve/:slug/*',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const { slug } = req.params;
      let assetPath = '/' + (req.params['*'] || '');
      if (assetPath === '/') assetPath = '/index.html';

      // Find the most recent booted session for this slug
      const session = getSessionBySlug(slug);
      if (!session) {
        return reply.status(404).send('Preview not booted. Click Boot in the workspace.');
      }

      const assets = getAssets(session.sessionId);
      const content = assets?.get(assetPath);
      if (!content) {
        // Fallback to index.html for SPA client-side routing
        const index = assets?.get('/index.html');
        if (index) {
          return reply.type('text/html').send(Buffer.from(index));
        }
        return reply.status(404).send('Asset not found');
      }

      const mime = mimeType(assetPath);
      return reply.type(mime).send(Buffer.from(content));
    },
  );

  // Also handle the slug root without trailing slash
  app.get<{ Params: { slug: string } }>(
    '/api/preview/serve/:slug',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const session = getSessionBySlug(req.params.slug);
      if (!session) return reply.status(404).send('Preview not booted.');
      const assets = getAssets(session.sessionId);
      const index  = assets?.get('/index.html');
      if (!index)  return reply.status(404).send('index.html not found');
      return reply.type('text/html').send(Buffer.from(index));
    },
  );
}

function mimeType(path: string): string {
  const ext = extname(path).toLowerCase();
  const map: Record<string, string> = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.mjs':  'application/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
  };
  return map[ext] ?? 'application/octet-stream';
}

// ── KV sync ──────────────────────────────────────────────────────────────────

/** Push bundled assets to Cloudflare KV via the Workers REST API. */
async function syncAssetsToKV(
  projectSlug: string,
  assets: Map<string, Uint8Array>,
  sessionId: string,
): Promise<void> {
  const accountId = process.env['CF_ACCOUNT_ID'];
  const apiToken   = process.env['CF_API_TOKEN'];
  const kvNsId     = process.env['CF_KV_PREVIEW_NAMESPACE_ID'];

  if (!accountId || !apiToken || !kvNsId) {
    // No CF credentials: skip KV sync (local dev without Cloudflare)
    appendLog(sessionId, {
      level: 'warn', source: 'bundler',
      message: 'CF credentials missing — KV sync skipped (local dev mode)',
    });
    return;
  }

  // Cloudflare KV bulk write (up to 10,000 keys per request)
  const pairs = Array.from(assets.entries()).map(([path, content]) => ({
    key: `${projectSlug}${path}`,
    value: Buffer.from(content).toString('base64'),
    base64: true,
    expiration_ttl: 86400, // 24 hours (refresh on each boot)
  }));

  // Chunk into batches of 100 to stay under KV bulk-write limits
  for (let i = 0; i < pairs.length; i += 100) {
    const batch = pairs.slice(i, i + 100);
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvNsId}/bulk`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`KV sync failed (batch ${i / 100}): ${text.slice(0, 200)}`);
    }
  }

  appendLog(sessionId, {
    level: 'info', source: 'bundler',
    message: `Synced ${assets.size} assets to KV for project ${projectSlug}`,
  });
}
