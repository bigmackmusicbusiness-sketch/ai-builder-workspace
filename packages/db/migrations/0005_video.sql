-- packages/db/migrations/0005_video.sql
-- Video Suite: 4 new project_type values, video_projects table, clipper_jobs table.
-- Idempotent: safe to re-run — uses IF NOT EXISTS / EXCEPTION guards everywhere.

-- ── Project type enum: add 4 video kinds ──────────────────────────
ALTER TYPE project_type ADD VALUE IF NOT EXISTS 'ai_movie';
ALTER TYPE project_type ADD VALUE IF NOT EXISTS 'ai_commercial';
ALTER TYPE project_type ADD VALUE IF NOT EXISTS 'ai_short';
ALTER TYPE project_type ADD VALUE IF NOT EXISTS 'ai_music_video';

-- ── Enums for video_projects ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "video_kind" AS ENUM ('movie','commercial','short','music_video');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "video_status" AS ENUM ('drafting','rendering','ready','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── video_projects ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "video_projects" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"        uuid NOT NULL REFERENCES "tenants"("id"),
  "project_id"       uuid REFERENCES "projects"("id"),
  "title"            text NOT NULL,
  "kind"             "video_kind" NOT NULL,
  "brief"            text,
  "duration_sec"     integer,
  "aspect_ratio"     text NOT NULL DEFAULT '16:9',
  "status"           "video_status" NOT NULL DEFAULT 'drafting',
  -- Single source of truth for the timeline. Tools mutate this; the agent
  -- never holds the full structure in context (see agent/tools/video-edit.ts).
  "timeline"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "preview_asset_id" uuid REFERENCES "assets"("id"),
  "final_asset_id"   uuid REFERENCES "assets"("id"),
  "cost_usd_cents"   integer NOT NULL DEFAULT 0,
  "error"            text,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  "deleted_at"       timestamptz
);
CREATE INDEX IF NOT EXISTS "video_projects_tenant_id_idx"  ON "video_projects" ("tenant_id");
CREATE INDEX IF NOT EXISTS "video_projects_project_id_idx" ON "video_projects" ("project_id");
CREATE INDEX IF NOT EXISTS "video_projects_kind_idx"       ON "video_projects" ("kind");
CREATE INDEX IF NOT EXISTS "video_projects_created_at_idx" ON "video_projects" ("created_at" DESC);
ALTER TABLE "video_projects" ENABLE ROW LEVEL SECURITY;

-- ── Clipper job state ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "clipper_status" AS ENUM (
    'uploading','transcribing','analyzing','cutting','captioning','done','failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "clipper_jobs" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"              uuid NOT NULL REFERENCES "tenants"("id"),
  "project_id"             uuid REFERENCES "projects"("id"),
  -- 'upload' | 'youtube' | 'url'
  "source_kind"            text NOT NULL,
  -- asset id (for 'upload') OR external URL (for 'youtube' / 'url')
  "source_ref"             text NOT NULL,
  "source_duration_sec"    integer,
  "target_clip_count"      integer NOT NULL DEFAULT 5,
  "target_clip_length_sec" integer NOT NULL DEFAULT 30,
  "caption_style"          text NOT NULL DEFAULT 'viral',
  "status"                 "clipper_status" NOT NULL DEFAULT 'uploading',
  "progress_pct"           integer NOT NULL DEFAULT 0,
  -- Pre-LLM scene candidates: [{ start, end, energy, transcriptSnippet }]
  "candidates"             jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Final clips: [{ assetId, start, end, score, reason, captions }]
  "clips"                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  "error"                  text,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "clipper_jobs_tenant_id_idx"  ON "clipper_jobs" ("tenant_id");
CREATE INDEX IF NOT EXISTS "clipper_jobs_project_id_idx" ON "clipper_jobs" ("project_id");
CREATE INDEX IF NOT EXISTS "clipper_jobs_status_idx"     ON "clipper_jobs" ("status");
CREATE INDEX IF NOT EXISTS "clipper_jobs_created_at_idx" ON "clipper_jobs" ("created_at" DESC);
ALTER TABLE "clipper_jobs" ENABLE ROW LEVEL SECURITY;
