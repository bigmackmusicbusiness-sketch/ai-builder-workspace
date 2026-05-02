// apps/api/src/routes/files.ts — file CRUD and content-addressed blob storage.
// All routes require auth; tenant is derived from JWT (never from client).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/client';
import { projects } from '@abw/db';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import { writeAuditEvent } from '../security/audit';
import * as previewBus from '../preview/eventBus';
import {
  listFiles, getFileContent, saveFile, searchFiles,
  saveFileByPath, getFileContentByPath,
} from '../db/repositories/filesRepo';

const SaveBodySchema = z.object({
  content: z.string().max(10_000_000), // 10 MB max per file
  lang: z.string().default('plaintext'),
});

const SaveByPathSchema = z.object({
  projectId: z.string().uuid(),
  path:      z.string().min(1).max(2048),
  content:   z.string().max(10_000_000),
  lang:      z.string().default('plaintext'),
});

const ContentByPathQuerySchema = z.object({
  projectId: z.string().uuid(),
  path:      z.string().min(1).max(2048),
});

const SearchQuerySchema = z.object({
  projectId: z.string().uuid(),
  q: z.string().min(1).max(200),
});

declare module 'fastify' {
  interface FastifyRequest {
    authCtx?: AuthContext;
  }
}

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  // All routes in this plugin require auth
  app.addHook('preHandler', authMiddleware);

  /** GET /api/files?projectId=… — list files (metadata only) */
  app.get<{ Querystring: { projectId?: string } }>('/api/files', async (req, reply) => {
    const ctx = req.authCtx!;
    const { projectId } = req.query;
    if (!projectId) return reply.status(400).send({ error: 'projectId required' });

    const rows = await listFiles(projectId, ctx.tenantId);
    return { files: rows };
  });

  /** GET /api/files/:id/content — fetch file content */
  app.get<{ Params: { id: string } }>('/api/files/:id/content', async (req, reply) => {
    const ctx = req.authCtx!;
    const content = await getFileContent(req.params.id, ctx.tenantId);
    if (content === null) return reply.status(404).send({ error: 'File not found' });
    return { content };
  });

  /** POST /api/files/:id — save file content; hashes + upserts blob */
  app.post<{ Params: { id: string }; Body: unknown }>('/api/files/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = SaveBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }
    const { content, lang } = parsed.data;

    // We need projectId to be passed by the client (it's the parent context, not a secret).
    // The tenantId is always derived from the JWT.
    const projectId = (req.query as Record<string, string>)['projectId'];
    if (!projectId) return reply.status(400).send({ error: 'projectId required' });

    const newHash = await saveFile({
      fileId: req.params.id,
      projectId,
      tenantId: ctx.tenantId,
      content,
      lang,
    });

    // Notify any open preview SSE listeners so the iframe can hot-reload.
    // Best-effort; never block the save response on this. We resolve slug from
    // projectId because the SSE channel is keyed by tenantId+slug, not id.
    void (async () => {
      try {
        const db = getDb();
        const [proj] = await db
          .select({ slug: projects.slug })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.tenantId, ctx.tenantId)))
          .limit(1);
        if (proj?.slug) {
          previewBus.emit(ctx.tenantId, proj.slug, { type: 'file-changed', path: req.params.id });
        }
      } catch {
        // Don't fail the save if preview-bus emit fails (no listeners is also fine)
      }
    })();

    await writeAuditEvent({
      actor: ctx.userId,
      tenantId: ctx.tenantId,
      action: 'file.save',
      target: 'file',
      targetId: req.params.id,
      after: { hash: newHash },
      env: 'dev',
      ip: req.ip,
      ua: req.headers['user-agent'] ?? '',
    });

    return reply.status(200).send({ hash: newHash });
  });

  /** POST /api/files — path-keyed upsert. Body: { projectId, path, content, lang }.
   *  Use this from the editor: file rows are seeded lazily on first save so a
   *  brand-new project's scaffold paths don't 404 when the user hits Ctrl+S. */
  app.post('/api/files', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = SaveByPathSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }
    const { projectId, path, content, lang } = parsed.data;

    const result = await saveFileByPath({
      projectId, tenantId: ctx.tenantId, path, content, lang,
    });

    // Best-effort preview reload notification (slug → emit). Same pattern as
    // the legacy POST /:id route; failures don't block the save response.
    void (async () => {
      try {
        const db = getDb();
        const [proj] = await db
          .select({ slug: projects.slug })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.tenantId, ctx.tenantId)))
          .limit(1);
        if (proj?.slug) {
          previewBus.emit(ctx.tenantId, proj.slug, { type: 'file-changed', path });
        }
      } catch { /* listener-less is fine */ }
    })();

    await writeAuditEvent({
      actor: ctx.userId,
      tenantId: ctx.tenantId,
      action: 'file.save',
      target: 'file',
      targetId: result.id,
      after: { hash: result.hash, path },
      env: 'dev',
      ip: req.ip,
      ua: req.headers['user-agent'] ?? '',
    });

    return reply.status(200).send(result);
  });

  /** GET /api/files/content?projectId=…&path=… — fetch file content by path */
  app.get<{ Querystring: { projectId?: string; path?: string } }>(
    '/api/files/content',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const parsed = ContentByPathQuerySchema.safeParse({
        projectId: req.query.projectId,
        path:      req.query.path,
      });
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid query', detail: parsed.error.format() });
      }
      const result = await getFileContentByPath(parsed.data.projectId, ctx.tenantId, parsed.data.path);
      if (!result) return reply.status(404).send({ error: 'File not found' });
      return result;
    },
  );

  /** GET /api/files/search?projectId=…&q=… — search file paths/content */
  app.get<{ Querystring: { projectId?: string; q?: string } }>('/api/files/search', async (req, reply) => {
    const ctx = req.authCtx!;
    const parsed = SearchQuerySchema.safeParse({
      projectId: req.query.projectId,
      q: req.query.q,
    });
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', detail: parsed.error.format() });
    }
    const results = await searchFiles(parsed.data.projectId, ctx.tenantId, parsed.data.q);
    return { results };
  });
}
