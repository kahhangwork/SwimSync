-- Teardown for fixtures-admin-table-geometry.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < drivers/fixtures-admin-table-geometry-teardown.sql
--
-- Removes exactly the rows that fixture added. NOT `supabase db reset` — the
-- local stack is shared with the other worktrees (§7.55).
--
-- ORDER IS FK ORDER, deepest child first: a credit note points at an invoice
-- item, a lesson session AND an invoice, so it cannot be the last thing
-- standing. Deleting by exact id rather than by a name pattern, per
-- check-teardowns.sh — `LIKE '%Geo%'` works today and takes a real child
-- called Geordie later. There is NOT ONE name-pattern DELETE here: every one
-- is by exact id or an id subquery. The `LIKE 'AdmGeo %'` at the bottom is the
-- verification SELECT, which is meant to match by name.
--
-- ⚠ THE UPDATE IS REVERSED TOO, NOT JUST THE INSERTS. The fixture sets
-- students.level_id on its own child; that child is deleted here, so the
-- pointer goes with it — but the level delete comes AFTER the student delete
-- for that reason, not by accident. Reverse the order and the level delete
-- silently blanks level_id through ON DELETE SET NULL first (§7.69), which is
-- invisible and would be a real bug on any row this fixture did not own.

BEGIN;

-- Deepest first: credit note → invoice item → invoice.
DELETE FROM credit_notes  WHERE id = 'a6000000-0000-0000-0000-0000000000fa'::uuid;
DELETE FROM invoice_items WHERE id = 'a6000000-0000-0000-0000-0000000000f2'::uuid;
DELETE FROM invoices      WHERE id = 'a6000000-0000-0000-0000-0000000000f1'::uuid;

-- The marked lesson.
DELETE FROM attendance      WHERE id = 'a6000000-0000-0000-0000-0000000000e2'::uuid;
DELETE FROM lesson_sessions WHERE id = 'a6000000-0000-0000-0000-0000000000e1'::uuid;

-- The package purchase, then the product it snapshots.
DELETE FROM parent_packages  WHERE id = 'a6000000-0000-0000-0000-0000000000d2'::uuid;
DELETE FROM package_products WHERE id = 'a6000000-0000-0000-0000-0000000000d1'::uuid;

-- The children (and their enrolment / parent links), BEFORE the levels they
-- point at — see the note above.
DELETE FROM student_class_enrolments
 WHERE student_id IN ('a6000000-0000-0000-0000-0000000000a1'::uuid,
                      'a6000000-0000-0000-0000-0000000000a2'::uuid);
DELETE FROM parent_students
 WHERE student_id IN ('a6000000-0000-0000-0000-0000000000a1'::uuid,
                      'a6000000-0000-0000-0000-0000000000a2'::uuid);
DELETE FROM students
 WHERE id IN ('a6000000-0000-0000-0000-0000000000a1'::uuid,
              'a6000000-0000-0000-0000-0000000000a2'::uuid);

DELETE FROM tenant_level_skills
 WHERE level_id IN ('a6000000-0000-0000-0000-0000000000c1'::uuid,
                    'a6000000-0000-0000-0000-0000000000c2'::uuid);
DELETE FROM tenant_levels
 WHERE id IN ('a6000000-0000-0000-0000-0000000000c1'::uuid,
              'a6000000-0000-0000-0000-0000000000c2'::uuid);

-- The class this fixture owns (§8.22 — it owns one so no sibling can collide
-- with it on (class_id, session_date)). class_rates is written by a trigger on
-- class creation, so it is deleted explicitly rather than trusted to cascade.
DELETE FROM class_rates WHERE class_id = 'a6000000-0000-0000-0000-0000000000c0'::uuid;
DELETE FROM classes     WHERE id       = 'a6000000-0000-0000-0000-0000000000c0'::uuid;

-- The parent last: parent_tenants and parents hang off the profile, and the
-- auth user cascades to both.
DELETE FROM parent_tenants
 WHERE parent_id IN (SELECT id FROM parents
                      WHERE profile_id = 'a6000000-0000-0000-0000-0000000000b1'::uuid);
DELETE FROM auth.users WHERE id = 'a6000000-0000-0000-0000-0000000000b1'::uuid;

COMMIT;

-- Should print 0 for everything removed, and 1 for each seed identity that
-- must have SURVIVED — a teardown that took the seed with it is the failure
-- this line exists to catch.
SELECT (SELECT count(*) FROM students         WHERE full_name LIKE 'AdmGeo %') AS students,
       (SELECT count(*) FROM tenant_levels    WHERE label     LIKE 'AdmGeo %') AS levels,
       (SELECT count(*) FROM package_products WHERE name      LIKE 'AdmGeo %') AS products,
       (SELECT count(*) FROM parent_packages  WHERE name      LIKE 'AdmGeo %') AS packages,
       (SELECT count(*) FROM invoices         WHERE id = 'a6000000-0000-0000-0000-0000000000f1'::uuid) AS invoices,
       (SELECT count(*) FROM credit_notes     WHERE id = 'a6000000-0000-0000-0000-0000000000fa'::uuid) AS credit_notes,
       (SELECT count(*) FROM attendance       WHERE id = 'a6000000-0000-0000-0000-0000000000e2'::uuid) AS attendance,
       (SELECT count(*) FROM profiles         WHERE id = 'a6000000-0000-0000-0000-0000000000b1'::uuid) AS parent_profile,
       (SELECT count(*) FROM classes          WHERE title = 'Saturday Beginners') AS seed_class,
       (SELECT count(*) FROM coaches)                                             AS seed_coach;
