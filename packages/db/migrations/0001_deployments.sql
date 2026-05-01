-- packages/db/migrations/0001_deployments.sql
-- Adds the deployments table for publish history tracking.
-- Run against your Supabase project via: supabase db push  OR  psql $DATABASE_URL < this_file

CREATE TABLE IF NOT EXISTS "deployments" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "target_id"     uuid NOT NULL REFERENCES "publish_targets"("id") ON DELETE CASCADE,
  "project_id"    uuid NOT NULL REFERENCES "projects"("id"),
  "tenant_id"     uuid NOT NULL REFERENCES "tenants"("id"),
  "status"        text NOT NULL DEFAULT 'building',
  "env"           text NOT NULL,
  "url"           text,
  "triggered_by"  text NOT NULL,
  "commit_msg"    text,
  "duration_ms"   integer,
  "error"         text,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  "deleted_at"    timestamptz
);

CREATE INDEX IF NOT EXISTS "deployments_tenant_id_idx"  ON "deployments" ("tenant_id");
CREATE INDEX IF NOT EXISTS "deployments_project_id_idx" ON "deployments" ("project_id");
CREATE INDEX IF NOT EXISTS "deployments_target_id_idx"  ON "deployments" ("target_id");
CREATE INDEX IF NOT EXISTS "deployments_created_at_idx" ON "deployments" ("created_at" DESC);
