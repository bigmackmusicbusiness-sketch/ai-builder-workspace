// apps/api/src/providers/registry.ts — provider factory + healthcheck-all.
// No auto-routing. The model chosen by the human is used as-is.
// Fallback is disabled by default and requires explicit opt-in per project.
import type { ProviderAdapter, HealthcheckResult } from '@abw/providers';
import { createMinimaxAdapter } from './minimax';
import { createOllamaAdapter }  from './ollama';
import { getDb } from '../db/client';
import { providerConfigs } from '@abw/db';
import { eq } from 'drizzle-orm';

export interface ProviderRegistryEntry {
  id:      string;
  label:   string;
  adapter: ProviderAdapter;
}

/** Get a provider adapter for a specific tenant + environment. */
export async function getAdapter(
  providerId: string,
  tenantId:   string,
  env:        string,
): Promise<ProviderAdapter> {
  switch (providerId) {
    case 'minimax':
      return createMinimaxAdapter(tenantId, env);
    case 'ollama': {
      const db = getDb();
      const rows = await db.select()
        .from(providerConfigs)
        .where(eq(providerConfigs.tenantId, tenantId))
        .limit(1);
      const baseUrl = rows[0]?.baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
      return createOllamaAdapter(baseUrl);
    }
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

/** Run healthcheck for all configured providers for a tenant. */
export async function healthcheckAll(
  tenantId: string,
  env:      string,
): Promise<Record<string, HealthcheckResult>> {
  const results: Record<string, HealthcheckResult> = {};
  const providerIds = ['minimax', 'ollama'];

  await Promise.allSettled(
    providerIds.map(async (id) => {
      try {
        const adapter = await getAdapter(id, tenantId, env);
        results[id] = await adapter.healthcheck();
      } catch (err) {
        results[id] = { ok: false, latencyMs: 0, detail: String(err) };
      }
    }),
  );

  return results;
}

/** Hard rule: no auto-routing. This function exists only to document the contract. */
export function assertNoAutoRoute(selectedProvider: string, selectedModel: string): void {
  if (!selectedProvider || !selectedModel) {
    throw new Error(
      'Provider and model must be explicitly selected before each run. Auto-routing is disabled.',
    );
  }
}
