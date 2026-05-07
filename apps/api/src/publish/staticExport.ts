// apps/api/src/publish/staticExport.ts — first-class deploy adapter for the
// "static-export" target. Uploads bundled assets to Supabase Storage at a
// predictable, immutable path; the api then serves them via the
// /api/published/<slug>/* route.
//
// Why this exists alongside the Cloudflare Pages adapter:
//   • CF Pages depends on Cloudflare's Direct Upload API which has been
//     unreliable (Worker exception 1101 on /pages/assets/upload).
//   • This adapter is fully self-contained on infra we already operate
//     (Supabase Storage + the api Fastify server).
//   • Custom domains attach via a CNAME from the user's CF zone to the
//     api hostname — the same UX as Cloudflare Pages from the user's POV.
//
// Layout in Storage (BACKUP_BUCKET = project-assets, public bucket):
//   <tenantId>/published/<slug>/<deployId>/index.html
//   <tenantId>/published/<slug>/<deployId>/_assets/...
//   <tenantId>/published/<slug>/current  ← text file with the active deployId
//
// The /api/published/<slug>/* serve route reads `current` to find the active
// deployment, then streams the requested file. Atomic switchover: write all
// files first, then update `current` last.

import { createClient } from '@supabase/supabase-js';
import { randomUUID }   from 'node:crypto';
import { env }          from '../config/env';

const PUBLISHED_BUCKET = 'project-assets';

export interface StaticExportInput {
  tenantId:     string;
  projectSlug:  string;
  assets:       Map<string, Uint8Array>;
  /** Public origin to use when constructing the live URL.
   *  E.g. `https://api.40-160-3-10.sslip.io`. */
  publicOrigin: string;
}

export interface StaticExportResult {
  url:          string;
  durationMs:   number;
  deploymentId: string;
}

/** MIME type lookup keyed off file extension. */
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

/** Turn a relative workspace path into the Supabase storage key. Always
 *  collapses leading slashes so the path layout is `<tenant>/published/<slug>/<deploy>/<file>`. */
function storageKey(
  tenantId: string,
  slug:     string,
  deployId: string,
  relPath:  string,
): string {
  const clean = relPath.replace(/^\/+/, '');
  return `${tenantId}/published/${slug}/${deployId}/${clean}`;
}

/** Upload all bundled assets to Supabase Storage and atomically flip the
 *  `current` pointer to the new deploy id. Returns the public URL. */
export async function deployStaticExport(input: StaticExportInput): Promise<StaticExportResult> {
  const t0 = Date.now();
  const deployId = randomUUID();

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. Upload every asset under the deploy-id-scoped prefix
  const uploadOps: Promise<{ ok: boolean; path: string; error?: string }>[] = [];
  for (const [relPath, bytes] of input.assets.entries()) {
    const key = storageKey(input.tenantId, input.projectSlug, deployId, relPath);
    const op = (async () => {
      // postgres-js supports Buffer; use that for binary safety
      const buf = Buffer.from(bytes);
      const { error } = await supabase.storage
        .from(PUBLISHED_BUCKET)
        .upload(key, buf, {
          contentType: mimeFromPath(relPath),
          upsert:      true,
          cacheControl: '300',
        });
      if (error) return { ok: false, path: key, error: error.message };
      return { ok: true, path: key };
    })();
    uploadOps.push(op);
  }

  const results = await Promise.all(uploadOps);
  const failed  = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    const sample = failed.slice(0, 3).map((f) => `${f.path}: ${f.error}`).join('; ');
    throw new Error(`Static export: ${failed.length} of ${results.length} assets failed to upload — ${sample}`);
  }

  // 2. Atomically update the `current` pointer so the serve route picks up
  //    the new deploy. This is the last write — readers stay on the previous
  //    deploy until this lands.
  const pointerKey = `${input.tenantId}/published/${input.projectSlug}/current`;
  const { error: pointerErr } = await supabase.storage
    .from(PUBLISHED_BUCKET)
    .upload(pointerKey, Buffer.from(deployId, 'utf-8'), {
      contentType: 'text/plain; charset=utf-8',
      upsert:      true,
      cacheControl: '60',
    });
  if (pointerErr) {
    throw new Error(`Static export: failed to update active-deploy pointer — ${pointerErr.message}`);
  }

  // 3. Return the live URL. The /api/published/<slug>/ route resolves the
  //    pointer + serves the requested file.
  const origin = input.publicOrigin.replace(/\/$/, '');
  const url = `${origin}/api/published/${input.projectSlug}/`;
  return {
    url,
    durationMs:   Date.now() - t0,
    deploymentId: deployId,
  };
}
