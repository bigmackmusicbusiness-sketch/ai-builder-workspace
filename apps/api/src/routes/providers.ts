// apps/api/src/routes/providers.ts — provider healthcheck endpoint.
//
// Replaces the frontend stub that hardcoded "Unconfigured" for MiniMax even
// when the vault held a working key (chat would succeed while the Settings
// page contradicted itself). This endpoint is the source of truth.
import type { FastifyInstance } from 'fastify';
import { authMiddleware, type AuthContext } from '../security/authz';
import { vaultGet } from '../security/vault';
import { env } from '../config/env';

declare module 'fastify' {
  interface FastifyRequest {
    authCtx?: AuthContext;
  }
}

const MINIMAX_KEY_NAMES = ['MINIMAX_API_KEY', 'MINIMAX', 'minimax.api_key', 'MINIMAX_KEY'];

interface ProviderHealth {
  provider:   'minimax' | 'ollama';
  configured: boolean;        // does the provider have what it needs to run?
  ok:         boolean;        // healthcheck round-trip succeeded
  latencyMs?: number;
  detail?:    string;
}

async function checkMinimax(tenantId: string): Promise<ProviderHealth> {
  // Configured = vault holds at least one of the canonical key names.
  // We don't make a real API call here (avoid burning rate-limit on every
  // settings page load) — chat path already does the call lazily.
  for (const name of MINIMAX_KEY_NAMES) {
    try {
      await vaultGet({ name, env: 'dev', tenantId });
      return { provider: 'minimax', configured: true, ok: true };
    } catch { /* try next */ }
  }
  return {
    provider:   'minimax',
    configured: false,
    ok:         false,
    detail:     'No API key in vault. Add MINIMAX_API_KEY in Env & secrets.',
  };
}

async function checkOllama(): Promise<ProviderHealth> {
  const baseUrl = env.OLLAMA_BASE_URL;
  const t0 = Date.now();
  try {
    // /api/tags lists installed models — fast, no auth, fails clean if down.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { provider: 'ollama', configured: true, ok: false,
        detail: `HTTP ${res.status} from ${baseUrl}` };
    }
    return { provider: 'ollama', configured: true, ok: true,
      latencyMs: Date.now() - t0 };
  } catch (err) {
    return {
      provider:   'ollama',
      configured: true,        // base URL is always set; just unreachable
      ok:         false,
      detail:     err instanceof Error ? err.message : 'unreachable',
    };
  }
}

export async function providersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  /** GET /api/providers/health — vault-backed configured + live healthcheck */
  app.get('/api/providers/health', async (req) => {
    const ctx = req.authCtx!;
    const [minimax, ollama] = await Promise.all([
      checkMinimax(ctx.tenantId),
      checkOllama(),
    ]);
    return { providers: [minimax, ollama] };
  });
}
