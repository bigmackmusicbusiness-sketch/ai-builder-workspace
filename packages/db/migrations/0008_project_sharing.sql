-- packages/db/migrations/0008_project_sharing.sql
-- Project sharing: private-by-default with an owner-toggleable is_shared boolean.
-- created_by already exists (nullable). Backfill it before adding is_shared so
-- pre-existing projects have a real owner.
--
-- Per user decision (logic-update plan): existing projects all become private
-- to the first admin user (the user with the lowest created_at in auth.users).
-- This means other tenant members stop seeing them by default; the admin can
-- re-share any they want exposed.

-- 1. Backfill created_by for any existing rows where it's null
UPDATE projects
SET created_by = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1)
WHERE created_by IS NULL;

-- 2. Add is_shared column (default false = private to creator)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Index for the (tenant_id, created_by) + is_shared filter combo used by GET /api/projects
CREATE INDEX IF NOT EXISTS projects_visibility_idx
  ON projects (tenant_id, created_by, is_shared);
