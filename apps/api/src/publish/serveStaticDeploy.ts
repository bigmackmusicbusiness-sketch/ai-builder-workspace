// apps/api/src/publish/serveStaticDeploy.ts — shared serve logic for
// static-export deployments. Used by both the path-based public route
// (apps/api/src/routes/published.ts → /api/published/:slug/...) AND
// the host-based custom-domain route
// (apps/api/src/routes/customHost.ts → request.host = customDomain).
//
// Layout in Storage matches what staticExport.ts wrote:
//   <tenantId>/published/<slug>/<deployId>/<file>
//   <tenantId>/published/<slug>/current     ← active deploy id pointer

import type { FastifyReply } from 'fastify';
import { eq, and, isNull } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { getDb } from '../db/client';
import { projects } from '@abw/db';
import { env as appEnv } from '../config/env';

const PUBLISHED_BUCKET = 'project-assets';

/** Map filename → MIME type. Conservative — falls back to octet-stream. */
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

/**
 * Look up the active deployment for `slug` and stream the requested file.
 * Both the path-based and host-based public routes funnel through here so
 * the headers, SPA fallback, and traversal guards stay in one place.
 */
export async function serveStaticDeploy(
  slug: string,
  relPath: string,
  reply: FastifyReply,
): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    reply.status(400).send({ error: 'Invalid slug' });
    return;
  }

  // 1. slug → tenantId via projects table
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

  // 2. read `current` pointer
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

  // 3. resolve requested file. Default to index.html for / and directory paths.
  let file = relPath || 'index.html';
  if (file.endsWith('/')) file = `${file}index.html`;
  if (!/\.[a-zA-Z0-9]+$/.test(file)) file = `${file}/index.html`;

  // refuse traversal
  if (file.includes('..') || file.startsWith('/')) {
    reply.status(400).send({ error: 'Invalid file path' });
    return;
  }

  const fileKey = `${proj.tenantId}/published/${slug}/${deployId}/${file}`;
  const { data: fileBlob, error: fileErr } = await supabase.storage
    .from(PUBLISHED_BUCKET)
    .download(fileKey);

  if (fileErr || !fileBlob) {
    // SPA fallback: only for extensionless paths in the original request
    const requestHadExt = /\.[a-zA-Z0-9]+$/.test(relPath);
    if (!requestHadExt) {
      const idxKey = `${proj.tenantId}/published/${slug}/${deployId}/index.html`;
      const { data: idxBlob } = await supabase.storage.from(PUBLISHED_BUCKET).download(idxKey);
      if (idxBlob) {
        const buf = Buffer.from(await idxBlob.arrayBuffer());
        reply
          .header('Content-Type', 'text/html; charset=utf-8')
          .header('Cache-Control', 'public, max-age=60')
          .header('X-Content-Type-Options', 'nosniff')
          .header('Referrer-Policy', 'strict-origin-when-cross-origin')
          .header('X-Frame-Options', 'SAMEORIGIN')
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
    .header('X-Content-Type-Options', 'nosniff')
    .header('Referrer-Policy', 'strict-origin-when-cross-origin')
    .header('X-Frame-Options', 'SAMEORIGIN')
    .send(buf);
}
