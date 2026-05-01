// apps/api/src/routes/editor.ts — Visual Editor API routes.
//
// POST   /api/editor/session           Create a session for an HTML file
// GET    /api/editor/serve/:sessionId  Serve stamped HTML with injected runtime (public)
// POST   /api/editor/apply             Apply an edit action to the file
// GET    /api/editor/history/:sessionId List last 50 edits for a session
// DELETE /api/editor/sessions/:sessionId Mark session as 'closed'
import type { FastifyInstance } from 'fastify';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { editorSessions, editorEdits } from '@abw/db';
import { authMiddleware, type AuthContext } from '../security/authz';
import { stampIds } from '../editor/selectors';
import { applyEdit, type EditAction } from '../editor/apply';
import { EDITOR_RUNTIME } from '../editor/runtime';

declare module 'fastify' {
  interface FastifyRequest   { authCtx?: AuthContext; }
  interface FastifyContextConfig { skipAuth?: boolean; }
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CreateSessionSchema = z.object({
  /** Absolute path to the HTML file on disk (the frontend knows it from the project record). */
  workspacePath: z.string().min(1),
  projectId:     z.string().uuid().optional(),
  targetType:    z.enum(['website', 'ebook', 'email']),
  targetId:      z.string().optional(),
});

const EditActionSchema: z.ZodType<EditAction> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('edit_text'),        newText:  z.string() }),
  z.object({ type: z.literal('edit_attr'),         attr:     z.string(), value: z.string() }),
  z.object({ type: z.literal('edit_style'),        property: z.string(), value: z.string() }),
  z.object({ type: z.literal('replace_image'),     src:      z.string() }),
  z.object({ type: z.literal('delete_element') }),
  z.object({ type: z.literal('duplicate_element') }),
  z.object({ type: z.literal('reorder_siblings'), newIndex: z.number().int().min(0) }),
]);

const ApplyEditSchema = z.object({
  sessionId: z.string().uuid(),
  abwId:     z.string().min(1),
  action:    EditActionSchema,
});

// ── Injected HTML helpers ─────────────────────────────────────────────────────

const EDITOR_STYLE = `
<style>
  /* Ensure pointer-events work in iframe for editor interactions */
  * { pointer-events: auto !important; }
  [data-abw-id]:hover { cursor: pointer; }
</style>`;

function injectRuntime(html: string): string {
  const script = `<script>${EDITOR_RUNTIME}</script>`;
  const style  = EDITOR_STYLE;

  // Inject style just before </head> if present, else before </body>
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${style}\n</head>`);
  }

  // Inject script just before </body>
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${script}\n</body>`);
  }
  // Fallback: append at end
  return html + script;
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export async function editorRoutes(app: FastifyInstance): Promise<void> {
  // Global auth hook — individual routes may opt out via config.skipAuth
  app.addHook('preHandler', authMiddleware);

  // ── POST /api/editor/session ───────────────────────────────────────────────
  /**
   * Create an editor session for a specific HTML file.
   * Body: { workspacePath, projectId?, targetType, targetId? }
   * Returns: { sessionId, previewUrl }
   */
  app.post<{ Body: unknown }>('/api/editor/session', async (req, reply) => {
    const ctx = req.authCtx!;

    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }

    const { workspacePath, projectId, targetType, targetId } = parsed.data;

    // Verify the file exists and is readable
    let rawHtml: string;
    try {
      rawHtml = await readFile(workspacePath, 'utf8');
    } catch {
      return reply.status(400).send({ error: `Cannot read file: ${workspacePath}` });
    }

    // Stamp IDs up-front so the session is consistent
    const _ = stampIds(rawHtml); // validate parse5 can handle it; discard — we stamp on serve
    void _;

    const db = getDb();
    const [session] = await db.insert(editorSessions).values({
      tenantId:   ctx.tenantId,
      projectId:  projectId ?? null,
      filePath:   workspacePath,
      targetType,
      targetId:   targetId ?? null,
      status:     'active',
      editCount:  0,
    }).returning();

    if (!session) {
      return reply.status(500).send({ error: 'Failed to create editor session' });
    }

    const previewUrl = `/api/editor/serve/${session.id}`;
    return reply.status(201).send({ sessionId: session.id, previewUrl });
  });

  // ── GET /api/editor/serve/:sessionId ──────────────────────────────────────
  /**
   * Public endpoint — loaded inside an iframe, no auth headers available.
   * Reads the workspace file, stamps IDs, injects the runtime, and returns HTML.
   */
  app.get<{ Params: { sessionId: string } }>(
    '/api/editor/serve/:sessionId',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const db = getDb();

      const rows = await db
        .select()
        .from(editorSessions)
        .where(eq(editorSessions.id, req.params.sessionId))
        .limit(1);

      const session = rows[0];
      if (!session || session.status === 'closed') {
        return reply.status(404).send('Editor session not found or closed.');
      }

      let html: string;
      try {
        html = await readFile(session.filePath, 'utf8');
      } catch {
        return reply.status(500).send('Could not read workspace file.');
      }

      const stamped  = stampIds(html);
      const injected = injectRuntime(stamped);

      return reply
        .type('text/html')
        .header('X-Frame-Options', 'SAMEORIGIN')
        .send(injected);
    },
  );

  // ── POST /api/editor/apply ────────────────────────────────────────────────
  /**
   * Apply a single edit action to the file.
   * Body: { sessionId, abwId, action: EditAction }
   * Returns: { ok: true, newHtml: string }
   */
  app.post<{ Body: unknown }>('/api/editor/apply', async (req, reply) => {
    const ctx = req.authCtx!;

    const parsed = ApplyEditSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });
    }

    const { sessionId, abwId, action } = parsed.data;

    const db = getDb();

    // Fetch session and verify tenant ownership
    const sessionRows = await db
      .select()
      .from(editorSessions)
      .where(
        and(
          eq(editorSessions.id, sessionId),
          eq(editorSessions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);

    const session = sessionRows[0];
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    if (session.status === 'closed') {
      return reply.status(400).send({ error: 'Session is closed' });
    }

    // Read current HTML
    let currentHtml: string;
    try {
      currentHtml = await readFile(session.filePath, 'utf8');
    } catch {
      return reply.status(500).send({ error: 'Could not read workspace file' });
    }

    // Apply the mutation
    let newHtml: string;
    try {
      newHtml = applyEdit(currentHtml, abwId, action);
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode ?? 400;
      return reply.status(statusCode).send({ error: (err as Error).message });
    }

    // Write back to disk
    try {
      await writeFile(session.filePath, newHtml, 'utf8');
    } catch {
      return reply.status(500).send({ error: 'Failed to write file' });
    }

    // Persist edit record
    await db.insert(editorEdits).values({
      sessionId,
      action:    action.type as typeof editorEdits.$inferInsert['action'],
      selector:  abwId,
      payload:   action as Record<string, unknown>,
      actor:     ctx.userId,
    });

    // Increment session edit counter + lastEditAt
    await db
      .update(editorSessions)
      .set({
        editCount:  (session.editCount ?? 0) + 1,
        lastEditAt: new Date(),
      })
      .where(eq(editorSessions.id, sessionId));

    return { ok: true, newHtml };
  });

  // ── GET /api/editor/history/:sessionId ────────────────────────────────────
  /**
   * Return the last 50 edits for a session, ordered by appliedAt DESC.
   */
  app.get<{ Params: { sessionId: string } }>(
    '/api/editor/history/:sessionId',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const db  = getDb();

      // Auth: confirm the session belongs to this tenant
      const sessionRows = await db
        .select()
        .from(editorSessions)
        .where(
          and(
            eq(editorSessions.id, req.params.sessionId),
            eq(editorSessions.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);

      if (!sessionRows[0]) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const edits = await db
        .select()
        .from(editorEdits)
        .where(eq(editorEdits.sessionId, req.params.sessionId))
        .orderBy(desc(editorEdits.appliedAt))
        .limit(50);

      return { edits };
    },
  );

  // ── GET /api/editor/sessions/:sessionId ──────────────────────────────────
  /** Fetch session metadata (used by VisualEditorScreen toolbar). */
  app.get<{ Params: { sessionId: string } }>(
    '/api/editor/sessions/:sessionId',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const db  = getDb();
      const rows = await db
        .select()
        .from(editorSessions)
        .where(and(eq(editorSessions.id, req.params.sessionId), eq(editorSessions.tenantId, ctx.tenantId)))
        .limit(1);
      if (!rows[0]) return reply.status(404).send({ error: 'Session not found' });
      const s = rows[0];
      return { session: { id: s.id, filePath: s.filePath, targetType: s.targetType, editCount: s.editCount } };
    },
  );

  // ── DELETE /api/editor/sessions/:sessionId ────────────────────────────────
  /**
   * Mark a session as 'closed'. Idempotent.
   */
  app.delete<{ Params: { sessionId: string } }>(
    '/api/editor/sessions/:sessionId',
    async (req, reply) => {
      const ctx = req.authCtx!;
      const db  = getDb();

      const [updated] = await db
        .update(editorSessions)
        .set({ status: 'closed' })
        .where(
          and(
            eq(editorSessions.id, req.params.sessionId),
            eq(editorSessions.tenantId, ctx.tenantId),
          ),
        )
        .returning({ id: editorSessions.id });

      if (!updated) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      return { ok: true };
    },
  );
}
