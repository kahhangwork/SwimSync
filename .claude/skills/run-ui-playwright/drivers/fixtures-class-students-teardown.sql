-- Teardown for fixtures-class-students.sql.
--
-- Run this when you are done driving verify-class-students.mjs:
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < drivers/fixtures-class-students-teardown.sql
--
-- WHY THIS EXISTS RATHER THAN `supabase db reset`. The local stack is shared
-- with every other worktree and session on this machine; a reset would destroy
-- whatever they were mid-way through. This removes exactly the rows the
-- fixture added and nothing else — and leaving them behind is not harmless
-- either, since 'ClsRoster Class' would show up on everyone's Classes page.
--
-- Order matters: children before parents, or the FKs refuse.

DELETE FROM trial_bookings
 WHERE class_id = 'c5000000-0000-0000-0000-0000000000C1';

DELETE FROM student_class_enrolments
 WHERE class_id = 'c5000000-0000-0000-0000-0000000000C1';

-- class_rates is seeded by a trigger on the class insert (floor-dated terms),
-- and classes.id is RESTRICT-referenced from trial_bookings — both gone above.
DELETE FROM class_rates
 WHERE class_id = 'c5000000-0000-0000-0000-0000000000C1';

DELETE FROM classes
 WHERE id = 'c5000000-0000-0000-0000-0000000000C1';

-- The location the class referenced (FK is ON DELETE RESTRICT — after classes).
DELETE FROM locations
 WHERE id = 'c5000000-0000-0000-0000-0000000010c1';

-- Students carry level_id, so they go before the level.
DELETE FROM students
 WHERE full_name LIKE 'ClsRoster %';

DELETE FROM tenant_levels
 WHERE id = 'c5000000-0000-0000-0000-000000000010';

-- Should print 0 for every column.
SELECT (SELECT count(*) FROM students WHERE full_name LIKE 'ClsRoster %') AS students,
       (SELECT count(*) FROM classes WHERE id = 'c5000000-0000-0000-0000-0000000000C1') AS classes,
       (SELECT count(*) FROM tenant_levels WHERE id = 'c5000000-0000-0000-0000-000000000010') AS levels;
