// apps/api/src/routes/published.ts — public path-based serve route for
// static-export deployments. NO auth: anonymous browser visitors load the
// deployed site at /api/published/<slug>/.
//
// Logic lives in apps/api/src/publish/serveStaticDeploy.ts so the
// host-based custom-domain route can reuse it without copy-paste.

import type { FastifyInstance } from 'fastify';
import { serveStaticDeploy } from '../publish/serveStaticDeploy';

export async function publishedRoutes(app: FastifyInstance): Promise<void> {
  // No auth — serves anonymous visitors

  /** GET /api/published/:slug/ — root, serves index.html
   *  GET /api/published/:slug/*  — any sub-path */
  app.get<{ Params: { slug: string; '*': string | undefined } }>(
    '/api/published/:slug/*',
    async (req, reply) => serveStaticDeploy(req.params.slug, req.params['*'] ?? '', reply),
  );
  app.get<{ Params: { slug: string } }>(
    '/api/published/:slug/',
    async (req, reply) => serveStaticDeploy(req.params.slug, '', reply),
  );
  // Trailing-slash-less form → 308 to root for clean UX
  app.get<{ Params: { slug: string } }>(
    '/api/published/:slug',
    async (req, reply) => reply.redirect(`/api/published/${req.params.slug}/`, 308),
  );
}
