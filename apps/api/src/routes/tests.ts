// apps/api/src/routes/tests.ts — verification matrix HTTP endpoints.
// POST /api/tests/run     — trigger pipeline for a project
// GET  /api/tests/results — fetch last results per adapter from DB
// POST /api/tests/baseline — set a screenshot as the new baseline

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/client';
import { visualChecks } from '@abw/db';
import { eq, and, desc } from 'drizzle-orm';
import { runPipeline, FULL_ADAPTERS, type AdapterName } from '../verify/pipeline';
import { writeAuditEvent } from '../security/audit';

const RunTestsSchema = z.object({
  projectId:   z.string().uuid(),
  projectRoot: z.string().min(1),
  adapters:    z.array(z.string()).optional(),
  previewUrl:  z.string().url().optional(),
});

const BaselineSchema = z.object({
  projectId:    z.string().uuid(),
  visualCheckId: z.string().uuid(),
});

export async function testsRoutes(app: FastifyInstance): Promise<void> {

  // ── POST /api/tests/run ────────────────────────────────────────────────────
  app.post('/api/tests/run', async (req, reply) => {
    const parsed = RunTestsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }

    const { projectId, projectRoot, adapters, previewUrl } = parsed.data;
    const tenantId = 'dev-tenant';  // TODO: derive from session

    const selectedAdapters = (adapters ?? FULL_ADAPTERS) as AdapterName[];
    const results = await runPipeline({
      adapters:    selectedAdapters,
      projectId,
      tenantId,
      projectRoot,
      previewUrl,
    });

    return reply.send({
      ok:       results.allGreen,
      totalMs:  results.totalMs,
      results:  results.results.map((r) => ({
        adapter:    r.adapter,
        ok:         r.ok,
        durationMs: r.durationMs,
        summary:    r.summary,
        findings:   r.findings,
        skipped:    r.skipped,
        skipReason: r.skipReason,
      })),
    });
  });

  // ── GET /api/tests/results?projectId= ────────────────────────────────────
  app.get('/api/tests/results', async (req, reply) => {
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) return reply.status(400).send({ error: 'projectId required' });

    const db = getDb();
    const rows = await db.select()
      .from(visualChecks)
      .where(eq(visualChecks.projectId, projectId))
      .orderBy(desc(visualChecks.capturedAt))
      .limit(100);

    return reply.send({ results: rows });
  });

  // ── POST /api/tests/baseline ──────────────────────────────────────────────
  app.post('/api/tests/baseline', async (req, reply) => {
    const parsed = BaselineSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }

    const { projectId, visualCheckId } = parsed.data;
    const tenantId = 'dev-tenant';

    const db = getDb();
    const [check] = await db.select()
      .from(visualChecks)
      .where(and(
        eq(visualChecks.id, visualCheckId),
        eq(visualChecks.projectId, projectId),
      ))
      .limit(1);

    if (!check) return reply.status(404).send({ error: 'Visual check not found' });
    if (!check.screenshotUrl) return reply.status(400).send({ error: 'No screenshot URL to promote to baseline' });

    await db.update(visualChecks)
      .set({ baselineUrl: check.screenshotUrl, passed: true, diffPct: 0 })
      .where(and(
        eq(visualChecks.projectId, projectId),
        eq(visualChecks.route, check.route),
        eq(visualChecks.viewport, check.viewport),
      ));

    await writeAuditEvent({
      actor:    'user',
      tenantId,
      action:   'visual_check.baseline_updated',
      target:   'visual_checks',
      targetId: visualCheckId,
      after:    { baselineUrl: check.screenshotUrl, route: check.route, viewport: check.viewport },
      env:      'dev',
    });

    return reply.send({ ok: true });
  });
}
