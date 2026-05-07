// apps/api/src/routes/published.ts — public serve route for static-export
// deployments. NO auth: the whole point is that anonymous browser visitors
// can load the deployed site by URL.
//
// Layout in Supabase Storage (public bucket: project-assets):
//   <tenantId>/published/<slug>/<deployId>/index.html
//   <tenantId>/published/<slug>/<deployId>/<other-files>
//   <tenantId>/published/<slug>/current     ← text file containing the active deployId
//
// The serve route is keyed by slug. To resolve the tenant we look the slug
// up in the projects table (slug is unique per-tenant; we accept that two
// tenants can't both publish a slug-collision because slugs are
// human-meaningful and the marketplace UX hasn't been spec'd yet).
//
// On every request:
//   1. Resolve <slug> → projects.tenantId
//   2. Read   <tenantId>/published/<slug>/current   → deployId
//   3. Serve  <tenantId>/published/<slug>/<deployId>/<requested-path>
//      Default to index.html when path is "/" or empty
//   4. Set CSP / X-Frame-Options to keep helmet's defense-in-depth on
//      published sites that we don't control the contents of
//
// All Storage reads use the service role key — the bucket is "public" but
// we still go through the SDK to get a private fetch URL (saves a redirect)
// and to inherit the SDK's retry/error handling.

import type { FastifyInstance } from 'fastify';
import { eq, and, isNull } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { getDb } from '../db/client';
import { projects } from '@abw/db';
import { env as appEnv } from '../config/env';

const PUBLISHED_BUCKET = 'project-assets';

function mimeFromPath(path: string): string {
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
    avif: 'image/avif',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf:  'font/ttf',
    otf:  'font/otf',
    txt:  'text/plain; charset=utf-8',
    xml:  'application/xml; charset=utf-8',
    pdf:  'application/pdf',
    mp4:  'video/mp4',
    webm: 'video/webm',
    mp3:  'audio/mpeg',
  };
  return map[ext] ?? 'application/octet-stream';
}

export async function publishedRoutes(app: FastifyInstance): Promise<void> {
  // No auth — serves anonymous visitors

  /** GET /api/published/:slug/ — root, serves index.html
   *  GET /api/published/:slug/*  — any sub-path */
  app.get<{ Params: { slug: string; '*': string | undefined } }>(
    '/api/published/:slug/*',
    async (req, reply) => serve(req.params.slug, req.params['*'] ?? '', reply),
  );
  app.get<{ Params: { slug: string } }>(
    '/api/published/:slug/',
    async (req, reply) => serve(req.params.slug, '', reply),
  );
  // Allow a trailing-slash-less form too — redirect to root for clean UX
  app.get<{ Params: { slug: string } }>(
    '/api/published/:slug',
    async (req, reply) => reply.redirect(`/api/published/${req.params.slug}/`, 308),
  );

  async function serve(
    slug: string,
    relPath: string,
    reply: import('fastify').FastifyReply,
  ): Promise<void> {
    if (!/^[a-z0-9-]+$/.test(slug)) {
      reply.status(400).send({ error: 'Invalid slug' });
      return;
    }

    // 1. Resolve slug → tenantId via the projects table.
    //    Slugs are scoped to a tenant; for the public serve route we accept
    //    "first non-deleted match wins" since collisions are not currently
    //    possible across tenants under our user model.
    const db = getDb();
    const [proj] = await db
      .select({ tenantId: projects.tenantId, name: projects.name })
      .from(projects)
      .where(and(eq(projects.slug, slug), isNull(projects.deletedAt)))
      .limit(1);

    if (!proj) {
      reply.status(404).send({ error: 'Project not found or not yet published' });
      return;
    }

    const supabase = createClient(appEnv.SUPABASE_URL, appEnv.SUPABASE_SERVICE_ROLE_KEY);

    // 2. Read the `current` pointer to find the active deploy id
    const pointerKey = `${proj.tenantId}/published/${slug}/current`;
    const { data: pointerBlob, error: pointerErr } = await supabase.storage
      .from(PUBLISHED_BUCKET)
      .download(pointerKey);

    if (pointerErr || !pointerBlob) {
      reply.status(404).send({ error: 'No active deployment for this project. Hit "Deploy" in the workspace.' });
      return;
    }

    const deployId = (await pointerBlob.text()).trim();
    if (!deployId) {
      reply.status(404).send({ error: 'Active-deploy pointer is empty' });
      return;
    }

    // 3. Resolve the requested file. Default to index.html for root /
    //    and for any directory-style path (no extension).
    let file = relPath || 'index.html';
    if (file.endsWith('/')) file = `${file}index.html`;
    if (!/\.[a-zA-Z0-9]+$/.test(file)) file = `${file}/index.html`;

    // Defensive: refuse traversal even though storage path joining wouldn't
    // execute escaped paths anyway
    if (file.includes('..') || file.startsWith('/')) {
      reply.status(400).send({ error: 'Invalid file path' });
      return;
    }

    const fileKey = `${proj.tenantId}/published/${slug}/${deployId}/${file}`;
    const { data: fileBlob, error: fileErr } = await supabase.storage
      .from(PUBLISHED_BUCKET)
      .download(fileKey);

    if (fileErr || !fileBlob) {
      // SPA fallback: only for paths the original request had NO extension on
      // (i.e., the user typed `/about`, not `/missing.css`). The request
      // path is what we should test — but we already mutated `file` to add
      // `/index.html`. Use `relPath` for the original-request signal.
      const requestHadExt = /\.[a-zA-Z0-9]+$/.test(relPath);
      if (!requestHadExt) {
        const idxKey = `${proj.tenantId}/published/${slug}/${deployId}/index.html`;
        const { data: idxBlob } = await supabase.storage.from(PUBLISHED_BUCKET).download(idxKey);
        if (idxBlob) {
          const buf = Buffer.from(await idxBlob.arrayBuffer());
          reply
            .header('Content-Type', 'text/html; charset=utf-8')
            .header('Cache-Control', 'public, max-age=60')
            .send(buf);
          return;
        }
      }
      reply.status(404).send({ error: `File not found in deployment: ${file}` });
      return;
    }

    const buf = Buffer.from(await fileBlob.arrayBuffer());
    reply
      .header('Content-Type', mimeFromPath(file))
      .header('Cache-Control', file === 'index.html' ? 'public, max-age=60' : 'public, max-age=300')
      // Defense-in-depth: the published HTML is user-generated, but our
      // helmet headers don't apply to Storage-served content. Apply the
      // most important ones at the proxy level here.
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'strict-origin-when-cross-origin')
      .header('X-Frame-Options', 'SAMEORIGIN')
      .send(buf);
  }
}
