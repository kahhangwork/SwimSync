-- Teardown for fixtures-parent-claim.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-parent-claim-teardown.sql
--
-- Run this instead of `supabase db reset` — one database serves every worktree
-- (§7.55).
--
-- THE DRIVER CREATES MORE THAN THE FIXTURE DOES, and that is the whole reason
-- this file is longer than the fixture. verify-parent-claim.mjs drives a real
-- claim through the UI: it files a `student_claims` row, may APPROVE it (which
-- writes a parent_students link and flips the student), and may MERGE a
-- duplicate the parent created through Add Child. A teardown that only reverses
-- the fixture leaves a claimed child and a duplicate behind — and the next run
-- then passes for the wrong reason, because the candidate it expects to find is
-- already claimed and therefore correctly invisible.
--
-- Leaving these rows is not cosmetic: a claimed child changes the "No parent
-- account" count the admin's Students filter is asserted against.

BEGIN;

-- Claims reference BOTH the student and the parent, so they go first — and by
-- either side, because the driver may have filed a claim against a duplicate
-- the fixture never created.
DELETE FROM student_claims
 WHERE student_id = 'c1a00000-0000-0000-0000-00000000e001'
    OR parent_id IN (SELECT id FROM parents
                      WHERE profile_id = 'c1a00000-0000-0000-0000-00000000d001');

-- Anything the parent adopted or created through the UI during the run.
CREATE TEMP TABLE _claim_students ON COMMIT DROP AS
SELECT 'c1a00000-0000-0000-0000-00000000e001'::uuid AS id
UNION
SELECT ps.student_id
  FROM parent_students ps
  JOIN parents p ON p.id = ps.parent_id
 WHERE p.profile_id = 'c1a00000-0000-0000-0000-00000000d001';

DELETE FROM attendance
 WHERE student_id IN (SELECT id FROM _claim_students);

DELETE FROM lesson_sessions
 WHERE id = 'c1a00000-0000-0000-0000-00000000f001';

DELETE FROM student_class_enrolments
 WHERE student_id IN (SELECT id FROM _claim_students);
DELETE FROM parent_students
 WHERE student_id IN (SELECT id FROM _claim_students);
DELETE FROM students
 WHERE id IN (SELECT id FROM _claim_students);

DELETE FROM audit_log WHERE actor_id = 'c1a00000-0000-0000-0000-00000000d001';
DELETE FROM auth.users WHERE id = 'c1a00000-0000-0000-0000-00000000d001';

COMMIT;

-- The fixture also does `UPDATE profiles SET phone` — on its OWN profile, which
-- the auth-user delete has just cascaded away. Nothing to restore.

-- Expect 0 across all four.
SELECT
  (SELECT count(*) FROM students
    WHERE id = 'c1a00000-0000-0000-0000-00000000e001')            AS ethan,
  (SELECT count(*) FROM lesson_sessions
    WHERE id = 'c1a00000-0000-0000-0000-00000000f001')            AS session,
  (SELECT count(*) FROM auth.users
    WHERE id = 'c1a00000-0000-0000-0000-00000000d001')            AS claim_parent,
  (SELECT count(*) FROM student_claims sc
    WHERE sc.student_id = 'c1a00000-0000-0000-0000-00000000e001') AS claims;
