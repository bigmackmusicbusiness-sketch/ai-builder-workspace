-- 0013_ad_creatives.sql — Ads Studio backing table.
--
-- Creates ad_creatives + the supporting enums for kind & placement.
-- Idempotent — safe to re-run after partial failure (every CREATE uses
-- IF NOT EXISTS, every DDL is wrapped in a DO block where Postgres
-- doesn't natively support IF NOT EXISTS for pgEnum).

DO $$ BEGIN
  CREATE TYPE "ad_kind" AS ENUM ('image', 'video', 'carousel');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ad_placement" AS ENUM ('feed', 'stories', 'reels', 'marketplace');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ad_creatives" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID NOT NULL REFERENCES "tenants"("id"),
  -- Nullable: tenant-scoped ads not tied to a project work the same way as
  -- project-less assets. Lets the user produce ads from a fresh /ads tab
  -- without first scaffolding a project.
  "project_id"     UUID REFERENCES "projects"("id"),
  "kind"           ad_kind NOT NULL,
  "placement"      ad_placement NOT NULL DEFAULT 'feed',
  "aspect_ratio"   TEXT NOT NULL,
  "headline"       TEXT NOT NULL DEFAULT '',
  "primary_text"   TEXT NOT NULL DEFAULT '',
  "description"    TEXT NOT NULL DEFAULT '',
  "call_to_action" TEXT NOT NULL DEFAULT 'Learn More',
  "asset_id"       UUID REFERENCES "assets"("id"),
  "extra"          JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at"     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "ad_creatives_tenant_idx"  ON "ad_creatives" ("tenant_id");
CREATE INDEX IF NOT EXISTS "ad_creatives_project_idx" ON "ad_creatives" ("project_id");
CREATE INDEX IF NOT EXISTS "ad_creatives_kind_idx"    ON "ad_creatives" ("kind");
