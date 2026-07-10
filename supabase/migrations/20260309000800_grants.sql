-- ============================================================
-- Table-level privileges.
--
-- RLS controls WHICH ROWS a role can touch, but a role still needs
-- base table GRANTs to touch the table at all. Objects created by the
-- `postgres` role (which runs these migrations) do NOT automatically
-- receive full DML grants for the API roles, so we grant them
-- explicitly here. Row visibility is still enforced by the policies in
-- 20260309000600_rls_policies.sql — e.g. `authenticated` has DML grant
-- on `invoices` but no INSERT policy, so inserts are still denied.
--
-- `anon` gets nothing: every app query runs after login as
-- `authenticated`; registration/login use the Auth API, not tables.
-- `service_role` needs full access because it bypasses RLS (Edge
-- Function invoice generation + admin create-coach route).
-- ============================================================

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO authenticated, service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO authenticated, service_role;

-- Cover any tables/sequences added by later migrations too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
