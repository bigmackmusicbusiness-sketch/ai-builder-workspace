// apps/api/src/routes/integrations.ts — integration connection CRUD.
// API keys stored in vault; OAuth stubbed with 501.
// Connections stored in provider_configs with provider = 'integration'.
//
// GET    /api/integrations          → list connected integrations for tenant
// POST   /api/integrations          → create connection (API-key only; OAuth → 501)
// DELETE /api/integrations/:id      → remove connection + vault key
// POST   /api/integrations/:id/test → ping the integration API, return latency
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, type AuthContext } from '../security/authz';
import { getDb } from '../db/client';
import { providerConfigs } from '@abw/db';
import { vaultPut, vaultGet, vaultDel } from '../security/vault';
import { writeAuditEvent } from '../security/audit';

declare module 'fastify' {
  interface FastifyRequest { authCtx?: AuthContext; }
}

const INT_PROVIDER = 'integration'; // sentinel value in provider_configs.provider

const CreateSchema = z.object({
  integrationId: z.string().min(1),     // e.g. 'stripe', 'resend'
  name:          z.string().min(1),     // display name
  accountLabel:  z.string().optional(), // e.g. "Production Account"
  apiKey:        z.string().optional(), // plaintext key — stored in vault, never returned
  authType:      z.enum(['api-key', 'oauth2', 'webhook']),
  env:           z.enum(['dev', 'staging', 'preview', 'production']).default('dev'),
});

// ── Ping helpers ───────────────────────────────────────────────────────────────

async function pingStripe(key: string): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.status !== 401 && res.status !== 403, latencyMs: Date.now() - t0, detail: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, detail: String(err) };
  }
}

async function pingResend(key: string): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.status !== 401 && res.status !== 403, latencyMs: Date.now() - t0, detail: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, detail: String(err) };
  }
}

async function pingSendGrid(key: string): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.sendgrid.com/v3/user/profile', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.status !== 401 && res.status !== 403, latencyMs: Date.now() - t0, detail: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, detail: String(err) };
  }
}

async function pingIntegration(
  integrationId: string,
  apiKey: string,
): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
  switch (integrationId) {
    case 'stripe':   return pingStripe(apiKey);
    case 'resend':   return pingResend(apiKey);
    case 'sendgrid': return pingSendGrid(apiKey);
    default:         return { ok: true, latencyMs: 0, detail: 'Test not implemented for this integration' };
  }
}

// ── Vault key name for an integration ─────────────────────────────────────────

function vaultKeyName(integrationId: string, env: string): string {
  return `INTEGRATION_${integrationId.toUpperCase()}_${env.toUpperCase()}`;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

export async function integrationsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /** GET /api/integrations — list connected integrations for this tenant */
  app.get('/api/integrations', async (req) => {
    const ctx = req.authCtx!;
    const db  = getDb();

    const rows = await db.select()
      .from(providerConfigs)
      .where(and(
        eq(providerConfigs.tenantId, ctx.tenantId),
        eq(providerConfigs.provider, INT_PROVIDER),
      ));

    return {
      integrations: rows.map((r) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const extra = (r.extra ?? {}) as Record<string, any>;
        return {
          id:            r.id,
          integrationId: (extra.integrationId as string) || r.name,
          name:          (extra.displayName as string) || r.name,
          accountLabel:  (extra.accountLabel as string | undefined),
          authType:      (extra.authType as string) || 'api-key',
          status:        'connected' as const,
          connectedAt:   r.createdAt?.toISOString(),
        };
      }),
    };
  });

  /** POST /api/integrations — create a connection */
  app.post<{ Body: unknown }>('/api/integrations', async (req, reply) => {
    const ctx    = req.authCtx!;
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid body', detail: parsed.error.format() });

    const { integrationId, name, accountLabel, apiKey, authType, env: intEnv } = parsed.data;

    // OAuth: not yet supported — stub with 501
    if (authType === 'oauth2') {
      return reply.status(501).send({
        error: 'OAuth integrations coming soon — use an API key for now.',
        supported: false,
      });
    }

    // Store API key in vault
    let apiKeyRef: string | null = null;
    if (apiKey) {
      const keyName = vaultKeyName(integrationId, intEnv);
      const metaId  = await vaultPut({
        name:     keyName,
        value:    apiKey,
        scope:    'tenant',
        env:      intEnv,
        tenantId: ctx.tenantId,
        ownerId:  ctx.userId,
      });
      apiKeyRef = metaId; // store the vault metadata ID as the ref
    }

    const db = getDb();
    const [row] = await db.insert(providerConfigs).values({
      tenantId:     ctx.tenantId,
      provider:     INT_PROVIDER,
      name:         integrationId,
      apiKeyRef:    apiKeyRef ?? undefined,
      extra: {
        integrationId,
        displayName:  name,
        accountLabel: accountLabel ?? null,
        authType,
        env:          intEnv,
        vaultKeyName: apiKey ? vaultKeyName(integrationId, intEnv) : null,
      },
    }).returning();

    if (!row) return reply.status(500).send({ error: 'Failed to create integration' });

    await writeAuditEvent({
      actor:    ctx.userId,
      tenantId: ctx.tenantId,
      action:   'integration.connect',
      target:   'integration',
      targetId: row.id,
      after:    { integrationId, authType },
      env:      intEnv,
    });

    return {
      integration: {
        id:            row.id,
        integrationId,
        name,
        accountLabel:  accountLabel ?? undefined,
        authType,
        status:        'connected',
        connectedAt:   row.createdAt?.toISOString(),
      },
    };
  });

  /** DELETE /api/integrations/:id — remove connection + vault key */
  app.delete<{ Params: { id: string } }>('/api/integrations/:id', async (req, reply) => {
    const ctx = req.authCtx!;
    const db  = getDb();

    const rows = await db.select()
      .from(providerConfigs)
      .where(and(
        eq(providerConfigs.id, req.params.id),
        eq(providerConfigs.tenantId, ctx.tenantId),
        eq(providerConfigs.provider, INT_PROVIDER),
      ));

    const row = rows[0];
    if (!row) return reply.status(404).send({ error: 'Integration not found' });

    // Soft-delete the vault key if it exists
    if (row.apiKeyRef) {
      await vaultDel({ metadataId: row.apiKeyRef, tenantId: ctx.tenantId }).catch(() => null);
    }

    // Remove config row
    await db.delete(providerConfigs).where(eq(providerConfigs.id, row.id));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extra = (row.extra ?? {}) as Record<string, any>;
    await writeAuditEvent({
      actor:    ctx.userId,
      tenantId: ctx.tenantId,
      action:   'integration.disconnect',
      target:   'integration',
      targetId: row.id,
      after:    { integrationId: extra.integrationId as string },
      env:      (extra.env as string) || 'dev',
    });

    return reply.status(204).send();
  });

  /** POST /api/integrations/:id/test — ping the integration API */
  app.post<{ Params: { id: string } }>('/api/integrations/:id/test', async (req, reply) => {
    const ctx = req.authCtx!;
    const db  = getDb();

    const rows = await db.select()
      .from(providerConfigs)
      .where(and(
        eq(providerConfigs.id, req.params.id),
        eq(providerConfigs.tenantId, ctx.tenantId),
        eq(providerConfigs.provider, INT_PROVIDER),
      ));

    const row = rows[0];
    if (!row) return reply.status(404).send({ error: 'Integration not found' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extra = (row.extra ?? {}) as Record<string, any>;
    const integrationId = (extra.integrationId as string) || row.name;
    const intEnv        = (extra.env as string) || 'dev';
    const keyName       = (extra.vaultKeyName as string | undefined) ?? vaultKeyName(integrationId, intEnv);

    let apiKey: string;
    try {
      apiKey = await vaultGet({ name: keyName, env: intEnv, tenantId: ctx.tenantId });
    } catch {
      return reply.status(400).send({ error: 'No API key stored for this integration' });
    }

    const result = await pingIntegration(integrationId, apiKey);
    return {
      ok:        result.ok,
      latencyMs: result.latencyMs,
      detail:    result.detail,
    };
  });
}
