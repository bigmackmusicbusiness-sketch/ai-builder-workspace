// apps/api/src/db/client.ts — Drizzle + Postgres client (service-role only).
// Never instantiate this in the browser or any worker.
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@abw/db';

let _client: ReturnType<typeof drizzle> | undefined;

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!_client) {
    const connectionString = process.env['DATABASE_URL'] ?? process.env['SUPABASE_URL'];
    if (!connectionString) throw new Error('DATABASE_URL or SUPABASE_URL is required');
    // Use transaction pooler URL format when available.
    const sql = postgres(connectionString, { max: 10, idle_timeout: 30 });
    _client = drizzle(sql, { schema });
  }
  return _client as ReturnType<typeof drizzle<typeof schema>>;
}
