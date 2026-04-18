// apps/api/src/routes/approvals.ts — approval queue CRUD + review endpoints.
// POST /api/approvals          — create an approval request (returns bundle)
// GET  /api/approvals          — list pending + recent approvals
// GET  /api/approvals/:id      — get one approval with full bundle
// POST /api/approvals/:id/approve  — approve (reviewer only)
// POST /api/approvals/:id/reject   — reject
// POST /api/approvals/:id/changes  — request changes
// POST /api/approvals/check    — evaluate whether an action requires approval (no DB write)

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/client';
import { approvals } from '@abw/db';
import { eq, and, desc } from 'drizzle-orm';
import { checkApproval, type ApprovalAction, type ApprovalEnvironment } from '../security/approvalMatrix';
import { writeAuditEvent } from '../security/audit';

// ── Schemas ───────────────────────────────────────────────────────────────────

const CreateApprovalSchema = z.object({
  projectId:   z.string().uuid(),
  runId:       z.string().uuid().optional(),
  action:      z.string().min(1),
  env:         z.enum(['dev', 'staging', 'preview', 'production']),
  scope:       z.string().optional(),
  /** JSON bundle: { files, diffSummary, screenshots, verificationResults } */
  bundle:      z.record(z.unknown()).default({}),
  scale: z.object({
    filesChanged:     z.number().int().optional(),
    linesChanged:     z.number().int().optional(),
    recordsAffected:  z.number().int().optional(),
  }).optional(),
  /** ISO expiry timestamp (defaults to 72h from now) */
  expiresAt:   z.string().optional(),
});

const ReviewSchema = z.object({
  note: z.string().optional(),
});

// ── Route plugin ──────────────────────────────────────────────────────────────

export async function approvalsRoutes(app: FastifyInstance): Promise<void> {

  // ── POST /api/approvals/check ─────────────────────────────────────────────
  // Pure decision — no DB write. Used by UI before kicking off actions.
  app.post('/api/approvals/check', async (req, reply) => {
    const body = req.body as { action?: string; env?: string; scale?: Record<string, number> };
    if (!body.action || !body.env) {
      return reply.status(400).send({ error: 'action and env are required' });
    }

    const decision = checkApproval({
      action:      body.action as ApprovalAction,
      env:         body.env as ApprovalEnvironment,
      tenantId:    'dev-tenant',
      projectId:   (body as Record<string, string>)['projectId'] ?? '',
      requestedBy: 'user',
      scale:       body.scale,
    });

    return reply.send(decision);
  });

  // ── POST /api/approvals ───────────────────────────────────────────────────
  app.post('/api/approvals', async (req, reply) => {
    const parsed = CreateApprovalSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }

    const { projectId, runId, action, env, scope, bundle, scale, expiresAt } = parsed.data;
    const tenantId    = 'dev-tenant';
    const requestedBy = 'user';

    // Check whether approval is even required
    const decision = checkApproval({
      action:  action as ApprovalAction,
      env:     env as ApprovalEnvironment,
      tenantId, projectId, requestedBy, scope, scale,
    });

    if (!decision.requiresApproval) {
      return reply.status(200).send({
        requiresApproval: false,
        reason:           decision.reason,
        approvalId:       null,
      });
    }

    const db = getDb();
    const expiry = expiresAt
      ? new Date(expiresAt)
      : new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h

    const [row] = await db.insert(approvals).values({
      tenantId,
      projectId,
      runId:       runId ?? null,
      requestedBy: null,  // TODO: from auth session
      action,
      bundle:      { ...bundle, scope, scale, decision: decision.bundleSpec },
      status:      'pending',
      expiresAt:   expiry,
    }).returning({ id: approvals.id });

    if (!row) return reply.status(500).send({ error: 'Failed to create approval' });

    await writeAuditEvent({
      actor:    requestedBy,
      tenantId,
      action:   'approval.created',
      target:   'approvals',
      targetId: row.id,
      after:    { action, env, status: 'pending' },
      env,
    });

    return reply.status(201).send({
      requiresApproval: true,
      reason:           decision.reason,
      approvalId:       row.id,
      bundleSpec:       decision.bundleSpec,
    });
  });

  // ── GET /api/approvals?projectId= ─────────────────────────────────────────
  app.get('/api/approvals', async (req, reply) => {
    const { projectId } = req.query as { projectId?: string };
    const tenantId = 'dev-tenant';

    const db = getDb();
    const query = db.select()
      .from(approvals)
      .where(eq(approvals.tenantId, tenantId))
      .orderBy(desc(approvals.createdAt))
      .limit(50);

    const rows = projectId
      ? await db.select()
          .from(approvals)
          .where(and(eq(approvals.tenantId, tenantId), eq(approvals.projectId, projectId)))
          .orderBy(desc(approvals.createdAt))
          .limit(50)
      : await query;

    return reply.send({ approvals: rows });
  });

  // ── GET /api/approvals/:id ────────────────────────────────────────────────
  app.get('/api/approvals/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = 'dev-tenant';
    const db = getDb();

    const [row] = await db.select()
      .from(approvals)
      .where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)))
      .limit(1);

    if (!row) return reply.status(404).send({ error: 'Approval not found' });
    return reply.send({ approval: row });
  });

  // ── POST /api/approvals/:id/approve ───────────────────────────────────────
  app.post('/api/approvals/:id/approve', async (req, reply) => {
    const { id }   = req.params as { id: string };
    const parsed   = ReviewSchema.safeParse(req.body);
    const tenantId = 'dev-tenant';
    const reviewer = 'user';

    const db = getDb();
    const [existing] = await db.select()
      .from(approvals)
      .where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)))
      .limit(1);

    if (!existing) return reply.status(404).send({ error: 'Approval not found' });
    if (existing.status !== 'pending') {
      return reply.status(409).send({ error: `Cannot approve — current status is '${existing.status}'` });
    }
    if (existing.expiresAt && new Date(existing.expiresAt) < new Date()) {
      return reply.status(409).send({ error: 'Approval has expired' });
    }

    await db.update(approvals)
      .set({
        status:     'approved',
        reviewedBy: null,  // TODO: from auth session
        reviewNote: parsed.success ? parsed.data.note : undefined,
        reviewedAt: new Date(),
      })
      .where(eq(approvals.id, id));

    await writeAuditEvent({
      actor:    reviewer,
      tenantId,
      action:   'approval.approved',
      target:   'approvals',
      targetId: id,
      after:    { status: 'approved' },
      env:      'dev',
    });

    return reply.send({ ok: true, status: 'approved' });
  });

  // ── POST /api/approvals/:id/reject ────────────────────────────────────────
  app.post('/api/approvals/:id/reject', async (req, reply) => {
    const { id }   = req.params as { id: string };
    const parsed   = ReviewSchema.safeParse(req.body);
    const tenantId = 'dev-tenant';
    const reviewer = 'user';

    const db = getDb();
    const [existing] = await db.select()
      .from(approvals)
      .where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)))
      .limit(1);

    if (!existing) return reply.status(404).send({ error: 'Approval not found' });
    if (existing.status !== 'pending') {
      return reply.status(409).send({ error: `Cannot reject — current status is '${existing.status}'` });
    }

    await db.update(approvals)
      .set({
        status:     'rejected',
        reviewedBy: null,
        reviewNote: parsed.success ? parsed.data.note : undefined,
        reviewedAt: new Date(),
      })
      .where(eq(approvals.id, id));

    await writeAuditEvent({
      actor:    reviewer,
      tenantId,
      action:   'approval.rejected',
      target:   'approvals',
      targetId: id,
      after:    { status: 'rejected' },
      env:      'dev',
    });

    return reply.send({ ok: true, status: 'rejected' });
  });

  // ── POST /api/approvals/:id/changes ───────────────────────────────────────
  app.post('/api/approvals/:id/changes', async (req, reply) => {
    const { id }   = req.params as { id: string };
    const parsed   = ReviewSchema.safeParse(req.body);
    const tenantId = 'dev-tenant';

    const db = getDb();
    const [existing] = await db.select()
      .from(approvals)
      .where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)))
      .limit(1);

    if (!existing) return reply.status(404).send({ error: 'Approval not found' });

    await db.update(approvals)
      .set({
        status:     'changes_requested',
        reviewNote: parsed.success ? parsed.data.note : undefined,
        reviewedAt: new Date(),
      })
      .where(eq(approvals.id, id));

    await writeAuditEvent({
      actor:    'user',
      tenantId,
      action:   'approval.changes_requested',
      target:   'approvals',
      targetId: id,
      after:    { status: 'changes_requested' },
      env:      'dev',
    });

    return reply.send({ ok: true, status: 'changes_requested' });
  });
}
