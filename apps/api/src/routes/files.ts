// apps/api/src/routes/files.ts — file CRUD and content-addressed blob storage.
// All routes require auth; tenant is derived from JWT (never from client).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import { writeAuditEvent } from '../security/audit';
import {
  listFiles, getFileContent, saveFile, searchFiles,
} from '../db/repositories/filesRepo';

const SaveBodySchema = z.object({
  content: z.string().max(10_000_000), // 10 MB max per file
  lang: z.string().default('plaintext'),
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
