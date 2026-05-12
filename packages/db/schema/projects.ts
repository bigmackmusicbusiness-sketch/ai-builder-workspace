// packages/db/schema/projects.ts — projects, files, blobs, components, pages, routes, services.
import {
  pgTable, text, timestamp, boolean, uuid, integer, jsonb, pgEnum,
  // (pgEnum already imported — kept for the new kickoffStatusEnum below)
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
  /** When true, project is visible to all users in the same tenant.
   *  When false (default), only `createdBy` sees it. Toggleable by owner only. */
  isShared:    boolean('is_shared').notNull().default(false),
  /** Optional pointer to a SignalPointSystems workspace that owns this project.
   *  Set when a project is created via the bidirectional handoff flow
   *  (POST /api/sps/projects with a valid HS256 handoff token). NULL for
   *  ordinary standalone-IDE projects, which is the vast majority. The column
   *  is dormant for non-SPS users and never observed by the standalone build
   *  path — see apps/api/tests/integration/standalone-regression.test.ts. */
  spsWorkspaceId: uuid('sps_workspace_id'),
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

// ── Project kickoff messages (round 12 — SPS auto-onboarding) ──────
//
// SPS's auto-onboarding pipeline drops a single seed message into a
// project's chat via POST /api/sps/projects/:projectId/kickoff. The
// row records the seed + tracks the eager (Option B) server-side
// agent run that builds the site from it. The IDE re-renders from
// the resulting agent_runs / agent_steps when the customer eventually
// opens the project — they don't need to click "send" to start the
// build; it's already done (or running).
//
// Idempotency: `onboarding_flow_id` is the SPS-side flow uuid. A
// second POST with the same flow id is a no-op (returns the original
// kickoff_id + current status). Different flow ids on the same project
// produce a 409 — by design, each project gets exactly one kickoff
// across its lifetime.
//
// Standalone-IDE guarantee: rows here are only inserted by the
// /api/sps/projects/:projectId/kickoff endpoint. Standalone projects
// (no SPS workspace) never trigger this code path; the table stays
// empty for them.
export const kickoffStatusEnum = pgEnum('kickoff_status', [
  'queued', 'running', 'completed', 'failed', 'cancelled',
]);

export const projectKickoffMessages = pgTable('project_kickoff_messages', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  projectId:          uuid('project_id').notNull().references(() => projects.id),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  /** The seed message — typically the QC-approved website-build prompt
   *  produced by SPS's per-package generator agent. Hard-capped at 16KB
   *  by the route handler so a 1MB blob can't slip through. */
  content:            text('content').notNull(),
  /** Free-form metadata from SPS: { source, onboarding_flow_id,
   *  qc_approved_at?, qc_artifact_id? }. JSON so SPS can evolve their
   *  pipeline without forcing migrations on ABW. */
  metadata:           jsonb('metadata').notNull().default({}),
  status:             kickoffStatusEnum('status').notNull().default('queued'),
  /** Set when the eager runner starts the agent loop. References
   *  agent_runs.id but not declared as a FK to avoid an import cycle
   *  through agent.ts. */
  agentRunId:         uuid('agent_run_id'),
  /** Idempotency key from the SPS caller. Same flow id = same kickoff
   *  (200 returns the original); different flow id = 409. */
  onboardingFlowId:   text('onboarding_flow_id'),
  /** Audit pointer back to the QC artifact on SPS side. Optional. */
  qcArtifactId:       text('qc_artifact_id'),
  startedAt:          timestamp('started_at',  { withTimezone: true }),
  completedAt:        timestamp('completed_at', { withTimezone: true }),
  /** Captured error message when status='failed'. NULL otherwise. */
  error:              text('error'),
  ...timestamps,
});
