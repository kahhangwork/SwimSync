-- Teardown for fixtures-stale-screen.sql.
--
-- Scoped to this fixture's own ids, never a bare DELETE on a shared table —
-- a sibling worktree runs against the same database (docs/WORKTREES.md), and
-- an over-broad delete here removes another session's children mid-run.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-stale-screen-teardown.sql

\set ON_ERROR_STOP on

DELETE FROM attendance
 WHERE lesson_session_id IN (
   SELECT id FROM lesson_sessions
    WHERE class_id = 'e1000000-0000-0000-0000-0000000000c1'
 );

DELETE FROM lesson_sessions
 WHERE class_id = 'e1000000-0000-0000-0000-0000000000c1';

DELETE FROM student_class_enrolments
 WHERE class_id = 'e1000000-0000-0000-0000-0000000000c1';

DELETE FROM audit_log
 WHERE entity_type = 'lesson_session'
   AND new_value->>'class_id' = 'e1000000-0000-0000-0000-0000000000c1';

DELETE FROM classes
 WHERE id = 'e1000000-0000-0000-0000-0000000000c1';

DELETE FROM students
 WHERE id IN ('e1000000-0000-0000-0000-00000000a001',
              'e1000000-0000-0000-0000-00000000a002');
