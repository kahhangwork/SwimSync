-- Teardown for fixtures-attendance-guard.sql.
--
-- Run this at the end of a session instead of `supabase db reset` — one database
-- serves every worktree (§7.55), and a reset rebuilds it from whichever branch
-- happens to be running, taking a sibling's state with it.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-attendance-guard-teardown.sql
--
-- ORDER MATTERS, and not for the usual reason. Two of these deletes are aimed at
-- rows the DRIVER created rather than the fixture: the attendance it saved and
-- corrected, and the extra lesson the admin scheduled. A teardown that only
-- reverses the fixture leaves the driver's own writes behind, and those are
-- exactly the rows that make the *next* run pass for the wrong reason — the
-- extra lesson already exists, so the idempotency check cannot fail.
--
-- Deletes by EXACT identifier, never by pattern: `LIKE '%Guard%'` works today
-- and takes a real child called *Guardiola* later (§8.12's cleanup lesson).

BEGIN;

-- 1. Attendance first — it references lesson_sessions and students.
DELETE FROM attendance a
 USING lesson_sessions ls
 WHERE a.lesson_session_id = ls.id
   AND ls.class_id = (SELECT id FROM classes WHERE title = 'Saturday Beginners');

-- 2. Every session on that class: the fixture's out-of-window one, the one the
--    driver created by saving attendance, and the admin's scheduled extra.
DELETE FROM lesson_sessions
 WHERE class_id = (SELECT id FROM classes WHERE title = 'Saturday Beginners');

-- 2b. The same, for the "nothing has fallen due yet" class. It should have NO
--     sessions — that absence IS the scenario — but a driver run that marked it
--     by mistake must not survive into the next run, so delete by class id
--     rather than assuming emptiness.
DELETE FROM attendance a
 USING lesson_sessions ls
 WHERE a.lesson_session_id = ls.id
   AND ls.class_id IN ('d0000000-0000-0000-0000-0000000000e1',
                       'd0000000-0000-0000-0000-0000000000e2');
DELETE FROM lesson_sessions
 WHERE class_id IN ('d0000000-0000-0000-0000-0000000000e1',
                    'd0000000-0000-0000-0000-0000000000e2');

-- 3. Enrolments, then the family links, then the children.
DELETE FROM student_class_enrolments
 WHERE student_id IN ('d0000000-0000-0000-0000-0000000000b1',
                      'd0000000-0000-0000-0000-0000000000b2',
                      'd0000000-0000-0000-0000-0000000000b3',
                      'd0000000-0000-0000-0000-0000000000b4');
DELETE FROM parent_students
 WHERE student_id IN ('d0000000-0000-0000-0000-0000000000b1',
                      'd0000000-0000-0000-0000-0000000000b2',
                      'd0000000-0000-0000-0000-0000000000b3',
                      'd0000000-0000-0000-0000-0000000000b4');
DELETE FROM students
 WHERE id IN ('d0000000-0000-0000-0000-0000000000b1',
              'd0000000-0000-0000-0000-0000000000b2',
              'd0000000-0000-0000-0000-0000000000b3',
              'd0000000-0000-0000-0000-0000000000b4');

-- 3b. The class itself, and the effective-dated rate a trigger created with it.
--     By exact id: 'Guard Newbies' is this fixture's own class, but a title
--     match would take a real one someone names the same (§8.12).
DELETE FROM class_rates WHERE class_id IN ('d0000000-0000-0000-0000-0000000000e1',
                                           'd0000000-0000-0000-0000-0000000000e2');
DELETE FROM classes     WHERE id       IN ('d0000000-0000-0000-0000-0000000000e1',
                                           'd0000000-0000-0000-0000-0000000000e2');
-- The location both classes referenced (FK is ON DELETE RESTRICT — after classes).
DELETE FROM locations   WHERE id       IN ('d0000000-0000-0000-0000-0000000010c1');

-- 4. Audit rows AUTHORED BY the fixture parent must go before the profile does:
--    audit_log.actor_id is NOT NULL and NO ACTION, so it can be neither
--    cascaded nor blanked (§7.50). Rows written by someone else ABOUT these
--    entities are left alone — entity_id has no FK, so they dangle harmlessly
--    and they are the business's own record.
DELETE FROM audit_log WHERE actor_id = 'd0000000-0000-0000-0000-0000000000aa';

-- 5. The parent. Deleting the auth user cascades profiles → parents →
--    parent_tenants.
DELETE FROM auth.users WHERE id = 'd0000000-0000-0000-0000-0000000000aa';

-- 6. The sealed billing month the fixture wrote to move markable_floor().
--    Identified by its own notes string rather than by month: the month is
--    derived from the clock, so a teardown run on a later day would compute a
--    different one and silently leave the row behind — and a stray seal is the
--    worst kind of leftover here, because it moves the marking floor for EVERY
--    later driver in the tenant without failing anything visibly.
DELETE FROM billing_periods
 WHERE notes = 'fixtures-attendance-guard: seals a month so the floor reaches back';

COMMIT;

-- Verify — expect 0 across the board. A non-zero here means the teardown is
-- incomplete, not that the check is wrong.
SELECT
  (SELECT count(*) FROM students
    WHERE full_name IN ('Ana Guard', 'Late Joiner',
                        'Newjoiner Guard', 'Waiting Guard'))          AS guard_students,
  (SELECT count(*) FROM auth.users
    WHERE email = 'parent-guard@swimsync.test')                   AS guard_parent,
  (SELECT count(*) FROM lesson_sessions
    WHERE off_schedule_reason IS NOT NULL)                        AS extra_lessons,
  (SELECT count(*) FROM classes
    WHERE id IN ('d0000000-0000-0000-0000-0000000000e1',
                 'd0000000-0000-0000-0000-0000000000e2'))             AS guard_classes,
  (SELECT count(*) FROM billing_periods
    WHERE notes = 'fixtures-attendance-guard: seals a month so the floor reaches back')
                                                                  AS guard_seals;
