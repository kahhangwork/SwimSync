-- Teardown for fixtures-package-draw-at-marking.sql (Wave 6, prefix w6pd_ / ids e6d00000-).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-package-draw-at-marking-teardown.sql
--
-- Everything the fixture owns lives in its TWO businesses (e6d00000-…0001 W6PD Swim, …0002 W6PD Months), so
-- every delete is scoped by that id prefix — never by a title or a weekday a sibling could share.
-- ATTENDANCE GOES FIRST: deleting a marked row fires the Wave 6 return trigger, which credits its package; the
-- package must still exist when it does. The fixture runs this same block at its top, so a re-load starts clean.

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM attendance            WHERE student_id::text LIKE 'e6d00000-%';
DELETE FROM package_applications  WHERE parent_package_id::text LIKE 'e6d00000-%';
DELETE FROM lesson_sessions       WHERE class_id::text LIKE 'e6d00000-%';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'e6d00000-%';
DELETE FROM invoices              WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM billing_runs          WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM billing_periods       WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM parent_packages       WHERE tenant_id::text LIKE 'e6d00000-%';
UPDATE tenants SET owner_profile_id = NULL WHERE id::text LIKE 'e6d00000-%';
DELETE FROM package_products      WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM parent_students       WHERE student_id::text LIKE 'e6d00000-%';
DELETE FROM students              WHERE id::text LIKE 'e6d00000-%';
DELETE FROM classes               WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM locations             WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM class_categories      WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM parent_tenant_balances WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM parent_tenants        WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM audit_log             WHERE tenant_id::text LIKE 'e6d00000-%' OR actor_id::text LIKE 'e6d00000-%';
DELETE FROM coaches               WHERE profile_id::text LIKE 'e6d00000-%';
DELETE FROM parents               WHERE profile_id::text LIKE 'e6d00000-%';
DELETE FROM profiles              WHERE id::text LIKE 'e6d00000-%';
DELETE FROM auth.users            WHERE id::text LIKE 'e6d00000-%';
DELETE FROM tenants               WHERE id::text LIKE 'e6d00000-%';

COMMIT;

-- Expect 0 in every column.
SELECT (SELECT count(*) FROM tenants         WHERE id::text LIKE 'e6d00000-%')        AS tenants,
       (SELECT count(*) FROM auth.users      WHERE id::text LIKE 'e6d00000-%')        AS users,
       (SELECT count(*) FROM students        WHERE id::text LIKE 'e6d00000-%')        AS students,
       (SELECT count(*) FROM parent_packages WHERE tenant_id::text LIKE 'e6d00000-%') AS packages;
