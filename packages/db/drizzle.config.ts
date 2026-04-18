// packages/db/drizzle.config.ts — Drizzle Kit config for schema push / migrations.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './schema/*.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? '',
  },
  // Only manage the public schema — don't touch auth/storage/realtime
  schemaFilter: ['public'],
  tablesFilter: ['!auth.*', '!storage.*', '!realtime.*', '!supabase_migrations.*'],
  verbose: true,
  strict: false,
});
