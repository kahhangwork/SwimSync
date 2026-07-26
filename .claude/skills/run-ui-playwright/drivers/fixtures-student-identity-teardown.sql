-- Teardown for fixtures-student-identity.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-student-identity-teardown.sql
--
-- Run this instead of `supabase db reset` — one database serves every worktree
-- (§7.55).
--
-- EXACT IDS, NEVER A PREFIX. The parent is a0000000-…-00000000ade1 and the SEED
-- PLATFORM ADMIN is a0000000-…-000000000001; `LIKE 'a0000000-%'` would take the
-- superadmin with it.
--
-- Leaving these four behind is worse than the usual clutter: TWO OF THEM SHARE
-- A NAME ('Ethan Tan', differing only by date of birth). That is the exact
-- collision students_identity_uniq exists to permit, so a later fixture adding
-- its own Ethan hits a duplicate-name error that looks like a schema bug.

BEGIN;

DELETE FROM attendance
 WHERE student_id IN ('5e000000-0000-0000-0000-000000000001',
                      '5e000000-0000-0000-0000-000000000002',
                      '5e000000-0000-0000-0000-000000000003',
                      '5e000000-0000-0000-0000-000000000004');

DELETE FROM student_class_enrolments
 WHERE student_id IN ('5e000000-0000-0000-0000-000000000001',
                      '5e000000-0000-0000-0000-000000000002',
                      '5e000000-0000-0000-0000-000000000003',
                      '5e000000-0000-0000-0000-000000000004');

DELETE FROM parent_students
 WHERE student_id IN ('5e000000-0000-0000-0000-000000000001',
                      '5e000000-0000-0000-0000-000000000002',
                      '5e000000-0000-0000-0000-000000000003',
                      '5e000000-0000-0000-0000-000000000004');

DELETE FROM students
 WHERE id IN ('5e000000-0000-0000-0000-000000000001',
              '5e000000-0000-0000-0000-000000000002',
              '5e000000-0000-0000-0000-000000000003',
              '5e000000-0000-0000-0000-000000000004');

-- The driver edits a child's name and DOB through the real edit screen, and
-- each edit writes an audit row authored by this parent. NOT NULL / NO ACTION,
-- so they must go before the profile (§7.50).
DELETE FROM audit_log WHERE actor_id = 'a0000000-0000-0000-0000-00000000ade1';

DELETE FROM auth.users WHERE id = 'a0000000-0000-0000-0000-00000000ade1';

COMMIT;

-- Expect 0, 0, 0 — and seed_admin_intact = 1, which is the assertion that
-- matters most here.
SELECT
  (SELECT count(*) FROM students WHERE id::text LIKE '5e000000-%')      AS identity_students,
  (SELECT count(*) FROM auth.users
    WHERE id = 'a0000000-0000-0000-0000-00000000ade1')                  AS identity_parent,
  (SELECT count(*) FROM audit_log
    WHERE actor_id = 'a0000000-0000-0000-0000-00000000ade1')            AS audit_rows,
  (SELECT count(*) FROM profiles
    WHERE id = 'a0000000-0000-0000-0000-000000000001')                  AS seed_admin_intact;
