// packages/db/schema/projects.ts — projects, files, blobs, components, pages, routes, services.
import {
  pgTable, text, timestamp, boolean, uuid, integer, jsonb, pgEnum,
} from 'drizzle-orm/pg-core';
import { timestamps, tenants, users } from './core';

// ── Project type enum ──────────────────────────────────────────────
export const projectTypeEnum = pgEnum('project_type', [
  'website', 'landing_page', 'dashboard', 'internal_tool',
  'onboarding_flow', 'automation_panel', 'saas_app',
  'api_service', 'full_stack_app',
  'ebook', 'document', 'email_composer', 'music_studio',
  'ai_movie', 'ai_commercial', 'ai_short', 'ai_music_video',
  'blank',
]);

// ── Environment enum ───────────────────────────────────────────────
export const envEnum = pgEnum('environment', ['dev', 'staging', 'preview', 'production']);

// ── Projects ───────────────────────────────────────────────────────
export const projects = pgTable('projects', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  createdBy:   uuid('created_by').references(() => users.id),
  name:        text('name').notNull(),
  slug:        text('slug').notNull(),
  type:        projectTypeEnum('type').notNull().default('blank'),
  description: text('description'),
  /** JSON: { framework, runtime, language, entryPoint, rootDir } */
  config:      jsonb('config').notNull().default({}),
  /** Active target env for this session */
  activeEnv:   envEnum('active_env').notNull().default('dev'),
  ...timestamps,
});

// ── Files (metadata) ───────────────────────────────────────────────
export const files = pgTable('files', {
  id:          uuid('id').primaryKey().defaultRandom(),
  projectId:   uuid('project_id').notNull().references(() => projects.id),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  path:        text('path').notNull(),              // relative to project root
  lang:        text('lang'),                        // ts, tsx, json, css, sql, md…
  contentHash: text('content_hash'),               // SHA-256 of current blob
  size:        integer('size'),                    // bytes
  dirty:       boolean('dirty').notNull().default(false),
  ...timestamps,
});

// ── File blobs (content-addressed storage) ─────────────────────────
export const fileBlobs = pgTable('file_blobs', {
  hash:      text('hash').primaryKey(),  // SHA-256 hex
  content:   text('content').notNull(),
  size:      integer('size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Versions (project-level snapshots) ────────────────────────────
export const versions = pgTable('versions', {
  id:        uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  tenantId:  uuid('tenant_id').notNull().references(() => tenants.id),
  createdBy: uuid('created_by').references(() => users.id),
  label:     text('label'),           // "Before agent run #42" / "Manual snapshot"
  /** JSON: { [filePath]: blobHash } */
  manifest:  jsonb('manifest').notNull().default({}),
  agentRunId: uuid('agent_run_id'),   // set if created by agent
  ...timestamps,
});

// ── Components ─────────────────────────────────────────────────────
export const components = pgTable('components', {
  id:        uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  tenantId:  uuid('tenant_id').notNull().references(() => tenants.id),
  name:      text('name').notNull(),
  filePath:  text('file_path').notNull(),
  exportName: text('export_name'),
  kind:      text('kind'),     // 'page' | 'layout' | 'widget' | 'section' | 'form'
  ...timestamps,
});

// ── Pages ──────────────────────────────────────────────────────────
export const pages = pgTable('pages', {
  id:          uuid('id').primaryKey().defaultRandom(),
  projectId:   uuid('project_id').notNull().references(() => projects.id),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  title:       text('title').notNull(),
  slug:        text('slug').notNull(),
  filePath:    text('file_path').notNull(),
  /** JSON: SEO metadata */
  meta:        jsonb('meta').notNull().default({}),
  published:   boolean('published').notNull().default(false),
  ...timestamps,
});

// ── Routes ─────────────────────────────────────────────────────────
export const routes = pgTable('routes', {
  id:        uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  tenantId:  uuid('tenant_id').notNull().references(() => tenants.id),
  path:      text('path').notNull(),     // e.g. '/api/users/:id'
  method:    text('method'),             // GET POST PUT PATCH DELETE (null for UI routes)
  filePath:  text('file_path').notNull(),
  kind:      text('kind').notNull().default('page'), // 'page' | 'api' | 'action'
  ...timestamps,
});

// ── Services ───────────────────────────────────────────────────────
export const services = pgTable('services', {
  id:          uuid('id').primaryKey().defaultRandom(),
  projectId:   uuid('project_id').notNull().references(() => projects.id),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  name:        text('name').notNull(),
  kind:        text('kind').notNull(),   // 'http' | 'worker' | 'queue' | 'cron'
  filePath:    text('file_path').notNull(),
  /** JSON: { port, baseUrl, env, bindings } */
  config:      jsonb('config').notNull().default({}),
  ...timestamps,
});
