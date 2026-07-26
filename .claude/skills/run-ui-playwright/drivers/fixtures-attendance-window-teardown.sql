-- Teardown for fixtures-attendance-window.sql.
--
-- Run this at the end of a session instead of `supabase db reset` — one database
-- serves every worktree (§7.55), and a reset rebuilds it from whichever branch
-- happens to be running, taking a sibling's state with it.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-attendance-window-teardown.sql
--
-- The fixture's two children get GENERATED ids, so they are reached through the
-- parent's own family links rather than by name — `full_name = 'Ana Win'` would
-- also be true of a child a sibling worktree happened to create. The parent
-- (b0000000-…-0000000000aa) is the one stable identifier the fixture owns.
--
-- It also creates a CLASS ('Sunday Newbies'), which is easy to forget: leaving
-- it behind puts a phantom Sunday class on the coach's roster forever, and it
-- has no students, so nothing ever flags it.

BEGIN;

-- Resolve the fixture's children once, through the family link.
CREATE TEMP TABLE _win_students ON COMMIT DROP AS
SELECT ps.student_id AS id
  FROM parent_students ps
  JOIN parents p ON p.id = ps.parent_id
 WHERE p.profile_id = 'b0000000-0000-0000-0000-0000000000aa';

-- Attendance the DRIVER saved (the fixture marks nothing) must go before the
-- sessions it points at.
DELETE FROM attendance
 WHERE student_id IN (SELECT id FROM _win_students);

DELETE FROM student_class_enrolments
 WHERE student_id IN (SELECT id FROM _win_students);

DELETE FROM parent_students
 WHERE student_id IN (SELECT id FROM _win_students);

DELETE FROM students
 WHERE id IN (SELECT id FROM _win_students);

-- The Sunday class, and any session the driver created on it. Sessions first.
DELETE FROM attendance a USING lesson_sessions ls
 WHERE a.lesson_session_id = ls.id
   AND ls.class_id IN (SELECT id FROM classes WHERE title = 'Sunday Newbies');
DELETE FROM lesson_sessions
 WHERE class_id IN (SELECT id FROM classes WHERE title = 'Sunday Newbies');
DELETE FROM student_class_enrolments
 WHERE class_id IN (SELECT id FROM classes WHERE title = 'Sunday Newbies');
DELETE FROM classes WHERE title = 'Sunday Newbies';

-- audit_log.actor_id is NOT NULL / NO ACTION — author rows go before the
-- profile (§7.50).
DELETE FROM audit_log WHERE actor_id = 'b0000000-0000-0000-0000-0000000000aa';

DELETE FROM auth.users WHERE id = 'b0000000-0000-0000-0000-0000000000aa';

COMMIT;

-- Expect 0, 0, 0. seed_class_intact = 1 proves we removed the fixture's Sunday
-- class and left the seed Saturday one alone.
SELECT
  (SELECT count(*) FROM auth.users
    WHERE id = 'b0000000-0000-0000-0000-0000000000aa')            AS win_parent,
  (SELECT count(*) FROM classes WHERE title = 'Sunday Newbies')   AS sunday_class,
  (SELECT count(*) FROM students
    WHERE full_name IN ('Ana Win', 'Newkid Win'))                 AS win_students,
  (SELECT count(*) FROM classes
    WHERE title = 'Saturday Beginners')                           AS seed_class_intact;
