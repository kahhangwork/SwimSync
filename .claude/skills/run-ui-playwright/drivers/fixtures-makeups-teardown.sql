-- Teardown for fixtures-makeups.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-makeups-teardown.sql
--
-- Run this instead of `supabase db reset` — one database serves every worktree
-- (§7.55).
--
-- Order matters: makeup_bookings restricts on BOTH classes (class_id and
-- home_class_id are ON DELETE RESTRICT), so every booking touching the fixture
-- child or the fixture class goes before the class and the child do. The
-- driver books through the real UI, so bookings exist that this file did not
-- create.

BEGIN;

DELETE FROM makeup_bookings
 WHERE student_id = '7e099999-0000-0000-0000-000000000001'
    OR class_id::text LIKE '7e0c1a55-%'
    OR home_class_id::text LIKE '7e0c1a55-%';

DELETE FROM attendance
 WHERE student_id = '7e099999-0000-0000-0000-000000000001';

DELETE FROM student_class_enrolments
 WHERE student_id = '7e099999-0000-0000-0000-000000000001';

DELETE FROM parent_students
 WHERE student_id = '7e099999-0000-0000-0000-000000000001';

DELETE FROM students
 WHERE id = '7e099999-0000-0000-0000-000000000001';

DELETE FROM lesson_sessions
 WHERE class_id::text LIKE '7e0c1a55-%';

DELETE FROM class_rates
 WHERE class_id::text LIKE '7e0c1a55-%';

DELETE FROM classes
 WHERE id::text LIKE '7e0c1a55-%';

-- The location the classes referenced (FK is ON DELETE RESTRICT — after classes).
DELETE FROM locations
 WHERE id = '7e0c1a55-0000-0000-0000-0000000010c1';

DELETE FROM audit_log WHERE actor_id = '7e000000-0000-0000-0000-0000000000d1';
DELETE FROM auth.users WHERE id = '7e000000-0000-0000-0000-0000000000d1';

COMMIT;

-- Expect 0, 0, 0, 0. seed_coach_intact = 1 — the fixture references the seed
-- coach as the class owner, and that identity must survive.
SELECT
  (SELECT count(*) FROM students
    WHERE id = '7e099999-0000-0000-0000-000000000001')                    AS makeup_kid,
  (SELECT count(*) FROM classes
    WHERE id::text LIKE '7e0c1a55-%')                                     AS fixture_classes,
  (SELECT count(*) FROM makeup_bookings
    WHERE student_id = '7e099999-0000-0000-0000-000000000001')            AS bookings,
  (SELECT count(*) FROM auth.users
    WHERE id = '7e000000-0000-0000-0000-0000000000d1')                    AS makeup_parent,
  (SELECT count(*) FROM profiles
    WHERE id = 'c0000000-0000-0000-0000-000000000001')                    AS seed_coach_intact;
