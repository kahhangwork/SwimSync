-- pgTAP: a child before their parent, and TRIALS AS BOOKINGS.
-- add_unclaimed_student(), book_trial(), trial_rates, student_settlements.
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
SELECT plan(34);

-- ── Two businesses, so the tenant boundary can be probed ───────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('66666666-0000-0000-0000-000000000001','trial-a','TRIAL Business A','SWIM-TRLA'),
  ('66666666-0000-0000-0000-000000000002','trial-b','TRIAL Business B','SWIM-TRLB');

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

-- ══ add_unclaimed_student: ONGOING ══════════════════════════════════════════
SET LOCAL ROLE authenticated;

-- 1. A PARENT cannot put a child on a roster.
SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Parent Made This','ongoing') $$,
  'not permitted to add a student to this class',
  'a PARENT cannot add an unclaimed student');

-- 2. A coach of ANOTHER BUSINESS cannot, even with a real class id. The
--    cross-tenant probe: pin_student_tenant() does not fire for a SECURITY
--    DEFINER writer (§7.42), so this gate is the whole boundary.
SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Cross Tenant Kid','ongoing') $$,
  'not permitted to add a student to this class',
  'a coach of ANOTHER business cannot add to this class');

-- 3. anon cannot.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Anon Kid','ongoing') $$,
  '42501', NULL, 'anon has no EXECUTE on add_unclaimed_student');
RESET ROLE;

-- 4. None of the three wrote a row. A gate that raises AFTER writing is not a gate.
SELECT is(
  (SELECT COUNT(*)::INT FROM students), (SELECT n FROM trial_baseline),
  'after THREE refusals, students has not grown');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- 5-9. The class's own coach CAN add an ongoing student, and its shape.
SELECT lives_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Ongoing Kid','ongoing') $$,
  'the CLASS''S OWN COACH can add an ONGOING unclaimed student');
SELECT is((SELECT tenant_id FROM students WHERE full_name='Ongoing Kid'),
  '66666666-0000-0000-0000-000000000001'::uuid,
  'pinned to the CLASS''s tenant — §7.42, nothing downstream would catch a wrong one');
SELECT is((SELECT created_by FROM students WHERE full_name='Ongoing Kid'),
  '66000000-0000-0000-0000-0000000000c1'::uuid,
  'created_by is the calling coach, not postgres');
SELECT is((SELECT COUNT(*)::INT FROM parent_students ps JOIN students s ON s.id=ps.student_id
            WHERE s.full_name='Ongoing Kid'), 0,
  'an unclaimed student has no parent link — that absence IS the definition');
SELECT is((SELECT e.is_active FROM student_class_enrolments e JOIN students s ON s.id=e.student_id
            WHERE s.full_name='Ongoing Kid'), TRUE,
  'an ONGOING student keeps an OPEN enrolment and so blocks the gate normally');

-- ══ TRIALS ARE BOOKINGS ═════════════════════════════════════════════════════

-- 10. A COACH may no longer create a trial. Schools arrange them at the admin,
--     and a private coach IS the admin.
SELECT throws_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Coach Trial','trial','2026-08-01'::date) $$,
  'only this business''s admin may book a trial',
  'a COACH cannot book a trial');

SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 11. The admin can, and it books AHEAD — 2026-08-01 is in the future relative
--     to nothing in particular; what matters is that no attendance is asserted.
SELECT lives_ok(
  $$ SELECT add_unclaimed_student('66666666-1111-0000-0000-000000000001','Trial Kid','trial','2026-08-01'::date) $$,
  'the ADMIN can create a child and book their trial');

-- 12-15. A booking is NOT an enrolment, NOT attendance, and NOT a session.
--        This is the whole correction: nothing about the outcome is claimed.
SELECT is((SELECT COUNT(*)::INT FROM student_class_enrolments e JOIN students s ON s.id=e.student_id
            WHERE s.full_name='Trial Kid'), 0,
  'a trial creates NO enrolment — it is a visit, not a standing arrangement');
SELECT is((SELECT COUNT(*)::INT FROM attendance a JOIN students s ON s.id=a.student_id
            WHERE s.full_name='Trial Kid'), 0,
  'a trial writes NO attendance — the coach marks it on the day');
SELECT is((SELECT COUNT(*)::INT FROM lesson_sessions
            WHERE class_id='66666666-1111-0000-0000-000000000001'), 0,
  'and NO lesson_sessions row — add_unclaimed_student is no longer its second writer (§7.43 retired)');
SELECT is((SELECT assignment_status::text FROM students WHERE full_name='Trial Kid'),
  'unassigned', 'a trial child is UNASSIGNED — being expected once is not placement');

-- 16. ⚠ THE CATEGORY IS SNAPSHOTTED. classes.category_id is mutable and money
--     depends on it; without this, re-tagging a class reprices trials already
--     taught (§7.7 through a new door).
SELECT is(
  (SELECT b.category_id FROM trial_bookings b JOIN students s ON s.id=b.student_id
    WHERE s.full_name='Trial Kid'),
  (SELECT id FROM class_categories WHERE tenant_id='66666666-0000-0000-0000-000000000001'
     AND lower(trim(name))='default group'),
  'the booking SNAPSHOTS the class''s category');

-- 17. A date the class does not run on is refused IN THE RPC. A booking on a
--     non-class day is never on any roster, never marked, and blocks the month
--     indefinitely with no visible cause.
SELECT throws_like(
  $$ SELECT book_trial('66666666-1111-0000-0000-000000000001','2026-08-04'::date,
       (SELECT id FROM students WHERE full_name='Trial Kid')) $$,
  '%runs on a saturday%tuesday%',
  'a Tuesday cannot be booked into a Saturday class');

-- 18-19. Cancel is SOFT, and the slot can then be re-booked. A plain unique
--        constraint would have made a cancelled booking block that slot forever.
SELECT lives_ok(
  $$ SELECT cancel_trial_booking((SELECT b.id FROM trial_bookings b
       JOIN students s ON s.id=b.student_id WHERE s.full_name='Trial Kid')) $$,
  'the admin can cancel a booking');
SELECT lives_ok(
  $$ SELECT book_trial('66666666-1111-0000-0000-000000000001','2026-08-01'::date,
       (SELECT id FROM students WHERE full_name='Trial Kid')) $$,
  'and the same slot can be RE-BOOKED — the unique index is partial');

-- 20. Two LIVE bookings for one slot are still refused.
SELECT throws_ok(
  $$ SELECT book_trial('66666666-1111-0000-0000-000000000001','2026-08-01'::date,
       (SELECT id FROM students WHERE full_name='Trial Kid')) $$,
  '23505', NULL, 'two live bookings for the same slot are refused');

-- 21. An ACTIVE enrolment blocks a trial — a trial is for a child not yet in a class.
SELECT throws_like(
  $$ SELECT book_trial('66666666-1111-0000-0000-000000000001','2026-08-08'::date,
       (SELECT id FROM students WHERE full_name='Ongoing Kid')) $$,
  '%already enrolled%',
  'a child with an ACTIVE enrolment cannot be booked for a trial');

-- 22. A CLOSED one does not — a family that left and is considering coming back
--     is a real trial.
UPDATE student_class_enrolments SET is_active = FALSE, unenrolled_at = NOW()
 WHERE student_id = (SELECT id FROM students WHERE full_name='Ongoing Kid');
SELECT lives_ok(
  $$ SELECT book_trial('66666666-1111-0000-0000-000000000001','2026-08-08'::date,
       (SELECT id FROM students WHERE full_name='Ongoing Kid')) $$,
  'a CLOSED enrolment does NOT block — a returning family can trial');

-- 23. A child of ANOTHER business cannot be booked into this one's class.
--     The tenant comes from the CLASS, so without this check an admin could
--     pull a stranger's child onto their own roster.
-- Seeded with RLS out of the way: admin A cannot (and must not) write into
-- business B. RESET ROLE / re-assume, the same dance the other fixtures do.
RESET ROLE;
INSERT INTO students (id, full_name, tenant_id)
VALUES ('66666666-2222-0000-0000-000000000001','B Kid','66666666-0000-0000-0000-000000000002');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT throws_like(
  $$ SELECT book_trial('66666666-1111-0000-0000-000000000001','2026-08-15'::date,
       '66666666-2222-0000-0000-000000000001') $$,
  '%another business%',
  'a child of ANOTHER business cannot be booked into this class');

-- ══ TRIAL RATES ═════════════════════════════════════════════════════════════

-- 24. Insert-only: there is no UPDATE and no DELETE policy, which is what makes
--     "a price change is a new row" true rather than merely intended.
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_policies
    WHERE tablename='trial_rates' AND cmd IN ('UPDATE','DELETE')),
  0, 'trial_rates has no UPDATE or DELETE policy — effective-dated, insert-only');

-- 25. The owning admin can set a rate.
SELECT lives_ok(
  $$ INSERT INTO trial_rates (tenant_id, category_id, rate, effective_from, created_by)
     VALUES ('66666666-0000-0000-0000-000000000001',
             (SELECT id FROM class_categories WHERE tenant_id='66666666-0000-0000-0000-000000000001'
                AND lower(trim(name))='default group'),
             25.00, '2026-01-01', '66000000-0000-0000-0000-0000000000a1') $$,
  'the owning admin can set a trial rate');

-- 26. A category from ANOTHER business is refused. The RLS policy checks
--     tenant_id and cannot see whether the CATEGORY belongs to it.
SELECT throws_like(
  $$ INSERT INTO trial_rates (tenant_id, category_id, rate, effective_from, created_by)
     VALUES ('66666666-0000-0000-0000-000000000001',
             (SELECT id FROM class_categories WHERE tenant_id='66666666-0000-0000-0000-000000000002'
                AND lower(trim(name))='default group'),
             25.00, '2026-01-01', '66000000-0000-0000-0000-0000000000a1') $$,
  '%another business%',
  'a rate scoped to ANOTHER business''s category is refused');

-- 27. A $0 rate is refused. A free trial is the trial_free STATUS, not a $0 price.
SELECT throws_ok(
  $$ INSERT INTO trial_rates (tenant_id, category_id, rate, effective_from, created_by)
     VALUES ('66666666-0000-0000-0000-000000000001',
             (SELECT id FROM class_categories WHERE tenant_id='66666666-0000-0000-0000-000000000001'
                AND lower(trim(name))='default group'),
             0, '2026-01-01', '66000000-0000-0000-0000-0000000000a1') $$,
  '23514', NULL, 'a $0 trial rate is refused by the DB');

-- 28-29. trial_rate_on picks the rate in force ON THE LESSON'S OWN DATE.
INSERT INTO trial_rates (tenant_id, category_id, rate, effective_from, created_by)
VALUES ('66666666-0000-0000-0000-000000000001',
        (SELECT id FROM class_categories WHERE tenant_id='66666666-0000-0000-0000-000000000001'
           AND lower(trim(name))='default group'),
        40.00, '2026-06-01', '66000000-0000-0000-0000-0000000000a1');
SELECT is(
  trial_rate_on((SELECT id FROM class_categories WHERE tenant_id='66666666-0000-0000-0000-000000000001'
                   AND lower(trim(name))='default group'), '2026-03-01'::date),
  25.00::numeric, 'a lesson BEFORE the raise keeps the old rate');
SELECT is(
  trial_rate_on((SELECT id FROM class_categories WHERE tenant_id='66666666-0000-0000-0000-000000000001'
                   AND lower(trim(name))='default group'), '2026-08-01'::date),
  40.00::numeric, 'a lesson after it gets the new one');

-- 30. A category with no rate returns NULL, which the engine reads as "fall
--     back to the class rate" — NOT as zero.
SELECT is(
  trial_rate_on((SELECT id FROM class_categories WHERE tenant_id='66666666-0000-0000-0000-000000000001'
                   AND lower(trim(name))='default private'), '2026-08-01'::date),
  NULL::numeric, 'an unpriced category returns NULL, not 0');

-- 31. Deleting a category that has rates is REFUSED. These rows price PAST
--     lessons; letting them vanish would reprice unbilled trials.
SELECT throws_ok(
  $$ DELETE FROM class_categories WHERE tenant_id='66666666-0000-0000-0000-000000000001'
       AND lower(trim(name))='default group' $$,
  '23503', NULL,
  'a category with trial rates cannot be deleted (ON DELETE RESTRICT)');

-- 32. And classes.category_id is RESTRICT, not SET NULL. Asserted structurally
--     rather than by attempting a delete: SET NULL against a NOT NULL column
--     fails with a null violation naming a column the admin never touched,
--     which is a confusing error rather than a correct refusal.
--     confdeltype: 'r' = RESTRICT, 'n' = SET NULL.
SELECT is(
  (SELECT confdeltype FROM pg_constraint WHERE conname = 'classes_category_id_fkey'),
  'r'::"char",
  'classes.category_id is ON DELETE RESTRICT — a category with classes cannot be deleted');

-- ══ SETTLEMENTS (unchanged by this work, still pinned) ══════════════════════

-- 33. A COACH cannot record a settlement — admin only.
SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
SELECT throws_ok(
  $$ INSERT INTO student_settlements (tenant_id, student_id, settled_through, kind, amount, recorded_by)
     VALUES ('66666666-0000-0000-0000-000000000001',
             (SELECT id FROM students WHERE full_name='Trial Kid'),
             '2026-08-01','paid_outside',30,'66000000-0000-0000-0000-0000000000c1') $$,
  '42501', NULL, 'a COACH cannot record a settlement');

-- 34. The owning admin can.
SET LOCAL "request.jwt.claims" TO '{"sub":"66000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT lives_ok(
  $$ INSERT INTO student_settlements (tenant_id, student_id, settled_through, kind, amount, recorded_by)
     VALUES ('66666666-0000-0000-0000-000000000001',
             (SELECT id FROM students WHERE full_name='Trial Kid'),
             '2026-08-01','paid_outside',30,'66000000-0000-0000-0000-0000000000a1') $$,
  'the owning business admin CAN record a settlement');

ROLLBACK;
