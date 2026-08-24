-- pgTAP: merging a duplicate child into the one that holds the history.
--
-- WHY THIS FILE IS MOSTLY REFUSALS. merge_students() ends in a DELETE, and it
-- is the only function in the codebase that repoints a child's records. Every
-- refusal below is a case where the right answer is "a human must look at
-- this", and each one asserts that `students` DID NOT SHRINK — a gate that
-- raises after deleting is not a gate.
--
-- ⚠ ASSERTIONS 15-17 ARE THE ONES THAT WOULD HAVE CAUGHT THE REAL BUG.
-- BACKLOG.md asserted for months that only parent_students cascaded from
-- students, and that therefore "a mis-aimed merge cannot destroy anything".
-- That sentence was ALREADY FALSE when it was written: student_settlements and
-- trial_bookings had been added by the trial work in the same session, both
-- ON DELETE CASCADE. A merge written against the documented list would have
-- silently destroyed a trial booking and a SETTLEMENT — and a settlement is
-- recorded revenue that cannot ride the invoice rails at all.
--
-- So the guard is not a list in a comment. Assertion 18 adds a NEW cascading
-- foreign key at runtime and proves the function REFUSES rather than eating
-- the rows it has not been taught about.
--
-- METHOD (§7.16): every probe runs inside this explicit transaction with
-- SET LOCAL ROLE, or the session stays superuser and the refusals all "pass".

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(20);

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('4e211111-0000-0000-0000-000000000001','merge-a','MERGE Business A','SWIM-MRGA'),
  ('4e211111-0000-0000-0000-000000000002','merge-b','MERGE Business B','SWIM-MRGB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','4e200000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','merge-admin-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"MERGE Admin A","role":"tenant_admin","tenant_id":"4e211111-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','4e200000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','merge-admin-b@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"MERGE Admin B","role":"tenant_admin","tenant_id":"4e211111-0000-0000-0000-000000000002"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','4e200000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','merge-coach-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"MERGE Coach A","role":"coach","tenant_id":"4e211111-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','4e200000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','merge-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"MERGE Parent","role":"parent"}', now(), now(), '', '', '', '');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '4e211111-0000-0000-0000-000000000001'
  FROM parents p JOIN profiles pr ON pr.id = p.profile_id
 WHERE pr.email = 'merge-parent@test.local';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('4e2cccc0-0000-0000-0000-000000000001','4e211111-0000-0000-0000-000000000001','Default Group'),
  ('4e2cccc0-0000-0000-0000-000000000002','4e211111-0000-0000-0000-000000000002','Default Group');

-- classes.location_id is NOT NULL since the location contract migration
-- (20260824000200). Give every tenant one location to hang classes off,
-- tenant-agnostic and idempotent (mirrors the Default Group category block).
INSERT INTO locations (tenant_id, name)
SELECT t.id, 'Default location' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM locations l
    WHERE l.tenant_id = t.id AND lower(trim(l.name)) = 'default location');

INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time,
                     location_id, price_per_lesson, category_id)
VALUES ('4e255555-0000-0000-0000-000000000001','4e211111-0000-0000-0000-000000000001',
  (SELECT id FROM coaches WHERE profile_id='4e200000-0000-0000-0000-0000000000c1'),
  'MERGE Class A','saturday','10:00','11:00',
  (SELECT l.id FROM locations l WHERE l.tenant_id = '4e211111-0000-0000-0000-000000000001'
      AND lower(trim(l.name)) = 'default location'), 30,
  '4e2cccc0-0000-0000-0000-000000000001');

-- ── The pair that will actually merge ──────────────────────────────────────
-- SURVIVOR holds the history and has NO date of birth (the usual coach-added
-- shape). DUPLICATE is the row the parent created: no attendance, but it holds
-- the parent link, a live trial booking and a settlement — all three of which
-- CASCADE, and so would vanish silently on a naive delete.
INSERT INTO students (id, full_name, date_of_birth, gender, notes, tenant_id,
                      assignment_status, is_active)
VALUES
  ('4e299999-0000-0000-0000-000000000001','Ethan Tan', NULL, NULL, 'Coach note kept',
   '4e211111-0000-0000-0000-000000000001','unassigned', TRUE),
  ('4e299999-0000-0000-0000-000000000002','Ethan Tan Wei Ming','2019-01-01','male','Parent note',
   '4e211111-0000-0000-0000-000000000001','unassigned', TRUE),
  -- A pair that BOTH carry attendance — the "needs a human" case.
  ('4e299999-0000-0000-0000-000000000003','Both Marked One','2018-02-02', NULL, NULL,
   '4e211111-0000-0000-0000-000000000001','unassigned', TRUE),
  ('4e299999-0000-0000-0000-000000000004','Both Marked Two','2018-03-03', NULL, NULL,
   '4e211111-0000-0000-0000-000000000001','unassigned', TRUE),
  -- A duplicate carrying an invoice item.
  ('4e299999-0000-0000-0000-000000000005','Invoiced Dup','2018-04-04', NULL, NULL,
   '4e211111-0000-0000-0000-000000000001','unassigned', TRUE),
  -- Another business entirely.
  ('4e299999-0000-0000-0000-000000000006','Other Business Kid','2018-05-05', NULL, NULL,
   '4e211111-0000-0000-0000-000000000002','unassigned', TRUE);

INSERT INTO lesson_sessions (id, class_id, session_date) VALUES
  ('4e277777-0000-0000-0000-000000000001','4e255555-0000-0000-0000-000000000001','2026-07-04'),
  ('4e277777-0000-0000-0000-000000000002','4e255555-0000-0000-0000-000000000001','2026-07-11');

INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('4e277777-0000-0000-0000-000000000001','4e299999-0000-0000-0000-000000000001',
   'present','4e200000-0000-0000-0000-0000000000c1'),
  ('4e277777-0000-0000-0000-000000000001','4e299999-0000-0000-0000-000000000003',
   'present','4e200000-0000-0000-0000-0000000000c1'),
  ('4e277777-0000-0000-0000-000000000002','4e299999-0000-0000-0000-000000000004',
   'present','4e200000-0000-0000-0000-0000000000c1');

-- The duplicate's three CASCADING attachments.
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '4e299999-0000-0000-0000-000000000002'
  FROM parents p JOIN profiles pr ON pr.id = p.profile_id
 WHERE pr.email = 'merge-parent@test.local';

INSERT INTO trial_bookings (tenant_id, student_id, class_id, session_date, category_id, booked_by)
VALUES ('4e211111-0000-0000-0000-000000000001','4e299999-0000-0000-0000-000000000002',
        '4e255555-0000-0000-0000-000000000001','2026-08-01',
        '4e2cccc0-0000-0000-0000-000000000001','4e200000-0000-0000-0000-0000000000a1');

INSERT INTO student_settlements (tenant_id, student_id, settled_through, kind, amount, recorded_by)
VALUES ('4e211111-0000-0000-0000-000000000001','4e299999-0000-0000-0000-000000000002',
        '2026-07-31','paid_outside', 40.00,'4e200000-0000-0000-0000-0000000000a1');

-- An invoice covering the "invoiced duplicate".
INSERT INTO invoices (id, parent_id, billing_month, gross_amount, credit_applied, net_amount, tenant_id)
SELECT '4e2ffff0-0000-0000-0000-000000000001', p.id, '2026-06', 30, 0, 30,
       '4e211111-0000-0000-0000-000000000001'
  FROM parents p JOIN profiles pr ON pr.id = p.profile_id
 WHERE pr.email = 'merge-parent@test.local';

INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status,
                           amount, class_title, session_date)
VALUES ('4e2ffff0-0000-0000-0000-000000000001','4e299999-0000-0000-0000-000000000005',
        '4e277777-0000-0000-0000-000000000001','present', 30,'MERGE Class A','2026-07-04');

-- ⚠ SCOPED TO TENANT A, because the assertions below read these counts while
-- acting as tenant A's ADMIN — and RLS scopes what that admin can see. Taken
-- globally (as postgres does here) the baseline would include business B's
-- child and every seed row, and assertion 9 would fail by exactly that
-- difference while nothing was wrong.
CREATE TEMP TABLE merge_baseline AS
SELECT (SELECT count(*)::INT FROM students
         WHERE tenant_id = '4e211111-0000-0000-0000-000000000001')            AS students,
       (SELECT count(*)::INT FROM trial_bookings
         WHERE tenant_id = '4e211111-0000-0000-0000-000000000001')            AS bookings,
       (SELECT count(*)::INT FROM student_settlements
         WHERE tenant_id = '4e211111-0000-0000-0000-000000000001')            AS settlements;

-- The baseline is created as `postgres` but read from inside `SET LOCAL ROLE
-- authenticated` blocks below, so it needs an explicit grant. Without it the
-- assertions fail with "permission denied for table merge_baseline", which
-- looks like a merge bug and is not one.
GRANT SELECT ON merge_baseline TO authenticated;

-- ══ Refusals ══════════════════════════════════════════════════════════════
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT * FROM merge_students('4e299999-0000-0000-0000-000000000001',
                                  '4e299999-0000-0000-0000-000000000002') $$,
  '42501', NULL, 'anon has no EXECUTE on merge_students');
RESET ROLE;

SET LOCAL ROLE authenticated;

-- 2. A parent cannot merge two children, even their own.
SET LOCAL "request.jwt.claims" TO '{"sub":"4e200000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM merge_students('4e299999-0000-0000-0000-000000000001',
                                  '4e299999-0000-0000-0000-000000000002') $$,
  'only this business''s admin may merge two children',
  'a PARENT cannot merge two children');

-- 3. Nor can another business's admin.
SET LOCAL "request.jwt.claims" TO '{"sub":"4e200000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM merge_students('4e299999-0000-0000-0000-000000000001',
                                  '4e299999-0000-0000-0000-000000000002') $$,
  'only this business''s admin may merge two children',
  'another business''s admin cannot merge this business''s children');

SET LOCAL "request.jwt.claims" TO '{"sub":"4e200000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 4. The same child twice.
SELECT throws_ok(
  $$ SELECT * FROM merge_students('4e299999-0000-0000-0000-000000000001',
                                  '4e299999-0000-0000-0000-000000000001') $$,
  'those are the same child', 'a child cannot be merged into themselves');

-- 5. Across the tenant boundary.
SELECT throws_ok(
  $$ SELECT * FROM merge_students('4e299999-0000-0000-0000-000000000001',
                                  '4e299999-0000-0000-0000-000000000006') $$,
  'those two children belong to different businesses',
  'two children of DIFFERENT businesses cannot be merged');

-- 6. Both carry attendance — the case that genuinely needs a person.
SELECT throws_ok(
  $$ SELECT * FROM merge_students('4e299999-0000-0000-0000-000000000003',
                                  '4e299999-0000-0000-0000-000000000004') $$,
  'Both children have lessons recorded (1 and 1). Merging would move attendance off a real record — this one needs to be sorted out by hand.',
  'two children who BOTH have lessons recorded cannot be merged');

-- 7. Wrong way round: refuse rather than silently swapping. Repointing
--    attendance is the dangerous half, so the direction is explicit.
SELECT throws_ok(
  $$ SELECT * FROM merge_students('4e299999-0000-0000-0000-000000000002',
                                  '4e299999-0000-0000-0000-000000000001') $$,
  'The child you marked as the duplicate is the one with 1 lessons recorded. Swap them: the record with the history must be the one that survives.',
  'the survivor must be the row holding the history — the wrong direction is refused');

-- 8. Money already documented against the duplicate.
SELECT throws_ok(
  $$ SELECT * FROM merge_students('4e299999-0000-0000-0000-000000000001',
                                  '4e299999-0000-0000-0000-000000000005') $$,
  'The duplicate record already appears on an invoice or credit note, so it cannot be deleted. Sort this one out by hand.',
  'a duplicate that appears on an invoice cannot be deleted');

-- 9. Nothing was destroyed by any of those seven refusals.
SELECT is(
  (SELECT count(*)::INT FROM students), (SELECT students FROM merge_baseline),
  'after SEVEN refusals, students has not shrunk');

-- ══ 10. The unknown-cascade guard (RISK 4) ════════════════════════════════
-- Add a NEW cascading foreign key into students, exactly as a future feature
-- would, and prove the merge REFUSES instead of silently deleting its rows.
-- This is the assertion that would have caught the real bug.
-- Created as postgres: `authenticated` has no CREATE on schema public, which is
-- correct and not what this assertion is about.
RESET ROLE;
CREATE TABLE zz_future_cascade (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE
);
SET LOCAL ROLE authenticated;

SELECT throws_like(
  $$ SELECT * FROM merge_students('4e299999-0000-0000-0000-000000000001',
                                  '4e299999-0000-0000-0000-000000000002') $$,
  '%has not been taught to move zz_future_cascade%',
  '⚠ an UNKNOWN cascading foreign key makes the merge refuse, not eat the rows');

RESET ROLE;
DROP TABLE zz_future_cascade;
SET LOCAL ROLE authenticated;

-- ══ The merge itself ══════════════════════════════════════════════════════
SELECT is(
  (SELECT (moved_parent_links, moved_trial_bookings, moved_settlements)
     FROM merge_students('4e299999-0000-0000-0000-000000000001',
                         '4e299999-0000-0000-0000-000000000002')),
  (1, 1, 1), 'the merge reports moving the link, the booking and the settlement');

SELECT is(
  (SELECT count(*)::INT FROM parent_students
    WHERE student_id = '4e299999-0000-0000-0000-000000000001'),
  1, 'the parent link now points at the survivor');

SELECT is(
  (SELECT count(*)::INT FROM trial_bookings
    WHERE student_id = '4e299999-0000-0000-0000-000000000001'),
  1, 'the trial booking moved to the survivor');

SELECT is(
  (SELECT count(*)::INT FROM student_settlements
    WHERE student_id = '4e299999-0000-0000-0000-000000000001'),
  1, 'the settlement moved to the survivor');

-- 15-16. ⚠ NOTHING WAS DESTROYED. The counts are global on purpose: a row that
--        moved is still there, a row that cascaded is not.
SELECT is(
  (SELECT count(*)::INT FROM trial_bookings), (SELECT bookings FROM merge_baseline),
  '⚠ the trial booking was MOVED, not destroyed — global count unchanged');

SELECT is(
  (SELECT count(*)::INT FROM student_settlements), (SELECT settlements FROM merge_baseline),
  '⚠ the settlement was MOVED, not destroyed — a settlement is recorded revenue');

-- 17. The survivor keeps what the business recorded and gains what it lacked.
SELECT is(
  (SELECT (date_of_birth, gender::text, notes) FROM students
    WHERE id = '4e299999-0000-0000-0000-000000000001'),
  ('2019-01-01'::date, 'male'::text, 'Coach note kept'::text),
  'the survivor gains the missing dob and gender, and KEEPS its own note');

SELECT is(
  (SELECT count(*)::INT FROM students WHERE id = '4e299999-0000-0000-0000-000000000002'),
  0, 'the emptied duplicate is gone');

-- 19. The deleted row survives in the audit log — the last line of defence.
SELECT is(
  (SELECT (old_value->>'full_name') FROM audit_log
    WHERE action = 'students_merged'
      AND entity_id = '4e299999-0000-0000-0000-000000000001'),
  'Ethan Tan Wei Ming',
  'the deleted duplicate''s contents are written to audit_log before the delete');

-- 20. The survivor's own attendance is untouched throughout.
SELECT is(
  (SELECT count(*)::INT FROM attendance
    WHERE student_id = '4e299999-0000-0000-0000-000000000001'),
  1, 'the survivor''s attendance is untouched');

SELECT * FROM finish();
ROLLBACK;
