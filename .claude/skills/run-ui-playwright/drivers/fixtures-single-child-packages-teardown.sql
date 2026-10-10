-- Teardown for fixtures-single-child-packages.sql (single-child packages, prefix scp / ids a5c00000-).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-single-child-packages-teardown.sql
--
-- Everything lives in ONE business (a5c00000-…0001), so every delete is scoped by that id prefix.
-- ATTENDANCE FIRST (a delete returns its draw to the package, which must still exist); parent_packages before
-- students (student_id is ON DELETE RESTRICT). The fixture runs this same block at its top.

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM attendance            WHERE student_id::text LIKE 'a5c00000-%';
DELETE FROM package_applications  WHERE parent_package_id IN (SELECT id FROM parent_packages WHERE tenant_id::text LIKE 'a5c00000-%');
DELETE FROM lesson_sessions       WHERE class_id::text LIKE 'a5c00000-%';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'a5c00000-%';
DELETE FROM parent_packages       WHERE tenant_id::text LIKE 'a5c00000-%';
UPDATE tenants SET owner_profile_id = NULL, default_package_product_id = NULL WHERE id::text LIKE 'a5c00000-%';
DELETE FROM package_products      WHERE tenant_id::text LIKE 'a5c00000-%';
DELETE FROM parent_students       WHERE student_id::text LIKE 'a5c00000-%';
DELETE FROM students              WHERE id::text LIKE 'a5c00000-%';
DELETE FROM classes               WHERE tenant_id::text LIKE 'a5c00000-%';
DELETE FROM locations             WHERE tenant_id::text LIKE 'a5c00000-%';
DELETE FROM class_categories      WHERE tenant_id::text LIKE 'a5c00000-%';
DELETE FROM parent_tenant_balances WHERE tenant_id::text LIKE 'a5c00000-%';
DELETE FROM parent_tenants        WHERE tenant_id::text LIKE 'a5c00000-%';
DELETE FROM audit_log             WHERE tenant_id::text LIKE 'a5c00000-%' OR actor_id::text LIKE 'a5c00000-%';
DELETE FROM coaches               WHERE profile_id::text LIKE 'a5c00000-%';
DELETE FROM parents               WHERE profile_id::text LIKE 'a5c00000-%';
DELETE FROM profiles              WHERE id::text LIKE 'a5c00000-%';
DELETE FROM auth.users            WHERE id::text LIKE 'a5c00000-%';
DELETE FROM tenants               WHERE id::text LIKE 'a5c00000-%';

COMMIT;

-- Expect 0 in every column.
SELECT (SELECT count(*) FROM tenants         WHERE id::text LIKE 'a5c00000-%')        AS tenants,
       (SELECT count(*) FROM auth.users      WHERE id::text LIKE 'a5c00000-%')        AS users,
       (SELECT count(*) FROM students        WHERE id::text LIKE 'a5c00000-%')        AS students,
       (SELECT count(*) FROM parent_packages WHERE tenant_id::text LIKE 'a5c00000-%') AS packages;
