-- Teardown for fixtures-class-deactivation.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < drivers/fixtures-class-deactivation-teardown.sql
--
-- WHY THIS EXISTS RATHER THAN `supabase db reset`. The local stack is shared
-- with every other worktree and session on this machine; a reset would destroy
-- whatever they were mid-way through. This removes exactly the rows the fixture
-- added — and leaving them is not harmless: three 'ClsRetire ' classes would
-- show up on everyone's Classes page, and one of them may be RETIRED, which is
-- a state the other drivers' assertions do not expect.
--
-- ⚠ SCOPED BY THE FIXTURE'S OWN IDS, NEVER BY `is_active = false` (§7.69). A
-- teardown that deleted "the retired classes" would delete a real business's
-- retired class the first time this ran against a stack holding one — the
-- filter that answers "what should I show?" is not the filter that answers
-- "what will this destroy?".
--
-- Order matters: children before parents, or the FKs refuse.

DELETE FROM trial_bookings
 WHERE class_id IN ('c9000000-0000-0000-0000-0000000000e1',
                    'c9000000-0000-0000-0000-0000000000e2',
                    'c9000000-0000-0000-0000-0000000000e3');

DELETE FROM student_class_enrolments
 WHERE class_id IN ('c9000000-0000-0000-0000-0000000000e1',
                    'c9000000-0000-0000-0000-0000000000e2',
                    'c9000000-0000-0000-0000-0000000000e3');

DELETE FROM attendance
 WHERE lesson_session_id IN (
   SELECT id FROM lesson_sessions
    WHERE class_id IN ('c9000000-0000-0000-0000-0000000000e1',
                       'c9000000-0000-0000-0000-0000000000e2',
                       'c9000000-0000-0000-0000-0000000000e3'));

DELETE FROM lesson_sessions
 WHERE class_id IN ('c9000000-0000-0000-0000-0000000000e1',
                    'c9000000-0000-0000-0000-0000000000e2',
                    'c9000000-0000-0000-0000-0000000000e3');

-- class_rates is seeded by a trigger on the class insert (floor-dated terms).
DELETE FROM class_rates
 WHERE class_id IN ('c9000000-0000-0000-0000-0000000000e1',
                    'c9000000-0000-0000-0000-0000000000e2',
                    'c9000000-0000-0000-0000-0000000000e3');

DELETE FROM classes
 WHERE id IN ('c9000000-0000-0000-0000-0000000000e1',
              'c9000000-0000-0000-0000-0000000000e2',
              'c9000000-0000-0000-0000-0000000000e3');

-- The audit rows deactivate_class()/reactivate_class() wrote for those classes.
-- entity_id is the class, which no longer exists, so these would otherwise be
-- unattributable clutter in a table nothing reads yet.
DELETE FROM audit_log
 WHERE entity_type = 'Class'
   AND entity_id IN ('c9000000-0000-0000-0000-0000000000e1',
                     'c9000000-0000-0000-0000-0000000000e2',
                     'c9000000-0000-0000-0000-0000000000e3');

DELETE FROM students
 WHERE id IN ('c9500000-0000-0000-0000-000000000001',
              'c9500000-0000-0000-0000-000000000002');
