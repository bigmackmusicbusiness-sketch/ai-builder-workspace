// apps/api/src/agent/tools/integration.invoke.ts — invoke an external integration action.
// All integration creds come from vault; this tool never accepts raw credentials as input.
// Allowed roles: backend.
import type { z } from 'zod';
import { IntegrationInvokeInput, IntegrationInvokeOutput } from '@abw/agent-core';
import { writeAuditEvent } from '../../security/audit';

export type IntegrationInvokeInputType  = z.infer<typeof IntegrationInvokeInput>;
export type IntegrationInvokeOutputType = z.infer<typeof IntegrationInvokeOutput>;

export async function integrationInvoke(
  input: IntegrationInvokeInputType,
  ctx: { tenantId: string; actorId: string; runId: string },
): Promise<IntegrationInvokeOutputType> {
  const start = Date.now();

  // TODO: Step 13 wires real integration adapters (GHL, Stripe, etc.)
  // Stub: log the invocation and return a placeholder result
  await writeAuditEvent({
    actor:    ctx.actorId,
    tenantId: ctx.tenantId,
    action:   'agent.integration_invoke',
    target:   'integration',
    targetId: input.integrationId,
    after:    { action: input.action },
    runId:    ctx.runId,
    env:      'dev',
  });

  return {
    ok:         true,
    result:     { stub: true, integrationId: input.integrationId, action: input.action },
    durationMs: Date.now() - start,
  };
}
