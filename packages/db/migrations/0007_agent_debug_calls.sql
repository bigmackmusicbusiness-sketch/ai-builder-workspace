-- packages/db/migrations/0007_agent_debug_calls.sql
-- Tool-call diagnostic dump for postmortem analysis of MiniMax tool-arg drift.
-- Idempotent. 30-day retention enforced by app-level cleanup, not DB.

CREATE TABLE IF NOT EXISTS "agent_debug_calls" (
  "id"              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       UUID            NOT NULL,
  "project_id"      UUID,
  "project_slug"    TEXT,
  "tool_name"       TEXT            NOT NULL,
  "raw_args"        TEXT            NOT NULL,
  "parsed_args"     JSONB,
  "recovery_layer"  TEXT,           -- 'schema' | 'aliases' | 'path-as-key' | 'heuristic-ext' | 'heuristic-len' | 'minimax-retry' | 'fallback-model' | null
  "validation_error" TEXT,
  "outcome"         TEXT            NOT NULL, -- 'success' | 'refused' | 'repaired'
  "model"           TEXT,           -- which model emitted the call (e.g. 'minimax-m2.7')
  "created_at"      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "agent_debug_calls_tenant_idx"   ON "agent_debug_calls" ("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "agent_debug_calls_project_idx"  ON "agent_debug_calls" ("project_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "agent_debug_calls_outcome_idx"  ON "agent_debug_calls" ("outcome", "created_at" DESC);
