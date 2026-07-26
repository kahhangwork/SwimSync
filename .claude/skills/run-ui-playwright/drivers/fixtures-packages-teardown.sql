-- Teardown for fixtures-packages.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-packages-teardown.sql
--
-- Run this instead of `supabase db reset` — one database serves every worktree
-- (§7.55), and a reset rebuilds it from whichever branch is running.
--
-- TWO THINGS HERE ARE NOT DELETES, AND BOTH MATTER MORE THAN THE DELETES.
--
-- 1. The fixture does `UPDATE classes SET category_id = <Group>` on the SEED
--    class. A teardown that only deletes rows leaves the seed class pointing at
--    a category that is about to vanish — and category_id is NOT NULL since
--    20260725000400, so the delete would fail, or worse, succeed against a
--    schema where it is nullable and leave a dangling id. The category is
--    restored to the tenant's Default Group FIRST, then removed.
-- 2. The fixture's lesson_session has a GENERATED id, so it is reached through
--    the attendance row that points at it — captured before that row is deleted.
--    Deleting "sessions on Saturday Beginners" instead would take a sibling
--    worktree's session with it.

BEGIN;

-- Capture the fixture's session(s) before the attendance that identifies them
-- is removed.
CREATE TEMP TABLE _pkg_sessions ON COMMIT DROP AS
SELECT DISTINCT lesson_session_id AS id
  FROM attendance
 WHERE student_id = 'c5000000-0000-0000-0000-000000000001';

DELETE FROM attendance
 WHERE student_id = 'c5000000-0000-0000-0000-000000000001';

-- Only sessions that are now unreferenced — never a blanket delete on the class.
DELETE FROM lesson_sessions ls
 WHERE ls.id IN (SELECT id FROM _pkg_sessions)
   AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.lesson_session_id = ls.id);

-- Package rows: the held package, then the products it snapshotted from.
DELETE FROM parent_packages
 WHERE id = 'ee100000-0000-0000-0000-000000000001';
DELETE FROM parent_packages
 WHERE product_id IN ('dd100000-0000-0000-0000-000000000001',
                      'dd100000-0000-0000-0000-000000000002');
DELETE FROM package_products
 WHERE id IN ('dd100000-0000-0000-0000-000000000001',
              'dd100000-0000-0000-0000-000000000002');

-- Put the seed class back on the tenant's Default Group BEFORE the fixture's
-- category is deleted. See the header — this is the step that is easy to miss.
UPDATE classes c
   SET category_id = (
        SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = c.tenant_id
           AND lower(trim(cc.name)) = 'default group'
         LIMIT 1)
 WHERE c.category_id = 'cc100000-0000-0000-0000-000000000001';

DELETE FROM class_categories
 WHERE id = 'cc100000-0000-0000-0000-000000000001';

DELETE FROM student_class_enrolments
 WHERE student_id = 'c5000000-0000-0000-0000-000000000001';
DELETE FROM parent_students
 WHERE student_id = 'c5000000-0000-0000-0000-000000000001';
DELETE FROM students
 WHERE id = 'c5000000-0000-0000-0000-000000000001';

DELETE FROM audit_log WHERE actor_id = 'c9000000-0000-0000-0000-000000000001';
DELETE FROM auth.users WHERE id = 'c9000000-0000-0000-0000-000000000001';

COMMIT;

-- Expect 0 across the first four. seed_class_categorised = 1 proves the seed
-- class came back to a real category rather than being left dangling.
SELECT
  (SELECT count(*) FROM students
    WHERE id = 'c5000000-0000-0000-0000-000000000001')                AS pkg_student,
  (SELECT count(*) FROM package_products
    WHERE id::text LIKE 'dd100000-%')                                 AS products,
  (SELECT count(*) FROM class_categories
    WHERE id = 'cc100000-0000-0000-0000-000000000001')                AS category,
  (SELECT count(*) FROM auth.users
    WHERE id = 'c9000000-0000-0000-0000-000000000001')                AS pkg_parent,
  (SELECT count(*) FROM classes
    WHERE title = 'Saturday Beginners' AND category_id IS NOT NULL)   AS seed_class_categorised;
