-- packages/db/migrations/0010_rls_sensitive_tables.sql
-- Defense-in-depth RLS for the three tables that hold the most sensitive
-- data: tenant audit log, secret metadata, secret values (encrypted vault).
--
-- Today the API uses the SUPABASE_SERVICE_ROLE_KEY for backend access, which
-- bypasses RLS — so the application layer continues to enforce tenant scope
-- in code. This migration adds RLS as a SECOND line of defense:
--   1. If the service-role key ever leaks or is misused, no tenant_id-scoped
--      data is exposed to the anon/authenticated roles via PostgREST.
--   2. If a future code path forgets to filter by tenant_id, RLS catches it.
--
-- We REVOKE access from anon + authenticated explicitly so PostgREST returns
-- nothing for these tables under any client-issued JWT.
--
-- secret_values has no tenant_id column directly; it joins to secret_metadata.
-- For RLS we deny ALL access to anon/authenticated and rely on service-role
-- bypass for legitimate API access.

-- ── audit_events ──────────────────────────────────────────────────────────────
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "audit_events" FROM anon, authenticated;

-- Authenticated users may read audit rows for their own tenant only.
-- Tenant ID is read from the JWT's user_metadata.tenant_id (Supabase Auth).
-- Cast to uuid because audit_events.tenant_id is uuid.
DROP POLICY IF EXISTS "audit_events_select_own_tenant" ON "audit_events";
CREATE POLICY "audit_events_select_own_tenant" ON "audit_events"
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = (
      coalesce(
        current_setting('request.jwt.claims', true)::json
          -> 'user_metadata' ->> 'tenant_id',
        ''
      )
    )::uuid
  );

-- No INSERT/UPDATE/DELETE policy → audit log is service-role-only writeable.

-- ── secret_metadata ──────────────────────────────────────────────────────────
ALTER TABLE "secret_metadata" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "secret_metadata" FROM anon, authenticated;

-- No SELECT/INSERT/UPDATE/DELETE policy for non-service-role clients. The api
-- already returns the tenant-scoped rows via service-role; we want the
-- DB-level surface to be empty for any other client.

-- ── secret_values ────────────────────────────────────────────────────────────
ALTER TABLE "secret_values" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "secret_values" FROM anon, authenticated;

-- Same as secret_metadata: zero-access for client roles. Encrypted ciphertext
-- never leaves the server's process memory.
