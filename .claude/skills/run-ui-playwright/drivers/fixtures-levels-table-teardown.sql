-- Teardown for fixtures-levels-table.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < drivers/fixtures-levels-table-teardown.sql
--
-- Removes exactly the rows the fixture added. NOT `supabase db reset` — the
-- local stack is shared with the other worktrees.
--
-- students.level_id is ON DELETE SET NULL and tenant_level_skills is
-- ON DELETE CASCADE, so deleting the levels would strand the students rather
-- than fail. They go first anyway, so the fixture's own children are gone
-- explicitly rather than by side effect.

DELETE FROM students WHERE full_name LIKE 'LvlTbl %';

DELETE FROM tenant_level_skills
 WHERE level_id IN (
   '11000000-0000-0000-0000-000000000001'::uuid,
   '11000000-0000-0000-0000-000000000002'::uuid,
   '11000000-0000-0000-0000-000000000003'::uuid
 );

DELETE FROM tenant_levels WHERE label LIKE 'LvlTbl %';

-- Should print 0, 0, 0.
SELECT (SELECT count(*) FROM tenant_levels WHERE label LIKE 'LvlTbl %')      AS levels,
       (SELECT count(*) FROM students      WHERE full_name LIKE 'LvlTbl %')  AS students,
       (SELECT count(*) FROM tenant_level_skills WHERE label LIKE 'LvlTbl %') AS skills;
