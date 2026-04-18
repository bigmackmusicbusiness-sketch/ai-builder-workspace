// apps/api/src/routes/runs.ts — agent run management endpoints.
// Starts runs, streams events, and exposes pause/resume/stop/kill controls.
// Run events are broadcast to the browser via Supabase Realtime (broadcastRunEvent).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { agentRuns, agentSteps } from '@abw/db';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import { createRun, Orchestrator, type StreamEvent } from '../agent/orchestrator';
import { broadcastRunEvent } from '../realtime/channels';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const StartRunSchema = z.object({
  projectId:   z.string().uuid(),
  goal:        z.string().min(1).max(2000),
  provider:    z.string().min(1),
  model:       z.string().min(1),
  projectRoot: z.string().default('/tmp/project'),
  budget: z.object({
    maxSteps:   z.number().int().min(1).max(200).default(50),
    maxTimeMs:  z.number().int().min(10_000).default(30 * 60 * 1000),
    maxCostUsd: z.number().min(0).default(5),
  }).optional(),
});

// In-process orchestrator registry (single-process; replaces with Redis in prod)
const activeOrchestrators = new Map<string, Orchestrator>();

export async function runsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /** GET /api/runs?projectId=… — list runs for a project */
  app.get<{ Querystring: { projectId?: string; limit?: string } }>('/api/runs', async (req, reply) => {
    const ctx = req.authCtx!;
    if (!req.query.projectId) return reply.status(400).send({ error: 'projectId required' });

    const db = getDb();
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const rows = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.projectId, req.query.projectId), eq(agentRuns.tenantId, ctx.tenantId)))
      .orderBy(desc(agentRuns.startedAt))
      .limit(limit);

    return { runs: rows };
  });

  /** GET /api/runs/:id — get a single run with its steps */
  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    const db = getDb();

    const [run] = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, req.params.id), eq(agentRuns.tenantId, ctx.tenantId)))
      .limit(1);

    if (!run) return reply.status(404).send({ error: 'Run not found' });

    const steps = await db
      .select()
      .from(agentSteps)
      .where(and(eq(agentSteps.runId, req.params.id), eq(agentSteps.tenantId, ctx.tenantId)))
      .orderBy(agentSteps.createdAt);

    return { run, steps };
  });

  /** POST /api/runs — start a new agent run */
  app.post<{ Body: unknown }>('/api/runs', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = StartRunSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    const runId = crypto.randomUUID();

    // Emit events: broadcast via Supabase Realtime + keep local ring buffer for /events poll
    const events: StreamEvent[] = [];
    const emit = (e: StreamEvent) => {
      events.push(e);
      // Broadcast to browser subscribers — non-blocking, non-fatal if Realtime not configured
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void broadcastRunEvent(runId, e as any);
    };

    const { orchestrator } = await createRun({
      runId,
      tenantId:    ctx.tenantId,
      projectId:   parsed.data.projectId,
      userId:      ctx.userId,
      goal:        parsed.data.goal,
      provider:    parsed.data.provider,
      model:       parsed.data.model,
      projectRoot: parsed.data.projectRoot,
      budget:      parsed.data.budget,
    }, emit);

    activeOrchestrators.set(runId, orchestrator);

    // Run in background; client polls /api/runs/:id or subscribes to Realtime
    void orchestrator.run().finally(() => {
      activeOrchestrators.delete(runId);
    });

    return reply.status(202).send({ runId, status: 'queued' });
  });

  /** POST /api/runs/:id/pause */
  app.post<{ Params: { id: string } }>('/api/runs/:id/pause', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');
    const orc = activeOrchestrators.get(req.params.id);
    if (!orc) return reply.status(404).send({ error: 'Run not found or not active' });
    orc.pause();
    return reply.send({ ok: true, status: 'paused' });
  });

  /** POST /api/runs/:id/resume */
  app.post<{ Params: { id: string } }>('/api/runs/:id/resume', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');
    const orc = activeOrchestrators.get(req.params.id);
    if (!orc) return reply.status(404).send({ error: 'Run not found or not active' });
    orc.resume();
    return reply.send({ ok: true, status: 'running' });
  });

  /** POST /api/runs/:id/stop */
  app.post<{ Params: { id: string } }>('/api/runs/:id/stop', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');
    const orc = activeOrchestrators.get(req.params.id);
    if (!orc) return reply.status(404).send({ error: 'Run not found or not active' });
    orc.stop();
    return reply.send({ ok: true, status: 'stopped' });
  });

  /** POST /api/runs/:id/kill — emergency kill */
  app.post<{ Params: { id: string } }>('/api/runs/:id/kill', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');
    const orc = activeOrchestrators.get(req.params.id);
    if (!orc) return reply.status(404).send({ error: 'Run not found or not active' });
    orc.kill();
    activeOrchestrators.delete(req.params.id);
    return reply.send({ ok: true, status: 'killed' });
  });
}
