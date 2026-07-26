-- Teardown for fixtures-trial-visibility.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-trial-visibility-teardown.sql
--
-- Run this instead of `supabase db reset` — one database serves every worktree
-- (§7.55).
--
-- The four children here sit at assignment_status = 'unassigned' with a
-- trial_bookings row and NO enrolment — which is precisely the shape the admin's
-- Unassigned queue is meant to describe as "booked for a trial" rather than
-- "waiting to be placed". Leave them behind and every later run of anything
-- touching that queue is reading four extra children whose state is the exact
-- edge case under test.
--
-- Bookings go before students: trial_bookings.student_id is a hard FK.

BEGIN;

DELETE FROM trial_bookings
 WHERE student_id IN ('7d099999-0000-0000-0000-000000000001',
                      '7d099999-0000-0000-0000-000000000002',
                      '7d099999-0000-0000-0000-000000000003',
                      '7d099999-0000-0000-0000-000000000004');

DELETE FROM attendance
 WHERE student_id IN ('7d099999-0000-0000-0000-000000000001',
                      '7d099999-0000-0000-0000-000000000002',
                      '7d099999-0000-0000-0000-000000000003',
                      '7d099999-0000-0000-0000-000000000004');

DELETE FROM student_class_enrolments
 WHERE student_id IN ('7d099999-0000-0000-0000-000000000001',
                      '7d099999-0000-0000-0000-000000000002',
                      '7d099999-0000-0000-0000-000000000003',
                      '7d099999-0000-0000-0000-000000000004');

DELETE FROM parent_students
 WHERE student_id IN ('7d099999-0000-0000-0000-000000000001',
                      '7d099999-0000-0000-0000-000000000002',
                      '7d099999-0000-0000-0000-000000000003',
                      '7d099999-0000-0000-0000-000000000004');

DELETE FROM students
 WHERE id IN ('7d099999-0000-0000-0000-000000000001',
              '7d099999-0000-0000-0000-000000000002',
              '7d099999-0000-0000-0000-000000000003',
              '7d099999-0000-0000-0000-000000000004');

-- Any booking the parent made themselves during the run.
DELETE FROM trial_bookings
 WHERE booked_by = '7d000000-0000-0000-0000-0000000000d1';

DELETE FROM audit_log WHERE actor_id = '7d000000-0000-0000-0000-0000000000d1';
DELETE FROM auth.users WHERE id = '7d000000-0000-0000-0000-0000000000d1';

COMMIT;

-- Expect 0, 0, 0. seed_coach_intact = 1 — the fixture references the seed coach
-- as `booked_by`, and that identity must survive.
SELECT
  (SELECT count(*) FROM students WHERE id::text LIKE '7d099999-%')       AS trial_students,
  (SELECT count(*) FROM trial_bookings
    WHERE student_id::text LIKE '7d099999-%')                            AS bookings,
  (SELECT count(*) FROM auth.users
    WHERE id = '7d000000-0000-0000-0000-0000000000d1')                   AS trial_parent,
  (SELECT count(*) FROM profiles
    WHERE id = 'c0000000-0000-0000-0000-000000000001')                   AS seed_coach_intact;
