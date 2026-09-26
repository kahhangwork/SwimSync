-- Teardown for fixtures-packages-admin.sql — removes the PkgAdm business and
-- everything in it, including what the DRIVER wrote (a recorded sale, an
-- extension event, a cancelled / declined package, an added product and
-- category, a Default / Max).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-packages-admin-teardown.sql
--
-- Scoped by the tenant id and the full 'c8000000-' block, never a 2-char
-- prefix (§7.280). Order is FK order: packages (extension events cascade)
-- before products, category defaults cleared before products, products before
-- categories, parents before profiles.

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM parent_packages        WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';
UPDATE tenants SET default_package_product_id = NULL, owner_profile_id = NULL
 WHERE id = 'c8000000-0000-0000-0000-000000000001';
UPDATE class_categories SET default_product_id = NULL
 WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';
DELETE FROM package_products       WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';
DELETE FROM parent_students        WHERE student_id::text LIKE 'c8000000-%';
DELETE FROM students               WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';
DELETE FROM parent_tenant_balances WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';
DELETE FROM parent_tenants         WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';
DELETE FROM audit_log              WHERE entity_id::text LIKE 'c8000000-%';
DELETE FROM audit_log              WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';
DELETE FROM class_categories       WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';
DELETE FROM skill_grade_levels     WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';
DELETE FROM parents                WHERE profile_id::text LIKE 'c8000000-%';
DELETE FROM profiles               WHERE id::text LIKE 'c8000000-%';
DELETE FROM auth.users             WHERE id::text LIKE 'c8000000-%';
DELETE FROM tenants                WHERE id = 'c8000000-0000-0000-0000-000000000001';

COMMIT;

-- Expect 0, 0, 0.
SELECT (SELECT count(*) FROM tenants    WHERE id = 'c8000000-0000-0000-0000-000000000001') AS tenant,
       (SELECT count(*) FROM students   WHERE id::text LIKE 'c8000000-%')                   AS students,
       (SELECT count(*) FROM auth.users WHERE id::text LIKE 'c8000000-%')                   AS users;
