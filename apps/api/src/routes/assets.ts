// apps/api/src/routes/assets.ts — Supabase Storage–backed asset CRUD.
// POST /api/assets/upload  (multipart) → Supabase Storage → DB record
// GET  /api/assets?projectId=          → list DB records
// DELETE /api/assets/:id               → remove from Storage + DB
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { authMiddleware, type AuthContext } from '../security/authz';
import { getDb } from '../db/client';
import { assets } from '@abw/db';
import { eq, and } from 'drizzle-orm';
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
   * GET /api/assets?projectId=
   * Returns: { assets: [{ id, name, mimeType, size, url, uploadedAt }] }
   */
  app.get<{ Querystring: { projectId?: string } }>('/api/assets', async (req, reply) => {
    const ctx = req.authCtx!;
    const { projectId } = req.query;
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });

    const db   = getDb();
    const rows = await db.select()
      .from(assets)
      .where(and(eq(assets.projectId, projectId), eq(assets.tenantId, ctx.tenantId)));

    return {
      assets: rows.map((r) => ({
        id:         r.id,
        name:       r.name,
        mimeType:   r.mimeType,
        size:       r.size,
        url:        r.publicUrl ?? '',
        uploadedAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
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
