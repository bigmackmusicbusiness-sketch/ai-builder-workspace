// apps/api/src/routes/preview.ts — preview session boot/stop/logs/sync.
// Bundles the project with esbuild, writes assets to Cloudflare KV, then
// returns the preview URL. Logs stream through this endpoint.
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyContextConfig { skipAuth?: boolean; }
}
import { randomUUID } from 'node:crypto';
import { stat, readdir, readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { z } from 'zod';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import {
  createSession, getSession, listSessions, updateSession,
  appendLog, getLogs, stopSession, deleteSession,
  storeAssets, getAssets, getSessionBySlug, evictSessionsBySlug,
} from '../preview/sessionManager';
import { bundleProject } from '../preview/bundler';
import { scaffoldHelloWorld } from '../preview/scaffold';
import { getWorkspace, workspaceExists } from '../preview/workspace';
import { subscribe as subscribePreview } from '../preview/eventBus';

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

    // Evict all previous sessions for this slug so stale assets don't linger
    // and getSessionBySlug always returns the freshest build.
    evictSessionsBySlug(projectSlug, ctx.tenantId);

    // For local dev: serve from the API itself.
    // For production with CF credentials: push assets to KV and serve via the
    // preview worker using path-based routing: /<slug>/<asset>.
    const hasCF = !!(process.env['CF_ACCOUNT_ID'] && process.env['CF_API_TOKEN'] && process.env['CF_KV_PREVIEW_NAMESPACE_ID']);
    // Public-facing API origin used to construct iframe-loadable preview URLs.
    // PUBLIC_API_URL is the canonical env name (matches env.ts schema). Older
    // deploys may have set API_URL — fall back to that for back-compat. The
    // localhost default is for local dev; in prod one of the env vars MUST be
    // set or the iframe won't be reachable from the browser.
    const apiBase    = process.env['PUBLIC_API_URL'] ?? process.env['API_URL'] ?? `http://localhost:${process.env['PORT'] ?? 3007}`;
    const workerBase = (process.env['WORKER_URL'] ?? 'https://abw-preview-worker.signalpoint.workers.dev').replace(/\/$/, '');

    // Embed the first 8 chars of sessionId as a cache-buster (?v=…).
    // This ensures the iframe src changes on every new boot, forcing a reload
    // even though the base URL path stays the same.
    const nonce = sessionId.replace(/-/g, '').slice(0, 8);
    const previewUrl = hasCF
      ? `${workerBase}/${projectSlug}/?v=${nonce}`
      : `${apiBase}/api/preview/serve/${projectSlug}?v=${nonce}`;

    const session = createSession({ sessionId, projectId, projectSlug, tenantId: ctx.tenantId, previewUrl });
    updateSession(sessionId, { status: 'bundling' });
    appendLog(sessionId, { level: 'info', source: 'bundler', message: `Starting bundle for ${projectSlug}…` });

    // Fire and forget — client polls /api/preview/logs or uses Realtime
    void (async () => {
      try {
        // Resolution order for the files we're about to bundle:
        //   1. The per-tenant AI workspace at ~/.abw-workspaces/{tenantId}/{slug}/ —
        //      this is where the AI agent writes via write_file tool calls.
        //   2. The rootDir the caller supplied (legacy / dev-only).
        //   3. Scaffolded Hello World.
        let resolvedRoot = rootDir;
        let resolvedFramework = framework;

        const ws = await getWorkspace(ctx.tenantId, projectSlug);
        const hasWorkspaceFiles = await workspaceExists(ws);

        if (hasWorkspaceFiles) {
          appendLog(sessionId, { level: 'info', source: 'bundler', message: `Bundling from AI workspace: ${ws.rootDir}` });
          resolvedRoot = ws.rootDir;

          // Framework detection — try strict shapes first, then walk for a
          // nested index.html / main.tsx. The agent commonly drops files into
          // dist/, public/, build/, or even just a flat tree without a top
          // -level entrypoint. Be forgiving: if we find an index.html anywhere
          // reasonable, treat that subdirectory as the static root.
          let detected: { kind: 'react-vite' | 'static'; rootDir: string } | null = null;

          if (await stat(`${ws.rootDir}/src/main.tsx`).then((s) => s.isFile()).catch(() => false)) {
            detected = { kind: 'react-vite', rootDir: ws.rootDir };
          } else if (await stat(`${ws.rootDir}/index.html`).then((s) => s.isFile()).catch(() => false)) {
            detected = { kind: 'static', rootDir: ws.rootDir };
          } else {
            // Walk up to 3 dirs deep for an index.html or src/main.tsx.
            // Prefer dist/build/public over deeper ad-hoc dirs.
            const candidates = await findEntrypoints(ws.rootDir, 3);
            if (candidates.length > 0) {
              const first = candidates[0]!;
              detected = first;
              appendLog(sessionId, {
                level: 'info', source: 'bundler',
                message: `Entry detected via scan: ${first.kind} at ${relative(ws.rootDir, first.rootDir) || '.'}`,
              });
            }
          }

          if (detected) {
            resolvedFramework = detected.kind;
            resolvedRoot      = detected.rootDir;
          } else {
            const hint =
              'Preview cannot render this workspace. No index.html or src/main.tsx found in the project tree.\n' +
              '  • Static site: drop an index.html anywhere reasonable.\n' +
              '  • Vite React SPA: src/main.tsx + index.html at the workspace root.\n' +
              '  • Next.js / Remix / Astro need a dev server and are not supported here. ' +
              'Ask the AI to emit a plain HTML or Vite SPA shape.';
            appendLog(sessionId, { level: 'error', source: 'bundler', message: hint });
            updateSession(sessionId, { status: 'error', error: hint });
            return;
          }
        } else {
          const dirExists = await stat(rootDir).then((s) => s.isDirectory()).catch(() => false);
          if (!dirExists) {
            appendLog(sessionId, { level: 'info', source: 'bundler', message: 'No project files found — scaffolding Hello World…' });
            const scaffold = await scaffoldHelloWorld(projectSlug);
            resolvedRoot      = scaffold.dir;
            resolvedFramework = scaffold.framework; // 'static' — bypasses esbuild
          }
        }

        // For static sites served at a sub-path, pass the base so the bundler
        // can inject a <base> tag and rewrite absolute asset paths.
        //   CF mode  → path-based:  /<slug>/   (worker serves at workerHost/<slug>/*)
        //   Local    → API-served:  /api/preview/serve/<slug>/
        //   React/Vite builds always use '/' (esbuild output is self-contained)
        const serveBasePath = resolvedFramework === 'static'
          ? (hasCF ? `/${projectSlug}/` : `/api/preview/serve/${projectSlug}/`)
          : '/';

        const result = await bundleProject({ projectId, projectSlug, rootDir: resolvedRoot, entryPoint, framework: resolvedFramework, serveBasePath });

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
   * GET /api/preview/watch/:slug — SSE channel that emits `file-changed` events
   * whenever the AI workspace for that slug is written to. The web client uses
   * this to hot-reload the iframe without polling.
   */
  app.get<{ Params: { slug: string } }>(
    '/api/preview/watch/:slug',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const slug = req.params.slug;
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return reply.status(400).send({ error: 'Invalid slug' });
      }

      // Hijack so we own the raw socket for SSE
      reply.hijack();
      const raw = reply.raw;

      // CORS — match what /api/chat does so EventSource works cross-origin
      const origin = (req.headers['origin'] as string | undefined) ?? '*';
      raw.setHeader('Access-Control-Allow-Origin',      origin);
      raw.setHeader('Access-Control-Allow-Credentials', 'true');
      raw.setHeader('Vary',                             'Origin');
      raw.setHeader('Content-Type',                     'text/event-stream; charset=utf-8');
      raw.setHeader('Cache-Control',                    'no-cache, no-transform');
      raw.setHeader('Connection',                       'keep-alive');
      raw.setHeader('X-Accel-Buffering',                'no');
      raw.flushHeaders?.();

      // Initial hello
      raw.write(`event: open\ndata: {"slug":"${slug}"}\n\n`);

      const unsubscribe = subscribePreview(ctx.tenantId, slug, (ev) => {
        try {
          raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
        } catch { /* socket likely closed */ }
      });

      // Heartbeat every 25s so proxies don't kill the idle connection
      const heartbeat = setInterval(() => {
        try { raw.write(`: heartbeat\n\n`); } catch { /* closed */ }
      }, 25_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { raw.end(); } catch { /* already closed */ }
      };

      req.raw.on('close', cleanup);
      req.raw.on('error', cleanup);
    },
  );

  /**
   * POST /api/preview/rebundle — re-bundle the workspace into the existing
   * session's asset map. Cheaper than a full boot (no new sessionId, no evict).
   * The frontend calls this debounced after a `file-changed` event.
   */
  app.post<{ Body: unknown }>('/api/preview/rebundle', async (req, reply) => {
    const ctx = req.authCtx!;
    const body = req.body as Record<string, unknown>;
    const sessionId   = typeof body['sessionId']   === 'string' ? body['sessionId']   : null;
    const projectSlug = typeof body['projectSlug'] === 'string' ? body['projectSlug'] : null;
    if (!sessionId || !projectSlug) {
      return reply.status(400).send({ error: 'sessionId and projectSlug required' });
    }

    const session = getSession(sessionId);
    if (!session || session.tenantId !== ctx.tenantId) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    try {
      const ws = await getWorkspace(ctx.tenantId, projectSlug);
      const hasReact = await stat(`${ws.rootDir}/src/main.tsx`).then((s) => s.isFile()).catch(() => false);
      const hasIndex = await stat(`${ws.rootDir}/index.html`).then((s) => s.isFile()).catch(() => false);
      const framework: 'react-vite' | 'static' = hasReact ? 'react-vite' : 'static';
      if (!hasReact && !hasIndex) {
        return reply.status(400).send({ error: 'Workspace has no entry (need src/main.tsx or index.html).' });
      }

      const hasCF = !!(process.env['CF_ACCOUNT_ID'] && process.env['CF_API_TOKEN'] && process.env['CF_KV_PREVIEW_NAMESPACE_ID']);
      const serveBasePath = framework === 'static'
        ? (hasCF ? `/${projectSlug}/` : `/api/preview/serve/${projectSlug}/`)
        : '/';

      const result = await bundleProject({
        projectId:   session.projectId,
        projectSlug,
        rootDir:     ws.rootDir,
        entryPoint:  'src/main.tsx',
        framework,
        serveBasePath,
      });

      if (result.errors.length > 0) {
        return reply.status(500).send({ error: result.errors[0] });
      }

      storeAssets(sessionId, result.assets);
      return reply.send({ ok: true, assetCount: result.assets.size, durationMs: result.durationMs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }
  });

  /**
   * POST /api/preview/screenshot — capture the iframe content via Playwright.
   * Returns an asset id so the screenshot can be referenced from the AssetsScreen.
   */
  app.post<{ Body: unknown }>('/api/preview/screenshot', async (req, reply) => {
    const ctx = req.authCtx!;
    const body = req.body as Record<string, unknown>;
    const sessionId = typeof body['sessionId'] === 'string' ? body['sessionId'] : null;
    if (!sessionId) return reply.status(400).send({ error: 'sessionId required' });

    const session = getSession(sessionId);
    if (!session || session.tenantId !== ctx.tenantId) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    if (!session.previewUrl) {
      return reply.status(400).send({ error: 'Session has no preview URL yet — boot it first.' });
    }

    try {
      // Dynamically import @playwright/test so esbuild doesn't try to resolve it at
      // build time and so we can fail gracefully if it isn't installed.
      const specifier = '@playwright/test';
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const pw = await (Function('s', 'return import(s)')(specifier) as Promise<{ chromium?: unknown }>).catch(() => null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chromium: any = pw && (pw as any).chromium;
      if (!chromium) {
        return reply.status(503).send({ error: 'Playwright not installed on this server.' });
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const browser = await chromium.launch({ headless: true });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const page    = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await page.goto(session.previewUrl, { waitUntil: 'networkidle', timeout: 15_000 });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      const buf: Buffer = await page.screenshot({ fullPage: true, type: 'png' });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await browser.close();

      // Upload to assets
      const { uploadBufferAsAsset } = await import('../lib/assetUpload');
      const upload = await uploadBufferAsAsset({
        tenantId:  ctx.tenantId,
        projectId: session.projectId,
        folder:    `previews/${session.projectSlug}/screenshots`,
        filename:  `screenshot-${Date.now()}.png`,
        mimeType:  'image/png',
        buffer:    buf,
      });

      return reply.send({ assetId: upload.assetId, url: upload.url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: `Screenshot failed: ${msg}` });
    }
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
          return reply.type('text/html').send(injectBase(index, slug));
        }
        return reply.status(404).send('Asset not found');
      }

      const mime = mimeType(assetPath);
      if (mime === 'text/html') {
        return reply.type(mime).send(injectBase(content, slug));
      }
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
      return reply.type('text/html').send(injectBase(index, req.params.slug));
    },
  );
}

/**
 * Ensure the HTML has a correct absolute <base href="/api/preview/serve/{slug}/">.
 * Called on every HTML response so the browser resolves relative asset paths
 * (images/foo.jpg, ./main.js) against the right API sub-path.
 *
 * Strategy: always replace any existing base tag with the authoritative one.
 * If no base tag exists, inject one right after <head>.
 */
/** Walk a workspace tree (BFS, max 3 levels deep) looking for either a Vite
 *  React SPA entrypoint (`src/main.tsx`) or a plain `index.html`. Returns
 *  candidates ranked by likely-correctness: dist/build/public first, then
 *  shallowest, then alphabetical. The agent often emits files into a
 *  subdirectory rather than the workspace root — this lets us recover. */
async function findEntrypoints(
  rootDir: string,
  maxDepth: number,
): Promise<Array<{ kind: 'react-vite' | 'static'; rootDir: string }>> {
  const out: Array<{ kind: 'react-vite' | 'static'; rootDir: string; depth: number; rank: number }> = [];

  const PRIORITY_DIRS = ['dist', 'build', 'public', 'out', 'www', 'site', 'app', 'web', 'src'];
  const SKIP_DIRS     = new Set(['node_modules', '.git', '.next', '.cache', '.parcel-cache', '.turbo']);

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }

    // Check for Vite SPA entry (src/main.tsx in this dir)
    const hasMainTsx = entries.some((e) => e.isDirectory() && e.name === 'src') &&
      await stat(join(dir, 'src/main.tsx')).then((s) => s.isFile()).catch(() => false);
    if (hasMainTsx) {
      out.push({ kind: 'react-vite', rootDir: dir, depth, rank: rankFor(dir, rootDir) });
    }

    // Check for static index.html in this dir
    const hasIndex = entries.some((e) => e.isFile() && e.name === 'index.html');
    if (hasIndex) {
      out.push({ kind: 'static', rootDir: dir, depth, rank: rankFor(dir, rootDir) });
    }

    // Recurse into subdirectories
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(join(dir, e.name), depth + 1);
    }
  }

  function rankFor(dir: string, root: string): number {
    const rel = relative(root, dir);
    const head = rel.split(/[\\/]/)[0] ?? '';
    const idx = PRIORITY_DIRS.indexOf(head);
    return idx === -1 ? 999 : idx;
  }

  await walk(rootDir, 0);

  // Prefer Vite SPA over static when both at the same dir;
  // then by priority dir (dist > build > public > ...);
  // then by depth (shallow > deep);
  // then by directory name.
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'react-vite' ? -1 : 1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.rootDir.localeCompare(b.rootDir);
  });

  return out.map(({ kind, rootDir }) => ({ kind, rootDir }));
}

function injectBase(html: Uint8Array, slug: string): Buffer {
  let str = Buffer.from(html).toString('utf8');
  const basePath = `/api/preview/serve/${slug}/`;
  const baseTag  = `<base href="${basePath}">`;

  if (str.includes('<base ')) {
    // Replace whatever base tag is already there (may have a wrong/relative href)
    str = str.replace(/<base\s[^>]*>/i, baseTag);
  } else {
    // No base tag — inject right after <head>
    str = str.replace(/(<head[^>]*>)/i, `$1\n  ${baseTag}`);
  }
  return Buffer.from(str, 'utf8');
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
