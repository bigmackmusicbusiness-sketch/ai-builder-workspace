// apps/api/src/db/client.ts — Drizzle + Postgres client (service-role only).
// Never instantiate this in the browser or any worker.
//
// CONNECTION NOTES:
// - Uses the Supabase DIRECT connection (db.xxx.supabase.co:5432) not Supavisor.
//   Custom DB roles (e.g. abw_app) are not recognised by Supavisor.
// - Railway resolves Supabase's hostname to IPv6 which it cannot route.
//   initDb() pre-resolves to IPv4 at startup; getDb() is then synchronous.
import { lookup } from 'node:dns/promises';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@abw/db';

let _client: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Call once at server startup (before any route handlers run).
 * Resolves the DB host to an IPv4 address so that Railway's IPv6-only
 * DNS response is never used.
 */
export async function initDb(): Promise<void> {
  if (_client) return;

  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required');

  // Parse hostname from the connection URL.
  const url = new URL(connectionString.replace(/^postgresql:\/\//, 'http://'));
  const hostname = url.hostname;

  // Pre-resolve to IPv4 — Railway cannot route to Supabase over IPv6.
  let resolvedHost = hostname;
  try {
    const { address } = await lookup(hostname, { family: 4 });
    resolvedHost = address;
  } catch {
    // DNS resolution failed; fall back to hostname and let the driver handle it.
    resolvedHost = hostname;
  }

  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    prepare: false,    // required if ever switching to Supavisor; no-op on direct
    host: resolvedHost,
    ssl: {
      rejectUnauthorized: false,
      // SNI: validate the SSL cert against the original hostname, not the raw IP.
      servername: hostname,
    },
  });

  _client = drizzle(sql, { schema });
}

/** Returns the Drizzle client. Throws if initDb() has not been called. */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!_client) throw new Error('DB not initialised — call initDb() during server startup');
  return _client as ReturnType<typeof drizzle<typeof schema>>;
}
