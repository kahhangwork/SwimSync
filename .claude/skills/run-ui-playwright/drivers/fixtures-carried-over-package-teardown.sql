-- Teardown for fixtures-carried-over-package.sql (carried-over packages, prefix cop / ids c0a00000-).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-carried-over-package-teardown.sql
--
-- Everything lives in ONE business (c0a00000-…0001). ATTENDANCE FIRST (a delete returns its draw to the package,
-- which must still exist); refunds before packages; referral rows before packages (a reserved reward points at one); parent_packages before students. The fixture runs this block.

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM attendance            WHERE student_id::text LIKE 'c0a00000-%';
DELETE FROM package_applications  WHERE parent_package_id IN (SELECT id FROM parent_packages WHERE tenant_id::text LIKE 'c0a00000-%');
DELETE FROM package_refunds       WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM package_holiday_extensions WHERE parent_package_id IN (SELECT id FROM parent_packages WHERE tenant_id::text LIKE 'c0a00000-%');
DELETE FROM package_cancel_extensions  WHERE parent_package_id IN (SELECT id FROM parent_packages WHERE tenant_id::text LIKE 'c0a00000-%');
DELETE FROM package_extension_events   WHERE parent_package_id IN (SELECT id FROM parent_packages WHERE tenant_id::text LIKE 'c0a00000-%');
DELETE FROM lesson_sessions       WHERE class_id::text LIKE 'c0a00000-%';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'c0a00000-%';
DELETE FROM referral_rewards      WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM referrals             WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM parent_packages       WHERE tenant_id::text LIKE 'c0a00000-%';
UPDATE tenants SET owner_profile_id = NULL, default_package_product_id = NULL WHERE id::text LIKE 'c0a00000-%';
DELETE FROM package_products      WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM parent_students       WHERE student_id::text LIKE 'c0a00000-%';
DELETE FROM students              WHERE id::text LIKE 'c0a00000-%';
DELETE FROM classes               WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM locations             WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM class_categories      WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM parent_tenant_balances WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM parent_tenants        WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM audit_log             WHERE tenant_id::text LIKE 'c0a00000-%' OR actor_id::text LIKE 'c0a00000-%';
DELETE FROM coaches               WHERE profile_id::text LIKE 'c0a00000-%';
DELETE FROM parents               WHERE profile_id::text LIKE 'c0a00000-%';
DELETE FROM profiles              WHERE id::text LIKE 'c0a00000-%';
DELETE FROM auth.users            WHERE id::text LIKE 'c0a00000-%';
DELETE FROM tenants               WHERE id::text LIKE 'c0a00000-%';

COMMIT;

-- Expect 0 in every column.
SELECT (SELECT count(*) FROM tenants         WHERE id::text LIKE 'c0a00000-%')        AS tenants,
       (SELECT count(*) FROM auth.users      WHERE id::text LIKE 'c0a00000-%')        AS users,
       (SELECT count(*) FROM students        WHERE id::text LIKE 'c0a00000-%')        AS students,
       (SELECT count(*) FROM parent_packages WHERE tenant_id::text LIKE 'c0a00000-%') AS packages;
