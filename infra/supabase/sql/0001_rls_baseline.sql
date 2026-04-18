-- Baseline RLS posture. Actual tables are created by Drizzle migrations in
-- packages/db/migrations. This file enables RLS and defines the default
-- tenant-scoped policies that those migrations reference.

-- Enable pgcrypto for gen_random_uuid() used by Drizzle schemas.
create extension if not exists "pgcrypto";

-- Service role bypasses RLS; everything else is denied by default.
-- Each app table should:
--   alter table <t> enable row level security;
--   create policy "<t>_tenant_read"  on <t> for select using (tenant_id = auth.jwt() ->> 'tenant_id');
--   create policy "<t>_tenant_write" on <t> for all    using (tenant_id = auth.jwt() ->> 'tenant_id');
-- Writes from the browser should be limited to the rows a user may touch;
-- all sensitive mutations go through /api with the service role.
