-- pgTAP: capacity as a HARD limit (20260820000200, plan Phase B).
--
-- Two axes (Decision 3):
--   * a BOOKING on a date (book_makeup/book_trial) is refused when the lesson's
--     EXPECTED SET (enrolled-by-span + guests) reaches the effective maximum;
--   * an ENROLMENT is refused when the class's ACTIVE ROSTER reaches it (trigger).
-- The refusal always matches the number the admin sees on the page (Decision 3).
--
-- METHOD (§7.16): every role-scoped probe runs inside this transaction with
-- SET LOCAL ROLE. Raw table DML (enrolment inserts, capacity UPDATEs) runs as
-- the superuser — the capacity TRIGGER fires for the owner too, so it is the
-- trigger under test, not RLS. book_makeup/book_trial/close/cancel/
-- add_unclaimed_student are called as the admin (they read auth.uid()); the
-- coach cases switch to the coach.
--
-- DATES ARE RELATIVE TO today_sg() (§7.7): booking targets run on weekday(today+4)
-- and bookings land on today+4 / today+18 (future, past the billed floor, matching
-- the class weekday). Fixed dates would slip below markable_floor as the month
-- rolls and turn the suite red on its own. Own tenant; rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(29);

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('ca900000-0000-0000-0000-000000000001','caplim','Capacity Limit','SWIM-CAP1');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','cb900000-0000-0000-0000-000000000001',
   'authenticated','authenticated','cap-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Cap Admin","role":"tenant_admin","is_coach":true,"tenant_id":"ca900000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','cb900000-0000-0000-0000-000000000002',
   'authenticated','authenticated','cap-coach@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Cap Coach","role":"coach","tenant_id":"ca900000-0000-0000-0000-000000000001"}',
   now(), now(), '','','','');

INSERT INTO class_categories (id, tenant_id, name, default_capacity) VALUES
  ('ce900000-0000-0000-0000-000000000001','ca900000-0000-0000-0000-000000000001','Group', 2),
  ('ce900000-0000-0000-0000-000000000002','ca900000-0000-0000-0000-000000000001','Uncapped', NULL);

-- All coached by cap-coach, ALL on weekday(today+4) with distinct times so a child
-- in several never clashes (trg_enrolment_schedule) and every booking on today+4
-- matches the class weekday.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id, capacity)
SELECT x.id, co.id, x.title,
       (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[EXTRACT(DOW FROM today_sg()+4)::int+1]::day_of_week,
       x.st::time, x.et::time, 'Pool', 50.00, x.cat, x.cap
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id
CROSS JOIN (VALUES
  ('cf900000-0000-0000-0000-000000000001'::uuid,'K','10:00','11:00','ce900000-0000-0000-0000-000000000001'::uuid, 3::smallint),
  ('cf900000-0000-0000-0000-000000000002'::uuid,'L','11:00','12:00','ce900000-0000-0000-0000-000000000001'::uuid, NULL::smallint),
  ('cf900000-0000-0000-0000-000000000003'::uuid,'U','12:00','13:00','ce900000-0000-0000-0000-000000000002'::uuid, NULL::smallint),
  ('cf900000-0000-0000-0000-000000000004'::uuid,'H','13:00','14:00','ce900000-0000-0000-0000-000000000001'::uuid, 10::smallint),
  ('cf900000-0000-0000-0000-000000000005'::uuid,'M','14:00','15:00','ce900000-0000-0000-0000-000000000001'::uuid, 3::smallint),
  ('cf900000-0000-0000-0000-000000000006'::uuid,'E','15:00','16:00','ce900000-0000-0000-0000-000000000001'::uuid, 3::smallint),
  ('cf900000-0000-0000-0000-000000000007'::uuid,'J','16:00','17:00','ce900000-0000-0000-0000-000000000001'::uuid, 3::smallint),
  ('cf900000-0000-0000-0000-000000000008'::uuid,'P','17:00','18:00','ce900000-0000-0000-0000-000000000001'::uuid, 2::smallint),
  ('cf900000-0000-0000-0000-000000000009'::uuid,'L2','18:00','19:00','ce900000-0000-0000-0000-000000000001'::uuid, 2::smallint)
  ) AS x(id,title,st,et,cat,cap)
WHERE pr.email='cap-coach@test.local';

INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by)
SELECT ('55900000-0000-0000-0000-0000000000'||n)::uuid, 'Kid '||n, '2016-01-01', 'assigned',
       'ca900000-0000-0000-0000-000000000001','cb900000-0000-0000-0000-000000000001'
FROM (VALUES ('01'),('02'),('03'),('04'),('05'),('06'),('07'),('08'),('09'),
             ('0a'),('0b'),('0c'),('0d'),
             ('10'),('11'),('12'),('13'),
             ('20'),('21'),('22'),('23'),
             ('30'),('31'),('32'),('33'),('34'),
             ('40'),('41'),('42'),('43'),('50')) AS s(n);

-- Guests GA/GB/GC and PG/PG2 live in home class H (CATG, cap 10) so they are
-- make-up eligible into K/L2/P/J (same category, not their own class).
INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
  ('55900000-0000-0000-0000-00000000000a','cf900000-0000-0000-0000-000000000004', true),  -- GA
  ('55900000-0000-0000-0000-00000000000b','cf900000-0000-0000-0000-000000000004', true),  -- GB
  ('55900000-0000-0000-0000-00000000000c','cf900000-0000-0000-0000-000000000004', true),  -- GC
  ('55900000-0000-0000-0000-000000000042','cf900000-0000-0000-0000-000000000004', true), -- PG
  ('55900000-0000-0000-0000-000000000043','cf900000-0000-0000-0000-000000000004', true); -- PG2

-- ══ Cases 1–2: K roster fills to 3, the 4th is refused (Decision 3 roster) ════
-- S3 (…03) enrolled in the FUTURE (today+11) — counts toward the roster
-- (is_active) but not toward a booking span before its start (cases 9/10).
SELECT lives_ok(format($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at) VALUES
    ('55900000-0000-0000-0000-000000000001','cf900000-0000-0000-0000-000000000001', true, now()),
    ('55900000-0000-0000-0000-000000000002','cf900000-0000-0000-0000-000000000001', true, now()),
    ('55900000-0000-0000-0000-000000000003','cf900000-0000-0000-0000-000000000001', true, %L)
$$, (today_sg()+11)::timestamptz), '1: three enrolments fill K (cap 3)');
SELECT throws_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active)
  VALUES ('55900000-0000-0000-0000-000000000004','cf900000-0000-0000-0000-000000000001', true) $$,
  'P0001', 'K is full (3 of 3) — free a place or raise the class''s maximum first',
  '2: the 4th enrolment into K is refused (3 of 3)');

-- ══ Case 3: L inherits the category default (2) ══════════════════════════════
SELECT lives_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
    ('55900000-0000-0000-0000-000000000005','cf900000-0000-0000-0000-000000000002', true),
    ('55900000-0000-0000-0000-000000000006','cf900000-0000-0000-0000-000000000002', true) $$,
  '3a: two enrolments fill L (inherits default 2)');
SELECT throws_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active)
  VALUES ('55900000-0000-0000-0000-000000000007','cf900000-0000-0000-0000-000000000002', true) $$,
  'P0001', 'L is full (2 of 2) — free a place or raise the class''s maximum first',
  '3b: the 3rd enrolment into L is refused — the category default applies');

-- ══ Case 4: U is uncapped (category has no default) ══════════════════════════
SELECT lives_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
    ('55900000-0000-0000-0000-000000000001','cf900000-0000-0000-0000-000000000003', true),
    ('55900000-0000-0000-0000-000000000002','cf900000-0000-0000-0000-000000000003', true),
    ('55900000-0000-0000-0000-000000000003','cf900000-0000-0000-0000-000000000003', true),
    ('55900000-0000-0000-0000-000000000004','cf900000-0000-0000-0000-000000000003', true) $$,
  '4: four enrolments into U all live — NULL cap = unlimited');

-- ══ Case 5: a CLOSED span occupies no seat ═══════════════════════════════════
SELECT lives_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at, unenrolled_at)
  VALUES ('55900000-0000-0000-0000-000000000008','cf900000-0000-0000-0000-000000000001', false, now(), now()) $$,
  '5: a closed enrolment into a full K lives — no seat taken');

-- ══ Case 6: closing a seat frees one (exercises close_student_enrolment) ══════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cb900000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT close_student_enrolment('55900000-0000-0000-0000-000000000001', false,
                               'cf900000-0000-0000-0000-000000000001');  -- S1 out of K
RESET ROLE;
SELECT lives_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
  VALUES ('55900000-0000-0000-0000-000000000009','cf900000-0000-0000-0000-000000000001', true, now()) $$,
  '6: after closing one, a new enrolment into K lives — the seat freed');

-- ══ Case 7: reactivating a closed row into a now-full K is refused ═══════════
SELECT throws_ok($$
  UPDATE student_class_enrolments SET is_active = true
   WHERE student_id='55900000-0000-0000-0000-000000000008'
     AND class_id='cf900000-0000-0000-0000-000000000001' $$,
  'P0001', 'K is full (3 of 3) — free a place or raise the class''s maximum first',
  '7: reactivating a closed enrolment into a full K is refused (UPDATE arm)');

-- ══ Case 8 (RISK 1): a DUPLICATE active child hits the unique index, not "full" ═
-- K holds S2,S3,S9 active. Inserting a 2nd active row for S2 must fall through
-- the capacity count (which excludes S2's own student) to the 23505 the index
-- raises — NOT "is full". Proven red against a trigger lacking the
-- `e.student_id <> NEW.student_id` term (see commit message).
SELECT throws_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active)
  VALUES ('55900000-0000-0000-0000-000000000002','cf900000-0000-0000-0000-000000000001', true) $$,
  '23505', NULL, '8: a duplicate active enrolment is refused by the unique index (not "full")');

-- ══ Cases 9–14: the BOOKING axis (book_makeup / book_trial), as the admin ════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cb900000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Case 9: on today+18 all three K spans cover (S3 started today+11) -> full.
SELECT throws_ok(format($$ SELECT book_makeup('cf900000-0000-0000-0000-000000000001',%L,
                                       '55900000-0000-0000-0000-00000000000a') $$, today_sg()+18),
  'P0001', NULL, '9: a make-up into K on a fully-covered date is refused (3 of 3)');
-- Case 10: on today+4 S3 has not started -> only 2 spans -> a guest fits.
SELECT lives_ok(format($$ SELECT book_makeup('cf900000-0000-0000-0000-000000000001',%L,
                                      '55900000-0000-0000-0000-00000000000a') $$, today_sg()+4),
  '10: a make-up into K on a date before a child''s span start lives (2 of 3, span not is_active)');

-- Case 11: L2 has 1 enrolled (LA) + 1 make-up guest (GB) on D=today+4; a 2nd guest is refused.
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
  VALUES ('55900000-0000-0000-0000-000000000050','cf900000-0000-0000-0000-000000000009', true, now());
SELECT book_makeup('cf900000-0000-0000-0000-000000000009', today_sg()+4,'55900000-0000-0000-0000-00000000000b'); -- GB (setup)
SELECT throws_ok(format($$ SELECT book_makeup('cf900000-0000-0000-0000-000000000009',%L,
                                       '55900000-0000-0000-0000-00000000000c') $$, today_sg()+4),
  'P0001', NULL, '11: a 2nd make-up guest into L2 (1 enrolled + 1 guest) is refused (2 of 2)');

-- Case 12: cancelling the guest frees the seat; rebooking lives.
SELECT cancel_makeup_booking((SELECT id FROM makeup_bookings
   WHERE student_id='55900000-0000-0000-0000-00000000000b'
     AND class_id='cf900000-0000-0000-0000-000000000009'
     AND session_date=today_sg()+4 AND cancelled_at IS NULL));
SELECT lives_ok(format($$ SELECT book_makeup('cf900000-0000-0000-0000-000000000009',%L,
                                      '55900000-0000-0000-0000-00000000000c') $$, today_sg()+4),
  '12: after cancelling a guest, rebooking L2 lives — the seat freed');

-- Case 13: rebooking a child already booked into a full K hears "already booked", not "full".
SELECT throws_ok(format($$ SELECT book_makeup('cf900000-0000-0000-0000-000000000001',%L,
                                       '55900000-0000-0000-0000-00000000000a') $$, today_sg()+4),
  'P0001', 'that child is already booked into that lesson',
  '13: a duplicate booking into a full lesson hears "already booked", not "full"');

-- Case 14: a trial into a full L2 is refused (L2 on D now holds LA + GC = 2).
SELECT throws_ok(format($$ SELECT book_trial('cf900000-0000-0000-0000-000000000009',%L,
                                      '55900000-0000-0000-0000-00000000000d') $$, today_sg()+4),
  'P0001', NULL, '14: a trial into a full L2 is refused (2 of 2)');
RESET ROLE;

-- ══ Case 15: the direct write paths are admin-only (Decision 4) ══════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cb900000-0000-0000-0000-000000000002","role":"authenticated"}';  -- coach
SELECT throws_ok(format($$ SELECT book_makeup('cf900000-0000-0000-0000-000000000003',%L,
                                       '55900000-0000-0000-0000-00000000000a') $$, today_sg()+4),
  'P0001', 'only this business''s admin may book a make-up',
  '15a: a coach cannot book a make-up');
SELECT throws_ok(format($$ SELECT book_trial('cf900000-0000-0000-0000-000000000003',%L,
                                      '55900000-0000-0000-0000-00000000000d') $$, today_sg()+4),
  'P0001', 'only this business''s admin may book a trial',
  '15b: a coach cannot book a trial');
SELECT throws_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active)
  VALUES ('55900000-0000-0000-0000-000000000007','cf900000-0000-0000-0000-000000000003', true) $$,
  '42501', NULL, '15c: a coach cannot INSERT an enrolment directly (RLS, admin-only)');
RESET ROLE;

-- ══ Case 16: add_unclaimed_student('ongoing') hits capacity on BOTH arms ═════
-- K is full (3 active). The coach's own arm and the admin arm both enrol through
-- the definer body, so the trigger refuses both (Decision 4, corrected).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cb900000-0000-0000-0000-000000000002","role":"authenticated"}';  -- coach owns K
SELECT throws_ok($$ SELECT add_unclaimed_student('cf900000-0000-0000-0000-000000000001','New Kid C','ongoing') $$,
  'P0001', NULL, '16a: the class''s own coach cannot enrol into a full K (is full)');
SET LOCAL "request.jwt.claims" TO '{"sub":"cb900000-0000-0000-0000-000000000001","role":"authenticated"}';  -- admin
SELECT throws_ok($$ SELECT add_unclaimed_student('cf900000-0000-0000-0000-000000000001','New Kid A','ongoing') $$,
  'P0001', NULL, '16b: the admin cannot enrol into a full K (is full)');
RESET ROLE;

-- ══ Case 17 (RISK 1): same-statement rows are counted ════════════════════════
-- M is empty (cap 3). One statement of 4 rows throws; one of exactly 3 lives.
SELECT throws_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
    ('55900000-0000-0000-0000-000000000010','cf900000-0000-0000-0000-000000000005', true),
    ('55900000-0000-0000-0000-000000000011','cf900000-0000-0000-0000-000000000005', true),
    ('55900000-0000-0000-0000-000000000012','cf900000-0000-0000-0000-000000000005', true),
    ('55900000-0000-0000-0000-000000000013','cf900000-0000-0000-0000-000000000005', true) $$,
  'P0001', 'M is full (3 of 3) — free a place or raise the class''s maximum first',
  '17a: a single 4-row insert into a cap-3 class is refused (same-statement counting)');
SELECT lives_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
    ('55900000-0000-0000-0000-000000000010','cf900000-0000-0000-0000-000000000005', true),
    ('55900000-0000-0000-0000-000000000011','cf900000-0000-0000-0000-000000000005', true),
    ('55900000-0000-0000-0000-000000000012','cf900000-0000-0000-0000-000000000005', true) $$,
  '17b: a single statement of exactly 3 rows lives');

-- ══ Case 18 (RISK 6): the escape hatch — raise the maximum ═══════════════════
INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
  ('55900000-0000-0000-0000-000000000020','cf900000-0000-0000-0000-000000000006', true),
  ('55900000-0000-0000-0000-000000000021','cf900000-0000-0000-0000-000000000006', true),
  ('55900000-0000-0000-0000-000000000022','cf900000-0000-0000-0000-000000000006', true);  -- E at 3/3
SELECT lives_ok($$ UPDATE classes SET capacity = 2 WHERE id='cf900000-0000-0000-0000-000000000006' $$,
  '18a: lowering E''s maximum below its roster is allowed (no trigger on capacity)');
SELECT throws_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active)
  VALUES ('55900000-0000-0000-0000-000000000023','cf900000-0000-0000-0000-000000000006', true) $$,
  'P0001', 'E is full (3 of 2) — free a place or raise the class''s maximum first',
  '18b: a new enrolment into the over-full E is refused (3 of 2)');
UPDATE classes SET capacity = 5 WHERE id='cf900000-0000-0000-0000-000000000006';
SELECT lives_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active)
  VALUES ('55900000-0000-0000-0000-000000000023','cf900000-0000-0000-0000-000000000006', true) $$,
  '18c: after raising E''s maximum, the enrolment lives — the always-available exit');

-- ══ Case 19 (RISK 6): a child closed still covers its date by span ═══════════
-- J (cap 3): JA,JB,JC enrolled well in the past; JC closed with unenrolled_at on
-- the booking date (raw UPDATE so the date is fixed relative to today — the RPC
-- sets now(); the ASYMMETRY is what matters). JD added in the future.
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at) VALUES
  ('55900000-0000-0000-0000-000000000030','cf900000-0000-0000-0000-000000000007', true, now() - INTERVAL '30 days'),
  ('55900000-0000-0000-0000-000000000031','cf900000-0000-0000-0000-000000000007', true, now() - INTERVAL '30 days'),
  ('55900000-0000-0000-0000-000000000032','cf900000-0000-0000-0000-000000000007', true, now() - INTERVAL '30 days'); -- J at 3/3
UPDATE student_class_enrolments SET is_active = false, unenrolled_at = (today_sg()+4)::timestamptz
  WHERE student_id='55900000-0000-0000-0000-000000000032' AND class_id='cf900000-0000-0000-0000-000000000007';
SELECT lives_ok(format($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
  VALUES ('55900000-0000-0000-0000-000000000033','cf900000-0000-0000-0000-000000000007', true, %L) $$, (today_sg()+11)::timestamptz),
  '19a: with one closed, a new enrolment lives — the roster sees 2 active');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cb900000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_ok(format($$ SELECT book_makeup('cf900000-0000-0000-0000-000000000007',%L,
                                       '55900000-0000-0000-0000-00000000000a') $$, today_sg()+4),
  'P0001', NULL, '19b: a make-up on today+4 is refused (3 of 3) — the closed child still covers by span, JD does not');
RESET ROLE;

-- ══ Case 20 (RISK 6): a FUTURE guest does not block a roster seat ════════════
-- P (cap 2): PA enrolled, plus a make-up guest PG on today+4. A 2nd PERMANENT
-- enrolment still lives (the roster sees 1). Then the booking axis reads 3 on
-- that date and a further guest is refused.
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
  VALUES ('55900000-0000-0000-0000-000000000040','cf900000-0000-0000-0000-000000000008', true, now());
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cb900000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT book_makeup('cf900000-0000-0000-0000-000000000008', today_sg()+4,'55900000-0000-0000-0000-000000000042'); -- PG (setup)
RESET ROLE;
SELECT lives_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
  VALUES ('55900000-0000-0000-0000-000000000041','cf900000-0000-0000-0000-000000000008', true, now()) $$,
  '20a: a 2nd permanent enrolment into P lives — a future guest does not take a roster seat');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cb900000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_ok(format($$ SELECT book_makeup('cf900000-0000-0000-0000-000000000008',%L,
                                       '55900000-0000-0000-0000-000000000043') $$, today_sg()+4),
  'P0001', NULL, '20b: a further guest into P on today+4 is refused (3 of 2) — 2 roster spans + 1 guest');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
