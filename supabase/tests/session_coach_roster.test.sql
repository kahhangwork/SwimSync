-- pgTAP: Wave 3 — the lesson-level coach roster (20260811000200).
--
-- Plan: docs/plans/WAVE_3_PLAN.md. The ranked risks from its /plan-review are
-- named inline; each one's assertion is the thing that would have been missed.
--
-- THE ORDER MATTERS. The roster mechanics come first because everything after
-- them depends on an assignment having actually landed, and the pay assertions
-- come last because they are the ones that move real money.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(40);

-- ── fixture ────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code, rain_pays_coach)
VALUES ('99999999-0000-0000-0000-000000000001','roster','Roster Swim','SWIM-ROST', FALSE);

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','71000000-0000-0000-0000-000000000001','authenticated','authenticated','r-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"R Admin","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-000000000001"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','71000000-0000-0000-0000-000000000002','authenticated','authenticated','r-coachA@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"Coach A","role":"coach","tenant_id":"99999999-0000-0000-0000-000000000001"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','71000000-0000-0000-0000-000000000003','authenticated','authenticated','r-coachB@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"Coach B","role":"coach","tenant_id":"99999999-0000-0000-0000-000000000001"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','71000000-0000-0000-0000-000000000004','authenticated','authenticated','r-coachT@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"Coach T","role":"coach","tenant_id":"99999999-0000-0000-0000-000000000001"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','71000000-0000-0000-0000-000000000005','authenticated','authenticated','r-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"R Parent","role":"parent"}', now(), now(), '','','','');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM class_categories c
                    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

-- A 60-minute Saturday class owned by Coach A. Two Saturdays are used:
-- 2026-08-08 (the cover, in the past so attendance is markable) and
-- 2026-07-04 (the settled-month correction). Both MUST be Saturdays or
-- guard_session_date refuses the insert.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT '67000000-0000-0000-0000-000000000001', c.id, 'Cover Lane', 'saturday','10:00','11:00','Pool', 40,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = c.tenant_id AND lower(trim(cc.name)) = 'default group')
  FROM coaches c WHERE c.profile_id = '71000000-0000-0000-0000-000000000002';

-- A SECOND class of Coach A's, never covered — this is what proves the
-- absence rule still pays the class's own coach.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT '67000000-0000-0000-0000-000000000002', c.id, 'Plain Lane', 'saturday','12:00','13:00','Pool', 40,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = c.tenant_id AND lower(trim(cc.name)) = 'default group')
  FROM coaches c WHERE c.profile_id = '71000000-0000-0000-0000-000000000002';

INSERT INTO students (id, full_name, assignment_status, tenant_id) VALUES
  ('56000000-0000-0000-0000-000000000001','Roster Kid','assigned','99999999-0000-0000-0000-000000000001'),
  ('56000000-0000-0000-0000-000000000002','Trial Guest','assigned','99999999-0000-0000-0000-000000000001'),
  ('56000000-0000-0000-0000-000000000003','Makeup Guest','assigned','99999999-0000-0000-0000-000000000001');
INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('56000000-0000-0000-0000-000000000001','67000000-0000-0000-0000-000000000001', TRUE);
-- The parent must really own a child, or the RISK 8 grant assertion below is
-- an assertion over an empty set and stays green with the GRANT missing.
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id,'56000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id='71000000-0000-0000-0000-000000000005';

-- Deliberately UNEQUAL rates. Equal ones would let the payout builder ignore
-- its coach argument entirely and still look right (RISK 2).
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from)
SELECT c.id, 30.00, 60, '2026-01-01' FROM coaches c WHERE c.profile_id='71000000-0000-0000-0000-000000000002';
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from)
SELECT c.id, 50.00, 60, '2026-01-01' FROM coaches c WHERE c.profile_id='71000000-0000-0000-0000-000000000003';
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from)
SELECT c.id, 10.00, 60, '2026-01-01' FROM coaches c WHERE c.profile_id='71000000-0000-0000-0000-000000000004';


-- ═══ 1. ROSTER MECHANICS ═══════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- lesson_sessions rows are created LAZILY at first attendance save, so a
-- FUTURE lesson has no id to assign against. The assignment resolves-or-creates.
SELECT lives_ok(
  $$ SELECT assign_session_coach('67000000-0000-0000-0000-000000000001','2026-08-08',
       (SELECT id FROM coaches WHERE profile_id='71000000-0000-0000-0000-000000000003'),'main') $$,
  'assigning a cover CREATES the lesson_sessions row the roster needs');

SELECT is(
  (SELECT count(*)::INT FROM lesson_sessions
    WHERE class_id='67000000-0000-0000-0000-000000000001' AND session_date='2026-08-08'),
  1, 'exactly one lesson_sessions row exists after the first assignment');

SELECT lives_ok(
  $$ SELECT assign_session_coach('67000000-0000-0000-0000-000000000001','2026-08-08',
       (SELECT id FROM coaches WHERE profile_id='71000000-0000-0000-0000-000000000003'),'main') $$,
  'assigning the same cover twice does not raise');

SELECT is(
  (SELECT count(*)::INT FROM lesson_sessions
    WHERE class_id='67000000-0000-0000-0000-000000000001' AND session_date='2026-08-08'),
  1, 'resolve-or-create is IDEMPOTENT — still one session row, not two');

SELECT is(
  (SELECT count(*)::INT FROM session_coaches sc
     JOIN lesson_sessions ls ON ls.id=sc.lesson_session_id
    WHERE ls.session_date='2026-08-08' AND sc.role='main'),
  1, 'and exactly one MAIN row, enforced by the partial unique index');

-- The main slot is a PARTIAL unique index and .upsert() cannot target one, so
-- a swap has to go through the RPC or the admin gets a raw 23505.
SELECT lives_ok(
  $$ SELECT set_session_main_coach(
       (SELECT id FROM lesson_sessions WHERE class_id='67000000-0000-0000-0000-000000000001' AND session_date='2026-08-08'),
       (SELECT id FROM coaches WHERE profile_id='71000000-0000-0000-0000-000000000004')) $$,
  'changing who the main coach is does not raise 23505');

SELECT is(
  (SELECT p.full_name FROM session_coaches sc
     JOIN coaches c ON c.id=sc.coach_id JOIN profiles p ON p.id=c.profile_id
     JOIN lesson_sessions ls ON ls.id=sc.lesson_session_id
    WHERE ls.session_date='2026-08-08' AND sc.role='main'),
  'Coach T', 'the swap actually replaced the main rather than keeping the old one');

-- Put B back as main and add T as a shadow — the shape the rest of the file uses.
SELECT set_session_main_coach(
  (SELECT id FROM lesson_sessions WHERE class_id='67000000-0000-0000-0000-000000000001' AND session_date='2026-08-08'),
  (SELECT id FROM coaches WHERE profile_id='71000000-0000-0000-0000-000000000003'));
SELECT assign_session_coach('67000000-0000-0000-0000-000000000001','2026-08-08',
  (SELECT id FROM coaches WHERE profile_id='71000000-0000-0000-0000-000000000004'),'shadow');

-- A roster row against a fabricated date is a lesson that will be marked, paid
-- and BILLED on a day the class never met.
SELECT throws_ok(
  $$ SELECT assign_session_coach('67000000-0000-0000-0000-000000000001','2026-08-12',
       (SELECT id FROM coaches WHERE profile_id='71000000-0000-0000-0000-000000000003'),'main') $$,
  NULL, NULL,
  'a date the class does not run on is REFUSED, not silently created');

-- The foreign coach id is resolved as superuser on purpose: fetching it under
-- RLS returns NULL, and the refusal would then prove nothing about tenancy.
RESET ROLE;
CREATE TEMP TABLE _foreign AS
  SELECT id FROM coaches WHERE profile_id='c0000000-0000-0000-0000-000000000001';
SELECT isnt((SELECT id FROM _foreign), NULL,
  'the cross-tenant probe has a REAL foreign coach id — not a null that would pass for free');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT assign_session_coach('67000000-0000-0000-0000-000000000001','2026-08-08',
       (SELECT id FROM _foreign),'shadow') $$,
  NULL, NULL,
  'a coach of ANOTHER business cannot be rostered onto this lesson');


-- ═══ 2. THE SUBSTITUTE WALKS THE WHOLE LESSON (RISK 1 + RISK 4) ════════════
-- Any ONE missing policy fails this section. A substitute with only
-- sessions_select + attendance_* has no class row (so no title and no week
-- card), no enrolment rows (so nobody to mark), and no visible guest (so a
-- billing month that will not close, with no override and nothing on screen).
RESET ROLE;
INSERT INTO trial_bookings (student_id, class_id, session_date, tenant_id, category_id, booked_by)
SELECT '56000000-0000-0000-0000-000000000002','67000000-0000-0000-0000-000000000001','2026-08-08',
       '99999999-0000-0000-0000-000000000001', cl.category_id, '71000000-0000-0000-0000-000000000001'
  FROM classes cl WHERE cl.id='67000000-0000-0000-0000-000000000001';
INSERT INTO makeup_bookings (student_id, class_id, session_date, tenant_id, category_id, home_class_id, booked_by)
SELECT '56000000-0000-0000-0000-000000000003','67000000-0000-0000-0000-000000000001','2026-08-08',
       '99999999-0000-0000-0000-000000000001', cl.category_id, '67000000-0000-0000-0000-000000000001',
       '71000000-0000-0000-0000-000000000001'
  FROM classes cl WHERE cl.id='67000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"71000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT is((SELECT count(*)::INT FROM classes WHERE id='67000000-0000-0000-0000-000000000001'),
  1, 'RISK 1 — the substitute can read the CLASS row (no class row, no week card at all)');

SELECT is((SELECT count(*)::INT FROM lesson_sessions WHERE session_date='2026-08-08'),
  1, 'the substitute can read the covered SESSION');

SELECT is((SELECT count(*)::INT FROM student_class_enrolments WHERE class_id='67000000-0000-0000-0000-000000000001'),
  1, 'RISK 1 — the substitute can read the ENROLMENT roster');

SELECT is((SELECT count(*)::INT FROM students WHERE id='56000000-0000-0000-0000-000000000001'),
  1, 'the substitute can read the enrolled CHILD');

SELECT is((SELECT count(*)::INT FROM trial_bookings WHERE class_id='67000000-0000-0000-0000-000000000001'),
  1, 'RISK 4 — the substitute can see the TRIAL guest');

SELECT is((SELECT count(*)::INT FROM makeup_bookings WHERE class_id='67000000-0000-0000-0000-000000000001'),
  1, 'RISK 4 — the substitute can see the MAKE-UP guest');

SELECT is((SELECT count(*)::INT FROM students
            WHERE id IN ('56000000-0000-0000-0000-000000000002','56000000-0000-0000-0000-000000000003')),
  2, 'RISK 4 — and both guest CHILDREN, or they cannot be marked and the month never closes');

SELECT lives_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     SELECT ls.id,'56000000-0000-0000-0000-000000000001','present','71000000-0000-0000-0000-000000000003'
       FROM lesson_sessions ls
      WHERE ls.class_id='67000000-0000-0000-0000-000000000001' AND ls.session_date='2026-08-08' $$,
  'the substitute can WRITE attendance on the lesson they are covering');


-- ═══ 3. RISK 7 — THE UNDEFENDED DOOR ══════════════════════════════════════
-- Decision 2 protects coach_owns_class(). coach_serves_student() is the other
-- one: it authorizes set_students_active(), which the coach app really calls,
-- so a roster branch inside it would let a one-hour substitute deactivate a
-- child across the whole business.
SELECT ok(NOT coach_serves_student('56000000-0000-0000-0000-000000000001'),
  'RISK 7 — coach_serves_student() stays FALSE for a substitute (its body is NOT edited by this wave)');

SELECT ok(coach_rostered_with_student('56000000-0000-0000-0000-000000000001'),
  'the substitute reaches the child through the SEPARATE roster function instead');

SELECT throws_ok(
  $$ SELECT set_students_active(ARRAY['56000000-0000-0000-0000-000000000001']::uuid[], FALSE) $$,
  NULL, NULL,
  'RISK 7 — and set_students_active() still REFUSES the substitute');


-- ═══ 4. THE TRAINEE READS, AND DOES NOT MARK ══════════════════════════════
SET LOCAL "request.jwt.claims" TO '{"sub":"71000000-0000-0000-0000-000000000004","role":"authenticated"}';

SELECT is((SELECT count(*)::INT FROM lesson_sessions WHERE session_date='2026-08-08'),
  1, 'a shadow coach can READ the lesson they are shadowing');

SELECT ok(NOT coach_is_main_on_session(
    (SELECT id FROM lesson_sessions WHERE class_id='67000000-0000-0000-0000-000000000001' AND session_date='2026-08-08')),
  'a shadow is not the main coach');

SELECT throws_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     SELECT ls.id,'56000000-0000-0000-0000-000000000002','present','71000000-0000-0000-0000-000000000004'
       FROM lesson_sessions ls
      WHERE ls.class_id='67000000-0000-0000-0000-000000000001' AND ls.session_date='2026-08-08' $$,
  NULL, NULL,
  'a shadow canNOT write attendance — the main coach stays unambiguous for marking');


-- ═══ 5. THE NARROWING — the class''s own coach loses write while covered ═══
SET LOCAL "request.jwt.claims" TO '{"sub":"71000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT ok(NOT coach_is_main_on_session(
    (SELECT id FROM lesson_sessions WHERE class_id='67000000-0000-0000-0000-000000000001' AND session_date='2026-08-08')),
  'the class''s own coach is not main on a lesson someone else covered');

SELECT throws_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     SELECT ls.id,'56000000-0000-0000-0000-000000000003','present','71000000-0000-0000-0000-000000000002'
       FROM lesson_sessions ls
      WHERE ls.class_id='67000000-0000-0000-0000-000000000001' AND ls.session_date='2026-08-08' $$,
  NULL, NULL,
  'THE NARROWING — and so canNOT write attendance on it either');


-- ═══ 6. RISK 8 — THE GRANT HALF ═══════════════════════════════════════════
-- A policy expression is evaluated as the INVOKING role, so sessions_select
-- gaining coach_teaches_session() without a GRANT makes every SELECT on
-- lesson_sessions throw for EVERY role — parents included.
SET LOCAL "request.jwt.claims" TO '{"sub":"71000000-0000-0000-0000-000000000005","role":"authenticated"}';
SELECT cmp_ok((SELECT count(*)::INT FROM lesson_sessions), '>', 0,
  'RISK 8 — a PARENT can still read lesson_sessions, so the new gate is granted to authenticated');


-- ═══ 7. PAY — per (session, coach) ════════════════════════════════════════
RESET ROLE;

SELECT is((SELECT amount FROM session_pay_amount(
    (SELECT id FROM lesson_sessions WHERE class_id='67000000-0000-0000-0000-000000000001' AND session_date='2026-08-08'),
    (SELECT id FROM coaches WHERE profile_id='71000000-0000-0000-0000-000000000002'))),
  NULL, 'the REPLACED coach is owed nothing for a lesson they did not teach');

SELECT is((SELECT amount FROM session_pay_amount(
    (SELECT id FROM lesson_sessions WHERE class_id='67000000-0000-0000-0000-000000000001' AND session_date='2026-08-08'),
    (SELECT id FROM coaches WHERE profile_id='71000000-0000-0000-0000-000000000003'))),
  50.00::NUMERIC, 'RISK 2 — the substitute is paid THEIR OWN rate (50), not the class''s terms (30)');

SELECT is((SELECT amount FROM session_pay_amount(
    (SELECT id FROM lesson_sessions WHERE class_id='67000000-0000-0000-0000-000000000001' AND session_date='2026-08-08'),
    (SELECT id FROM coaches WHERE profile_id='71000000-0000-0000-0000-000000000004'))),
  10.00::NUMERIC, 'RISK 2 — the shadow is paid their own rate (10); three different answers prove the coach argument is read');

SELECT is((SELECT amount FROM session_pay_amount(
    (SELECT id FROM lesson_sessions WHERE class_id='67000000-0000-0000-0000-000000000001' AND session_date='2026-08-08'))),
  50.00::NUMERIC, '§7.123 — the one-argument form still exists and delegates to the roster main');

-- The absence rule: an untouched lesson of Coach A''s other class still pays A.
-- It must be MARKED — session_pays_coach() returns FALSE on an unmarked
-- session ("not a lesson that happened"), so an unmarked one would assert
-- nothing about attribution. The child is in both classes, which Wave 2 allows.
INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('45000000-0000-0000-0000-000000000009','67000000-0000-0000-0000-000000000002','2026-08-08','completed');
INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('56000000-0000-0000-0000-000000000001','67000000-0000-0000-0000-000000000002', TRUE);
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('45000000-0000-0000-0000-000000000009','56000000-0000-0000-0000-000000000001','present','71000000-0000-0000-0000-000000000002');
SELECT is((SELECT amount FROM session_pay_amount('45000000-0000-0000-0000-000000000009',
    (SELECT id FROM coaches WHERE profile_id='71000000-0000-0000-0000-000000000002'))),
  30.00::NUMERIC, 'THE ABSENCE RULE — a lesson with no roster row still pays the class''s own coach');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';

CREATE TEMP TABLE _aug AS
  SELECT * FROM generate_coach_payouts('99999999-0000-0000-0000-000000000001','2026-08');

SELECT is((SELECT gross FROM _aug WHERE coach_name='Coach B'), 50.00::NUMERIC,
  'payroll pays the substitute for the lesson they covered');
SELECT is((SELECT gross FROM _aug WHERE coach_name='Coach T'), 10.00::NUMERIC,
  'payroll pays the shadow at their own rate — one lesson, TWO payout rows');
SELECT is((SELECT gross FROM _aug WHERE coach_name='Coach A'), 30.00::NUMERIC,
  'and pays the class''s own coach ONLY for the lesson nobody covered');


-- ═══ 8. RISK 3 — A COVER RECORDED AFTER THE MONTH WAS SETTLED ═════════════
-- Adjustments A is driven FROM EXISTING ITEMS, so it can only ever visit a
-- coach who was already paid in that period. A substitute named afterwards has
-- no item and no payout at all — their money is invisible to it.
RESET ROLE;
INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('45000000-0000-0000-0000-000000000001','67000000-0000-0000-0000-000000000001','2026-07-04','completed');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('45000000-0000-0000-0000-000000000001','56000000-0000-0000-0000-000000000001','present','71000000-0000-0000-0000-000000000002');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
CREATE TEMP TABLE _jul AS
  SELECT * FROM generate_coach_payouts('99999999-0000-0000-0000-000000000001','2026-07');
SELECT is((SELECT gross FROM _jul WHERE coach_name='Coach A'), 30.00::NUMERIC,
  'July pays Coach A, who taught it — no roster row exists yet');

RESET ROLE;
UPDATE coach_payouts SET status='paid', paid_at=now()
 WHERE period_month='2026-07' AND tenant_id='99999999-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT set_session_main_coach('45000000-0000-0000-0000-000000000001',
  (SELECT id FROM coaches WHERE profile_id='71000000-0000-0000-0000-000000000003'));

CREATE TEMP TABLE _sep AS
  SELECT * FROM generate_coach_payouts('99999999-0000-0000-0000-000000000001','2026-09');
SELECT is((SELECT gross FROM _sep WHERE coach_name='Coach A'), -30.00::NUMERIC,
  'the replaced coach is CLAWED BACK on the next payout');
SELECT is((SELECT gross FROM _sep WHERE coach_name='Coach B'), 50.00::NUMERIC,
  'RISK 3 — and the substitute is PAID for a period they had no payout in at all');

-- Re-run the same period twice more, then a later one. 20260719000900 exists
-- because a first version re-emitted the difference every period, forever.
SELECT generate_coach_payouts('99999999-0000-0000-0000-000000000001','2026-09');
SELECT generate_coach_payouts('99999999-0000-0000-0000-000000000001','2026-09');
SELECT generate_coach_payouts('99999999-0000-0000-0000-000000000001','2026-10');

RESET ROLE;
SELECT is(
  (SELECT COALESCE(SUM(i.amount),0) FROM coach_payout_items i
     JOIN coach_payouts p ON p.id=i.payout_id
     JOIN coaches c ON c.id=p.coach_id
    WHERE i.lesson_session_id='45000000-0000-0000-0000-000000000001'
      AND c.profile_id='71000000-0000-0000-0000-000000000002'),
  0.00::NUMERIC,
  'CARRIED ONCE — across three re-runs and a later period, the replaced coach nets to exactly 0');

SELECT is(
  (SELECT COALESCE(SUM(i.amount),0) FROM coach_payout_items i
     JOIN coach_payouts p ON p.id=i.payout_id
     JOIN coaches c ON c.id=p.coach_id
    WHERE i.lesson_session_id='45000000-0000-0000-0000-000000000001'
      AND c.profile_id='71000000-0000-0000-0000-000000000003'),
  50.00::NUMERIC,
  'CARRIED ONCE — and the substitute is paid 50 exactly once, not 100 or 150');

SELECT * FROM finish();
ROLLBACK;
