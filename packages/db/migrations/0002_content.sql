-- packages/db/migrations/0002_content.sql
-- Creative Suite: eBooks, Documents, Music tracks, Visual Editor sessions + edits.
-- Apply via Supabase Management API or psql $DATABASE_URL < this_file.

-- ── Enums ─────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "ebook_style" AS ENUM (
    'professional_business','lead_magnet','narrative_story','how_to_guide',
    'academic','cookbook','kdp_novel','picture_book'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "content_status" AS ENUM ('generating','ready','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "document_type" AS ENUM (
    'business_proposal','case_study','project_report','invoice','pitch_deck'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "music_mode"   AS ENUM ('beat','cinematic');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "music_status" AS ENUM ('generating','separating','packaging','ready','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "editor_target" AS ENUM ('website','ebook','email');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "editor_session_status" AS ENUM ('active','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "editor_action" AS ENUM (
    'edit_text','edit_attr','edit_style','replace_image',
    'delete_element','duplicate_element','reorder_siblings','ai_rewrite'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── eBooks ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ebooks" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"           uuid NOT NULL REFERENCES "tenants"("id"),
  "project_id"          uuid REFERENCES "projects"("id"),
  "title"               text NOT NULL,
  "topic"               text,
  "audience"            text,
  "tone"                text,
  "genre"               text,
  "pov"                 text,
  "style"               "ebook_style" NOT NULL,
  "chapter_count"       integer NOT NULL DEFAULT 5,
  "word_count_target"   integer NOT NULL DEFAULT 800,
  "status"              "content_status" NOT NULL DEFAULT 'generating',
  "pdf_asset_id"        uuid REFERENCES "assets"("id"),
  "epub_asset_id"       uuid REFERENCES "assets"("id"),
  "cover_asset_id"      uuid REFERENCES "assets"("id"),
  "kdp_bundle_asset_id" uuid REFERENCES "assets"("id"),
  "outline"             jsonb NOT NULL DEFAULT '{}'::jsonb,
  "cover_variants"      jsonb NOT NULL DEFAULT '[]'::jsonb,
  "error"               text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  "deleted_at"          timestamptz
);
CREATE INDEX IF NOT EXISTS "ebooks_tenant_id_idx"  ON "ebooks" ("tenant_id");
CREATE INDEX IF NOT EXISTS "ebooks_project_id_idx" ON "ebooks" ("project_id");
CREATE INDEX IF NOT EXISTS "ebooks_created_at_idx" ON "ebooks" ("created_at" DESC);
ALTER TABLE "ebooks" ENABLE ROW LEVEL SECURITY;

-- ── Documents ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "documents" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"   uuid NOT NULL REFERENCES "tenants"("id"),
  "project_id"  uuid REFERENCES "projects"("id"),
  "title"       text NOT NULL,
  "doc_type"    "document_type" NOT NULL,
  "status"      "content_status" NOT NULL DEFAULT 'generating',
  "asset_id"    uuid REFERENCES "assets"("id"),
  "content"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error"       text,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  "deleted_at"  timestamptz
);
CREATE INDEX IF NOT EXISTS "documents_tenant_id_idx"  ON "documents" ("tenant_id");
CREATE INDEX IF NOT EXISTS "documents_project_id_idx" ON "documents" ("project_id");
CREATE INDEX IF NOT EXISTS "documents_created_at_idx" ON "documents" ("created_at" DESC);
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;

-- ── Music tracks ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "music_tracks" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"       uuid NOT NULL REFERENCES "tenants"("id"),
  "project_id"      uuid REFERENCES "projects"("id"),
  "title"           text NOT NULL,
  "mode"            "music_mode" NOT NULL,
  "inputs"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "generation_plan" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "bpm"             integer,
  "key"             text,
  "duration_sec"    integer,
  "mp3_asset_id"    uuid REFERENCES "assets"("id"),
  "zip_asset_id"    uuid REFERENCES "assets"("id"),
  "status"          "music_status" NOT NULL DEFAULT 'generating',
  "cost_usd_cents"  integer NOT NULL DEFAULT 0,
  "error"           text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  "deleted_at"      timestamptz
);
CREATE INDEX IF NOT EXISTS "music_tracks_tenant_id_idx"  ON "music_tracks" ("tenant_id");
CREATE INDEX IF NOT EXISTS "music_tracks_project_id_idx" ON "music_tracks" ("project_id");
CREATE INDEX IF NOT EXISTS "music_tracks_created_at_idx" ON "music_tracks" ("created_at" DESC);
ALTER TABLE "music_tracks" ENABLE ROW LEVEL SECURITY;

-- ── Editor sessions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "editor_sessions" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"     uuid NOT NULL REFERENCES "tenants"("id"),
  "project_id"    uuid REFERENCES "projects"("id"),
  "file_path"     text NOT NULL,
  "target_type"   "editor_target" NOT NULL,
  "target_id"     text,
  "status"        "editor_session_status" NOT NULL DEFAULT 'active',
  "edit_count"    integer NOT NULL DEFAULT 0,
  "last_edit_at"  timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  "deleted_at"    timestamptz
);
CREATE INDEX IF NOT EXISTS "editor_sessions_tenant_id_idx"  ON "editor_sessions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "editor_sessions_project_id_idx" ON "editor_sessions" ("project_id");
ALTER TABLE "editor_sessions" ENABLE ROW LEVEL SECURITY;

-- ── Editor edits ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "editor_edits" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id"  uuid NOT NULL REFERENCES "editor_sessions"("id") ON DELETE CASCADE,
  "action"      "editor_action" NOT NULL,
  "selector"    text NOT NULL,
  "payload"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version_id"  uuid,
  "actor"       text NOT NULL,
  "applied_at"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "editor_edits_session_id_idx" ON "editor_edits" ("session_id");
CREATE INDEX IF NOT EXISTS "editor_edits_applied_at_idx" ON "editor_edits" ("applied_at" DESC);
ALTER TABLE "editor_edits" ENABLE ROW LEVEL SECURITY;
