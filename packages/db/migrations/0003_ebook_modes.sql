-- packages/db/migrations/0003_ebook_modes.sql
-- Adds two-mode support to ebooks: 'generate' (AI writes) | 'format' (user provides text).
-- Idempotent — safe to re-run.

DO $$ BEGIN
  CREATE TYPE "ebook_mode" AS ENUM ('generate', 'format');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ebooks"
  ADD COLUMN IF NOT EXISTS "mode" "ebook_mode" NOT NULL DEFAULT 'generate';

ALTER TABLE "ebooks"
  ADD COLUMN IF NOT EXISTS "raw_manuscript" text;

CREATE INDEX IF NOT EXISTS "ebooks_mode_idx" ON "ebooks" ("mode");
