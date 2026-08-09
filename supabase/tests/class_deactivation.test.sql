-- pgTAP: RETIRING A CLASS — deactivate_class() / reactivate_class()
-- (20260809000300). Wave 1 item #6, Chunk 4.
--
-- WHAT THIS FILE EXISTS TO PROTECT. The engine no longer skips inactive classes
-- (core.ts), which is the fix — a class retired at month end used to drop its
-- already-taught lessons out of billing silently. The cost of that fix is that
-- an inactive class can now BLOCK a billing month, and an inactive class is
-- invisible to every role who could clear it: the coach class list, the coach
-- Schedule tab and the admin Classes page all filter `is_active`. The block has
-- no override by design (§8a). So the three refusals below are the difference
-- between "retire a class" and "make this business unbillable this month".
--
-- ⚠ EVERY REFUSAL IS TESTED IN BOTH DIRECTIONS, AND THAT IS NOT PADDING.
-- A guard that refuses EVERYTHING satisfies all three refusal assertions on its
-- own — markable_floor.test.sql is the precedent, and reactivate_class() would
-- then be the only way to undo it. Each refusal therefore has a partner
-- assertion proving the class CAN be retired once the obstruction is cleared.
--
-- ⚠ ASSERTION 2 IS THE ONE PEOPLE WILL WANT TO "FIX". An EMPTY class — no
-- enrolments, no bookings, no sessions — IS deactivated. All three refusals are
-- made of "nothing went wrong" negatives, which §7.17 warns are satisfied
-- hardest by empty input, so that outcome is asserted deliberately rather than
-- left to fall out. It is also the correct product answer: an empty class is
-- exactly the one an admin wants to retire, and there is nothing to strand.
--
-- ⚠ ASSERTION 5 IS THE §7.66 CASE. The enrolment refusal reads the SPAN, never
-- `is_active`: one_active_enrolment_per_student is a PARTIAL unique index, so
-- is_active is a point-in-time flag, not a span. A child unenrolled YESTERDAY
-- still has unmarked lessons this month, and retiring the class hides them.
-- Written `WHERE is_active`, assertion 5 goes green while the hole stays open.
--
-- WHY THE DATES ARE COMPUTED, NOT HARDCODED (§7.33): the rules under test are
-- relative to now(), so a fixed date would mean something different next month.
-- Every date derives from ONE anchor. The tenant is created now and has never
-- sealed, so its markable_floor() is the calendar rule — the 1st of last month.
--
-- METHOD (§7.16): every client probe runs inside this explicit transaction with
-- SET LOCAL ROLE. Outside one, SET LOCAL ROLE is a no-op, the session stays
-- superuser, RLS is bypassed and every assertion "passes" — including the ones
-- that must fail. The refusals also assert NOTHING WAS WRITTEN: a gate that
-- raises after writing is not a gate.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(23);

-- ── The dates, from one anchor ──────────────────────────────────────────────
--   d_floor    1st of last month     the business's markable_floor()
--   d_past     d_floor + 7 days      a lesson date INSIDE the window, already gone
--   d_ancient  d_floor - 70 days     below the floor; 70 = whole weeks, so it
--                                    lands on the same weekday as d_past
--   d_future   today + 7 days        a lesson that has not happened yet
-- Classes run on d_past's weekday, so d_past and d_ancient are both real lesson
-- dates and only the rule under test can be doing the refusing.
CREATE TEMP TABLE cd AS
SELECT
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '1 month')::date                                  AS d_floor,
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '1 month' + INTERVAL '7 days')::date              AS d_past,
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '1 month' - INTERVAL '70 days')::date             AS d_ancient,
  ((now() AT TIME ZONE 'Asia/Singapore') + INTERVAL '7 days')::date AS d_future;
GRANT SELECT ON cd TO PUBLIC;

-- Both businesses first: handle_new_user() resolves a profile's tenant from the
-- JWT metadata, so an admin whose business does not exist yet fails the FK.
INSERT INTO tenants (id, slug, display_name, join_code, created_at) VALUES
  ('79777777-0000-0000-0000-000000000001','cdx','CDX Business','SWIM-CDXA', now()),
  ('79777777-0000-0000-0000-000000000002','cdy','CDY Other Business','SWIM-CDYA', now());

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','79100000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','cdx-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"CDX Admin","role":"tenant_admin","tenant_id":"79777777-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','79100000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','cdx-coach@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"CDX Coach","role":"coach","tenant_id":"79777777-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  -- A second business's admin. Deactivation is tenant-scoped, and "any signed-in
  -- admin" is not the same permission as "this business's admin".
  ('00000000-0000-0000-0000-000000000000','79100000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','cdx-outsider@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"CDX Outsider","role":"tenant_admin","tenant_id":"79777777-0000-0000-0000-000000000002"}', now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE t.id = '79777777-0000-0000-0000-000000000001'
   AND NOT EXISTS (
     SELECT 1 FROM class_categories c
      WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

-- ── Six classes, one per state a deactivation attempt can be in ─────────────
--   EMPTY    nothing at all                        → allowed (assertion 1)
--   ENROL    one OPEN enrolment                    → refusal 1
--   RECENT   enrolment closed INSIDE the window    → refusal 1 (§7.66)
--   OLD      enrolment closed BELOW the floor      → allowed
--   BOOKED   a future trial booking                → refusal 2
--   MAKEUP   a future make-up booking              → refusal 2
--   STALE    a PAST booking nobody marked          → refusal 3
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                     end_time, location_name, price_per_lesson, category_id)
SELECT
  ids.id, '79777777-0000-0000-0000-000000000001',
  (SELECT id FROM coaches WHERE profile_id='79100000-0000-0000-0000-0000000000c1'),
  ids.title,
  (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    )[EXTRACT(DOW FROM cd.d_past)::int + 1]::day_of_week,
  '10:00','11:00','Pool CDX', 30,
  (SELECT id FROM class_categories
    WHERE tenant_id='79777777-0000-0000-0000-000000000001'
      AND lower(trim(name))='default group')
FROM cd, (VALUES
  ('79777777-1111-0000-0000-00000000000e'::UUID,'CDX Empty Class'),
  ('79777777-1111-0000-0000-000000000001'::UUID,'CDX Enrolled Class'),
  ('79777777-1111-0000-0000-000000000002'::UUID,'CDX Recently Left Class'),
  ('79777777-1111-0000-0000-000000000003'::UUID,'CDX Long Gone Class'),
  ('79777777-1111-0000-0000-000000000004'::UUID,'CDX Booked Class'),
  ('79777777-1111-0000-0000-000000000005'::UUID,'CDX Makeup Host Class'),
  ('79777777-1111-0000-0000-000000000006'::UUID,'CDX Stale Booking Class')
) AS ids(id, title);

INSERT INTO students (id, full_name, assignment_status, tenant_id) VALUES
  ('79500000-0000-0000-0000-000000000001','CDX Enrolled Kid','assigned','79777777-0000-0000-0000-000000000001'),
  ('79500000-0000-0000-0000-000000000002','CDX Recently Left Kid','unassigned','79777777-0000-0000-0000-000000000001'),
  ('79500000-0000-0000-0000-000000000003','CDX Long Gone Kid','unassigned','79777777-0000-0000-0000-000000000001'),
  ('79500000-0000-0000-0000-000000000004','CDX Trial Kid','unassigned','79777777-0000-0000-0000-000000000001'),
  ('79500000-0000-0000-0000-000000000005','CDX Makeup Kid','assigned','79777777-0000-0000-0000-000000000001'),
  ('79500000-0000-0000-0000-000000000006','CDX Stale Kid','unassigned','79777777-0000-0000-0000-000000000001');

-- Casts are explicit: in a UNION the literals are untyped and Postgres resolves
-- the branch to text, which the uuid columns then reject.
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, unenrolled_at, is_active)
SELECT '79500000-0000-0000-0000-000000000001'::UUID,'79777777-1111-0000-0000-000000000001'::UUID,
       d_ancient::TIMESTAMPTZ, NULL::TIMESTAMPTZ, TRUE FROM cd
UNION ALL
-- is_active FALSE, but the span reaches INTO the window. This is the row that
-- makes assertion 6 discriminating — see the marked session below.
--
-- The span is EXACTLY d_past, one day, and that is load-bearing. Opened at
-- d_ancient it would also cover the earlier class-weekday dates inside the
-- window, none of which are marked, and refusal 3 would then be what refuses
-- this class — assertion 6 green, refusal 1 untested. Measured twice: the
-- sabotage run stayed green through both wider spans before this.
SELECT '79500000-0000-0000-0000-000000000002'::UUID,'79777777-1111-0000-0000-000000000002'::UUID,
       d_past::TIMESTAMPTZ, d_past::TIMESTAMPTZ, FALSE FROM cd
UNION ALL
-- Closed BELOW the floor: nothing left to mark, nothing to strand.
SELECT '79500000-0000-0000-0000-000000000003'::UUID,'79777777-1111-0000-0000-000000000003'::UUID,
       (d_ancient - 7)::TIMESTAMPTZ, d_ancient::TIMESTAMPTZ, FALSE FROM cd
UNION ALL
-- The make-up guest's HOME class is the enrolled one; the host is class 5.
SELECT '79500000-0000-0000-0000-000000000005'::UUID,'79777777-1111-0000-0000-000000000001'::UUID,
       d_ancient::TIMESTAMPTZ, NULL::TIMESTAMPTZ, TRUE FROM cd;

INSERT INTO trial_bookings (tenant_id, student_id, class_id, session_date, category_id, booked_by)
SELECT '79777777-0000-0000-0000-000000000001'::UUID,'79500000-0000-0000-0000-000000000004'::UUID,
       '79777777-1111-0000-0000-000000000004'::UUID, d_future,
       (SELECT id FROM class_categories
         WHERE tenant_id='79777777-0000-0000-0000-000000000001'
           AND lower(trim(name))='default group'),
       '79100000-0000-0000-0000-0000000000a1'::UUID
FROM cd
UNION ALL
-- The stale one: a lesson that HAS happened, inside the window, unmarked. This
-- is the only shape refusal 3 can still find once refusals 1 and 2 have passed,
-- and it is a real hole — the guest was expected and nobody recorded them.
SELECT '79777777-0000-0000-0000-000000000001'::UUID,'79500000-0000-0000-0000-000000000006'::UUID,
       '79777777-1111-0000-0000-000000000006'::UUID, d_past,
       (SELECT id FROM class_categories
         WHERE tenant_id='79777777-0000-0000-0000-000000000001'
           AND lower(trim(name))='default group'),
       '79100000-0000-0000-0000-0000000000a1'::UUID
FROM cd;

INSERT INTO makeup_bookings (tenant_id, student_id, class_id, session_date,
                             category_id, home_class_id, booked_by)
SELECT '79777777-0000-0000-0000-000000000001','79500000-0000-0000-0000-000000000005',
       '79777777-1111-0000-0000-000000000005', d_future,
       (SELECT id FROM class_categories
         WHERE tenant_id='79777777-0000-0000-0000-000000000001'
           AND lower(trim(name))='default group'),
       '79777777-1111-0000-0000-000000000001',
       '79100000-0000-0000-0000-0000000000a1'
FROM cd;

-- ⚠ CLASS 2's LESSON IS MARKED, AND THAT IS WHAT MAKES ASSERTION 6 MEAN
-- SOMETHING. Measured, not assumed: without this, refusal 3 fires on class 2
-- (the closed enrolment still spans d_past, and nothing was recorded there), so
-- assertion 6 goes green even when refusal 1 is written the §7.66-buggy way and
-- the sabotage run proves nothing. Marking d_past empties refusal 3's hands and
-- leaves the enrolment SPAN as the only thing that can refuse this class.
INSERT INTO lesson_sessions (id, class_id, session_date)
SELECT '79400000-0000-0000-0000-000000000002','79777777-1111-0000-0000-000000000002', d_past FROM cd;
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('79400000-0000-0000-0000-000000000002','79500000-0000-0000-0000-000000000002',
        'present','79100000-0000-0000-0000-0000000000c1');

-- Scoped, not a bare COUNT(*): taken as postgres and compared under SET LOCAL
-- ROLE, a global count reads a different row set on each side.
CREATE TEMP TABLE cd_baseline AS
  SELECT (SELECT COUNT(*)::INT FROM classes
           WHERE tenant_id = '79777777-0000-0000-0000-000000000001'
             AND is_active = FALSE) AS inactive;
GRANT SELECT ON cd_baseline TO PUBLIC;


-- ══ 0. The floor is what this file thinks it is ═════════════════════════════
-- If this fails, every window-relative assertion below is measuring something
-- else and their greenness means nothing.
SELECT is(
  (SELECT markable_floor('79777777-0000-0000-0000-000000000001')),
  (SELECT d_floor FROM cd),
  'the fixture business floors at the 1st of last month — the window everything below assumes');


SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"79100000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ══ 1. THE EMPTY CLASS IS RETIRED, DELIBERATELY (§7.17) ═════════════════════
SELECT lives_ok(
  $$ SELECT deactivate_class('79777777-1111-0000-0000-00000000000e') $$,
  'an EMPTY class is deactivated — decided, not fallen through (§7.17)');

SELECT ok(
  (SELECT NOT is_active AND deactivated_at IS NOT NULL
     FROM classes WHERE id='79777777-1111-0000-0000-00000000000e'),
  'and it records WHEN — the engine needs a date, not a boolean');


-- ══ 3-4. Refusal 1: children still on the roster ════════════════════════════
SELECT throws_ok(
  $$ SELECT deactivate_class('79777777-1111-0000-0000-000000000001') $$,
  'P0001',
  NULL,
  'a class with a child still enrolled is REFUSED');

SELECT ok(
  (SELECT is_active FROM classes WHERE id='79777777-1111-0000-0000-000000000001'),
  'and it stayed active — a gate that raises after writing is not a gate');


-- ══ 5-6. Refusal 1 reads the SPAN, not is_active (§7.66) ════════════════════
-- The enrolment here is is_active = FALSE. Written `WHERE is_active`, assertion
-- 5 passes the deactivation straight through and the child's unmarked lessons
-- this month become unreachable.
SELECT throws_ok(
  $$ SELECT deactivate_class('79777777-1111-0000-0000-000000000002') $$,
  'P0001',
  NULL,
  'a child who left INSIDE the window still blocks it — is_active is a flag, not a span (§7.66)');

-- The other direction, and the reason 5 is not satisfied by refusing everything:
-- an enrolment closed BELOW the floor has nothing left to mark.
SELECT lives_ok(
  $$ SELECT deactivate_class('79777777-1111-0000-0000-000000000003') $$,
  'a child who left BEFORE the floor does not block it — the refusal is dated, not blanket');


-- ══ 7-9. Refusal 2: guests booked into lessons that have not happened ═══════
SELECT throws_ok(
  $$ SELECT deactivate_class('79777777-1111-0000-0000-000000000004') $$,
  'P0001',
  NULL,
  'a future TRIAL booking blocks it — the guest is expected there and nowhere else');

SELECT throws_ok(
  $$ SELECT deactivate_class('79777777-1111-0000-0000-000000000005') $$,
  'P0001',
  NULL,
  'a future MAKE-UP booking blocks it too — both tables, not just trials');

-- Cancelling is the documented way out, and it must actually work: a refusal
-- that survives its own remedy is a dead end. The cancel itself runs as
-- postgres — this file is about deactivate_class(), and routing it through
-- trial_bookings' own RLS would make the assertion fail for a reason that has
-- nothing to do with what is under test.
RESET ROLE;
UPDATE trial_bookings
   SET cancelled_at = now(), cancelled_by = '79100000-0000-0000-0000-0000000000a1'
 WHERE class_id = '79777777-1111-0000-0000-000000000004';
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$ SELECT deactivate_class('79777777-1111-0000-0000-000000000004') $$,
  'cancel the booking and it retires — a cancelled booking expects nobody');


-- ══ 10-12. Refusal 3: lessons that happened and were never marked ═══════════
-- The hole refusals 1 and 2 cannot see. The enrolments are all closed and the
-- booking is in the PAST, so neither of them fires — but a guest was expected
-- on d_past and nobody recorded them. Retire the class and that mark can never
-- be made, because an inactive class is not on any coach's screen.
SELECT throws_ok(
  $$ SELECT deactivate_class('79777777-1111-0000-0000-000000000006') $$,
  'P0001',
  NULL,
  'a PAST lesson nobody marked blocks it — the case refusals 1 and 2 cannot reach');

-- Read as postgres, and the reason is itself a check: the helper is granted to
-- NOBODY (20260809000300), so calling it as `authenticated` is refused with
-- 42501. It is reached only through deactivate_class(), which is SECURITY
-- DEFINER. If this ever runs green under `authenticated`, the revoke has been
-- undone somewhere.
RESET ROLE;
SELECT is(
  (SELECT class_unmarked_lesson_dates('79777777-1111-0000-0000-000000000006')),
  ARRAY[(SELECT d_past FROM cd)],
  'and it names the date, so the error can tell the admin what to go and mark');
SET LOCAL ROLE authenticated;

-- Mark it and the class retires. Without this the refusal could be permanent
-- and nobody would know. Marking runs as postgres for the same reason the
-- cancel above does — attendance RLS is the coach's, and is not what is on
-- trial here.
RESET ROLE;
INSERT INTO lesson_sessions (id, class_id, session_date)
SELECT '79400000-0000-0000-0000-000000000001','79777777-1111-0000-0000-000000000006', d_past FROM cd;
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('79400000-0000-0000-0000-000000000001','79500000-0000-0000-0000-000000000006',
        'present','79100000-0000-0000-0000-0000000000c1');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$ SELECT deactivate_class('79777777-1111-0000-0000-000000000006') $$,
  'mark the lesson and it retires — the refusal has a way out');


-- ══ 13a-13b. THE OTHER TWO ARMS OF THE EXPECTED-STUDENTS UNION ═════════════
-- Assertion 12 pins only the trial_bookings arm. The enrolment and make-up arms
-- cannot produce a positive result THROUGH deactivate_class() at all — refusal
-- 1 fires before any open enrolment can reach refusal 3, and refusal 2 fires
-- before any future make-up can. So they are exercised here, against the helper
-- directly, which is the only place they are reachable.
--
-- This matters more than an ordinary coverage gap: the migration header calls
-- this function the single SQL copy of §7.18's union — the rule whose four
-- hand-written copies caused a live underbill. Measured before this was added:
-- delete either arm and the whole file still passed.
--
-- Read as postgres — the helper is granted to nobody (see assertion 12).
RESET ROLE;

-- The enrolment arm: an OPEN enrolment on a class with no sessions at all. Every
-- class-weekday date in the window is owed a mark.
SELECT ok(
  (SELECT array_length(class_unmarked_lesson_dates('79777777-1111-0000-0000-000000000001'), 1) > 0),
  'the ENROLMENT arm names dates — an open enrolment with nothing recorded is unmarked');

-- The make-up arm: a PAST make-up nobody marked. Dated in the past on purpose —
-- a future one is refusal 2's business, and this arm's job is the lesson that
-- has already happened.
INSERT INTO makeup_bookings (tenant_id, student_id, class_id, session_date,
                             category_id, home_class_id, booked_by)
SELECT '79777777-0000-0000-0000-000000000001','79500000-0000-0000-0000-000000000005',
       '79777777-1111-0000-0000-000000000005', d_past,
       (SELECT id FROM class_categories
         WHERE tenant_id='79777777-0000-0000-0000-000000000001'
           AND lower(trim(name))='default group'),
       '79777777-1111-0000-0000-000000000001',
       '79100000-0000-0000-0000-0000000000a1'
FROM cd;

SELECT is(
  (SELECT class_unmarked_lesson_dates('79777777-1111-0000-0000-000000000005')),
  ARRAY[(SELECT d_past FROM cd)],
  'the MAKE-UP arm names the date — a past guest lesson nobody marked');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"79100000-0000-0000-0000-0000000000a1","role":"authenticated"}';


-- ══ 13-15. reactivate_class() TAKES NO REFUSALS ═════════════════════════════
-- It is the only exit from a class that is blocking a billing month while being
-- invisible to every screen that filters is_active. Anything that can refuse it
-- can strand a business. Assertion 13 deliberately reactivates the class in the
-- WORST state in this file — the one that was refused three times over.
SELECT lives_ok(
  $$ SELECT reactivate_class('79777777-1111-0000-0000-000000000006') $$,
  'reactivate takes no refusals, even on the class that was hardest to retire');

SELECT ok(
  (SELECT is_active AND deactivated_at IS NULL
     FROM classes WHERE id='79777777-1111-0000-0000-000000000006'),
  'and it clears the date — a live class is not "retired on some day"');

-- Idempotence, both ways: the admin panel will call these from a button that can
-- be double-pressed, and a second press must not move deactivated_at.
SELECT lives_ok(
  $$ SELECT reactivate_class('79777777-1111-0000-0000-000000000006') $$,
  'reactivating an active class is a no-op, not an error');


-- ══ 17-18. Re-deactivating must NOT move the date ══════════════════════════
-- deactivated_at is what the engine expects lessons UP TO. Rewriting it on a
-- second press silently widens that window on a class already retired.
RESET ROLE;
CREATE TEMP TABLE cd_stamp AS
  SELECT deactivated_at AS at FROM classes WHERE id='79777777-1111-0000-0000-00000000000e';
GRANT SELECT ON cd_stamp TO PUBLIC;
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$ SELECT deactivate_class('79777777-1111-0000-0000-00000000000e') $$,
  'deactivating an already-inactive class is a no-op, not an error');

SELECT is(
  (SELECT deactivated_at FROM classes WHERE id='79777777-1111-0000-0000-00000000000e'),
  (SELECT at FROM cd_stamp),
  'and the second press did NOT move the date the engine bills against');


-- ══ 19. Another business's admin cannot touch it ═══════════════════════════
-- The one case where "is this an admin?" is not the question. `authenticated`
-- carries every role in this product, so an unscoped check would let any
-- business retire any other business's class.
SET LOCAL "request.jwt.claims" TO '{"sub":"79100000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- ⚠ TARGETS THE ALREADY-RETIRED EMPTY CLASS, NOT AN ENROLLED ONE, AND THAT IS
-- THE WHOLE ASSERTION. Pointed at a class that ALSO trips refusal 1, this goes
-- green from refusal 1's own P0001 even with the `is_tenant_admin` check
-- deleted — any business could then retire any other business's class and the
-- suite would not notice. The empty class is already inactive, so the only
-- things that can happen are the tenant refusal (correct) or the idempotent
-- RETURN, which sits AFTER the tenant check. Without the check this flips to
-- lives_ok. Measured: it was pointed at the enrolled class and was vacuous.
SELECT throws_ok(
  $$ SELECT deactivate_class('79777777-1111-0000-0000-00000000000e') $$,
  'P0001',
  NULL,
  'an admin of a DIFFERENT business is refused — tenant-scoped, not role-scoped');

-- reactivate_class() takes no refusals BY DESIGN, so is_tenant_admin() is its
-- ONLY barrier — and `authenticated` is every parent and every coach in this
-- product, not just admins. Untested, deleting that one line would let any
-- signed-in stranger un-retire any class in any business, which re-opens that
-- business's whole expectation window.
SELECT throws_ok(
  $$ SELECT reactivate_class('79777777-1111-0000-0000-00000000000e') $$,
  'P0001',
  NULL,
  'and reactivate is tenant-scoped too — its ONLY barrier, since it has no refusals');


-- ══ 20. Nothing leaked ═════════════════════════════════════════════════════
-- Exactly three classes end this file retired: EMPTY, LONG GONE, and BOOKED
-- (after its booking was cancelled). STALE was retired and then REACTIVATED by
-- assertion 13, so it is active again and does not count. The other three were
-- refused throughout. Any refusal that raised AFTER writing lands here.
RESET ROLE;
SELECT is(
  (SELECT COUNT(*)::INT FROM classes
    WHERE tenant_id = '79777777-0000-0000-0000-000000000001' AND is_active = FALSE),
  (SELECT inactive + 3 FROM cd_baseline),
  'exactly the three intended classes are retired — every refusal wrote nothing');

SELECT * FROM finish();
ROLLBACK;
