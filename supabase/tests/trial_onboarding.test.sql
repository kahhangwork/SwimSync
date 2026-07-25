-- pgTAP: adding a child before their parent has an account —
-- add_unclaimed_student(), and the student_settlements boundary.
--
-- WHY THE AUTHORIZATION ASSERTIONS DOMINATE. add_unclaimed_student() is
-- SECURITY DEFINER, so it bypasses RLS entirely and its own caller check is
-- the WHOLE boundary. Worse than most: pin_student_tenant() (20260719001500)
-- deliberately exempts SECURITY DEFINER writers — its seam is `current_user`,
-- and this function runs as postgres — so the trigger that normally stops a
-- student being written into the wrong business will NOT fire here. Confirmed
-- empirically in the phase 0 spike: inside SECURITY DEFINER, auth.uid() is the
-- caller while current_user is postgres.
--
-- That is why `tenant_id` is derived from the class rather than passed, and
-- why test 6 below is the most important assertion in this file.
--
-- METHOD (gotcha §7.16): every probe runs inside this explicit transaction
-- with SET LOCAL ROLE. Outside one, SET LOCAL ROLE is a no-op, the session
-- stays superuser, RLS is bypassed and every assertion "passes" — including
-- the ones that must fail. Each refusal also asserts that `students` DID NOT
-- GROW: a gate that raises after writing is not a gate.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(32);

-- ── Two businesses, so the tenant boundary can be probed ───────────────────
INSERT INTO tenants (id, slug, display_name, kind, join_code) VALUES
  ('66666666-0000-0000-0000-000000000001','trial-a','TRIAL Business A','school','SWIM-TRLA'),
  ('66666666-0000-0000-0000-000000000002','trial-b','TRIAL Business B','school','SWIM-TRLB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','66000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','trial-admin-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"TRIAL Admin A","role":"tenant_admin","tenant_id":"66666666-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','66000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','trial-coach-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"TRIAL Coach A","role":"coach","tenant_id":"66666666-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','66000000-0000-0000-0000-0000000000c2',
   'authenticated','authenticated','trial-coach-b@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"TRIAL Coach B","role":"coach","tenant_id":"66666666-0000-0000-0000-000000000002"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','66000000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','trial-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"TRIAL Parent","role":"parent"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','66000000-0000-0000-0000-0000000000d2',
   'authenticated','authenticated','trial-parent2@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"TRIAL Parent Two","role":"parent"}', now(), now(), '', '', '', '');

-- Class A belongs to business A and its coach; class B to business B.
-- classes.category_id is NOT NULL (20260725000400). A test creates its own
-- tenants inside this transaction, so they have none of the categories the
-- migration backfilled onto pre-existing ones — give every tenant a Default
-- Group to hang classes off. Idempotent, and deliberately tenant-agnostic so
-- this block is identical in every fixture.
INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM class_categories c
    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
VALUES
  ('66666666-1111-0000-0000-000000000001','66666666-0000-0000-0000-000000000001',
   (SELECT id FROM coaches WHERE profile_id='66000000-0000-0000-0000-0000000000c1'),
   'TRIAL Class A','saturday','10:00','11:00','Pool A', 30,
   (SELECT id FROM class_categories WHERE tenant_id='66666666-0000-0000-0000-000000000001' AND lower(trim(name))='default group')),
  ('66666666-1111-0000-0000-000000000002','66666666-0000-0000-0000-000000000002',
   (SELECT id FROM coaches WHERE profile_id='66000000-0000-0000-0000-0000000000c2'),
   'TRIAL Class B','saturday','10:00','11:00','Pool B', 30,
   (SELECT id FROM class_categories WHERE tenant_id='66666666-0000-0000-0000-000000000002' AND lower(trim(name))='default group'));

CREATE TEMP TABLE trial_baseline AS SELECT COUNT(*)::INT AS n FROM students;

-- ══ REFUSALS ════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;

-- 1. A PARENT cannot put a child on a roster.
SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Parent Made This','ongoing') $$,
  'not permitted to add a student to this class',
  'a PARENT cannot add an unclaimed student');

-- 2. A coach of ANOTHER BUSINESS cannot, even with a real class id.
--    This is the cross-tenant probe: pin_student_tenant() will not catch it.
SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Cross Tenant Kid','ongoing') $$,
  'not permitted to add a student to this class',
  'a coach of ANOTHER business cannot add to this class');

-- 3. anon cannot.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Anon Kid','ongoing') $$,
  '42501', NULL,
  'anon has no EXECUTE on add_unclaimed_student');
RESET ROLE;

-- 4. THE LOAD-BEARING REFUSAL ASSERTION: none of the three wrote a row.
--    A gate that raises AFTER writing is not a gate.
SELECT is(
  (SELECT COUNT(*)::INT FROM students),
  (SELECT n FROM trial_baseline),
  'after THREE refusals, students has not grown — the gate refuses BEFORE writing');

-- ══ THE HAPPY PATHS ═════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;

-- 5. The OWNING business admin can add one (students_insert already allowed
--    this; the RPC must not have narrowed it).
SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT lives_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Admin A Kid','ongoing') $$,
  'the OWNING business admin CAN add an unclaimed student');

SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- 6. The class's own coach can add an ongoing student.
SELECT lives_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Ongoing Kid','ongoing') $$,
  'the CLASS''S OWN COACH can add an unclaimed student');

-- 6. ⚠ THE LOAD-BEARING ONE. tenant_id comes from the CLASS, and nothing
--    downstream would catch it if it did not.
SELECT is(
  (SELECT tenant_id FROM students WHERE full_name = 'Ongoing Kid'),
  '66666666-0000-0000-0000-000000000001'::uuid,
  'the student is pinned to the CLASS''s tenant, not the caller''s input');

-- 7. created_by is the CALLING COACH. This is what keeps a trial student
--    visible after their enrolment closes — coach_serves_student() requires an
--    ACTIVE enrolment, so without this the coach loses sight of the child they
--    just marked.
SELECT is(
  (SELECT created_by FROM students WHERE full_name = 'Ongoing Kid'),
  '66000000-0000-0000-0000-0000000000c1'::uuid,
  'created_by is the calling coach, not postgres');

-- 8. An unclaimed student has NO parent link. That absence is the definition.
SELECT is(
  (SELECT COUNT(*)::INT FROM parent_students ps
    JOIN students s ON s.id = ps.student_id WHERE s.full_name = 'Ongoing Kid'),
  0, 'an unclaimed student has no parent_students row');

-- 9. An ONGOING enrolment is open — they attend weekly and must be marked.
SELECT is(
  (SELECT e.is_active FROM student_class_enrolments e
    JOIN students s ON s.id = e.student_id WHERE s.full_name = 'Ongoing Kid'),
  TRUE, 'an ongoing unclaimed student keeps an OPEN enrolment');

-- ── The trial shape ─────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Walk In Kid','trial',
       '2026-08-01'::date, 'trial_paid'::attendance_status) $$,
  'a coach can add AND mark a trial walk-in in one call');

-- 10. The trial enrolment is CLOSED on its own date, so it can never block the
--     completeness gate on a later lesson.
SELECT is(
  (SELECT e.is_active FROM student_class_enrolments e
    JOIN students s ON s.id = e.student_id WHERE s.full_name = 'Walk In Kid'),
  FALSE, 'a trial enrolment is closed immediately');
SELECT is(
  (SELECT e.unenrolled_at::date FROM student_class_enrolments e
    JOIN students s ON s.id = e.student_id WHERE s.full_name = 'Walk In Kid'),
  '2026-08-01'::date, 'closed on the SESSION''s date, not today');

-- 11. The attendance row exists, and marked_by is a PROFILE id (§7.2).
SELECT is(
  (SELECT a.status::text FROM attendance a
    JOIN students s ON s.id = a.student_id WHERE s.full_name = 'Walk In Kid'),
  'trial_paid', 'the trial attendance row was written');
SELECT is(
  (SELECT a.marked_by FROM attendance a
    JOIN students s ON s.id = a.student_id WHERE s.full_name = 'Walk In Kid'),
  '66000000-0000-0000-0000-0000000000c1'::uuid,
  'marked_by is the coach''s PROFILE id, not coaches.id');

-- 12. ⚠ IDEMPOTENCY (RISK 4). This function is the SECOND writer of
--     lesson_sessions. A duplicate (class, date) row double-bills a whole
--     class — that shipped once already (§7.7). A second trial on the SAME
--     date must reuse the SAME session.
SELECT lives_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Second Walk In','trial',
       '2026-08-01'::date, 'trial_free'::attendance_status) $$,
  'a second walk-in on the same date is fine');
SELECT is(
  (SELECT COUNT(*)::INT FROM lesson_sessions
    WHERE class_id = '66666666-1111-0000-0000-000000000001' AND session_date = '2026-08-01'),
  1, 'TWO walk-ins on one date share ONE lesson_sessions row — no double-billing');

-- 13. A trial without its date/status is refused rather than guessed.
SELECT throws_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','No Date Kid','trial') $$,
  'a trial needs the session date and an attendance status',
  'a trial without a date is refused, not defaulted to today');

-- 14. ⚠ RISK 8: a duplicate name + DOB gets a PLAIN explanation, not SQLSTATE
--     23505 surfacing raw at the poolside (PRD §5.1).
SELECT lives_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Ethan Tan','ongoing',
       NULL, NULL, '2018-03-04'::date) $$,
  'first Ethan Tan is added');
SELECT throws_like(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Ethan Tan','ongoing',
       NULL, NULL, '2018-03-04'::date) $$,
  '%already registered with this business%',
  'a duplicate name+DOB is explained in plain words, not a raw constraint error');

-- ══ SETTLEMENTS ═════════════════════════════════════════════════════════════

-- 15. A COACH cannot record a settlement — admin only, by the user's decision.
SELECT throws_ok(
  $$ INSERT INTO student_settlements (tenant_id, student_id, settled_through, kind, amount, recorded_by)
     VALUES ('66666666-0000-0000-0000-000000000001',
             (SELECT id FROM students WHERE full_name='Walk In Kid'),
             '2026-08-01','paid_outside',30,'66000000-0000-0000-0000-0000000000c1') $$,
  '42501', NULL,
  'a COACH cannot record a settlement');

-- 16. The owning admin can.
SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT lives_ok(
  $$ INSERT INTO student_settlements (tenant_id, student_id, settled_through, kind, amount, recorded_by)
     VALUES ('66666666-0000-0000-0000-000000000001',
             (SELECT id FROM students WHERE full_name='Walk In Kid'),
             '2026-08-01','paid_outside',30,'66000000-0000-0000-0000-0000000000a1') $$,
  'the owning business admin CAN record a settlement');

-- 17. Cross-tenant: admin A cannot settle against business B.
SELECT throws_ok(
  $$ INSERT INTO student_settlements (tenant_id, student_id, settled_through, kind, amount, recorded_by)
     VALUES ('66666666-0000-0000-0000-000000000002',
             (SELECT id FROM students WHERE full_name='Walk In Kid'),
             '2026-08-01','paid_outside',30,'66000000-0000-0000-0000-0000000000a1') $$,
  '42501', NULL,
  'an admin cannot record a settlement against ANOTHER business');

-- 18. There is deliberately no DELETE policy — a settlement is reversed, not
--     removed, so the record of the decision survives.
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_policies
    WHERE tablename = 'student_settlements' AND cmd = 'DELETE'),
  0, 'settlements have no DELETE policy — reversal is an UPDATE');

-- ══ CLAIMING — link_invited_parent() ════════════════════════════════════════
-- The claim is what makes "adopt, don't merge" true: it moves nothing. The
-- coach's student row IS the student row; this only makes it visible, and
-- billable, to a parent who now exists.

-- 19. A COACH cannot link a parent to a child, even their own student. This
--     decides who can see a family's attendance and billing history.
SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT link_invited_parent('66000000-0000-0000-0000-0000000000d1'::uuid,
       (SELECT id FROM students WHERE full_name='Ongoing Kid')) $$,
  'only this business''s admin may link a parent to this child',
  'a COACH cannot link a parent to a child');

-- 20. The owning admin can, and it writes BOTH links in one transaction.
SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT lives_ok(
  $$ SELECT link_invited_parent('66000000-0000-0000-0000-0000000000d1'::uuid,
       (SELECT id FROM students WHERE full_name='Ongoing Kid')) $$,
  'the owning business admin CAN link a parent');

SELECT is(
  (SELECT COUNT(*)::INT FROM parent_students ps
     JOIN students s ON s.id = ps.student_id
    WHERE s.full_name = 'Ongoing Kid'),
  1, 'the child now has a parent — they are CLAIMED');

-- 21. Membership too. handle_new_user() does not create parent_tenants (parents
--     are global and normally redeem a join code), so an invited parent would
--     otherwise hold a child in a business they are not a member of.
SELECT is(
  (SELECT COUNT(*)::INT FROM parent_tenants pt
     JOIN parents p ON p.id = pt.parent_id
    WHERE p.profile_id = '66000000-0000-0000-0000-0000000000d1'
      AND pt.tenant_id = '66666666-0000-0000-0000-000000000001'),
  1, 'the parent is also made a MEMBER of the business');

-- 22. THE ADOPTION PROPERTY: nothing moved. The attendance marked before the
--     parent existed still points at the same student, and is now theirs.
SELECT is(
  (SELECT COUNT(*)::INT FROM attendance a
     JOIN students s ON s.id = a.student_id
     JOIN parent_students ps ON ps.student_id = s.id
     JOIN parents p ON p.id = ps.parent_id
    WHERE p.profile_id = '66000000-0000-0000-0000-0000000000d1'
      AND s.full_name = 'Walk In Kid'),
  0, 'linking one child does not sweep in another coach-added child');

-- 23. Re-linking the SAME parent is a no-op. An invite resent, or an admin
--     clicking twice, must not error — nothing about the desired state differs.
SELECT lives_ok(
  $$ SELECT link_invited_parent('66000000-0000-0000-0000-0000000000d1'::uuid,
       (SELECT id FROM students WHERE full_name='Ongoing Kid')) $$,
  'linking the SAME parent twice is idempotent');
SELECT is(
  (SELECT COUNT(*)::INT FROM parent_students ps
     JOIN students s ON s.id = ps.student_id WHERE s.full_name = 'Ongoing Kid'),
  1, 'and it did not create a second link');

-- 24. A DIFFERENT parent is REFUSED. These two cases are deliberately split:
--     collapsing them into one "already has a parent" refusal breaks the
--     harmless case above, and collapsing them the other way would silently
--     attach a stranger to an existing family.
SELECT throws_ok(
  $$ SELECT link_invited_parent('66000000-0000-0000-0000-0000000000d2'::uuid,
       (SELECT id FROM students WHERE full_name='Ongoing Kid')) $$,
  'that child is already linked to a different parent account',
  'a DIFFERENT parent cannot be attached to a claimed child');

ROLLBACK;
