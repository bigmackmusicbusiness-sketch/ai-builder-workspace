// apps/api/src/routes/assets.ts — Supabase Storage–backed asset CRUD.
// POST /api/assets/upload  (multipart) → Supabase Storage → DB record
// GET  /api/assets?projectId=          → list DB records
// DELETE /api/assets/:id               → remove from Storage + DB
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { authMiddleware, type AuthContext } from '../security/authz';
import { getDb } from '../db/client';
import { assets, projects } from '@abw/db';
import { eq, and, or, like } from 'drizzle-orm';
import { env } from '../config/env';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const BUCKET = 'project-assets';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function getStorage() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY).storage;
}

export async function assetsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── Upload ─────────────────────────────────────────────────────────────────
  /**
   * POST /api/assets/upload?projectId=&env=
   * Content-Type: multipart/form-data (single file field "file")
   * Returns: { asset: { id, name, mimeType, size, url, uploadedAt } }
   */
  app.post<{ Querystring: { projectId?: string } }>(
    '/api/assets/upload',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const { projectId } = req.query;
      if (!projectId) return reply.status(400).send({ error: 'projectId is required' });

      // @fastify/multipart — req.file() returns the first part
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await (req as any).file() as {
        filename: string;
        mimetype: string;
        toBuffer: () => Promise<Buffer>;
      } | undefined;

      if (!data) return reply.status(400).send({ error: 'No file provided' });

      const buffer = await data.toBuffer();
      if (buffer.length > MAX_FILE_BYTES) {
        return reply.status(413).send({ error: `File too large (max ${MAX_FILE_BYTES / 1_048_576} MB)` });
      }

      // ── B6: MIME sniff via magic-byte detection ─────────────────────────────
      // Don't trust the client-supplied Content-Type. Sniff the first ~4100
      // bytes via file-type and reject when:
      //   • the detected type isn't in our whitelist (image/video/audio/pdf)
      //   • the detected type contradicts the client's claim by media class
      // For text-only types (CSV, JSON, plaintext) file-type returns null —
      // we accept those when the client claim is also a text/* MIME.
      const { fileTypeFromBuffer } = await import('file-type');
      const sniffed = await fileTypeFromBuffer(buffer);
      const claimed = (data.mimetype || '').toLowerCase();
      const ALLOWED_PREFIXES = ['image/', 'video/', 'audio/', 'application/pdf'];
      if (sniffed) {
        const sniffedMime = sniffed.mime.toLowerCase();
        const allowed = ALLOWED_PREFIXES.some((p) => sniffedMime.startsWith(p));
        if (!allowed) {
          return reply.status(400).send({
            error: `Rejected file type "${sniffedMime}" — only images, video, audio, and PDF uploads are accepted.`,
          });
        }
        // Cross-check the class (image/video/audio/pdf). Within a class we
        // accept type drift (e.g., client says image/jpeg, sniffer says
        // image/webp) — that's recoverable. Across classes is malicious.
        const classOf = (m: string): string => m.split('/')[0] ?? '';
        if (claimed && classOf(sniffedMime) !== classOf(claimed) && !claimed.startsWith('application/octet-stream')) {
          return reply.status(400).send({
            error: `MIME mismatch: declared "${claimed}" but bytes are "${sniffedMime}". Refusing upload.`,
          });
        }
      } else {
        // file-type couldn't recognise the bytes — allow only if the client
        // claim is plain text or known-textual JSON/CSV. Anything else
        // smells like obfuscated content; reject.
        const isTextLike = /^(text\/|application\/(json|csv|xml|x-www-form-urlencoded)$)/.test(claimed);
        if (!isTextLike) {
          return reply.status(400).send({
            error: `Could not recognise file type from bytes; refusing upload (client claimed "${claimed || '(none)'}")`,
          });
        }
      }

      const safeFilename = data.filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload';
      const storagePath  = `${ctx.tenantId}/${projectId}/${Date.now()}-${safeFilename}`;
      // Prefer the SNIFFED MIME — never store the client-declared type when
      // it disagrees with the bytes. Falls back to claim if sniff was nullish
      // (text-like content).
      const mimeType     = sniffed?.mime || claimed || 'application/octet-stream';

      const storage = getStorage();
      const { error: uploadErr } = await storage
        .from(BUCKET)
        .upload(storagePath, buffer, { contentType: mimeType, upsert: false });

      if (uploadErr) {
        return reply.status(500).send({ error: `Storage upload failed: ${uploadErr.message}` });
      }

      const { data: urlData } = storage.from(BUCKET).getPublicUrl(storagePath);
      const publicUrl = urlData.publicUrl;

      const db = getDb();
      const [row] = await db.insert(assets).values({
        projectId,
        tenantId:    ctx.tenantId,
        name:        data.filename || safeFilename,
        storagePath,
        mimeType,
        size:        buffer.length,
        publicUrl,
      }).returning();

      if (!row) return reply.status(500).send({ error: 'Failed to create asset record' });

      return {
        asset: {
          id:         row.id,
          name:       row.name,
          mimeType:   row.mimeType,
          size:       row.size,
          url:        publicUrl,
          uploadedAt: row.createdAt?.toISOString(),
        },
      };
    },
  );

  // ── List ───────────────────────────────────────────────────────────────────
  /**
   * GET /api/assets
   *
   * Query parameters:
   *   - `projectId` (uuid, optional)  — filter to a single project's assets.
   *   - `scope`     ('project' | 'tenant', default 'project')
   *       'tenant' returns every asset in the tenant regardless of which project
   *       it's attached to. Used by the chat composer's Platform Media picker
   *       (cross-project asset reuse).
   *   - `kinds`     (csv, optional)
   *       Comma-separated MIME-prefix filter. Accepted values:
   *         image, video, audio, pdf
   *       Anything else is silently dropped. No `kinds` = no filter (all kinds).
   *       PDF maps to the literal `application/pdf` MIME, not a prefix; the
   *       others map to `<kind>/*` prefix matches.
   *
   * Either `projectId` OR `scope=tenant` is required so callers can't
   * accidentally pull every tenant's asset surface (auth still scopes per-tenant
   * but we want intent to be explicit).
   *
   * Response shape:
   *   {
   *     assets: [{
   *       id, name, mimeType, size, url, uploadedAt,
   *       projectId, projectName  // null projectId means "tenant-scoped, no project link"
   *     }]
   *   }
   */
  app.get<{ Querystring: { projectId?: string; scope?: string; kinds?: string } }>('/api/assets', async (req, reply) => {
    const ctx = req.authCtx!;
    const { projectId, scope = 'project', kinds } = req.query;

    if (scope !== 'project' && scope !== 'tenant') {
      return reply.status(400).send({ error: `scope must be 'project' or 'tenant'` });
    }
    if (scope === 'project' && !projectId) {
      return reply.status(400).send({ error: 'projectId is required when scope=project' });
    }

    // Parse and validate kinds filter. Drop unknown values silently to avoid
    // accidentally returning an empty list when the SPA sends a future kind
    // we don't recognise yet (forwards-compat).
    const requestedKinds = (kinds ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((k): k is 'image' | 'video' | 'audio' | 'pdf' =>
        k === 'image' || k === 'video' || k === 'audio' || k === 'pdf');

    const db = getDb();

    // Build where clauses defensively — the assets schema doesn't have a
    // mimeType-prefix index, but the tenant scope keeps the row count
    // bounded and Postgres handles the LIKEs fast enough for this use.
    const tenantClause = eq(assets.tenantId, ctx.tenantId);
    const projectClause = scope === 'project' && projectId
      ? eq(assets.projectId, projectId)
      : undefined;

    const kindClauses = requestedKinds.length > 0
      ? requestedKinds.map((k) =>
          k === 'pdf' ? eq(assets.mimeType, 'application/pdf') : like(assets.mimeType, `${k}/%`),
        )
      : [];
    const kindClause = kindClauses.length > 0 ? or(...kindClauses) : undefined;

    const where = and(
      tenantClause,
      ...(projectClause ? [projectClause] : []),
      ...(kindClause ? [kindClause] : []),
    );

    // LEFT JOIN to projects so tenant-scoped (projectId NULL) assets still
    // come back with a friendly null projectName. The picker groups by
    // projectName when it's set, and dumps null-project rows into a
    // "Tenant library" bucket.
    const rows = await db
      .select({
        id:           assets.id,
        name:         assets.name,
        mimeType:     assets.mimeType,
        size:         assets.size,
        publicUrl:    assets.publicUrl,
        createdAt:    assets.createdAt,
        projectId:    assets.projectId,
        projectName:  projects.name,
        projectSlug:  projects.slug,
      })
      .from(assets)
      .leftJoin(projects, eq(projects.id, assets.projectId))
      .where(where);

    return {
      assets: rows.map((r) => ({
        id:          r.id,
        name:        r.name,
        mimeType:    r.mimeType,
        size:        r.size,
        url:         r.publicUrl ?? '',
        uploadedAt:  r.createdAt?.toISOString() ?? new Date().toISOString(),
        projectId:   r.projectId,
        projectName: r.projectName,
        projectSlug: r.projectSlug,
      })),
    };
  });

  // ── Delete ─────────────────────────────────────────────────────────────────
  /**
   * DELETE /api/assets/:id
   * Removes from Supabase Storage then DB. Returns 204.
   */
  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    const db  = getDb();

    const rows = await db.select()
      .from(assets)
      .where(and(eq(assets.id, req.params.id), eq(assets.tenantId, ctx.tenantId)));

    const row = rows[0];
    if (!row) return reply.status(404).send({ error: 'Asset not found' });

    // Remove from Storage (non-fatal if already gone)
    const storage = getStorage();
    await storage.from(BUCKET).remove([row.storagePath]).catch(() => null);

    // Remove from DB
    await db.delete(assets).where(eq(assets.id, row.id));

    return reply.status(204).send();
  });
}
