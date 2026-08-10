-- pgTAP: multiple classes per child — Wave 2 (20260811000100).
--
-- What is pinned here, in order of blast radius:
--   • book_makeup()'s home class is NAMED by the admin once a child has more
--     than one, and the NAMED class is what gets snapshotted onto the booking.
--     That snapshot is money twice over: it prices the make-up line
--     (core.ts:896 via rateOn) and it decides package coverage (core.ts:1205).
--     Before this wave the function derived it with a plain SELECT INTO whose
--     determinism came entirely from one_active_enrolment_per_student.
--   • book_makeup() refuses EVERY class the child is actively in, not just the
--     one named as home. Booking a make-up into the child's OTHER class is not
--     a billing bug — enrolment-wins (core.ts:940) prices it correctly as a
--     member — it SILENTLY VOIDS the make-up: the child attends the lesson they
--     were already attending and receives nothing replacing the missed one,
--     while the Makeups page reports the booking as arranged.
--   • close_student_enrolment() closes ONE named class, and the per-class path
--     is authorized by coach_owns_class(), never coach_serves_student(). The
--     latter is true for ANY class the child is in, so it would let one coach
--     close a row on ANOTHER coach's roster — a cross-coach write RLS never
--     sees, because the function is SECURITY DEFINER and enrolments_write is
--     admin-only, making this RPC the whole coach-side surface.
--   • assignment_status means "in NO class", not "left a class".
--   • The class side of the schedule rule: moving a class onto a time that
--     clashes for an enrolled child is refused, and a non-schedule edit is not.
--
-- METHOD (§7.16): every probe runs inside this transaction with SET LOCAL ROLE.
-- Outside one, SET LOCAL ROLE is a no-op, the session stays superuser, RLS is
-- bypassed and every assertion "passes" — including the ones that must fail.
--
-- DATES ARE COMPUTED, NEVER LITERAL (§7.121). A hardcoded session date rots the
-- moment it falls behind markable_floor(), and the failure is a thrown function
-- rather than a failed assertion.
--
-- PROVEN RED (§7.25), 2026-08-10, by running supabase/rollback/20260811_multi_class_DOWN.sql
-- and re-running this file: it dies at line 120 with `duplicate key value violates
-- unique constraint "one_active_enrolment_per_student"` — 0 of 16 assertions run,
-- because the two-enrolment state this file exists to test cannot be BUILT without
-- the migration. constraints.test.sql fails 2 of 6 the ordinary way in the same pass.
-- That rollback rehearsal is also the §7.93 half of the deploy checklist.
--
-- Runs on its own tenant; self-contained; rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(16);

-- ── Fixtures ────────────────────────────────────────────────────────────────

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('ea000000-0000-0000-0000-00000000000a','mc-a','Multi Class Swim','SWIM-MCLA');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','ed000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','mc-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"MC Admin","role":"tenant_admin","tenant_id":"ea000000-0000-0000-0000-00000000000a"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ed000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','mc-coach-x@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"MC Coach X","role":"coach","tenant_id":"ea000000-0000-0000-0000-00000000000a"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ed000000-0000-0000-0000-000000000003',
   'authenticated','authenticated','mc-coach-y@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"MC Coach Y","role":"coach","tenant_id":"ea000000-0000-0000-0000-00000000000a"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ed000000-0000-0000-0000-000000000004',
   'authenticated','authenticated','mc-parent@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"MC Parent","role":"parent"}',
   now(), now(), '','','','');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'ea000000-0000-0000-0000-00000000000a'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'mc-parent@test.local';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('ec000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-00000000000a','MC Group');

-- Coach X owns Sat and Sun; coach Y owns Wed. The split is the point: Wed is a
-- legitimate make-up host, and coach Y is the one who must NOT be able to close
-- an enrolment in coach X's class.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id, is_active)
SELECT 'ef000000-0000-0000-0000-000000000001', co.id, 'MC Sat', 'saturday',
       '10:00','11:00','Test Pool', 40.00, 'ec000000-0000-0000-0000-000000000001', TRUE
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'mc-coach-x@test.local';

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id, is_active)
SELECT 'ef000000-0000-0000-0000-000000000002', co.id, 'MC Sun', 'sunday',
       '10:00','11:00','Test Pool', 40.00, 'ec000000-0000-0000-0000-000000000001', TRUE
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'mc-coach-x@test.local';

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id, is_active)
SELECT 'ef000000-0000-0000-0000-000000000003', co.id, 'MC Wed', 'wednesday',
       '10:00','11:00','Test Pool', 40.00, 'ec000000-0000-0000-0000-000000000001', TRUE
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'mc-coach-y@test.local';

-- Kid TWO holds two active enrolments — the shape that did not exist before
-- this wave. Kid ONE holds one, and exists to prove the old call still works.
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by) VALUES
  ('e5000000-0000-0000-0000-000000000001','MC Kid Two','2016-01-01','assigned',
   'ea000000-0000-0000-0000-00000000000a','ed000000-0000-0000-0000-000000000001'),
  ('e5000000-0000-0000-0000-000000000002','MC Kid One','2016-02-02','assigned',
   'ea000000-0000-0000-0000-00000000000a','ed000000-0000-0000-0000-000000000001');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.sid FROM (VALUES
  ('e5000000-0000-0000-0000-000000000001'::uuid),
  ('e5000000-0000-0000-0000-000000000002'::uuid)) AS s(sid),
  parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'mc-parent@test.local';

INSERT INTO student_class_enrolments (student_id, class_id) VALUES
  ('e5000000-0000-0000-0000-000000000001','ef000000-0000-0000-0000-000000000001'),
  ('e5000000-0000-0000-0000-000000000001','ef000000-0000-0000-0000-000000000002'),
  ('e5000000-0000-0000-0000-000000000002','ef000000-0000-0000-0000-000000000001');


-- ════════════════════════════════════════════════════════════════════════════
-- 1-2. THE CLASS SIDE OF THE SCHEDULE RULE
-- Run first, while Kid Two still holds both enrolments.
-- ════════════════════════════════════════════════════════════════════════════

-- MC Sun is 10-11; moving it to Saturday puts it on top of MC Sat, where Kid Two
-- already is. Refused by trg_class_time_no_enrolment_clash, which fires on
-- classes, so set_class_terms() and a bare PostgREST UPDATE both inherit it.
SELECT throws_ok($$
  UPDATE classes SET day_of_week = 'saturday'
   WHERE id = 'ef000000-0000-0000-0000-000000000002'
$$, 'P0001', NULL, 'moving a class onto a time an enrolled child already has is refused');

-- The WHEN clause names the three schedule columns and nothing else, so a
-- non-schedule edit cannot deadlock. This is the assertion that would catch
-- someone widening the trigger to fire on is_active, which would give
-- reactivate_class() a refusal it must never have.
SELECT lives_ok($$
  UPDATE classes SET title = 'MC Sun renamed'
   WHERE id = 'ef000000-0000-0000-0000-000000000002'
$$, 'a non-schedule edit to the same class is untouched by the clash trigger');


-- ════════════════════════════════════════════════════════════════════════════
-- 3-8. book_makeup(): the home class, and every own class refused
-- ════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ed000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Ambiguous, so it must ask rather than pick. Before this wave the equivalent
-- call took an arbitrary row and priced an invoice line from it.
SELECT throws_ok($$
  SELECT book_makeup('ef000000-0000-0000-0000-000000000003',
                     (date_trunc('week', CURRENT_DATE) + interval '9 days')::date,
                     'e5000000-0000-0000-0000-000000000001', NULL)
$$, 'P0001', NULL,
   'a child in two classes must have their home class named');

SELECT throws_ok($$
  SELECT book_makeup('ef000000-0000-0000-0000-000000000003',
                     (date_trunc('week', CURRENT_DATE) + interval '9 days')::date,
                     'e5000000-0000-0000-0000-000000000001',
                     'ef000000-0000-0000-0000-000000000003')
$$, 'P0001', NULL,
   'the named home class must be one the child is actually in');

-- ⚠ THE SILENT-VOID CASE. Home is MC Sat, host is MC Sun — the child's OTHER
-- class. The old refusal compared only against the named home and let this
-- through. Billing would have been right; the make-up would have been worthless.
SELECT throws_ok($$
  SELECT book_makeup('ef000000-0000-0000-0000-000000000002',
                     (date_trunc('week', CURRENT_DATE) + interval '13 days')::date,
                     'e5000000-0000-0000-0000-000000000001',
                     'ef000000-0000-0000-0000-000000000001')
$$, 'P0001', NULL,
   '⚠ a make-up cannot be booked into ANY class the child is already in');

SELECT lives_ok($$
  SELECT book_makeup('ef000000-0000-0000-0000-000000000003',
                     (date_trunc('week', CURRENT_DATE) + interval '9 days')::date,
                     'e5000000-0000-0000-0000-000000000001',
                     'ef000000-0000-0000-0000-000000000001')
$$, 'a make-up into a class the child is NOT in, with the home class named, works');

-- THE MONEY ASSERTION. The booking must carry the class the admin NAMED, not
-- whichever of the two the database happened to reach first.
SELECT is(
  (SELECT home_class_id FROM makeup_bookings
    WHERE student_id = 'e5000000-0000-0000-0000-000000000001'
      AND cancelled_at IS NULL),
  'ef000000-0000-0000-0000-000000000001'::uuid,
  '⚠ the booking snapshots the NAMED home class — it prices the invoice line');

-- Back-compat: one enrolment still derives silently, so the admin is not asked
-- a question with one possible answer. Internally this arm is INTO STRICT, so if
-- the one-row assumption ever breaks again it raises instead of guessing.
SELECT lives_ok($$
  SELECT book_makeup('ef000000-0000-0000-0000-000000000003',
                     (date_trunc('week', CURRENT_DATE) + interval '9 days')::date,
                     'e5000000-0000-0000-0000-000000000002', NULL)
$$, 'a child with ONE class still needs no home-class argument');

RESET ROLE;


-- ════════════════════════════════════════════════════════════════════════════
-- 9-14. close_student_enrolment(): one class, and whose class it is
-- ════════════════════════════════════════════════════════════════════════════

-- ⚠ RISK 4. Coach Y owns MC Wed only. Kid Two is in MC Sat and MC Sun, both
-- coach X's — so coach_serves_student() is FALSE for coach Y and this would
-- have been refused either way. The discriminating case is below.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ed000000-0000-0000-0000-000000000003","role":"authenticated"}';

-- Enrol Kid Two into coach Y's Wednesday class FIRST, as the admin would. Now
-- coach_serves_student(Kid Two) is TRUE for coach Y — they legitimately teach
-- this child — and the ONLY thing standing between coach Y and coach X's roster
-- is that the per-class check is coach_owns_class(p_class_id).
RESET ROLE;
INSERT INTO student_class_enrolments (student_id, class_id)
VALUES ('e5000000-0000-0000-0000-000000000001','ef000000-0000-0000-0000-000000000003');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ed000000-0000-0000-0000-000000000003","role":"authenticated"}';
SELECT throws_ok($$
  SELECT close_student_enrolment('e5000000-0000-0000-0000-000000000001', FALSE,
                                 'ef000000-0000-0000-0000-000000000001')
$$, 'P0001', NULL,
   '⚠ a coach who teaches the child CANNOT close their enrolment in another coach''s class');

SELECT lives_ok($$
  SELECT close_student_enrolment('e5000000-0000-0000-0000-000000000001', FALSE,
                                 'ef000000-0000-0000-0000-000000000003')
$$, 'a coach CAN close an enrolment in their own class');

-- An explicit NULL is refused, so there is no spelling of this call that means
-- "every class". That is what makes the missing-argument case structural rather
-- than a thing to remember at three call sites.
SELECT throws_ok($$
  SELECT close_student_enrolment('e5000000-0000-0000-0000-000000000001', FALSE, NULL)
$$, 'P0001', NULL, 'close_student_enrolment refuses a NULL class — no "all of them"');

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM student_class_enrolments
    WHERE student_id = 'e5000000-0000-0000-0000-000000000001' AND is_active),
  2, 'closing one class leaves the child''s other enrolments alone');

SELECT is(
  (SELECT assignment_status::text FROM students
    WHERE id = 'e5000000-0000-0000-0000-000000000001'),
  'assigned',
  'a child dropped from one of several classes is still ASSIGNED');

-- Close the remaining two and the child is finally unassigned. 'unassigned'
-- means "in NO class" — the Students page reads this column, and collapsing it
-- to "left a class" would show a two-class family as unassigned after one drop.
--
-- ⚠ RESET ROLE DOES NOT CLEAR request.jwt.claims. The claims are SET LOCAL, so
-- they survive to the end of the transaction and auth.uid() still returns coach
-- Y — who does not own these two classes. The admin's claims must be set
-- explicitly, or these closes are refused for a reason that has nothing to do
-- with what is being tested.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ed000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT lives_ok($$
  SELECT close_student_enrolment('e5000000-0000-0000-0000-000000000001', FALSE,
                                 'ef000000-0000-0000-0000-000000000001')
$$, 'the admin closes the second-to-last class');

SELECT lives_ok($$
  SELECT close_student_enrolment('e5000000-0000-0000-0000-000000000001', FALSE,
                                 'ef000000-0000-0000-0000-000000000002')
$$, 'the admin closes the last class');

RESET ROLE;

SELECT is(
  (SELECT assignment_status::text FROM students
    WHERE id = 'e5000000-0000-0000-0000-000000000001'),
  'unassigned',
  'only when the LAST class goes does the child become unassigned');

SELECT * FROM finish();
ROLLBACK;
