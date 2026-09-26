-- Teardown for fixtures-grading-admin.sql — removes the GradAdm business and
-- everything in it, including what the DRIVER wrote (a converted enrolment, a
-- booked make-up, grades, a scale grade, an audit trail).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-grading-admin-teardown.sql
--
-- Scoped by the tenant id and the full 'c3000000-' block, never a 2-char
-- prefix (§7.280). Order is FK order: progress restricts on skills and grades,
-- bookings restrict on classes.

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM student_skill_progress WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001';
DELETE FROM makeup_bookings        WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001';
DELETE FROM trial_bookings         WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001';
DELETE FROM attendance             WHERE student_id::text LIKE 'c3000000-%';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'c3000000-%';
DELETE FROM lesson_sessions        WHERE class_id::text LIKE 'c3000000-%';
DELETE FROM students               WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001';
DELETE FROM tenant_level_skills    WHERE level_id::text LIKE 'c3000000-%';
DELETE FROM tenant_levels          WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001';
DELETE FROM skill_grade_levels     WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001';
DELETE FROM class_rates            WHERE class_id::text LIKE 'c3000000-%';
DELETE FROM classes                WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001';
DELETE FROM locations              WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001';
DELETE FROM class_categories       WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001';
DELETE FROM audit_log              WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001';
UPDATE tenants SET owner_profile_id = NULL WHERE id = 'c3000000-0000-0000-0000-000000000001';
DELETE FROM coaches                WHERE profile_id = 'c3000000-0000-0000-0000-0000000000a1';
DELETE FROM profiles               WHERE id = 'c3000000-0000-0000-0000-0000000000a1';
DELETE FROM auth.users             WHERE id = 'c3000000-0000-0000-0000-0000000000a1';
DELETE FROM tenants                WHERE id = 'c3000000-0000-0000-0000-000000000001';

COMMIT;

-- Expect 0, 0, 0.
SELECT (SELECT count(*) FROM tenants  WHERE id = 'c3000000-0000-0000-0000-000000000001') AS tenant,
       (SELECT count(*) FROM students WHERE id::text LIKE 'c3000000-%')                   AS students,
       (SELECT count(*) FROM auth.users WHERE id = 'c3000000-0000-0000-0000-0000000000a1') AS owner;
