-- packages/db/migrations/0006_assets_nullable_project.sql
-- Allow tenant-scoped assets without a project (e.g. AI gen outputs uploaded
-- before the user has selected a project). The assetUpload helper was
-- passing a sentinel zero-UUID which violated the FK constraint at runtime.
-- Idempotent.

ALTER TABLE "assets" ALTER COLUMN "project_id" DROP NOT NULL;
