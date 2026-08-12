-- pgTAP: class-level shadow coaches (20260812000200).
--
-- Plan: docs/plans/CLASS_SHADOW_COACHES_PLAN.md. The ranked risks from its
-- /plan-review are named inline; each one's assertion is the thing that would
-- otherwise have been missed.
--
-- THE ORDER MATTERS, AND IT IS FORCED BY THE SEAL. Everything that needs an
-- OPEN payout month comes first; the seal section marks a month paid and from
-- that point on no assignment and no absence for that month or later can be
-- written at all. Putting the seal earlier would silently disable half the file.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(49);

-- ── fixture ────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code, rain_pays_coach)
VALUES ('a1111111-0000-0000-0000-000000000001','shadowco','Shadow Swim','SWIM-SHDW', FALSE);

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-000000000001','authenticated','authenticated','s-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"S Admin","role":"tenant_admin","tenant_id":"a1111111-0000-0000-0000-000000000001"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-000000000002','authenticated','authenticated','s-coachA@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"Coach A","role":"coach","tenant_id":"a1111111-0000-0000-0000-000000000001"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-000000000003','authenticated','authenticated','s-coachS@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"Coach S","role":"coach","tenant_id":"a1111111-0000-0000-0000-000000000001"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-000000000004','authenticated','authenticated','s-coachN@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"Coach N","role":"coach","tenant_id":"a1111111-0000-0000-0000-000000000001"}', now(), now(), '','','','');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM class_categories c
                    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

-- A 60-minute SATURDAY class owned by Coach A. Every date below must be a
-- Saturday or guard_session_date refuses the insert: 2026-07-04, 2026-08-01 and
-- 2026-08-08 all are, and all are in the past relative to today_sg().
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'a3000000-0000-0000-0000-000000000001', c.id, 'Shadow Lane', 'saturday','09:00','10:00','Pool', 40,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = c.tenant_id AND lower(trim(cc.name)) = 'default group')
  FROM coaches c WHERE c.profile_id = 'a2000000-0000-0000-0000-000000000002';

-- A second class of A's, never shadowed. It is what proves an absence row
-- suppresses ONE lesson's shadow pay and nothing else (case 2).
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'a3000000-0000-0000-0000-000000000002', c.id, 'Quiet Lane', 'saturday','11:00','12:00','Pool', 40,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = c.tenant_id AND lower(trim(cc.name)) = 'default group')
  FROM coaches c WHERE c.profile_id = 'a2000000-0000-0000-0000-000000000002';

INSERT INTO students (id, full_name, assignment_status, tenant_id) VALUES
  ('a4000000-0000-0000-0000-000000000001','Shadow Kid','assigned','a1111111-0000-0000-0000-000000000001'),
  ('a4000000-0000-0000-0000-000000000002','Shadow Trial','assigned','a1111111-0000-0000-0000-000000000001'),
  ('a4000000-0000-0000-0000-000000000003','Shadow Makeup','assigned','a1111111-0000-0000-0000-000000000001');

INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
  ('a4000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001', TRUE),
  ('a4000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000002', TRUE);

INSERT INTO trial_bookings (student_id, class_id, session_date, tenant_id, category_id, booked_by)
SELECT 'a4000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000001','2026-08-08',
       'a1111111-0000-0000-0000-000000000001', cl.category_id, 'a2000000-0000-0000-0000-000000000001'
  FROM classes cl WHERE cl.id='a3000000-0000-0000-0000-000000000001';
INSERT INTO makeup_bookings (student_id, class_id, session_date, tenant_id, category_id, home_class_id, booked_by)
SELECT 'a4000000-0000-0000-0000-000000000003','a3000000-0000-0000-0000-000000000001','2026-08-08',
       'a1111111-0000-0000-0000-000000000001', cl.category_id, 'a3000000-0000-0000-0000-000000000002',
       'a2000000-0000-0000-0000-000000000001'
  FROM classes cl WHERE cl.id='a3000000-0000-0000-0000-000000000001';

-- THREE DISTINCT AMOUNTS, and they are the point. Coach S holds BOTH a main
-- rate (25) and a shadow rate (10): if the rate choice ignores the attribution
-- kind, or re-derives it from a second query, one of those two numbers comes
-- back where the other belongs and the test says so. Coach A's 30 is the third.
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from, role)
SELECT c.id, 30.00, 60, '2026-01-01', 'main'   FROM coaches c WHERE c.profile_id='a2000000-0000-0000-0000-000000000002';
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from, role)
SELECT c.id, 25.00, 60, '2026-01-01', 'main'   FROM coaches c WHERE c.profile_id='a2000000-0000-0000-0000-000000000003';
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from, role)
SELECT c.id, 10.00, 60, '2026-01-01', 'shadow' FROM coaches c WHERE c.profile_id='a2000000-0000-0000-0000-000000000003';
-- Coach N gets a MAIN rate only. They are the "assigned as a shadow with no
-- shadow rate" case (11), and the main rate is what makes the refusal
-- meaningful — a fallback would find it and quietly pay 20.
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from, role)
SELECT c.id, 20.00, 60, '2026-01-01', 'main'   FROM coaches c WHERE c.profile_id='a2000000-0000-0000-0000-000000000004';

-- The lessons. Marked, because session_pays_coach() returns FALSE on a lesson
-- with no attendance at all ("not a lesson that happened") and an unmarked one
-- would assert nothing about attribution.
-- TWO July lessons, deliberately. The seal section needs an absence row that
-- ALREADY EXISTS when the month is sealed (so the DELETE can be refused) and a
-- lesson that still pays (so CASE 4 has a number to assert). One lesson cannot
-- be both.
INSERT INTO lesson_sessions (id, class_id, session_date, status) VALUES
  ('a5000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','2026-08-01','completed'),
  ('a5000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000001','2026-08-08','completed'),
  ('a5000000-0000-0000-0000-000000000003','a3000000-0000-0000-0000-000000000002','2026-08-08','completed'),
  ('a5000000-0000-0000-0000-000000000004','a3000000-0000-0000-0000-000000000001','2026-07-04','completed'),
  ('a5000000-0000-0000-0000-000000000005','a3000000-0000-0000-0000-000000000001','2026-07-11','completed');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
SELECT ls.id,'a4000000-0000-0000-0000-000000000001','present','a2000000-0000-0000-0000-000000000002'
  FROM lesson_sessions ls WHERE ls.id IN (
    'a5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000002',
    'a5000000-0000-0000-0000-000000000003','a5000000-0000-0000-0000-000000000004',
    'a5000000-0000-0000-0000-000000000005');


-- ═══ A. ASSIGNMENT MECHANICS AND THE GUARDS ═══════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT lives_ok(
  $$ SELECT assign_class_shadow('a3000000-0000-0000-0000-000000000001',
       (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003'),
       '2026-07-01') $$,
  'a shadow can be assigned to a CLASS, backdated into an unsealed month');

-- CASE 9 — the one state the whole model exists to make unbuildable. The
-- class's own coach as a shadow OF THAT CLASS is main by the absence rule and
-- shadow by an actual row: the lesson becomes unmarkable AND un-nagged.
SELECT throws_ok(
  $$ SELECT assign_class_shadow('a3000000-0000-0000-0000-000000000001',
       (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000002'),
       '2026-07-01') $$,
  NULL, 'that coach already teaches this class — they cannot also shadow it',
  'CASE 9 — the class''s OWN coach cannot be given a shadow assignment on it');

-- The cross-tenant refusal lives in the stamp trigger, not in a policy: RLS can
-- hide the counterparty row and a check that cannot see a row silently passes.
RESET ROLE;
CREATE TEMP TABLE _foreign_coach AS
  SELECT id FROM coaches WHERE profile_id='c0000000-0000-0000-0000-000000000001';
SELECT isnt((SELECT id FROM _foreign_coach), NULL,
  'the cross-tenant probe has a REAL foreign coach id — not a null that passes for free');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT assign_class_shadow('a3000000-0000-0000-0000-000000000001',
       (SELECT id FROM _foreign_coach), '2026-07-01') $$,
  NULL, NULL,
  'a coach of ANOTHER business cannot be made a shadow of this class');

SELECT throws_ok(
  $$ SELECT assign_class_shadow('a3000000-0000-0000-0000-000000000001',
       (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003'),
       '2026-07-01') $$,
  NULL, NULL,
  'the same coach cannot hold TWO active assignments on one class');


-- ═══ B. VISIBILITY — "today", and it ENDS when the assignment does ════════
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT ok(coach_is_active_class_shadow('a3000000-0000-0000-0000-000000000001'),
  'the shadow is active on the class today');

SELECT is((SELECT count(*)::INT FROM classes WHERE id='a3000000-0000-0000-0000-000000000001'),
  1, 'the shadow can read the CLASS row — without it there is no week card at all');

-- ⚠ THE WHOLE SCHEDULE, NOT ONE LESSON. This is the opposite of a substitute,
-- who sees only the lesson they were named on, and it is why the coach app
-- takes a different DATE SOURCE for a shadowed class (plan RISK 8).
SELECT is((SELECT count(*)::INT FROM lesson_sessions
            WHERE class_id='a3000000-0000-0000-0000-000000000001'),
  4, 'the shadow sees EVERY lesson of the class (all four), not just one');

-- CASE 6 — ⚠ A COUNT, NOT THREE SEPARATE CHECKS. A per-arm test passes
-- two-thirds of the way with an arm missing, and a missing guest arm is not a
-- cosmetic gap: the engine expects the guest, nobody can mark them, the month
-- will not close, there is no override (§8i) and no screen says why.
SELECT is((SELECT count(*)::INT FROM students
            WHERE id IN ('a4000000-0000-0000-0000-000000000001',
                         'a4000000-0000-0000-0000-000000000002',
                         'a4000000-0000-0000-0000-000000000003')),
  3, 'CASE 6 — the shadow sees the enrolled child AND the trial guest AND the make-up guest');

SELECT is((SELECT count(*)::INT FROM trial_bookings WHERE class_id='a3000000-0000-0000-0000-000000000001'),
  1, 'CASE 6 — and the trial BOOKING itself');
SELECT is((SELECT count(*)::INT FROM makeup_bookings WHERE class_id='a3000000-0000-0000-0000-000000000001'),
  1, 'CASE 6 — and the make-up BOOKING itself');

-- CASE 5 — a shadow reads and never marks. Same predicate that decides NEEDS
-- MARKING, deliberately: a nag nobody may answer is worse than no nag.
SELECT ok(NOT coach_is_main_on_session('a5000000-0000-0000-0000-000000000002'),
  'CASE 5 — a shadow is not the main coach of a lesson they shadow');

SELECT throws_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     VALUES ('a5000000-0000-0000-0000-000000000002','a4000000-0000-0000-0000-000000000002',
             'present','a2000000-0000-0000-0000-000000000003') $$,
  NULL, NULL,
  'CASE 5 — and canNOT write attendance');

-- CASE 5 (cont.) — the class's own coach is UNAFFECTED. A shadow assignment
-- must not narrow anybody's write the way a substitute does.
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT ok(coach_is_main_on_session('a5000000-0000-0000-0000-000000000002'),
  'CASE 5 — the class''s own coach still IS the main coach on a shadowed lesson');
SELECT lives_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     VALUES ('a5000000-0000-0000-0000-000000000002','a4000000-0000-0000-0000-000000000002',
             'present','a2000000-0000-0000-0000-000000000002') $$,
  'CASE 5 — and their write is untouched by the shadow assignment');


-- ═══ C. PAY ═══════════════════════════════════════════════════════════════
RESET ROLE;

-- CASE 1 — the shadow rate, not their main rate. Coach S holds both (10 and
-- 25); picking the wrong one is a number this assertion can see.
SELECT is((SELECT amount FROM session_pay_amount('a5000000-0000-0000-0000-000000000002',
    (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003'))),
  10.00::NUMERIC, 'CASE 1 — the shadow is paid their SHADOW rate (10), not their main rate (25)');

SELECT is(coach_attribution_kind('a5000000-0000-0000-0000-000000000002',
    (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003')),
  'shadow', 'and the attribution kind says WHY, so the rate choice never re-derives it');

SELECT is((SELECT amount FROM session_pay_amount('a5000000-0000-0000-0000-000000000002',
    (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000002'))),
  30.00::NUMERIC, 'the class''s own coach is still paid their own rate on a shadowed lesson');

-- CASE 16 — ONE COACH, TWO ARMS. S shadows the class all term AND covers this
-- one lesson. Substitute beats shadow, so S is paid 25, not 10. A boolean
-- predicate cannot express that and the rate would be chosen by a second copy
-- of the rule — §7.129's shape inside §7.129's own function.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT set_session_main_coach('a5000000-0000-0000-0000-000000000001',
  (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003'));
RESET ROLE;

SELECT is(coach_attribution_kind('a5000000-0000-0000-0000-000000000001',
    (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003')),
  'substitute', 'CASE 16 — SUBSTITUTE BEATS SHADOW when one coach satisfies both arms');

SELECT is((SELECT amount FROM session_pay_amount('a5000000-0000-0000-0000-000000000001',
    (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003'))),
  25.00::NUMERIC, 'CASE 16 — and they are paid the SUBSTITUTE rate (25), not the shadow rate (10)');

-- Undo the cover; the rest of the file wants S as a plain shadow.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated"}';
DELETE FROM session_coaches WHERE lesson_session_id='a5000000-0000-0000-0000-000000000001';
RESET ROLE;

-- CASE 2 — an absence suppresses THAT lesson and nothing else.
INSERT INTO session_coach_absences (lesson_session_id, coach_id, tenant_id, marked_by)
SELECT 'a5000000-0000-0000-0000-000000000002', c.id,
       '00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-000000000002'
  FROM coaches c WHERE c.profile_id='a2000000-0000-0000-0000-000000000003';

SELECT is((SELECT amount FROM session_pay_amount('a5000000-0000-0000-0000-000000000002',
    (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003'))),
  NULL, 'CASE 2 — an absence row suppresses the shadow''s pay for THAT lesson');

SELECT is((SELECT amount FROM session_pay_amount('a5000000-0000-0000-0000-000000000001',
    (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003'))),
  10.00::NUMERIC, 'CASE 2 — and NOT for the other lesson of the same class');

SELECT is((SELECT amount FROM session_pay_amount('a5000000-0000-0000-0000-000000000002',
    (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000002'))),
  30.00::NUMERIC, 'CASE 2 — and NOT the main coach''s pay for the same lesson');

-- The tenant stamp fired rather than trusting the caller's zero uuid.
SELECT is((SELECT tenant_id FROM session_coach_absences
            WHERE lesson_session_id='a5000000-0000-0000-0000-000000000002'),
  'a1111111-0000-0000-0000-000000000001'::UUID,
  'the absence row''s tenant is STAMPED, not taken from the caller');

-- CASE 3 — ending an assignment must not change pay INSIDE its date range.
-- This is the whole reason effective_to exists rather than a DELETE: Adjustments
-- A re-asks "what is this coach owed now?" for every paid session, so an
-- assignment that vanished would emit a clawback of pay genuinely earned.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT end_class_shadow('a3000000-0000-0000-0000-000000000001',
  (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003'), '2026-08-10');
RESET ROLE;

SELECT is((SELECT amount FROM session_pay_amount('a5000000-0000-0000-0000-000000000001',
    (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003'))),
  10.00::NUMERIC,
  'CASE 3 — ENDING the assignment does NOT change pay for a lesson inside its range');

-- CASE 7 — but visibility stops dead. The assignment ended 2026-08-10 and
-- today_sg() is later, so "am I a shadow today?" is now FALSE.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000003","role":"authenticated"}';
SELECT ok(NOT coach_is_active_class_shadow('a3000000-0000-0000-0000-000000000001'),
  'CASE 7 — an ENDED shadow is no longer active today');
SELECT is((SELECT count(*)::INT FROM classes WHERE id='a3000000-0000-0000-0000-000000000001'),
  0, 'CASE 7 — and can no longer see the class at all');
SELECT is((SELECT count(*)::INT FROM lesson_sessions
            WHERE class_id='a3000000-0000-0000-0000-000000000001'),
  0, 'CASE 7 — nor any of its lessons');

-- ⚠ RISK 11 — THE TWO DATE QUESTIONS, PROVEN TO BE DIFFERENT QUESTIONS. The
-- pair above and below is what catches somebody merging them into one function:
-- visibility says NO today, pay says YES for a lesson inside the range.
RESET ROLE;
SELECT ok(coach_shadowed_class_on('a3000000-0000-0000-0000-000000000001','2026-08-01',
    (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003')),
  'RISK 11 — pay still answers YES for a date inside the ended range');
SELECT ok(NOT coach_shadowed_class_on('a3000000-0000-0000-0000-000000000001','2026-08-11',
    (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003')),
  'RISK 11 — and NO for a date after it, on the same record');

-- CASE 8 — …unless they become the class's own coach, which restores every
-- read through a different door.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT lives_ok(
  $$ SELECT set_class_terms('a3000000-0000-0000-0000-000000000001','Shadow Lane','saturday',
       '09:00','10:00','Pool', 40,
       (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003')) $$,
  'CASE 10 — the handover is ACCEPTED once the shadow assignment has ended');

SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000003","role":"authenticated"}';
SELECT is((SELECT count(*)::INT FROM classes WHERE id='a3000000-0000-0000-0000-000000000001'),
  1, 'CASE 8 — an ex-shadow who is now the class''s coach sees it again');

-- Hand it back to A so the remaining cases read normally.
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT set_class_terms('a3000000-0000-0000-0000-000000000001','Shadow Lane','saturday',
  '09:00','10:00','Pool', 40,
  (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000002'));

-- CASE 10 — the refusal half. Re-assign S as an ACTIVE shadow, then try the
-- handover in the wrong order.
SELECT assign_class_shadow('a3000000-0000-0000-0000-000000000001',
  (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003'), '2026-08-11');

SELECT throws_ok(
  $$ SELECT set_class_terms('a3000000-0000-0000-0000-000000000001','Shadow Lane','saturday',
       '09:00','10:00','Pool', 40,
       (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000003')) $$,
  NULL, NULL,
  'CASE 10 — a handover ONTO an ACTIVE shadow is refused');

-- CASE 10b — ⚠ THE ASSERTION THAT CATCHES AN UNGATED GUARD. set_class_terms()
-- runs on EVERY class edit and sends the UNCHANGED coach id through the same
-- path, so a guard that does not test "is the coach actually changing?" makes a
-- shadowed class permanently unrenameable. The refusal test above passes with
-- or without the gate; only this one fails.
SELECT lives_ok(
  $$ SELECT set_class_terms('a3000000-0000-0000-0000-000000000001','Renamed Lane','saturday',
       '09:00','10:00','Pool', 40,
       (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000002')) $$,
  'CASE 10b — RENAMING a class that HAS an active shadow still succeeds');

-- CASE 11 — payroll refuses a shadow with no shadow rate. Coach N holds a main
-- rate of 20, so a fallback would find one and quietly pay it.
SELECT assign_class_shadow('a3000000-0000-0000-0000-000000000002',
  (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000004'), '2026-08-01');

-- ⚠ THE MESSAGE IS PINNED, AND THAT IS THE POINT. session_pay_amount() raises
-- on the same condition, so a bare throws_ok() here stays green with the
-- PRE-FLIGHT deleted — a decorative check of exactly the §7.140 kind. Matching
-- the text is what makes this assertion about the pre-flight rather than about
-- "something, somewhere, refused".
SELECT throws_ok(
  $$ SELECT * FROM generate_coach_payouts('a1111111-0000-0000-0000-000000000001','2026-08') $$,
  NULL,
  'a shadow coach has no shadow rate in force — refusing to run payroll rather than pay the wrong rate: Coach N on Quiet Lane, 2026-08-08',
  'CASE 11 — payroll REFUSES when an assigned shadow has no shadow rate in force');

-- End it on its own start date — the class's only lesson is the 8th, so this
-- puts it outside the range and payroll stops refusing. Ending it BEFORE it
-- started is itself refused, which is how this line was first written.
SELECT end_class_shadow('a3000000-0000-0000-0000-000000000002',
  (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000004'), '2026-08-01');


-- ═══ D. THE SEAL — everything after this point is frozen ══════════════════
-- CASE 4's open half first, then the month is paid and the refusals begin.

-- The absence must exist BEFORE the seal, or the seal refuses it and CASE 15
-- has nothing to try to delete. July's two lessons then split: the 4th is
-- suppressed, the 11th pays.
RESET ROLE;
INSERT INTO session_coach_absences (lesson_session_id, coach_id, tenant_id, marked_by)
SELECT 'a5000000-0000-0000-0000-000000000004', c.id,
       '00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-000000000002'
  FROM coaches c WHERE c.profile_id='a2000000-0000-0000-0000-000000000003';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated"}';
CREATE TEMP TABLE _jul AS
  SELECT * FROM generate_coach_payouts('a1111111-0000-0000-0000-000000000001','2026-07');

SELECT is((SELECT gross FROM _jul WHERE coach_name='Coach S'), 10.00::NUMERIC,
  'CASE 4 — backdating into an UNSEALED month pays the shadow for the lesson '
  'they attended, and only that one');

RESET ROLE;
UPDATE coach_payouts SET status='paid', paid_at=now()
 WHERE tenant_id='a1111111-0000-0000-0000-000000000001' AND period_month='2026-07';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- CASE 13 — ⚠ THE SEAL IS TENANT-WIDE, AND THIS IS THE CASE A PER-COACH ONE
-- LETS THROUGH. Coach N has NO payout row for July at all, so "is THIS coach's
-- July paid?" is false and a per-coach guard would allow the backdate — into a
-- month Adjustments B considers settled tenant-wide, where nothing would ever
-- pay them. Two definitions of "settled" in one engine is a hole.
SELECT throws_ok(
  $$ SELECT assign_class_shadow('a3000000-0000-0000-0000-000000000002',
       (SELECT id FROM coaches WHERE profile_id='a2000000-0000-0000-0000-000000000004'),
       '2026-07-01') $$,
  NULL, NULL,
  'CASE 13 — backdating into a month sealed for ANOTHER coach is refused');

-- CASE 15 — a tick REMOVED after the month is paid would emit an unguarded
-- clawback through Adjustments A. The row was written above, before the seal.
RESET ROLE;
SELECT throws_ok(
  $$ DELETE FROM session_coach_absences
      WHERE lesson_session_id='a5000000-0000-0000-0000-000000000004' $$,
  NULL, NULL,
  'CASE 15 — an absence REMOVED after the month is paid is refused by the seal');

-- CASE 14 — ⚠ THE PERMANENT-UNDERPAY CASE, AND IT IS INVISIBLE ON EVERY SCREEN.
-- A tick restored after settlement would be reachable by NEITHER adjustment
-- loop: Adjustments A is driven FROM coach_payout_items and the shadow has no
-- item, Adjustments B was driven FROM session_coaches and a class shadow has no
-- row there. It would simply never be paid. This case will not be written by
-- anybody who has not been told it exists.
SELECT throws_ok(
  $$ INSERT INTO session_coach_absences (lesson_session_id, coach_id, tenant_id, marked_by)
     SELECT 'a5000000-0000-0000-0000-000000000005', c.id,
            '00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-000000000002'
       FROM coaches c WHERE c.profile_id='a2000000-0000-0000-0000-000000000003' $$,
  NULL, NULL,
  'CASE 14 — an absence WRITTEN into a paid month is refused by the same seal');


-- ═══ D1b. ADJUSTMENTS B'S CLASS-SHADOW ARM — the permanent-underpay insurance
--
-- ⚠ THIS CASE IS ONLY REACHABLE WITH THE SEAL RELAXED, WHICH IS THE POINT.
-- While the seal holds, nothing can newly owe a shadow money for a settled
-- month — so the arm is insurance, and insurance nobody tests is a comment.
-- The trigger is disabled for one statement to produce exactly the state the
-- arm exists for, then put back.
--
-- Coach S was recorded ABSENT on 2026-07-04 before July was sealed, so their
-- paid July payout has NO item for that lesson. Adjustments A is driven FROM
-- coach_payout_items and therefore cannot see it; Adjustments B was driven from
-- session_coaches alone, where a class shadow has no row. Delete the absence and
-- the money is owed and reachable by NEITHER loop — a permanent, silent
-- underpayment that no screen would ever show.
RESET ROLE;
ALTER TABLE session_coach_absences DISABLE TRIGGER trg_session_absence_seal;
DELETE FROM session_coach_absences
 WHERE lesson_session_id = 'a5000000-0000-0000-0000-000000000004';
ALTER TABLE session_coach_absences ENABLE TRIGGER trg_session_absence_seal;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated"}';
CREATE TEMP TABLE _sep AS
  SELECT * FROM generate_coach_payouts('a1111111-0000-0000-0000-000000000001','2026-09');

SELECT is((SELECT gross FROM _sep WHERE coach_name='Coach S'), 10.00::NUMERIC,
  'ADJUSTMENTS B — a shadow newly owed for a SETTLED month is paid, exactly once');

-- Re-running must not pay it again. session_carried_for_coach() is what makes
-- that true, and 20260719000900 exists because a first version re-emitted the
-- difference every period, for ever.
SELECT generate_coach_payouts('a1111111-0000-0000-0000-000000000001','2026-09');
SELECT generate_coach_payouts('a1111111-0000-0000-0000-000000000001','2026-10');
RESET ROLE;
SELECT is(
  (SELECT COALESCE(SUM(i.amount),0) FROM coach_payout_items i
     JOIN coach_payouts pay ON pay.id = i.payout_id
     JOIN coaches co ON co.id = pay.coach_id
    WHERE i.lesson_session_id = 'a5000000-0000-0000-0000-000000000004'
      AND co.profile_id = 'a2000000-0000-0000-0000-000000000003'),
  10.00::NUMERIC,
  'CARRIED ONCE — across a re-run and a later period it totals 10, not 20 or 30');


-- ═══ D2. session_shadow_coaches — WHO MAY ASK, AND FOR WHICH DATE ════════
-- ⚠ THE POINT OF THIS FUNCTION IS THAT RLS HIDES ITS ANSWER FROM THE ONE
-- PERSON WHO NEEDS IT. class_shadow_coaches_select is `admin OR coach_id =
-- current_coach_id()`, so a SUBSTITUTE covering a lesson can read none of its
-- shadows — and they are the coach who ticks the box. A plain table read here
-- returns an empty list and the screen silently shows no section at all.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a2000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::INT FROM session_shadow_coaches(
     'a3000000-0000-0000-0000-000000000001', '2026-08-01')),
  1,
  'the lesson''s MAIN coach can read who shadows it');

SELECT is(
  (SELECT count(*)::INT FROM class_shadow_coaches
    WHERE class_id = 'a3000000-0000-0000-0000-000000000001'),
  0,
  '…while a direct table read returns NOTHING for them — which is why the RPC exists');

-- ⚠ THE LESSON''S DATE, NOT TODAY''S. S holds two records by now — 1 Jul to
-- 10 Aug, then 11 Aug onward — so a date BEFORE the first one lists nobody even
-- though S is a shadow of this class today. Asking "today" instead would put a
-- shadow on every lesson the class ever ran, including ones before they joined,
-- and pay them for all of them.
SELECT is(
  (SELECT count(*)::INT FROM session_shadow_coaches(
     'a3000000-0000-0000-0000-000000000001', '2026-06-06')),
  0,
  'and a date BEFORE the assignment began lists nobody — the range is the lesson''s');

RESET ROLE;


-- ═══ E. CASE 12 — GRANTS, BY EXACT SIGNATURE ══════════════════════════════
-- DROP+CREATE does not carry a grant the way CREATE OR REPLACE does (§7.124),
-- so a new signature that nobody granted is callable by nobody. Named by exact
-- signature on purpose: a probe naming a signature that no longer exists ERRORS
-- and aborts the whole file rather than failing one check.
RESET ROLE;

SELECT ok(has_function_privilege('authenticated',
    'public.assign_session_coach(uuid,date,uuid)', 'EXECUTE'),
  'CASE 12 — the NEW 3-arg assign_session_coach is granted to authenticated');

-- The 4-arg COMPAT SHIM had its own assertion here across the §7.123 deploy
-- window. 20260812000300 dropped it (and session_coach_role with it), so the
-- assertion is DELETED rather than inverted — the count below is what proves
-- the shim is gone, and it cannot pass by accident the way a NOT ok() could.
SELECT is(
  (SELECT count(*)::INT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='assign_session_coach'),
  1, 'CASE 12 — exactly ONE assign_session_coach row: the shim is DROPPED (20260812000300)');

SELECT ok(
  bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  'CASE 12 — every new gate this wave adds is EXECUTE-able by authenticated')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('coach_is_active_class_shadow','coach_shadowed_class_on',
                     'coach_rate_on','coach_attribution_kind',
                     'assign_class_shadow','end_class_shadow',
                     'session_shadow_coaches');

SELECT ok(
  NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')),
  'CASE 12 — and anon holds EXECUTE on NONE of them (§7.82, §7.85)')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('coach_is_active_class_shadow','coach_shadowed_class_on',
                     'coach_rate_on','coach_attribution_kind','assign_class_shadow',
                     'end_class_shadow','assign_session_coach','assert_payout_month_open',
                     'session_shadow_coaches');

-- assert_payout_month_open() is called only from other SECURITY DEFINER bodies
-- and from a trigger. Nothing outside the database calls it, so it is
-- deliberately ungranted — and that is an assertion, not an omission.
SELECT ok(NOT has_function_privilege('authenticated',
    'public.assert_payout_month_open(uuid,date,text)', 'EXECUTE'),
  'CASE 12 — the internal seal helper is deliberately granted to NOBODY');

SELECT * FROM finish();
ROLLBACK;
