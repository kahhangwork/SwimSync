-- Teardown for fixtures-coach-remove-student.sql — removes the CoachRm business
-- and everything in it, including what the DRIVER wrote (a closed enrolment,
-- the removal's audit_log row, the child's assignment_status change).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-coach-remove-student-teardown.sql
--
-- Scoped by the tenant id and the full 'b4000000-' block, never a 2-char
-- prefix (§7.280). FK order: audit_log (actor_id → the coach's profile) before
-- the profile (§7.50); enrolments before classes and students.

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM audit_log              WHERE tenant_id = 'b4000000-0000-0000-0000-000000000001'
                                      OR actor_id = 'b4000000-0000-0000-0000-0000000000a1';
DELETE FROM attendance             WHERE student_id::text LIKE 'b4000000-%';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'b4000000-%';
DELETE FROM lesson_sessions        WHERE class_id::text LIKE 'b4000000-%';
DELETE FROM student_skill_progress WHERE tenant_id = 'b4000000-0000-0000-0000-000000000001';
DELETE FROM students               WHERE tenant_id = 'b4000000-0000-0000-0000-000000000001';
DELETE FROM tenant_level_skills    WHERE level_id::text LIKE 'b4000000-%';
DELETE FROM tenant_levels          WHERE tenant_id = 'b4000000-0000-0000-0000-000000000001';
DELETE FROM skill_grade_levels     WHERE tenant_id = 'b4000000-0000-0000-0000-000000000001';
DELETE FROM class_rates            WHERE class_id::text LIKE 'b4000000-%';
DELETE FROM classes                WHERE tenant_id = 'b4000000-0000-0000-0000-000000000001';
DELETE FROM locations              WHERE tenant_id = 'b4000000-0000-0000-0000-000000000001';
DELETE FROM class_categories       WHERE tenant_id = 'b4000000-0000-0000-0000-000000000001';
DELETE FROM coaches                WHERE profile_id = 'b4000000-0000-0000-0000-0000000000a1';
DELETE FROM profiles               WHERE id = 'b4000000-0000-0000-0000-0000000000a1';
DELETE FROM auth.users             WHERE id = 'b4000000-0000-0000-0000-0000000000a1';
DELETE FROM tenants                WHERE id = 'b4000000-0000-0000-0000-000000000001';

COMMIT;

-- Expect 0, 0, 0.
SELECT (SELECT count(*) FROM tenants  WHERE id = 'b4000000-0000-0000-0000-000000000001') AS tenant,
       (SELECT count(*) FROM students WHERE id::text LIKE 'b4000000-%')                   AS students,
       (SELECT count(*) FROM auth.users WHERE id = 'b4000000-0000-0000-0000-0000000000a1') AS coach;
