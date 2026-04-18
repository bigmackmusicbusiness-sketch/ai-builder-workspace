// packages/db/schema/agent.ts — agent_runs, agent_steps, approvals, visual_checks, runtime_logs.
import {
  pgTable, text, uuid, jsonb, timestamp, integer, real, pgEnum, boolean,
} from 'drizzle-orm/pg-core';
import { timestamps, tenants, users } from './core';
import { projects } from './projects';

// ── Agent run status ───────────────────────────────────────────────
export const agentRunStatusEnum = pgEnum('agent_run_status', [
  'queued', 'planning', 'running', 'paused', 'blocked',
  'awaiting_approval', 'completed', 'failed', 'killed',
]);

// ── Agent runs ─────────────────────────────────────────────────────
export const agentRuns = pgTable('agent_runs', {
  id:          uuid('id').primaryKey().defaultRandom(),
  projectId:   uuid('project_id').notNull().references(() => projects.id),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  initiatedBy: uuid('initiated_by').references(() => users.id),

  goal:        text('goal').notNull(),
  /** The provider/model pinned for this entire run */
  provider:    text('provider').notNull(),
  model:       text('model').notNull(),
  status:      agentRunStatusEnum('status').notNull().default('queued'),

  /** Structured resumable memory — see packages/agent-core/memory.ts */
  memory:      jsonb('memory').notNull().default({}),

  /** Per-run budgets */
  maxSteps:    integer('max_steps'),
  maxTimeSec:  integer('max_time_sec'),
  maxCostUsd:  real('max_cost_usd'),

  /** Actuals */
  stepsUsed:   integer('steps_used').notNull().default(0),
  costUsd:     real('cost_usd').notNull().default(0),

  startedAt:   timestamp('started_at', { withTimezone: true }),
  endedAt:     timestamp('ended_at', { withTimezone: true }),
  summary:     text('summary'),   // human-readable completion/blockers

  /** ID of the version snapshot taken before this run */
  restoreVersionId: uuid('restore_version_id'),

  ...timestamps,
});

// ── Agent step role enum ───────────────────────────────────────────
export const agentRoleEnum = pgEnum('agent_role', [
  'planner', 'builder', 'runtime', 'visual', 'backend', 'fixer', 'release',
]);

export const agentStepStatusEnum = pgEnum('agent_step_status', [
  'pending', 'running', 'completed', 'failed', 'skipped',
]);

// ── Agent steps ────────────────────────────────────────────────────
export const agentSteps = pgTable('agent_steps', {
  id:          uuid('id').primaryKey().defaultRandom(),
  runId:       uuid('run_id').notNull().references(() => agentRuns.id),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  role:        agentRoleEnum('role').notNull(),
  tool:        text('tool').notNull(),       // e.g. 'fs.write', 'verify.run'
  /** SHA-256 of JSON-serialized input (no secrets stored) */
  inputHash:   text('input_hash'),
  /** SHA-256 of JSON-serialized output */
  outputHash:  text('output_hash'),
  model:       text('model'),                // model used for this step
  status:      agentStepStatusEnum('status').notNull().default('pending'),
  durationMs:  integer('duration_ms'),
  costUsd:     real('cost_usd'),
  findingId:   uuid('finding_id'),           // Fixer steps reference a finding
  error:       text('error'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Approval status enum ───────────────────────────────────────────
export const approvalStatusEnum = pgEnum('approval_status', [
  'pending', 'approved', 'rejected', 'changes_requested', 'expired',
]);

// ── Approvals ──────────────────────────────────────────────────────
export const approvals = pgTable('approvals', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  projectId:   uuid('project_id').references(() => projects.id),
  runId:       uuid('run_id').references(() => agentRuns.id),
  requestedBy: uuid('requested_by').references(() => users.id),
  reviewedBy:  uuid('reviewed_by').references(() => users.id),

  action:      text('action').notNull(),   // 'deploy.production' | 'migration.apply' | ...
  /** JSON: { files, diffSummary, screenshots, verificationResults, affectedEnv } */
  bundle:      jsonb('bundle').notNull().default({}),
  status:      approvalStatusEnum('status').notNull().default('pending'),
  reviewNote:  text('review_note'),
  reviewedAt:  timestamp('reviewed_at', { withTimezone: true }),
  expiresAt:   timestamp('expires_at', { withTimezone: true }),

  ...timestamps,
});

// ── Visual checks ──────────────────────────────────────────────────
export const visualChecks = pgTable('visual_checks', {
  id:             uuid('id').primaryKey().defaultRandom(),
  runId:          uuid('run_id').references(() => agentRuns.id),
  projectId:      uuid('project_id').notNull().references(() => projects.id),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  route:          text('route').notNull(),
  viewport:       text('viewport').notNull(),   // '360' | '768' | '1280' | ...
  screenshotUrl:  text('screenshot_url'),
  baselineUrl:    text('baseline_url'),
  diffPct:        real('diff_pct'),
  passed:         boolean('passed'),
  /** JSON: { consoleErrors, networkFailures, blankScreen, overflowDetected } */
  findings:       jsonb('findings').notNull().default({}),
  capturedAt:     timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Runtime logs ───────────────────────────────────────────────────
export const runtimeLogs = pgTable('runtime_logs', {
  id:        uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  tenantId:  uuid('tenant_id').notNull().references(() => tenants.id),
  runId:     uuid('run_id').references(() => agentRuns.id),
  level:     text('level').notNull().default('info'),  // info | warn | error
  source:    text('source'),   // 'dev-server' | 'api' | 'worker' | 'playwright'
  /** Redacted — no secrets */
  message:   text('message').notNull(),
  /** JSON: additional structured fields (no secrets) */
  meta:      jsonb('meta').notNull().default({}),
  ts:        timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
});
