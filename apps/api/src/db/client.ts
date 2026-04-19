// apps/api/src/db/client.ts — Drizzle + Postgres client (service-role only).
// Never instantiate this in the browser or any worker.
//
// CONNECTION NOTES:
// - Use the Supabase DIRECT connection string (db.xxx.supabase.co:5432) not the Supavisor
//   pooler (aws-0-*.pooler.supabase.com:6543). Custom DB roles are not recognized by
//   Supavisor; the direct connection works with any valid Postgres role.
// - SSL is required for Supabase direct connections; set ssl:'require' or sslmode=require
//   in the URL.
// - prepare:false is a no-op on direct connections but is kept for safety.
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@abw/db';

let _client: ReturnType<typeof drizzle> | undefined;

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!_client) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) throw new Error('DATABASE_URL is required');
    const sql = postgres(connectionString, {
      max: 10,
      idle_timeout: 30,
      prepare: false,    // safe no-op on direct connections; required if using Supavisor
      ssl: 'require',    // Supabase requires SSL for all connections
      connection: {
        application_name: 'abw-api',
      },
    });
    _client = drizzle(sql, { schema });
  }
  return _client as ReturnType<typeof drizzle<typeof schema>>;
}
