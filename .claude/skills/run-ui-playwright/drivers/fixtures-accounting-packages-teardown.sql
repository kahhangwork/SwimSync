-- Teardown for fixtures-accounting-packages.sql — removes AcctPkg Swim and everything in it.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-accounting-packages-teardown.sql
--
-- Scoped by the exact tenant id and the full 'ac700000-' block, never a 2-char prefix (§7.280).

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM invoices               WHERE tenant_id = 'ac700000-0000-0000-0000-000000000001';
DELETE FROM billing_periods        WHERE tenant_id = 'ac700000-0000-0000-0000-000000000001';
DELETE FROM parent_packages        WHERE tenant_id = 'ac700000-0000-0000-0000-000000000001';
UPDATE tenants SET owner_profile_id = NULL WHERE id = 'ac700000-0000-0000-0000-000000000001';
DELETE FROM package_products       WHERE tenant_id = 'ac700000-0000-0000-0000-000000000001';
DELETE FROM parent_tenant_balances WHERE tenant_id = 'ac700000-0000-0000-0000-000000000001';
DELETE FROM parent_tenants         WHERE tenant_id = 'ac700000-0000-0000-0000-000000000001';
DELETE FROM audit_log              WHERE entity_id::text LIKE 'ac700000-%';
DELETE FROM audit_log              WHERE tenant_id = 'ac700000-0000-0000-0000-000000000001';
DELETE FROM class_categories       WHERE tenant_id = 'ac700000-0000-0000-0000-000000000001';
DELETE FROM skill_grade_levels     WHERE tenant_id = 'ac700000-0000-0000-0000-000000000001';
DELETE FROM parents                WHERE profile_id::text LIKE 'ac700000-%';
DELETE FROM profiles               WHERE id::text LIKE 'ac700000-%';
DELETE FROM auth.users             WHERE id::text LIKE 'ac700000-%';
DELETE FROM tenants                WHERE id = 'ac700000-0000-0000-0000-000000000001';

COMMIT;

-- Expect 0, 0, 0.
SELECT (SELECT count(*) FROM tenants    WHERE id = 'ac700000-0000-0000-0000-000000000001') AS tenant,
       (SELECT count(*) FROM profiles   WHERE id::text LIKE 'ac700000-%')                   AS profiles,
       (SELECT count(*) FROM auth.users WHERE id::text LIKE 'ac700000-%')                   AS users;
