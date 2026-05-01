-- 0002_rls_lockdown.sql
-- Enables Row Level Security on every application table.
--
-- WHY NO POLICIES ARE DEFINED HERE:
--   All data access goes through /api using SUPABASE_SERVICE_ROLE_KEY.
--   The service role bypasses RLS entirely, so API operations are unaffected.
--   The browser anon key is used ONLY for:
--     • supabase.auth (sign in / sign out / session) — auth tables, not affected by RLS
--     • Realtime channel subscriptions — channel-level auth, not table RLS
--   With RLS enabled and zero policies, the anon and authenticated roles have
--   no access to any data table. This is the correct and intended posture.
--
-- HOW TO APPLY:
--   Paste into Supabase Dashboard → SQL Editor → Run
--   OR: psql $DATABASE_URL -f 0002_rls_lockdown.sql

-- ── Core ──────────────────────────────────────────────────────────────────────
ALTER TABLE tenants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences    ENABLE ROW LEVEL SECURITY;

-- ── Projects ──────────────────────────────────────────────────────────────────
ALTER TABLE projects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE files               ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_blobs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE components          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages               ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE services            ENABLE ROW LEVEL SECURITY;
ALTER TABLE schemas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE versions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_kits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates           ENABLE ROW LEVEL SECURITY;

-- ── Agent ─────────────────────────────────────────────────────────────────────
ALTER TABLE agent_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_steps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE visual_checks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_flows    ENABLE ROW LEVEL SECURITY;

-- ── Ops ───────────────────────────────────────────────────────────────────────
ALTER TABLE publish_targets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE preview_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_configs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_payloads    ENABLE ROW LEVEL SECURITY;

-- ── Security (most sensitive — lock down hardest) ─────────────────────────────
ALTER TABLE secret_metadata     ENABLE ROW LEVEL SECURITY;
ALTER TABLE secret_values       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events        ENABLE ROW LEVEL SECURITY;

-- ── Verification ──────────────────────────────────────────────────────────────
-- (No policies = anon/authenticated roles see nothing; service role sees all)

-- Confirm RLS status on all tables (run this SELECT to verify after applying):
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
