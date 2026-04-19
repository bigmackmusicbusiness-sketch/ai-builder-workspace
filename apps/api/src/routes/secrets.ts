// apps/api/src/routes/secrets.ts — secret METADATA management (no plaintext values).
// Create/rotate/delete require approval-gating (enforced server-side in Step 11).
// The vault module handles all encryption; this route only touches metadata.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import { writeAuditEvent } from '../security/audit';
import { vaultPut, vaultGet, vaultRotate, vaultList, vaultDel } from '../security/vault';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const CreateSecretSchema = z.object({
  name:      z.string().min(1).max(120),
  value:     z.string().min(1),
  scope:     z.enum(['project', 'tenant', 'global']).default('project'),
  env:       z.enum(['dev', 'staging', 'preview', 'production']),
  projectId: z.string().uuid().optional(),
});

const RotateSecretSchema = z.object({
  metadataId: z.string().uuid(),
  newValue:   z.string().min(1),
});

export async function secretsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /** GET /api/secrets?projectId=… — list secret metadata (never values) */
  app.get<{ Querystring: { projectId?: string } }>('/api/secrets', async (req) => {
    const ctx = req.authCtx!;
    const rows = await vaultList({ tenantId: ctx.tenantId, projectId: req.query.projectId });
    // Strip any field that could leak values (belt + suspenders)
    const safe = rows.map((r) => ({
      id:            r.id,
      name:          r.name,
      scope:         r.scope,
      env:           r.env,
      lastRotatedAt: r.lastRotatedAt,
      ownerId:       r.ownerId,
      projectId:     r.projectId,
    }));
    return { secrets: safe };
  });

  /** POST /api/secrets — create and vault a new secret (admin+) */
  app.post<{ Body: unknown }>('/api/secrets', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'admin');

    const parsed = CreateSecretSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    // Production secrets require approval (Step 11 wires the full gate)
    if (parsed.data.env === 'production') {
      return reply.status(403).send({
        error: 'Production secrets require an approved action.',
        requiresApproval: true,
      });
    }

    const metadataId = await vaultPut({
      name:      parsed.data.name,
      value:     parsed.data.value,
      scope:     parsed.data.scope,
      env:       parsed.data.env,
      tenantId:  ctx.tenantId,
      projectId: parsed.data.projectId,
      ownerId:   ctx.userId,
    });

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'secret.create', target: 'secret_metadata', targetId: metadataId,
      // Never log the value — only the name
      after: { name: parsed.data.name, scope: parsed.data.scope, env: parsed.data.env },
      env: parsed.data.env, ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.status(201).send({ metadataId });
  });

  /** POST /api/secrets/rotate — rotate a secret value */
  app.post<{ Body: unknown }>('/api/secrets/rotate', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'admin');

    const parsed = RotateSecretSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    await vaultRotate({
      metadataId: parsed.data.metadataId,
      newValue:   parsed.data.newValue,
      tenantId:   ctx.tenantId,
    });

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'secret.rotate', target: 'secret_metadata', targetId: parsed.data.metadataId,
      env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.send({ ok: true });
  });

  /** DELETE /api/secrets/:id — delete a secret */
  app.delete<{ Params: { id: string } }>('/api/secrets/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'admin');

    await vaultDel({ metadataId: req.params.id, tenantId: ctx.tenantId });

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'secret.delete', target: 'secret_metadata', targetId: req.params.id,
      env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.send({ ok: true });
  });
}
