-- Teardown for fixtures-admin-reset-password.sql — removes the AdmReset business
-- and its admin, including what the DRIVER wrote: the new password lives on the
-- auth.users row, and GoTrue's recovery sessions / refresh tokens / identities
-- cascade from it; any audit trail goes by tenant.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-admin-reset-password-teardown.sql
--
-- Scoped by exact ids and the full 'd6000000-' block, never a 2-char prefix
-- (§7.280).

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM audit_log          WHERE tenant_id = 'd6000000-0000-0000-0000-000000000001';
DELETE FROM skill_grade_levels WHERE tenant_id = 'd6000000-0000-0000-0000-000000000001';
UPDATE tenants SET owner_profile_id = NULL WHERE id = 'd6000000-0000-0000-0000-000000000001';
DELETE FROM coaches            WHERE profile_id::text LIKE 'd6000000-%';
DELETE FROM profiles           WHERE id::text LIKE 'd6000000-%';
DELETE FROM auth.users         WHERE id::text LIKE 'd6000000-%';
DELETE FROM tenants            WHERE id = 'd6000000-0000-0000-0000-000000000001';

COMMIT;

-- Expect 0, 0, 0.
SELECT (SELECT count(*) FROM tenants    WHERE id::text LIKE 'd6000000-%') AS tenants,
       (SELECT count(*) FROM profiles   WHERE id::text LIKE 'd6000000-%') AS profiles,
       (SELECT count(*) FROM auth.users WHERE id::text LIKE 'd6000000-%') AS users;
