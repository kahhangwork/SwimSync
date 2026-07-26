-- Teardown for fixtures-active-inactive.sql.
--
-- Run this at the end of a session instead of `supabase db reset` — one database
-- serves every worktree (§7.55), and a reset rebuilds it from whichever branch
-- happens to be running, taking a sibling's state with it.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-active-inactive-teardown.sql
--
-- EXACT IDS, NEVER A PREFIX PATTERN. The parent here is
-- a0000000-…-00000000dddd and the SEED PLATFORM ADMIN is
-- a0000000-…-000000000001 — `LIKE 'a0000000-%'` would delete the superadmin and
-- the next session would find the admin panel unusable with no clue why.
--
-- Order: enrolments → family links → students → audit → auth user. Deleting the
-- auth user cascades profiles → parents → parent_tenants.

BEGIN;

DELETE FROM student_class_enrolments
 WHERE student_id IN ('5d000000-0000-0000-0000-000000000001',
                      '5d000000-0000-0000-0000-000000000002');

DELETE FROM parent_students
 WHERE student_id IN ('5d000000-0000-0000-0000-000000000001',
                      '5d000000-0000-0000-0000-000000000002');

DELETE FROM students
 WHERE id IN ('5d000000-0000-0000-0000-000000000001',
              '5d000000-0000-0000-0000-000000000002');

-- audit_log.actor_id is NOT NULL and NO ACTION, so it can be neither cascaded
-- nor blanked — rows AUTHORED BY this parent must go before the profile (§7.50).
-- The driver deactivates and reactivates children, and each of those writes one.
DELETE FROM audit_log WHERE actor_id = 'a0000000-0000-0000-0000-00000000dddd';

DELETE FROM auth.users WHERE id = 'a0000000-0000-0000-0000-00000000dddd';

COMMIT;

-- Expect 0, 0, 0 — and seed_admin_intact = 1. That last column is the point:
-- it proves the teardown removed the fixture parent and NOT the superadmin.
SELECT
  (SELECT count(*) FROM students
    WHERE id IN ('5d000000-0000-0000-0000-000000000001',
                 '5d000000-0000-0000-0000-000000000002'))                  AS students,
  (SELECT count(*) FROM auth.users
    WHERE id = 'a0000000-0000-0000-0000-00000000dddd')                     AS parent,
  (SELECT count(*) FROM audit_log
    WHERE actor_id = 'a0000000-0000-0000-0000-00000000dddd')               AS audit_rows,
  (SELECT count(*) FROM profiles
    WHERE id = 'a0000000-0000-0000-0000-000000000001')                     AS seed_admin_intact;
