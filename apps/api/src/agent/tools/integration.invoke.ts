// apps/api/src/agent/tools/integration.invoke.ts — invoke an external integration action.
// All integration creds come from vault; this tool never accepts raw credentials as input.
// Allowed roles: backend.
//
// integrationId = provider_configs.id (UUID) — the connection record.
// action        = 'ping' | 'send_email' | 'list_domains' | ...
// params        = action-specific payload (no secrets)
import type { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { IntegrationInvokeInput, IntegrationInvokeOutput } from '@abw/agent-core';
import { writeAuditEvent } from '../../security/audit';
import { getDb } from '../../db/client';
import { providerConfigs } from '@abw/db';
import { vaultGet } from '../../security/vault';

export type IntegrationInvokeInputType  = z.infer<typeof IntegrationInvokeInput>;
export type IntegrationInvokeOutputType = z.infer<typeof IntegrationInvokeOutput>;

// ── Per-integration action handlers ───────────────────────────────────────────

async function callStripe(
  apiKey: string,
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const BASE = 'https://api.stripe.com/v1';
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' };

  switch (action) {
    case 'ping': {
      const res = await fetch(`${BASE}/balance`, { headers, signal: AbortSignal.timeout(8000) });
      const data = await res.json() as Record<string, unknown>;
      return { ok: res.ok, status: res.status, object: data?.object };
    }
    case 'list_customers': {
      const limit = (params.limit as number) ?? 10;
      const res = await fetch(`${BASE}/customers?limit=${limit}`, { headers, signal: AbortSignal.timeout(10000) });
      const data = await res.json() as { data?: unknown[]; has_more?: boolean };
      return { count: data.data?.length ?? 0, hasMore: data.has_more ?? false };
    }
    case 'list_products': {
      const res = await fetch(`${BASE}/products?limit=20&active=true`, { headers, signal: AbortSignal.timeout(10000) });
      const data = await res.json() as { data?: unknown[] };
      return { products: data.data ?? [] };
    }
    default:
      return { supported: false, action, message: `Action '${action}' not implemented for Stripe` };
  }
}

async function callResend(
  apiKey: string,
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const BASE = 'https://api.resend.com';
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  switch (action) {
    case 'ping': {
      const res = await fetch(`${BASE}/domains`, { headers, signal: AbortSignal.timeout(8000) });
      return { ok: res.ok, status: res.status };
    }
    case 'send_email': {
      const res = await fetch(`${BASE}/emails`, {
        method:  'POST',
        headers,
        body: JSON.stringify({
          from:    params.from    ?? 'noreply@resend.dev',
          to:      params.to,
          subject: params.subject ?? '(no subject)',
          html:    params.html,
          text:    params.text,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json() as Record<string, unknown>;
      return { ok: res.ok, id: data.id, error: data.message };
    }
    case 'list_domains': {
      const res = await fetch(`${BASE}/domains`, { headers, signal: AbortSignal.timeout(8000) });
      const data = await res.json() as { data?: unknown[] };
      return { domains: data.data ?? [] };
    }
    default:
      return { supported: false, action, message: `Action '${action}' not implemented for Resend` };
  }
}

async function callSendGrid(
  apiKey: string,
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const BASE = 'https://api.sendgrid.com/v3';
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  switch (action) {
    case 'ping': {
      const res = await fetch(`${BASE}/user/profile`, { headers, signal: AbortSignal.timeout(8000) });
      return { ok: res.ok, status: res.status };
    }
    case 'send_email': {
      const res = await fetch(`${BASE}/mail/send`, {
        method:  'POST',
        headers,
        body: JSON.stringify({
          personalizations: [{ to: [{ email: params.to }] }],
          from:    { email: params.from ?? 'noreply@example.com' },
          subject: params.subject ?? '(no subject)',
          content: [{ type: 'text/plain', value: (params.text as string) ?? '' }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      return { ok: res.ok, status: res.status };
    }
    default:
      return { supported: false, action, message: `Action '${action}' not implemented for SendGrid` };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function integrationInvoke(
  input: IntegrationInvokeInputType,
  ctx: { tenantId: string; actorId: string; runId: string },
): Promise<IntegrationInvokeOutputType> {
  const start = Date.now();
  const db    = getDb();

  // Look up the connection record — enforces tenant isolation
  const rows = await db.select()
    .from(providerConfigs)
    .where(and(
      eq(providerConfigs.id, input.integrationId),
      eq(providerConfigs.tenantId, ctx.tenantId),
    ));

  const row = rows[0];
  if (!row) {
    return {
      ok:         false,
      result:     { error: `Integration '${input.integrationId}' not found for this tenant` },
      durationMs: Date.now() - start,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extra         = (row.extra ?? {}) as Record<string, any>;
  const integrationId = (extra.integrationId as string) || row.name;
  const intEnv        = (extra.env as string) || 'dev';
  const keyName       = (extra.vaultKeyName as string | undefined)
    ?? `INTEGRATION_${integrationId.toUpperCase()}_${intEnv.toUpperCase()}`;

  // Fetch the decrypted API key from vault (server-side only)
  let apiKey: string;
  try {
    apiKey = await vaultGet({ name: keyName, env: intEnv, tenantId: ctx.tenantId });
  } catch {
    return {
      ok:         false,
      result:     { error: `No API key found for integration '${integrationId}'. Add it in the Integrations screen.` },
      durationMs: Date.now() - start,
    };
  }

  // Route to the right adapter
  let result: Record<string, unknown>;
  try {
    switch (integrationId) {
      case 'stripe':   result = await callStripe(apiKey, input.action, input.params); break;
      case 'resend':   result = await callResend(apiKey, input.action, input.params); break;
      case 'sendgrid': result = await callSendGrid(apiKey, input.action, input.params); break;
      default:
        result = {
          supported: false,
          integrationId,
          message: `No action adapter for '${integrationId}'. Supported: stripe, resend, sendgrid.`,
        };
    }
  } catch (err) {
    result = { error: err instanceof Error ? err.message : String(err) };
  }

  const ok = !(result.error || result.supported === false);

  await writeAuditEvent({
    actor:    ctx.actorId,
    tenantId: ctx.tenantId,
    action:   'agent.integration_invoke',
    target:   'integration',
    targetId: input.integrationId,
    after:    { integrationId, action: input.action, ok },
    runId:    ctx.runId,
    env:      intEnv,
  });

  return { ok, result, durationMs: Date.now() - start };
}
