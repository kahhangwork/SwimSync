-- pgTAP: make-up bookings — the guest-pass model (MAKEUP_CLASSES_PLAN).
--
-- What is pinned here, in order of blast radius:
--   • book_makeup()'s refusals, all server-side: unenrolled child, own class,
--     category mismatch, wrong weekday (unless an off-schedule session exists —
--     that one is ALLOWED), pre-window floor, duplicate live slot, inactive
--     child, inactive host class, cross-tenant child, non-admin callers.
--   • The R3 visibility widening, both directions: the HOST coach now reads a
--     booked guest's students row; an unrelated coach still counts ZERO; the
--     other tenant's admin still counts ZERO; the parent reads the host class
--     and its sessions; an unrelated parent still counts ZERO. Both sides
--     counted as the same role (§7.59).
--   • The host coach's visible-student BASELINE is unchanged by the function
--     replace except for the guest (1 before booking, 2 after).
--   • anon has no EXECUTE on either RPC and no privilege on the table (§7.39
--     first layer — the remote grant dump at deploy is the second).
--
-- METHOD (§7.16): every probe runs inside this transaction with SET LOCAL
-- ROLE. Outside one, SET LOCAL ROLE is a no-op and everything "passes" as
-- superuser. Phase 0 of the plan ran the coach/parent probes against the
-- PRE-migration database and both counted 0 — the widening is proven needed.
--
-- Runs on its own tenants; self-contained; rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(26);

-- ── Fixtures ────────────────────────────────────────────────────────────────

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('ca000000-0000-0000-0000-00000000000a','mkp-a','Makeup Swim A','SWIM-MKPA'),
  ('ca000000-0000-0000-0000-00000000000b','mkp-b','Makeup Swim B','SWIM-MKPB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','cd000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','mkp-admin-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Mkp Admin A","role":"tenant_admin","tenant_id":"ca000000-0000-0000-0000-00000000000a"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','cd000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','mkp-host-coach@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Mkp Host Coach","role":"coach","tenant_id":"ca000000-0000-0000-0000-00000000000a"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','cd000000-0000-0000-0000-000000000003',
   'authenticated','authenticated','mkp-home-coach@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Mkp Home Coach","role":"coach","tenant_id":"ca000000-0000-0000-0000-00000000000a"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','cd000000-0000-0000-0000-000000000004',
   'authenticated','authenticated','mkp-other-coach@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Mkp Other Coach","role":"coach","tenant_id":"ca000000-0000-0000-0000-00000000000a"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','cd000000-0000-0000-0000-000000000005',
   'authenticated','authenticated','mkp-parent-1@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Mkp Parent One","role":"parent"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','cd000000-0000-0000-0000-000000000006',
   'authenticated','authenticated','mkp-parent-2@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Mkp Parent Two","role":"parent"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','cd000000-0000-0000-0000-000000000007',
   'authenticated','authenticated','mkp-admin-b@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Mkp Admin B","role":"tenant_admin","tenant_id":"ca000000-0000-0000-0000-00000000000b"}',
   now(), now(), '','','','');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'ca000000-0000-0000-0000-00000000000a'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email IN ('mkp-parent-1@test.local','mkp-parent-2@test.local');

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('cc000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-00000000000a','Mkp Group'),
  ('cc000000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-00000000000a','Mkp Private');

-- Host H (host coach, Group, SATURDAY) · Home M (home coach, Group, SUNDAY) ·
-- Private PC (home coach, Private, MONDAY) · Inactive IC (host coach, Group).
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id, is_active)
SELECT 'cf000000-0000-0000-0000-000000000001', co.id, 'Mkp Host Sat', 'saturday',
       '10:00','11:00','Test Pool', 40.00, 'cc000000-0000-0000-0000-000000000001', TRUE
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'mkp-host-coach@test.local';

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id, is_active)
SELECT 'cf000000-0000-0000-0000-000000000002', co.id, 'Mkp Home Sun', 'sunday',
       '10:00','11:00','Test Pool', 35.00, 'cc000000-0000-0000-0000-000000000001', TRUE
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'mkp-home-coach@test.local';

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id, is_active)
SELECT 'cf000000-0000-0000-0000-000000000003', co.id, 'Mkp Private Mon', 'monday',
       '10:00','11:00','Test Pool', 70.00, 'cc000000-0000-0000-0000-000000000002', TRUE
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'mkp-home-coach@test.local';

-- ⚠ `deactivated_at` IS NOT DECORATION HERE. Since 20260810000100,
-- `classes_inactive_requires_deactivated_at` refuses `is_active = false` with a
-- null date: the engine reads that column to decide how far an inactive class
-- was expected to run, and a NULL means "expect nothing". Without the date this
-- INSERT raises 23514 and the whole file dies before its first assertion —
-- which is exactly how the constraint found this fixture.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id, is_active,
                     deactivated_at)
SELECT 'cf000000-0000-0000-0000-000000000004', co.id, 'Mkp Retired Sat', 'saturday',
       '10:00','11:00','Test Pool', 40.00, 'cc000000-0000-0000-0000-000000000001', FALSE,
       now()
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'mkp-host-coach@test.local';

-- Kid K — parent 1's, ACTIVE, enrolled in Home M (the make-up candidate).
-- Kid U — parent 1's, no enrolment. Kid X — parent 1's, INACTIVE.
-- Kid H — parent 2's, enrolled in Host H (the host coach's baseline student).
-- Kid B — tenant B's.
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by, is_active) VALUES
  ('c5000000-0000-0000-0000-000000000001','Mkp Kid K','2018-01-01','assigned',
   'ca000000-0000-0000-0000-00000000000a','cd000000-0000-0000-0000-000000000005', TRUE),
  ('c5000000-0000-0000-0000-000000000002','Mkp Kid U','2018-02-02','unassigned',
   'ca000000-0000-0000-0000-00000000000a','cd000000-0000-0000-0000-000000000005', TRUE),
  ('c5000000-0000-0000-0000-000000000003','Mkp Kid X','2018-03-03','assigned',
   'ca000000-0000-0000-0000-00000000000a','cd000000-0000-0000-0000-000000000005', FALSE),
  ('c5000000-0000-0000-0000-000000000004','Mkp Kid H','2018-04-04','assigned',
   'ca000000-0000-0000-0000-00000000000a','cd000000-0000-0000-0000-000000000006', TRUE),
  ('c5000000-0000-0000-0000-000000000005','Mkp Kid B','2018-05-05','assigned',
   'ca000000-0000-0000-0000-00000000000b','cd000000-0000-0000-0000-000000000007', TRUE);

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.sid FROM (VALUES
  ('c5000000-0000-0000-0000-000000000001'::uuid),
  ('c5000000-0000-0000-0000-000000000002'::uuid),
  ('c5000000-0000-0000-0000-000000000003'::uuid)) AS s(sid),
  parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'mkp-parent-1@test.local';

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c5000000-0000-0000-0000-000000000004'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'mkp-parent-2@test.local';

INSERT INTO student_class_enrolments (student_id, class_id) VALUES
  ('c5000000-0000-0000-0000-000000000001','cf000000-0000-0000-0000-000000000002'),
  ('c5000000-0000-0000-0000-000000000004','cf000000-0000-0000-0000-000000000001');

-- An admin-scheduled off-schedule session of the HOST class next WEDNESDAY
-- (superuser insert bypasses the client guard, like schedule_extra_lesson).
INSERT INTO lesson_sessions (class_id, session_date, off_schedule_reason)
VALUES ('cf000000-0000-0000-0000-000000000001',
        current_date + ((3 - EXTRACT(DOW FROM current_date)::int + 7) % 7 + 7),
        'holiday shift');

-- ── 1–2. R3 baseline, BEFORE any booking exists ─────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cd000000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM students
    WHERE id IN ('c5000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000004')),
  1,
  'host coach baseline: sees their enrolled student, NOT the future guest');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cd000000-0000-0000-0000-000000000005","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM classes WHERE id = 'cf000000-0000-0000-0000-000000000001'),
  0,
  'parent baseline: cannot read the host class before a booking exists');
RESET ROLE;

-- ── 3–12. book_makeup refusals, as the business''s admin ────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cd000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT throws_like(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000001',
      current_date + ((6 - EXTRACT(DOW FROM current_date)::int + 7) % 7),
      'c5000000-0000-0000-0000-000000000002')$$,
  '%not enrolled in a class%',
  'an unenrolled child is refused — book a trial instead');

SELECT throws_like(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000002',
      current_date + ((0 - EXTRACT(DOW FROM current_date)::int + 7) % 7),
      'c5000000-0000-0000-0000-000000000001')$$,
  '%child''s own class%',
  'the child''s own class is refused — that is an Extra lesson');

SELECT throws_like(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000003',
      current_date + ((1 - EXTRACT(DOW FROM current_date)::int + 7) % 7),
      'c5000000-0000-0000-0000-000000000001')$$,
  '%own category%',
  'a Group child cannot make up in a Private class');

SELECT throws_like(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000001',
      current_date + ((2 - EXTRACT(DOW FROM current_date)::int + 7) % 7),
      'c5000000-0000-0000-0000-000000000001')$$,
  '%pick a day the class actually meets%',
  'a date the host class does not run (and no session exists) is refused');

SELECT throws_like(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000001', DATE '2025-01-04',
      'c5000000-0000-0000-0000-000000000001')$$,
  '%that month has been billed%',
  'a Saturday below the attendance-window floor is refused');

SELECT throws_like(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000001',
      current_date + ((6 - EXTRACT(DOW FROM current_date)::int + 7) % 7),
      'c5000000-0000-0000-0000-000000000003')$$,
  '%no longer attending%',
  'an inactive child is refused');

SELECT throws_like(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000004',
      current_date + ((6 - EXTRACT(DOW FROM current_date)::int + 7) % 7),
      'c5000000-0000-0000-0000-000000000001')$$,
  '%no longer running%',
  'an inactive host class is refused');

SELECT throws_like(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000001',
      current_date + ((6 - EXTRACT(DOW FROM current_date)::int + 7) % 7),
      'c5000000-0000-0000-0000-000000000005')$$,
  '%another business%',
  'another tenant''s child is refused');

SELECT lives_ok(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000001',
      current_date + ((6 - EXTRACT(DOW FROM current_date)::int + 7) % 7),
      'c5000000-0000-0000-0000-000000000001')$$,
  'happy path: same category, host weekday, enrolled active child');

SELECT throws_like(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000001',
      current_date + ((6 - EXTRACT(DOW FROM current_date)::int + 7) % 7),
      'c5000000-0000-0000-0000-000000000001')$$,
  '%already booked into that lesson%',
  'a duplicate live booking is refused with a plain sentence');

-- ── 13–14. Cancel, then the slot is re-bookable ─────────────────────────────
SELECT lives_ok(
  $$SELECT cancel_makeup_booking(
      (SELECT id FROM makeup_bookings
        WHERE student_id = 'c5000000-0000-0000-0000-000000000001'
          AND cancelled_at IS NULL LIMIT 1))$$,
  'the admin can cancel a booking');

SELECT lives_ok(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000001',
      current_date + ((6 - EXTRACT(DOW FROM current_date)::int + 7) % 7),
      'c5000000-0000-0000-0000-000000000001')$$,
  'a cancelled slot can be re-booked (the unique index is partial)');

-- ── 15. Off-schedule session date is ALLOWED ────────────────────────────────
SELECT lives_ok(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000001',
      current_date + ((3 - EXTRACT(DOW FROM current_date)::int + 7) % 7 + 7),
      'c5000000-0000-0000-0000-000000000001')$$,
  'guesting into an admin-scheduled off-schedule extra session is allowed');

-- ── 16. The snapshots landed ────────────────────────────────────────────────
SELECT is(
  (SELECT (category_id = 'cc000000-0000-0000-0000-000000000001'
           AND home_class_id = 'cf000000-0000-0000-0000-000000000002')
     FROM makeup_bookings
    WHERE student_id = 'c5000000-0000-0000-0000-000000000001'
      AND cancelled_at IS NULL
    ORDER BY booked_at LIMIT 1),
  TRUE,
  'the booking snapshots the home category AND the home class id');
RESET ROLE;

-- ── 17–19. Non-admin callers refused, and the table did not grow ────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cd000000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT throws_like(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000001',
      current_date + ((6 - EXTRACT(DOW FROM current_date)::int + 7) % 7),
      'c5000000-0000-0000-0000-000000000004')$$,
  '%only this business''s admin%',
  'a coach cannot book a make-up — arranging is the admin''s');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cd000000-0000-0000-0000-000000000007","role":"authenticated"}';
SELECT throws_like(
  $$SELECT book_makeup('cf000000-0000-0000-0000-000000000001',
      current_date + ((6 - EXTRACT(DOW FROM current_date)::int + 7) % 7),
      'c5000000-0000-0000-0000-000000000001')$$,
  '%only this business''s admin%',
  'another business''s admin cannot book into this tenant');
RESET ROLE;

-- Counted as superuser — the role that sees everything (§7.59). Exactly the
-- two live + one cancelled bookings the admin made above, nothing more.
SELECT is(
  (SELECT count(*)::int FROM makeup_bookings),
  3,
  'the refused calls added no rows (mutation-testing the gate)');

-- ── 20–23. R3 visibility, positive AND negative ─────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cd000000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM students
    WHERE id IN ('c5000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000004')),
  2,
  'AFTER booking: the host coach reads the guest''s students row (baseline +1, nothing else)');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cd000000-0000-0000-0000-000000000004","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM students
    WHERE id = 'c5000000-0000-0000-0000-000000000001'),
  0,
  'an unrelated coach in the same tenant still counts ZERO');
-- Same-tenant staff CAN read booking rows (tenant_id = current_tenant_id() —
-- the exact visibility trial_bookings grants); the guarded boundary is the
-- STUDENT row, asserted above. Cross-tenant zero is asserted below.
SELECT is(
  (SELECT count(*)::int FROM makeup_bookings),
  3,
  'a same-tenant coach reads booking rows — the trials rule, unchanged');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cd000000-0000-0000-0000-000000000007","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM students
    WHERE id = 'c5000000-0000-0000-0000-000000000001'),
  0,
  'the other tenant''s admin still counts ZERO');
RESET ROLE;

-- ── 24–25. The parent's side ────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cd000000-0000-0000-0000-000000000005","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM classes WHERE id = 'cf000000-0000-0000-0000-000000000001')
  + (SELECT count(*)::int FROM lesson_sessions
      WHERE class_id = 'cf000000-0000-0000-0000-000000000001'),
  2,
  'AFTER booking: the parent reads the host class AND its session');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cd000000-0000-0000-0000-000000000006","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM makeup_bookings),
  0,
  'an unrelated parent reads no bookings');
RESET ROLE;

-- ── 26. anon is locked out (§7.39, layer one) ───────────────────────────────
SELECT is(
  -- 4-arg since Wave 2 (20260811000100). Naming a signature that does not exist
  -- does not FAIL here — has_function_privilege ERRORS, which aborts the whole
  -- file with a bad plan and takes 25 unrelated assertions down with it.
  (SELECT has_function_privilege('anon', 'public.book_makeup(uuid,date,uuid,uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.cancel_makeup_booking(uuid)', 'EXECUTE')
       OR has_table_privilege('anon', 'makeup_bookings', 'SELECT')),
  FALSE,
  'anon can execute neither RPC and cannot read the table');

SELECT * FROM finish();
ROLLBACK;
