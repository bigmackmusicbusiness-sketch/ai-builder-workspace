// apps/api/src/config/env.ts — zod-validated env. Fail fast on missing values.
// VAULT_MASTER_KEY and SUPABASE_SERVICE_ROLE_KEY are crown-jewel assets;
// they must never be logged or returned to the client.
import { z } from 'zod';

const schema = z.object({
  NODE_ENV:               z.enum(['development', 'test', 'production']).default('development'),
  PORT:                   z.coerce.number().default(3007),
  HOST:                   z.string().default('0.0.0.0'),

  SUPABASE_URL:           z.string().url(),
  SUPABASE_ANON_KEY:      z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET:    z.string().min(1),

  /** 32-byte base64-encoded key. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" */
  VAULT_MASTER_KEY:       z.string().min(32),

  CF_ACCOUNT_ID:          z.string().optional(),
  CF_API_TOKEN:           z.string().optional(),
  CF_PAGES_PROJECT:       z.string().optional(),

  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  UPSTASH_QSTASH_TOKEN:   z.string().optional(),

  OLLAMA_BASE_URL:        z.string().url().default('http://localhost:11434'),
  PREVIEW_ROOT_DOMAIN:    z.string().default('preview.local.test'),

  /** Public base URL of THIS API server. Used as the Higgsfield OAuth redirect
   *  target. Must match what the user's browser can reach the API at. Defaults
   *  to http://localhost:{PORT} which works for local Windows dev. */
  PUBLIC_API_URL:         z.string().url().optional(),
});

function parseEnv() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return result.data;
}

export const env = parseEnv();
export type Env = typeof env;
