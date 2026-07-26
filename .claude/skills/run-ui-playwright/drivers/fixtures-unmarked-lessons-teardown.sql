-- Teardown for fixtures-unmarked-lessons.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-unmarked-lessons-teardown.sql
--
-- Run this instead of `supabase db reset` — one database serves every worktree
-- (§7.55).
--
-- ⚠ READ THIS BEFORE TRUSTING THE TEARDOWN. The fixture contains a bug that no
-- teardown can fully reverse:
--
--     INSERT INTO student_class_enrolments (student_id, class_id, ...)
--     SELECT st.id, c.id, ... FROM students st
--     CROSS JOIN classes c WHERE c.title = 'Saturday Beginners';
--
-- There is no filter on `st`. It enrols EVERY STUDENT IN THE DATABASE into
-- Saturday Beginners — including children belonging to other fixtures and to
-- sibling worktrees. Once mixed in, a fixture-created enrolment is
-- indistinguishable from a legitimate one, so this file removes only the
-- enrolments of the fixture's OWN two children and says so rather than guessing.
--
-- Practical advice until that is fixed (BACKLOG → Foundations): run this fixture
-- FIRST in a session, or on a database with no other fixture loaded. Its
-- blast radius is the reason it is worth fixing rather than working around.

BEGIN;

CREATE TEMP TABLE _um_students ON COMMIT DROP AS
SELECT ps.student_id AS id
  FROM parent_students ps
  JOIN parents p ON p.id = ps.parent_id
 WHERE p.profile_id = 'b0000000-0000-0000-0000-000000000001';

-- Capture the fixture's sessions through its own attendance before deleting it.
--
-- The UNION arm is not redundant. The fixture deliberately creates a session it
-- never marks (Saturday 4 July marked, 11 July left bare — an unmarked lesson IS
-- the scenario), and a half-failed run leaves sessions with no attendance at all.
-- Reaching sessions only through attendance would strand both, which the
-- round-trip check caught as a one-row drift in lesson_sessions.
CREATE TEMP TABLE _um_sessions ON COMMIT DROP AS
SELECT DISTINCT lesson_session_id AS id
  FROM attendance
 WHERE student_id IN (SELECT id FROM _um_students)
UNION
SELECT ls.id
  FROM lesson_sessions ls
  JOIN classes c ON c.id = ls.class_id
 WHERE c.title = 'Saturday Beginners'
   AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.lesson_session_id = ls.id);

DELETE FROM attendance WHERE student_id IN (SELECT id FROM _um_students);

-- Only sessions now unreferenced — a sibling may have marked their own child on
-- the same Saturday.
DELETE FROM lesson_sessions ls
 WHERE ls.id IN (SELECT id FROM _um_sessions)
   AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.lesson_session_id = ls.id);

DELETE FROM student_class_enrolments WHERE student_id IN (SELECT id FROM _um_students);
DELETE FROM parent_students          WHERE student_id IN (SELECT id FROM _um_students);
DELETE FROM students                 WHERE id         IN (SELECT id FROM _um_students);

DELETE FROM audit_log WHERE actor_id = 'b0000000-0000-0000-0000-000000000001';
DELETE FROM auth.users WHERE id = 'b0000000-0000-0000-0000-000000000001';

COMMIT;

-- Expect 0, 0, 0. `stray_enrolments` is NOT expected to be 0 — it counts every
-- enrolment on the seed class, and a non-zero value here after other fixtures
-- have run is the bug described in the header, not a failure of this teardown.
SELECT
  (SELECT count(*) FROM students WHERE full_name IN ('Ana Tan', 'Ben Tan'))  AS um_students,
  (SELECT count(*) FROM auth.users
    WHERE id = 'b0000000-0000-0000-0000-000000000001')                       AS um_parent,
  (SELECT count(*) FROM audit_log
    WHERE actor_id = 'b0000000-0000-0000-0000-000000000001')                 AS audit_rows,
  (SELECT count(*) FROM student_class_enrolments e JOIN classes c ON c.id = e.class_id
    WHERE c.title = 'Saturday Beginners')                                    AS stray_enrolments;
