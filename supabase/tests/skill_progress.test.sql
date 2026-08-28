-- pgTAP: per-child swim-skill grading — Wave C S-pool Piece 4 (20260828000100).
--
-- What is pinned here, in order of blast radius:
--   • The cross-tenant reference hole RLS cannot see (plan step 1a): a row
--     pairing this tenant's student with ANOTHER tenant's grade level or skill
--     is refused by trg_skill_progress_tenant even for an otherwise-authorised
--     writer — the exact lesson 20260719001800 records for students.level_id.
--   • The upsert key (1c): re-grading the same (student, skill) REPLACES; without
--     UNIQUE (student_id, skill_id) the tap-cycle UI double-counts every n-of-m.
--   • The two ON DELETE RESTRICT FKs (1b): an in-use skill, its level (by
--     cascade), and an in-use grade level can no longer be deleted — the
--     keep-records decision made structural. Unused ones still delete.
--   • Who may write: an ADMIN of the business, and NOBODY ELSE. As of
--     20260829000100 the coach arm is gone — a coach who SERVES the child is
--     refused 42501, which is this file's §7.25 RED proof (against the previous
--     policy that same statement SUCCEEDS). A parent stays read-only;
--     cross-tenant is refused.
--   • graded_at/graded_by mean "who last CONFIRMED, and when" (20260829000100):
--     re-confirming an unchanged grade MUST advance them, or the Assessment
--     tab's round mechanism reads a re-confirmed child as never assessed — the
--     exact oversight it exists to prevent. A bare student_id repoint
--     (merge_students folding a duplicate) must still PRESERVE both.
--   • The seed trigger (1d): a tenant created AFTER this migration is born with
--     the three default grade levels.
--   • "Done" is the TOP rank, computed — adding a higher grade re-opens it.
--
-- METHOD (§7.16): every policy probe runs inside this transaction under SET LOCAL
-- ROLE + a JWT claim. Outside one, SET LOCAL ROLE is a no-op, the session stays
-- superuser, RLS is bypassed, and every assertion "passes" — including the ones
-- that must fail.
--
-- PROVEN RED (§7.25), twice over:
--   • Without 20260828000100 the two tables do not exist, so this file dies at
--     the first fixture INSERT — 0 of N assertions run.
--   • Without 20260829000100 the serving-coach INSERT succeeds instead of
--     throwing 42501, and the re-confirmation leaves graded_at at its backdated
--     value. Both are observable failures, not silent passes.
--
-- Runs on its own tenants; self-contained; rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(30);

-- ── RLS is actually ON (not merely policies written) ───────────────────────
SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'skill_grade_levels' AND relnamespace = 'public'::regnamespace),
  'skill_grade_levels has ROW LEVEL SECURITY enabled');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'student_skill_progress' AND relnamespace = 'public'::regnamespace),
  'student_skill_progress has ROW LEVEL SECURITY enabled');

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('a1000000-0000-0000-0000-000000000001','skp-a','Skill Progress A','SWIM-SKPA'),
  ('a1000000-0000-0000-0000-000000000002','skp-b','Skill Progress B','SWIM-SKPB');

-- 1d — the seed trigger fired on the two INSERTs above.
SELECT is(
  (SELECT count(*)::int FROM skill_grade_levels
    WHERE tenant_id = 'a1000000-0000-0000-0000-000000000001'),
  3, 'a tenant created after this migration is seeded with 3 default grade levels');
SELECT is(
  (SELECT string_agg(label, ' | ' ORDER BY rank) FROM skill_grade_levels
    WHERE tenant_id = 'a1000000-0000-0000-0000-000000000001'),
  'Developing | Competent | Mastered',
  'the default scale is Developing / Competent / Mastered, low rank first');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  -- admin A
  ('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','skp-admin-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"SKP Admin A","role":"tenant_admin","tenant_id":"a1000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  -- coach A — serves the student (owns the class they are enrolled in)
  ('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','skp-coach-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"SKP Coach A","role":"coach","tenant_id":"a1000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  -- coach A2 — same business, but does NOT serve the student
  ('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-0000000000a3',
   'authenticated','authenticated','skp-coach-a2@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"SKP Coach A2","role":"coach","tenant_id":"a1000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  -- parent A — owns the student
  ('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-0000000000a4',
   'authenticated','authenticated','skp-parent-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"SKP Parent A","role":"parent"}',
   now(), now(), '','','',''),
  -- admin B — the other business
  ('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','skp-admin-b@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"SKP Admin B","role":"tenant_admin","tenant_id":"a1000000-0000-0000-0000-000000000002"}',
   now(), now(), '','','','');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'a1000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'skp-parent-a@test.local';

-- Levels + skills for both tenants.
INSERT INTO tenant_levels (id, tenant_id, label, sort_order) VALUES
  ('a3000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','A Level 1', 1),
  ('a3000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','A Level 2', 2),
  ('a3000000-0000-0000-0000-000000000009','a1000000-0000-0000-0000-000000000002','B Level 1', 1);

INSERT INTO tenant_level_skills (id, level_id, label, sort_order) VALUES
  ('a4000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','A Skill One', 1),
  ('a4000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000001','A Skill Two', 2),
  ('a4000000-0000-0000-0000-000000000009','a3000000-0000-0000-0000-000000000009','B Skill One', 1);

-- A grade level for tenant B with a KNOWN id. The auto-seeded ones have random
-- ids AND are invisible to coach A under RLS (its select policy is tenant-scoped)
-- — so the cross-tenant test below must reference this fixed literal, not a
-- subquery that would return NULL for coach A and mis-fire as a NOT NULL error.
INSERT INTO skill_grade_levels (id, tenant_id, rank, label) VALUES
  ('a8000000-0000-0000-0000-000000000009','a1000000-0000-0000-0000-000000000002', 5, 'B Extra Grade');

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('a5000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','SKP Group');

INSERT INTO locations (tenant_id, name)
SELECT t.id, 'Default location' FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM locations l
    WHERE l.tenant_id = t.id AND lower(trim(l.name)) = 'default location');

-- Coach A owns C1 (the served student's class); coach A2 owns C2 (the student is
-- NOT in it), which is what makes coach A2 fail coach_serves_student.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_id, price_per_lesson, category_id, is_active)
SELECT 'a6000000-0000-0000-0000-000000000001', co.id, 'SKP C1', 'saturday','10:00','11:00',
       (SELECT l.id FROM locations l WHERE l.tenant_id = co.tenant_id AND lower(trim(l.name)) = 'default location'),
       40.00, 'a5000000-0000-0000-0000-000000000001', TRUE
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'skp-coach-a@test.local';

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_id, price_per_lesson, category_id, is_active)
SELECT 'a6000000-0000-0000-0000-000000000002', co.id, 'SKP C2', 'sunday','10:00','11:00',
       (SELECT l.id FROM locations l WHERE l.tenant_id = co.tenant_id AND lower(trim(l.name)) = 'default location'),
       40.00, 'a5000000-0000-0000-0000-000000000001', TRUE
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'skp-coach-a2@test.local';

-- The student, on A Level 1, enrolled in C1.
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, level_id, created_by) VALUES
  ('a7000000-0000-0000-0000-000000000001','SKP Kid','2018-01-01','assigned',
   'a1000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-0000000000a1');

-- A SECOND child in the same business, deliberately ungraded. Its only job is to
-- be the destination of the student_id repoint at the end of this file — the
-- exact shape merge_students() uses when it folds a duplicate. It must be
-- ungraded, or the repoint would collide with UNIQUE (student_id, skill_id) and
-- fail for a reason that has nothing to do with what is being tested.
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, level_id, created_by) VALUES
  ('a7000000-0000-0000-0000-000000000002','SKP Kid Two','2018-06-01','assigned',
   'a1000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-0000000000a1');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'a7000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'skp-parent-a@test.local';

INSERT INTO student_class_enrolments (student_id, class_id) VALUES
  ('a7000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001');

-- ════════════════════════════════════════════════════════════════════════════
-- The business's ADMIN can grade — and is now the ONLY one who can
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT lives_ok($$
  INSERT INTO student_skill_progress (tenant_id, student_id, skill_id, grade_level_id)
  VALUES ('a1000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001',
          'a4000000-0000-0000-0000-000000000001',
          (SELECT id FROM skill_grade_levels
            WHERE tenant_id='a1000000-0000-0000-0000-000000000001' AND rank=1))
$$, 'an admin of the business can grade a skill');

SELECT is(
  (SELECT count(*)::int FROM student_skill_progress
    WHERE student_id='a7000000-0000-0000-0000-000000000001'),
  1, 'one graded row exists after the first grade');

-- graded_by is stamped server-side to the caller, not taken from the payload.
SELECT is(
  (SELECT graded_by FROM student_skill_progress
    WHERE student_id='a7000000-0000-0000-0000-000000000001'
      AND skill_id='a4000000-0000-0000-0000-000000000001'),
  'a2000000-0000-0000-0000-0000000000a1'::uuid,
  'graded_by is stamped to the grading admin');

-- 1c — re-grading the same (student, skill) REPLACES via the upsert key.
SELECT lives_ok($$
  INSERT INTO student_skill_progress (tenant_id, student_id, skill_id, grade_level_id)
  VALUES ('a1000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001',
          'a4000000-0000-0000-0000-000000000001',
          (SELECT id FROM skill_grade_levels
            WHERE tenant_id='a1000000-0000-0000-0000-000000000001' AND rank=3))
  ON CONFLICT (student_id, skill_id)
  DO UPDATE SET grade_level_id = EXCLUDED.grade_level_id
$$, 're-grading the same (student, skill) upserts');

SELECT is(
  (SELECT count(*)::int FROM student_skill_progress
    WHERE student_id='a7000000-0000-0000-0000-000000000001'
      AND skill_id='a4000000-0000-0000-0000-000000000001'),
  1, 'a re-grade REPLACES, never adds a second row (1c)');

SELECT is(
  (SELECT g.rank FROM student_skill_progress sp
     JOIN skill_grade_levels g ON g.id = sp.grade_level_id
    WHERE sp.student_id='a7000000-0000-0000-0000-000000000001'
      AND sp.skill_id='a4000000-0000-0000-0000-000000000001'),
  3, 'the re-grade updated the grade to the new rank');

-- ════════════════════════════════════════════════════════════════════════════
-- 1a — the cross-tenant reference hole, refused even for an authorised writer
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠ THESE TWO PROBES RUN UNDER THE ADMIN'S JWT, AND THAT IS LOAD-BEARING.
-- They test the TRIGGER, not the policy, so the writer must be one the policy
-- lets through — otherwise the statement dies 42501 at the policy and the
-- asserted 23514 never happens. They ran under coach A's JWT until
-- 20260829000100 removed the coach write arm; leaving them there would have
-- turned two trigger tests into two policy tests wearing the wrong error code.
SELECT throws_ok($$
  INSERT INTO student_skill_progress (tenant_id, student_id, skill_id, grade_level_id)
  VALUES ('a1000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001',
          'a4000000-0000-0000-0000-000000000002',
          'a8000000-0000-0000-0000-000000000009')
$$, '23514', NULL,
  'a grade level from ANOTHER business is refused (1a)');

SELECT throws_ok($$
  INSERT INTO student_skill_progress (tenant_id, student_id, skill_id, grade_level_id)
  VALUES ('a1000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001',
          'a4000000-0000-0000-0000-000000000009',
          (SELECT id FROM skill_grade_levels
            WHERE tenant_id='a1000000-0000-0000-0000-000000000001' AND rank=1))
$$, '23514', NULL,
  'a skill from ANOTHER business is refused (1a)');

-- ════════════════════════════════════════════════════════════════════════════
-- THE RED PROOF (§7.25): the coach who SERVES the child is now REFUSED
-- ════════════════════════════════════════════════════════════════════════════
-- Coach A owns the class the child is enrolled in, so coach_serves_student() is
-- TRUE for them. Under 20260828000100's policy this exact INSERT SUCCEEDS — it
-- is the statement the whole previous feature was built around. Under
-- 20260829000100 it must throw 42501. Run this file against the previous
-- migration and this assertion is the one that fails; that is what makes it a
-- proof rather than a restatement.
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok($$
  INSERT INTO student_skill_progress (tenant_id, student_id, skill_id, grade_level_id)
  VALUES ('a1000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001',
          'a4000000-0000-0000-0000-000000000002',
          (SELECT id FROM skill_grade_levels
            WHERE tenant_id='a1000000-0000-0000-0000-000000000001' AND rank=1))
$$, '42501', NULL,
  'the coach who SERVES the child can no longer grade them (20260829000100)');

-- ════════════════════════════════════════════════════════════════════════════
-- A coach who does NOT serve the child cannot grade them either
-- ════════════════════════════════════════════════════════════════════════════
-- Still refused, but for a different reason than before: not "you do not serve
-- this child" but "you are not an admin". Kept because it pins that the removal
-- of the coach arm did not accidentally leave some other coach path open.
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
SELECT throws_ok($$
  INSERT INTO student_skill_progress (tenant_id, student_id, skill_id, grade_level_id)
  VALUES ('a1000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001',
          'a4000000-0000-0000-0000-000000000002',
          (SELECT id FROM skill_grade_levels
            WHERE tenant_id='a1000000-0000-0000-0000-000000000001' AND rank=1))
$$, '42501', NULL,
  'a coach who does not serve the child cannot grade them');

-- ════════════════════════════════════════════════════════════════════════════
-- The parent is read-only
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
SELECT throws_ok($$
  INSERT INTO student_skill_progress (tenant_id, student_id, skill_id, grade_level_id)
  VALUES ('a1000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001',
          'a4000000-0000-0000-0000-000000000002',
          (SELECT id FROM skill_grade_levels
            WHERE tenant_id='a1000000-0000-0000-0000-000000000001' AND rank=1))
$$, '42501', NULL,
  'a parent cannot write progress');

SELECT is(
  (SELECT count(*)::int FROM student_skill_progress
    WHERE student_id='a7000000-0000-0000-0000-000000000001'),
  1, 'but the parent CAN read their own child''s progress');

-- ════════════════════════════════════════════════════════════════════════════
-- 1b — the ON DELETE RESTRICT guards (admin A)
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- The graded skill is now in use.
SELECT throws_ok($$
  DELETE FROM tenant_level_skills WHERE id = 'a4000000-0000-0000-0000-000000000001'
$$, '23503', NULL,
  'a skill a child has been graded on cannot be deleted (1b)');

-- Deleting the LEVEL cascades to its skills, and that cascade is blocked by the
-- graded skill's RESTRICT — so an in-use level cannot be deleted either.
SELECT throws_ok($$
  DELETE FROM tenant_levels WHERE id = 'a3000000-0000-0000-0000-000000000001'
$$, '23503', NULL,
  'a level whose skill a child has been graded on cannot be deleted (1b)');

-- The grade level the child holds cannot be deleted.
SELECT throws_ok($$
  DELETE FROM skill_grade_levels
   WHERE tenant_id='a1000000-0000-0000-0000-000000000001' AND rank=3
$$, '23503', NULL,
  'a grade level a child holds cannot be deleted (1b)');

-- An UNUSED skill still deletes cleanly.
SELECT lives_ok($$
  DELETE FROM tenant_level_skills WHERE id = 'a4000000-0000-0000-0000-000000000002'
$$, 'an unused skill still deletes');

-- Renaming a grade label is free.
SELECT lives_ok($$
  UPDATE skill_grade_levels SET label = 'Achieved'
   WHERE tenant_id='a1000000-0000-0000-0000-000000000001' AND rank=3
$$, 'a grade label can be renamed freely');

-- ════════════════════════════════════════════════════════════════════════════
-- Keep records across a level change
-- ════════════════════════════════════════════════════════════════════════════
-- Move the child to A Level 2; their earned record on the old level survives.
RESET ROLE;
UPDATE students SET level_id = 'a3000000-0000-0000-0000-000000000002'
 WHERE id = 'a7000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM student_skill_progress
    WHERE student_id='a7000000-0000-0000-0000-000000000001'),
  1, 'changing the child''s level does not delete their earned records');

-- ════════════════════════════════════════════════════════════════════════════
-- "Done" is the TOP rank, computed — adding a higher grade re-opens it
-- ════════════════════════════════════════════════════════════════════════════
-- The child is graded at rank 3, the current top. It reads as "done".
SELECT ok(
  (SELECT sp.grade_level_id = (
      SELECT id FROM skill_grade_levels
       WHERE tenant_id='a1000000-0000-0000-0000-000000000001'
       ORDER BY rank DESC LIMIT 1)
     FROM student_skill_progress sp
    WHERE sp.student_id='a7000000-0000-0000-0000-000000000001'
      AND sp.skill_id='a4000000-0000-0000-0000-000000000001'),
  'a skill graded at the current top rank reads as done');

-- Add a rank-4 grade. The child's rank-3 grade is no longer the top.
INSERT INTO skill_grade_levels (tenant_id, rank, label)
VALUES ('a1000000-0000-0000-0000-000000000001', 4, 'Expert');

SELECT ok(
  (SELECT sp.grade_level_id <> (
      SELECT id FROM skill_grade_levels
       WHERE tenant_id='a1000000-0000-0000-0000-000000000001'
       ORDER BY rank DESC LIMIT 1)
     FROM student_skill_progress sp
    WHERE sp.student_id='a7000000-0000-0000-0000-000000000001'
      AND sp.skill_id='a4000000-0000-0000-0000-000000000001'),
  'adding a higher grade re-opens the skill — "done" is computed, never stored');

-- ════════════════════════════════════════════════════════════════════════════
-- graded_at/graded_by mean "who last CONFIRMED, and when" (20260829000100)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠ WHY THIS BLOCK BACKDATES UNDER A DISABLED TRIGGER, AND WHY THERE IS NO
-- SIMPLER WAY. The obvious test — "re-confirm, then assert graded_at moved" —
-- CANNOT WORK HERE, and would pass for the wrong reason if written naively:
--
--   1. NOW() is the TRANSACTION timestamp, and this whole suite runs inside one
--      BEGIN…ROLLBACK (§7.16). The row was already stamped NOW() when it was
--      inserted above, so after a re-confirmation graded_at = NOW() either way.
--      Comparing NOW() to NOW() can never observe an advance — the assertion
--      would be green against the OLD trigger too, which is the definition of a
--      test that proves nothing (§7.25).
--   2. Backdating the fixture with a plain UPDATE does not work either, because
--      the NEW trigger stamps every non-repoint UPDATE and would clobber the
--      backdate with NOW() on the way in.
--
-- So the fixture disables the trigger to plant a genuinely old timestamp, then
-- re-enables it. This is also the worked example the migration comment points at
-- for any future graded_at data fix.
RESET ROLE;

ALTER TABLE student_skill_progress DISABLE TRIGGER trg_skill_progress_tenant;
UPDATE student_skill_progress
   SET graded_at = NOW() - interval '90 days',
       graded_by = 'a2000000-0000-0000-0000-0000000000a2'
 WHERE student_id = 'a7000000-0000-0000-0000-000000000001'
   AND skill_id   = 'a4000000-0000-0000-0000-000000000001';
ALTER TABLE student_skill_progress ENABLE TRIGGER trg_skill_progress_tenant;

-- The fixture itself is asserted. A backdate that silently did not take would
-- make every assertion below vacuous.
SELECT ok(
  (SELECT graded_at < NOW() - interval '89 days' FROM student_skill_progress
    WHERE student_id='a7000000-0000-0000-0000-000000000001'
      AND skill_id='a4000000-0000-0000-0000-000000000001'),
  'the DISABLE TRIGGER fixture really did plant a 90-day-old graded_at');

-- ── A RE-CONFIRMATION at the SAME grade must advance both stamps ────────────
-- This is the assessment round's whole mechanism. Under 20260828000100 the
-- stamp fired only when grade_level_id CHANGED, so re-confirming a child at the
-- grade they already hold — the commonest act of an assessment day — left
-- graded_at 90 days old and the child read as never assessed.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT lives_ok($$
  INSERT INTO student_skill_progress (tenant_id, student_id, skill_id, grade_level_id)
  SELECT tenant_id, student_id, skill_id, grade_level_id
    FROM student_skill_progress
   WHERE student_id='a7000000-0000-0000-0000-000000000001'
     AND skill_id  ='a4000000-0000-0000-0000-000000000001'
  ON CONFLICT (student_id, skill_id)
  DO UPDATE SET grade_level_id = EXCLUDED.grade_level_id
$$, 're-confirming an unchanged grade is accepted');

SELECT ok(
  (SELECT graded_at > NOW() - interval '1 day' FROM student_skill_progress
    WHERE student_id='a7000000-0000-0000-0000-000000000001'
      AND skill_id='a4000000-0000-0000-0000-000000000001'),
  're-confirming an UNCHANGED grade advances graded_at (20260829000100)');

SELECT is(
  (SELECT graded_by FROM student_skill_progress
    WHERE student_id='a7000000-0000-0000-0000-000000000001'
      AND skill_id='a4000000-0000-0000-0000-000000000001'),
  'a2000000-0000-0000-0000-0000000000a1'::uuid,
  're-confirming re-attributes graded_by to the confirming admin');

-- ── A BARE student_id REPOINT must PRESERVE both ────────────────────────────
-- The exact shape merge_students() uses when folding a duplicate: student_id
-- moves, the grade does not. The child's earned record must not be
-- re-attributed to whoever happened to run the merge. This is the guard against
-- the stamp condition over-reaching — without it, "stamp on every UPDATE" would
-- also pass every assertion above.
RESET ROLE;

ALTER TABLE student_skill_progress DISABLE TRIGGER trg_skill_progress_tenant;
UPDATE student_skill_progress
   SET graded_at = NOW() - interval '90 days',
       graded_by = 'a2000000-0000-0000-0000-0000000000a2'
 WHERE student_id = 'a7000000-0000-0000-0000-000000000001'
   AND skill_id   = 'a4000000-0000-0000-0000-000000000001';
ALTER TABLE student_skill_progress ENABLE TRIGGER trg_skill_progress_tenant;

UPDATE student_skill_progress
   SET student_id = 'a7000000-0000-0000-0000-000000000002'
 WHERE student_id = 'a7000000-0000-0000-0000-000000000001'
   AND skill_id   = 'a4000000-0000-0000-0000-000000000001';

SELECT ok(
  (SELECT graded_at < NOW() - interval '89 days' FROM student_skill_progress
    WHERE student_id='a7000000-0000-0000-0000-000000000002'
      AND skill_id='a4000000-0000-0000-0000-000000000001'),
  'a bare student_id repoint PRESERVES graded_at (merge_students'' contract)');

SELECT is(
  (SELECT graded_by FROM student_skill_progress
    WHERE student_id='a7000000-0000-0000-0000-000000000002'
      AND skill_id='a4000000-0000-0000-0000-000000000001'),
  'a2000000-0000-0000-0000-0000000000a2'::uuid,
  'a bare student_id repoint PRESERVES the original grader');

SELECT * FROM finish();
ROLLBACK;
