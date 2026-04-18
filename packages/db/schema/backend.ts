// packages/db/schema/backend.ts — schemas, migrations, jobs, webhooks, integrations, assets.
import { pgTable, text, uuid, jsonb, boolean, timestamp, integer, pgEnum } from 'drizzle-orm/pg-core';
import { timestamps, tenants, users } from './core';
import { projects, envEnum } from './projects';

// ── DB schemas (user's project schema definitions) ─────────────────
export const schemas = pgTable('schemas', {
  id:        uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  tenantId:  uuid('tenant_id').notNull().references(() => tenants.id),
  name:      text('name').notNull(),   // table name
  /** JSON: { columns: [...], indexes: [...], rls: [...] } */
  definition: jsonb('definition').notNull().default({}),
  ...timestamps,
});

// ── Migration status enum ─────────────────────────────────────────
export const migrationStatusEnum = pgEnum('migration_status', [
  'pending', 'applied', 'rolled_back', 'failed',
]);

// ── Migrations ─────────────────────────────────────────────────────
export const migrations = pgTable('migrations', {
  id:          uuid('id').primaryKey().defaultRandom(),
  projectId:   uuid('project_id').notNull().references(() => projects.id),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  env:         envEnum('env').notNull().default('dev'),
  name:        text('name').notNull(),
  sql:         text('sql').notNull(),
  status:      migrationStatusEnum('status').notNull().default('pending'),
  appliedAt:   timestamp('applied_at', { withTimezone: true }),
  appliedBy:   uuid('applied_by').references(() => users.id),
  approvalId:  uuid('approval_id'),   // FK set after approval lands
  ...timestamps,
});

// ── Jobs ───────────────────────────────────────────────────────────
export const jobs = pgTable('jobs', {
  id:          uuid('id').primaryKey().defaultRandom(),
  projectId:   uuid('project_id').notNull().references(() => projects.id),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  name:        text('name').notNull(),
  handler:     text('handler').notNull(),   // file path
  cron:        text('cron'),                // cron expression or null (on-demand)
  /** JSON: { retries, timeout, queue } */
  config:      jsonb('config').notNull().default({}),
  enabled:     boolean('enabled').notNull().default(true),
  lastRunAt:   timestamp('last_run_at', { withTimezone: true }),
  lastError:   text('last_error'),
  ...timestamps,
});

// ── Webhooks ───────────────────────────────────────────────────────
export const webhooks = pgTable('webhooks', {
  id:              uuid('id').primaryKey().defaultRandom(),
  projectId:       uuid('project_id').notNull().references(() => projects.id),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  name:            text('name').notNull(),
  urlPath:         text('url_path').notNull(),   // /webhooks/{slug}
  signingSecretRef: text('signing_secret_ref'),  // vault key name — never the value
  enabled:         boolean('enabled').notNull().default(true),
  ...timestamps,
});

// ── Webhook payloads (recent N; not permanent log) ─────────────────
export const webhookPayloads = pgTable('webhook_payloads', {
  id:         uuid('id').primaryKey().defaultRandom(),
  webhookId:  uuid('webhook_id').notNull().references(() => webhooks.id),
  tenantId:   uuid('tenant_id').notNull().references(() => tenants.id),
  method:     text('method').notNull(),
  headers:    jsonb('headers').notNull().default({}),
  body:       text('body'),
  status:     integer('status'),  // response status code
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Assets ─────────────────────────────────────────────────────────
export const assets = pgTable('assets', {
  id:          uuid('id').primaryKey().defaultRandom(),
  projectId:   uuid('project_id').notNull().references(() => projects.id),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  name:        text('name').notNull(),
  storagePath: text('storage_path').notNull(),  // Supabase Storage path
  mimeType:    text('mime_type').notNull(),
  size:        integer('size').notNull(),
  publicUrl:   text('public_url'),
  ...timestamps,
});

// ── Brand kits ─────────────────────────────────────────────────────
export const brandKits = pgTable('brand_kits', {
  id:        uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  tenantId:  uuid('tenant_id').notNull().references(() => tenants.id),
  name:      text('name').notNull(),
  /** JSON: { colors, fonts, logoUrl, voice, guidelines } */
  data:      jsonb('data').notNull().default({}),
  ...timestamps,
});

// ── Templates ──────────────────────────────────────────────────────
export const templates = pgTable('templates', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').references(() => tenants.id), // null = global
  name:        text('name').notNull(),
  description: text('description'),
  projectType: text('project_type').notNull(),
  /** JSON: file tree manifest */
  manifest:    jsonb('manifest').notNull().default({}),
  thumbnail:   text('thumbnail'),
  ...timestamps,
});
