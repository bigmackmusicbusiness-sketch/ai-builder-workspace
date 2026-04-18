// packages/db/schema/ops.ts — provider_configs, secret_metadata, publish_targets,
//   preview_sessions, onboarding_flows, audit_events, user_preferences.
import {
  pgTable, text, uuid, jsonb, timestamp, boolean,
} from 'drizzle-orm/pg-core';
import { timestamps, tenants, users } from './core';
import { projects } from './projects';

// ── Provider configs ───────────────────────────────────────────────
export const providerConfigs = pgTable('provider_configs', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
  provider:     text('provider').notNull(),       // 'minimax' | 'ollama'
  name:         text('name').notNull(),           // display name
  baseUrl:      text('base_url'),                // for Ollama
  defaultModel: text('default_model'),
  healthy:      boolean('healthy').default(false),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  /** API key vault ref — NOT the key itself */
  apiKeyRef:    text('api_key_ref'),
  /** JSON: extra adapter-specific config */
  extra:        jsonb('extra').notNull().default({}),
  ...timestamps,
});

// ── Secret metadata (NO values stored here) ────────────────────────
// Values live in the vault (libsodium sealed box in secret_values table).
export const secretMetadata = pgTable('secret_metadata', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => tenants.id),
  projectId:     uuid('project_id').references(() => projects.id),
  name:          text('name').notNull(),          // e.g. 'STRIPE_SECRET_KEY'
  scope:         text('scope').notNull(),         // 'project' | 'tenant' | 'provider'
  env:           text('env').notNull(),           // 'dev' | 'staging' | 'preview' | 'production'
  ownerId:       uuid('owner_id').references(() => users.id),
  lastRotatedAt: timestamp('last_rotated_at', { withTimezone: true }),
  ...timestamps,
});

// ── Secret values (vault storage — service role only) ─────────────
// This table is never queried from the browser or via anon role.
export const secretValues = pgTable('secret_values', {
  id:           uuid('id').primaryKey().defaultRandom(),
  metadataId:   uuid('metadata_id').notNull().references(() => secretMetadata.id),
  /** libsodium sealed box: base64(nonce + ciphertext) */
  ciphertext:   text('ciphertext').notNull(),
  nonce:        text('nonce').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Publish targets ────────────────────────────────────────────────
export const publishTargets = pgTable('publish_targets', {
  id:         uuid('id').primaryKey().defaultRandom(),
  projectId:  uuid('project_id').notNull().references(() => projects.id),
  tenantId:   uuid('tenant_id').notNull().references(() => tenants.id),
  name:       text('name').notNull(),
  adapter:    text('adapter').notNull(),   // 'cloudflare-pages' | 'supabase' | 'static'
  env:        text('env').notNull(),
  /** JSON: adapter-specific config (no secrets — refs vault) */
  config:     jsonb('config').notNull().default({}),
  lastDeployAt: timestamp('last_deploy_at', { withTimezone: true }),
  lastDeployUrl: text('last_deploy_url'),
  ...timestamps,
});

// ── Preview sessions ───────────────────────────────────────────────
export const previewSessions = pgTable('preview_sessions', {
  id:        uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  tenantId:  uuid('tenant_id').notNull().references(() => tenants.id),
  userId:    uuid('user_id').references(() => users.id),
  url:       text('url').notNull(),
  /** 'booting' | 'running' | 'stopped' | 'error' */
  status:    text('status').notNull().default('booting'),
  error:     text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  stoppedAt: timestamp('stopped_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Onboarding flows ───────────────────────────────────────────────
export const onboardingFlows = pgTable('onboarding_flows', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  projectId:   uuid('project_id').references(() => projects.id),
  createdBy:   uuid('created_by').references(() => users.id),
  name:        text('name').notNull(),
  description: text('description'),
  /** JSON: array of typed steps */
  steps:       jsonb('steps').notNull().default([]),
  /** JSON: brand/intake data */
  intake:      jsonb('intake').notNull().default({}),
  status:      text('status').notNull().default('draft'),  // draft | active | archived
  ...timestamps,
});

// ── Audit events ───────────────────────────────────────────────────
// Every sensitive action writes a row here. Values never included.
export const auditEvents = pgTable('audit_events', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
  actor:        uuid('actor').references(() => users.id),
  /** e.g. 'deploy.production', 'secret.rotate', 'migration.apply' */
  action:       text('action').notNull(),
  target:       text('target'),        // table or resource name
  targetId:     text('target_id'),     // resource UUID
  env:          text('env'),
  beforeHash:   text('before_hash'),   // SHA-256 of before-state (no values)
  afterHash:    text('after_hash'),    // SHA-256 of after-state
  /** UUID of the approval record (FK enforced at DB level via SQL, not Drizzle) */
  approvalId:   uuid('approval_id'),
  runId:        uuid('run_id'),
  ip:           text('ip'),
  ua:           text('ua'),
  ts:           timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
});

// ── User preferences ───────────────────────────────────────────────
export const userPreferences = pgTable('user_preferences', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull().references(() => users.id).unique(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
  /** JSON: { theme, defaultProvider, defaultModel, sidebarOpen, splitLayout } */
  prefs:        jsonb('prefs').notNull().default({}),
  ...timestamps,
});
