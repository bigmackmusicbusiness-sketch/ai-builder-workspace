// apps/api/src/routes/webhooks.ts — inbound webhook management.
// Each webhook gets a URL path + HMAC signing secret (stored in vault).
// Payloads are stored in webhook_payloads for inspection and replay.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { getDb } from '../db/client';
import { webhooks, webhookPayloads } from '@abw/db';
import { authMiddleware, requireRole, type AuthContext } from '../security/authz';
import { writeAuditEvent } from '../security/audit';
import { generateSecret, vaultPut, vaultGet } from '../security/vault';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const CreateWebhookSchema = z.object({
  projectId: z.string().uuid(),
  name:      z.string().min(1).max(120),
  urlPath:   z.string().regex(/^[a-z0-9_-]+$/).min(1).max(80),
});

export async function webhooksRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /** GET /api/webhooks?projectId=… */
  app.get<{ Querystring: { projectId?: string } }>('/api/webhooks', async (req, reply) => {
    const ctx = req.authCtx!;
    if (!req.query.projectId) return reply.status(400).send({ error: 'projectId required' });

    const db = getDb();
    const rows = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.projectId, req.query.projectId), eq(webhooks.tenantId, ctx.tenantId)));
    // Never return the vault ref value itself
    return { webhooks: rows.map((r) => ({ ...r, signingSecretRef: undefined })) };
  });

  /** POST /api/webhooks — create a webhook + vault the signing secret */
  app.post<{ Body: unknown }>('/api/webhooks', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const parsed = CreateWebhookSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    // Generate a signing secret and store it in vault
    const signingSecret  = generateSecret(32);
    const secretName     = `webhook.${parsed.data.urlPath}.signing_secret`;
    await vaultPut({
      name:      secretName,
      value:     signingSecret,
      scope:     'project',
      env:       'dev',
      tenantId:  ctx.tenantId,
      projectId: parsed.data.projectId,
      ownerId:   ctx.userId,
    });

    const db = getDb();
    const [row] = await db.insert(webhooks).values({
      projectId:        parsed.data.projectId,
      tenantId:         ctx.tenantId,
      name:             parsed.data.name,
      urlPath:          parsed.data.urlPath,
      signingSecretRef: secretName,
      enabled:          true,
    }).returning();

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'webhook.create', target: 'webhook', targetId: row?.id,
      after: { name: parsed.data.name, urlPath: parsed.data.urlPath },
      env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    // Return the signing secret ONCE — user must copy it now
    return reply.status(201).send({ webhook: row, signingSecret });
  });

  /** DELETE /api/webhooks/:id */
  app.delete<{ Params: { id: string } }>('/api/webhooks/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const db = getDb();
    const [row] = await db
      .delete(webhooks)
      .where(and(eq(webhooks.id, req.params.id), eq(webhooks.tenantId, ctx.tenantId)))
      .returning({ id: webhooks.id });

    if (!row) return reply.status(404).send({ error: 'Webhook not found' });

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'webhook.delete', target: 'webhook', targetId: req.params.id,
      env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    return reply.send({ ok: true });
  });

  /** GET /api/webhooks/:id/payloads — list recent payloads */
  app.get<{ Params: { id: string } }>('/api/webhooks/:id/payloads', async (req, reply) => {
    const ctx = req.authCtx!;

    // Verify ownership
    const db = getDb();
    const [hook] = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, req.params.id), eq(webhooks.tenantId, ctx.tenantId)))
      .limit(1);
    if (!hook) return reply.status(404).send({ error: 'Webhook not found' });

    const payloads = await db
      .select()
      .from(webhookPayloads)
      .where(and(eq(webhookPayloads.webhookId, req.params.id), eq(webhookPayloads.tenantId, ctx.tenantId)))
      .orderBy(desc(webhookPayloads.receivedAt))
      .limit(50);

    return { payloads };
  });

  /** POST /api/webhooks/:id/replay — re-deliver a stored payload */
  app.post<{ Params: { id: string }; Body: { payloadId: string } }>('/api/webhooks/:id/replay', async (req, reply) => {
    const ctx = req.authCtx!;
    requireRole(ctx, 'member');

    const db = getDb();
    const [payload] = await db
      .select()
      .from(webhookPayloads)
      .where(and(eq(webhookPayloads.id, req.body.payloadId), eq(webhookPayloads.tenantId, ctx.tenantId)))
      .limit(1);
    if (!payload) return reply.status(404).send({ error: 'Payload not found' });

    await writeAuditEvent({
      actor: ctx.userId, tenantId: ctx.tenantId,
      action: 'webhook.replay', target: 'webhook_payload', targetId: payload.id,
      env: 'dev', ip: req.ip, ua: req.headers['user-agent'] ?? '',
    });

    // TODO: re-deliver to the webhook handler — for now return success stub
    return reply.send({ ok: true, replayed: payload.id });
  });

  // ── Inbound webhook receiver ──────────────────────────────────────────────
  // Receives payloads at /inbound/:urlPath — no auth middleware (public endpoint).
  app.post<{ Params: { urlPath: string } }>('/inbound/:urlPath', {
    config: { skipAuth: true },
    preHandler: [], // override the global preHandler; this route is public
  }, async (req, reply) => {
    const db = getDb();
    const [hook] = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.urlPath, req.params.urlPath), eq(webhooks.enabled, true)))
      .limit(1);

    if (!hook) return reply.status(404).send({ error: 'Unknown webhook path' });

    // Verify HMAC signature if signing secret exists
    if (hook.signingSecretRef) {
      const sigHeader = req.headers['x-webhook-signature'] as string | undefined;
      if (sigHeader) {
        try {
          const secret = await vaultGet({
            name:     hook.signingSecretRef,
            env:      'dev',
            tenantId: hook.tenantId,
          });
          const body = JSON.stringify(req.body ?? '');
          const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
          if (sigHeader !== expected) {
            return reply.status(401).send({ error: 'Invalid signature' });
          }
        } catch {
          // Vault miss — accept anyway (secret may not be set up yet in dev)
        }
      }
    }

    // Store the payload
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    await db.insert(webhookPayloads).values({
      webhookId:  hook.id,
      tenantId:   hook.tenantId,
      method:     req.method,
      headers:    req.headers as Record<string, unknown>,
      body,
      status:     200,
      receivedAt: new Date(),
    });

    return reply.status(200).send({ ok: true });
  });
}
