-- Teardown for fixtures-assessment.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < drivers/fixtures-assessment-teardown.sql
--
-- Removes exactly the rows the fixture added. NOT `supabase db reset` — the
-- local stack is shared with the other worktrees.
--
-- ORDER MATTERS, and not only for foreign keys. student_skill_progress'
-- skill_id and grade_level_id are ON DELETE RESTRICT (20260828000100 — a
-- child's earned record must not vanish because someone tidied the
-- curriculum), so deleting the levels first would FAIL rather than cascade.
-- The progress rows go first, then the children, then the skills, then the
-- levels.
--
-- The driver's own writes are covered too: it grades children by clicking, so
-- the delete is scoped by student rather than by the rows the fixture inserted.

DELETE FROM student_skill_progress
 WHERE student_id IN (
   SELECT id FROM students WHERE full_name LIKE 'Assess %'
 );

-- Also catch anything the driver graded on a fixture SKILL for some other
-- child — belt and braces, since an in-use skill cannot be deleted below.
DELETE FROM student_skill_progress
 WHERE skill_id IN (
   '12100000-0000-0000-0000-000000000001'::uuid,
   '12100000-0000-0000-0000-000000000002'::uuid,
   '12100000-0000-0000-0000-000000000003'::uuid,
   '12100000-0000-0000-0000-000000000004'::uuid
 );

DELETE FROM student_class_enrolments
 WHERE student_id IN (
   SELECT id FROM students WHERE full_name LIKE 'Assess %'
 );

DELETE FROM students WHERE full_name LIKE 'Assess %';

DELETE FROM tenant_level_skills
 WHERE level_id IN (
   '12000000-0000-0000-0000-000000000001'::uuid,
   '12000000-0000-0000-0000-000000000002'::uuid
 );

DELETE FROM tenant_levels
 WHERE id IN (
   '12000000-0000-0000-0000-000000000001'::uuid,
   '12000000-0000-0000-0000-000000000002'::uuid
 );

-- Should print 0, 0, 0, 0.
SELECT (SELECT count(*) FROM tenant_levels WHERE label LIKE 'Assess %')          AS levels,
       (SELECT count(*) FROM tenant_level_skills WHERE label LIKE 'Assess %')    AS skills,
       (SELECT count(*) FROM students WHERE full_name LIKE 'Assess %')           AS students,
       (SELECT count(*) FROM student_skill_progress p
          JOIN students s ON s.id = p.student_id
         WHERE s.full_name LIKE 'Assess %')                                      AS progress;
