-- pgTAP: coach wages (phase 5).
--
-- Covers the pay-decision table, pro-rata arithmetic, the class flat-rate
-- override, EFFECTIVE-DATED RATES (a raise must not reprice history), the
-- draft/freeze lifecycle, and cross-coach payout isolation.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(36);

INSERT INTO tenants (id, slug, display_name, join_code, rain_pays_coach)
VALUES ('88888888-0000-0000-0000-000000000001','wages','Wages Swim','SWIM-WAGE', FALSE);

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','77000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','wage-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Wage Admin","role":"tenant_admin","tenant_id":"88888888-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','77000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','wage-coach@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Wage Coach","role":"coach","tenant_id":"88888888-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','77000000-0000-0000-0000-000000000003',
   'authenticated','authenticated','wage-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Wage Parent","role":"parent"}', now(), now(), '', '', '', '');

-- A 90-minute class, so pro-rata is actually exercised (60 would hide it).
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson)
SELECT '66000000-0000-0000-0000-000000000001', c.id, 'Long Lane', 'saturday','10:00','11:30','Pool', 40
  FROM coaches c WHERE c.profile_id = '77000000-0000-0000-0000-000000000002';

INSERT INTO students (id, full_name, assignment_status, tenant_id) VALUES
  ('55000000-0000-0000-0000-000000000001','Wage Kid','assigned','88888888-0000-0000-0000-000000000001');
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '55000000-0000-0000-0000-000000000001' FROM parents p WHERE p.profile_id='77000000-0000-0000-0000-000000000003';
INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('55000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001', TRUE);

-- $30 per 60 min from Jan 2026.
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from)
SELECT c.id, 30.00, 60, '2026-01-01' FROM coaches c WHERE c.profile_id='77000000-0000-0000-0000-000000000002';

-- Four sessions covering the decision table.
INSERT INTO lesson_sessions (id, class_id, session_date, status) VALUES
  ('44000000-0000-0000-0000-00000000000a','66000000-0000-0000-0000-000000000001','2026-03-07','completed'),
  ('44000000-0000-0000-0000-00000000000b','66000000-0000-0000-0000-000000000001','2026-03-14','completed'),
  ('44000000-0000-0000-0000-00000000000c','66000000-0000-0000-0000-000000000001','2026-03-21','completed'),
  ('44000000-0000-0000-0000-00000000000d','66000000-0000-0000-0000-000000000001','2026-03-28','completed');

INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('44000000-0000-0000-0000-00000000000a','55000000-0000-0000-0000-000000000001','present','77000000-0000-0000-0000-000000000002'),
  ('44000000-0000-0000-0000-00000000000b','55000000-0000-0000-0000-000000000001','absent','77000000-0000-0000-0000-000000000002'),
  ('44000000-0000-0000-0000-00000000000c','55000000-0000-0000-0000-000000000001','cancelled_rain','77000000-0000-0000-0000-000000000002'),
  ('44000000-0000-0000-0000-00000000000d','55000000-0000-0000-0000-000000000001','cancelled_coach','77000000-0000-0000-0000-000000000002');

-- ── The pay-decision table ─────────────────────────────────────────────────
SELECT ok(session_pays_coach('44000000-0000-0000-0000-00000000000a'),
          'a student attended -> pays');
SELECT ok(NOT session_pays_coach('44000000-0000-0000-0000-00000000000b'),
          'everyone absent -> does NOT pay (the lesson ran on paper, nobody came)');
SELECT ok(NOT session_pays_coach('44000000-0000-0000-0000-00000000000c'),
          'rained off, tenant does not pay for rain -> does NOT pay');
SELECT ok(NOT session_pays_coach('44000000-0000-0000-0000-00000000000d'),
          'cancelled by the coach -> never pays');

-- Rain is the tenant's policy.
UPDATE tenants SET rain_pays_coach = TRUE WHERE id='88888888-0000-0000-0000-000000000001';
SELECT ok(session_pays_coach('44000000-0000-0000-0000-00000000000c'),
          'rained off, tenant DOES pay for rain -> pays');

-- cancelled_coach is NOT configurable, even by an override.
INSERT INTO session_pay_overrides (lesson_session_id, pays_coach)
VALUES ('44000000-0000-0000-0000-00000000000d', TRUE);
SELECT ok(NOT session_pays_coach('44000000-0000-0000-0000-00000000000d'),
          'a coach-cancelled lesson stays unpaid even with an override set');

-- A per-session override does apply to the absent case.
INSERT INTO session_pay_overrides (lesson_session_id, pays_coach)
VALUES ('44000000-0000-0000-0000-00000000000b', TRUE);
SELECT ok(session_pays_coach('44000000-0000-0000-0000-00000000000b'),
          'an admin override can pay an otherwise-unpaid session');
DELETE FROM session_pay_overrides WHERE lesson_session_id='44000000-0000-0000-0000-00000000000b';

-- ── Amount: pro-rata, never rounded up ─────────────────────────────────────
SELECT is((SELECT amount FROM session_pay_amount('44000000-0000-0000-0000-00000000000a')),
          45.00, '90 min at $30/60min = $45.00, pro-rata not rounded up to $60');
SELECT is((SELECT basis FROM session_pay_amount('44000000-0000-0000-0000-00000000000a')),
          'duration', 'basis records HOW the amount was derived');

-- ── EFFECTIVE DATING: a raise must not reprice history ─────────────────────
-- The single most important property in this phase. A mutable rate column
-- would silently change a coach's March payout because of a June decision.
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from)
SELECT c.id, 60.00, 60, '2026-06-01' FROM coaches c WHERE c.profile_id='77000000-0000-0000-0000-000000000002';

SELECT is((SELECT amount FROM session_pay_amount('44000000-0000-0000-0000-00000000000a')),
          45.00, 'a June raise does NOT reprice a March lesson');

INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('44000000-0000-0000-0000-00000000000e','66000000-0000-0000-0000-000000000001','2026-07-04','completed');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('44000000-0000-0000-0000-00000000000e','55000000-0000-0000-0000-000000000001','present','77000000-0000-0000-0000-000000000002');
SELECT is((SELECT amount FROM session_pay_amount('44000000-0000-0000-0000-00000000000e')),
          90.00, 'a July lesson uses the NEW rate: 90 min at $60/60min');

-- ── Class flat-rate override REPLACES the calculation ──────────────────────
INSERT INTO class_rate_overrides (class_id, flat_amount, effective_from)
VALUES ('66000000-0000-0000-0000-000000000001', 25.00, '2026-01-01');
SELECT is((SELECT amount FROM session_pay_amount('44000000-0000-0000-0000-00000000000a')),
          25.00, 'a class flat rate replaces the duration calculation entirely');
SELECT is((SELECT basis FROM session_pay_amount('44000000-0000-0000-0000-00000000000a')),
          'flat', 'and says so in the basis');
DELETE FROM class_rate_overrides WHERE class_id='66000000-0000-0000-0000-000000000001';

-- ── Generation + freeze ────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT gross FROM generate_coach_payouts('88888888-0000-0000-0000-000000000001','2026-03')),
  90.00,
  'March pays for the attended lesson AND the rained-off one (rain now paid): 45 + 45'
);

-- A coach must not see a colleague's payout, but must see their own.
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"77000000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT is((SELECT COUNT(*) FROM coach_payouts)::int, 1,
          'a coach sees their own payout');

-- Rates are admin-only, even the coach's own: a rate row is per-coach, and a
-- colleague's earnings must not be inferable.
SELECT is((SELECT COUNT(*) FROM coach_rates)::int, 0,
          'a coach cannot read rate rows at all');

-- ── Draft → frozen, and adjustments ────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- A DRAFT rebuilds freely: this is why ordinary late corrections need no
-- adjustment machinery at all. Mark the absent lesson present and re-run.
RESET ROLE;
UPDATE attendance SET status = 'present'
 WHERE lesson_session_id = '44000000-0000-0000-0000-00000000000b';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT gross FROM generate_coach_payouts('88888888-0000-0000-0000-000000000001','2026-03')),
  135.00,
  'a DRAFT payout absorbs a late correction on re-run: 45 x 3'
);

-- Freeze it.
SELECT lives_ok(
  $$ SELECT mark_payout_paid((SELECT id FROM coach_payouts WHERE period_month='2026-03')) $$,
  'the admin can mark a payout paid'
);
SELECT is((SELECT status::text FROM coach_payouts WHERE period_month='2026-03'), 'paid',
          'and it is frozen');

-- A correction to a FROZEN period must not rewrite it...
RESET ROLE;
UPDATE attendance SET status = 'absent'
 WHERE lesson_session_id = '44000000-0000-0000-0000-00000000000b';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- PERFORM is plpgsql-only; in a plain SQL script this must be a SELECT.
SELECT * FROM generate_coach_payouts('88888888-0000-0000-0000-000000000001','2026-04');

SELECT is((SELECT gross_amount FROM coach_payouts WHERE period_month='2026-03'), 135.00,
          'the PAID period is untouched by a later correction — it matches the bank');

-- ...it becomes a negative adjustment on the next period instead.
SELECT is(
  (SELECT amount FROM coach_payout_items i
     JOIN coach_payouts p ON p.id = i.payout_id
    WHERE p.period_month='2026-04' AND i.is_adjustment),
  -45.00,
  'the difference carries forward as an adjustment on the next payout'
);

-- ── MULTIPLE raises over time ──────────────────────────────────────────────
-- One raise is easy to get right by accident; the real question is whether the
-- rule holds across a series. Each lesson looks up the rate in force ON ITS OWN
-- DATE, so there is no accumulated state to drift and no number of raises
-- changes the answer for an earlier month.
RESET ROLE;
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from)
SELECT c.id, 90.00, 60, '2026-10-01' FROM coaches c WHERE c.profile_id='77000000-0000-0000-0000-000000000002';

INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('44000000-0000-0000-0000-00000000000f','66000000-0000-0000-0000-000000000001','2026-11-07','completed');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('44000000-0000-0000-0000-00000000000f','55000000-0000-0000-0000-000000000001','present','77000000-0000-0000-0000-000000000002');

-- The class is 90 minutes, so each is 1.5x the hourly rate.
SELECT is((SELECT amount FROM session_pay_amount('44000000-0000-0000-0000-00000000000a')),
          45.00, 'after a THIRD raise, the March lesson still prices at the Jan rate');
SELECT is((SELECT amount FROM session_pay_amount('44000000-0000-0000-0000-00000000000e')),
          90.00, 'and the July lesson still prices at the June rate, not October''s');
SELECT is((SELECT amount FROM session_pay_amount('44000000-0000-0000-0000-00000000000f')),
          135.00, 'only a November lesson gets the October rate');

-- ══════════════════════════════════════════════════════════════════════════
-- HANDOVER: changing a class's coach must NOT move its history (20260719000800)
--
-- Before effective-dated attribution, payroll resolved the coach through
-- classes.coach_id at compute time. Handing a class over therefore moved the
-- ENTIRE unpaid history with it: the outgoing coach's draft dropped to zero and
-- the incoming coach was paid, at their own rate, for lessons they never
-- taught. These pin that it cannot happen again.
-- ══════════════════════════════════════════════════════════════════════════
RESET ROLE;

-- A second coach in the same business, on a DIFFERENT rate so a misattributed
-- lesson shows up as a wrong amount, not just a wrong name.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','77000000-0000-0000-0000-000000000004',
   'authenticated','authenticated','wage-coach-b@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Wage Coach B","role":"coach","tenant_id":"88888888-0000-0000-0000-000000000001"}', now(), now(), '', '', '', '');

INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from)
SELECT c.id, 20.00, 60, '2026-01-01' FROM coaches c WHERE c.profile_id='77000000-0000-0000-0000-000000000004';

-- Coach B takes the class over from 15 Dec 2026. The class row itself moves to
-- them too — that is what a real handover does, and it is exactly what used to
-- drag the history along.
INSERT INTO class_rates (class_id, price_per_lesson, paid_coach_id, effective_from)
SELECT '66000000-0000-0000-0000-000000000001', 40.00, c.id, '2026-12-15'
  FROM coaches c WHERE c.profile_id='77000000-0000-0000-0000-000000000004';
UPDATE classes SET coach_id = (SELECT id FROM coaches WHERE profile_id='77000000-0000-0000-0000-000000000004')
 WHERE id='66000000-0000-0000-0000-000000000001';

-- One lesson each side of the handover.
INSERT INTO lesson_sessions (id, class_id, session_date, status) VALUES
  ('44000000-0000-0000-0000-0000000000b1','66000000-0000-0000-0000-000000000001','2026-12-05','completed'),
  ('44000000-0000-0000-0000-0000000000b2','66000000-0000-0000-0000-000000000001','2026-12-19','completed');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('44000000-0000-0000-0000-0000000000b1','55000000-0000-0000-0000-000000000001','present','77000000-0000-0000-0000-000000000002'),
  ('44000000-0000-0000-0000-0000000000b2','55000000-0000-0000-0000-000000000001','present','77000000-0000-0000-0000-000000000002');

-- Coach A is on $90/hr from Oct; the class is 90 min -> $135. Coach B is on
-- $20/hr -> $30. Wildly different, so a misattribution cannot hide.
SELECT is((SELECT amount FROM session_pay_amount('44000000-0000-0000-0000-0000000000b1')),
          135.00, 'a lesson BEFORE the handover still pays the ORIGINAL coach''s rate');
SELECT is((SELECT amount FROM session_pay_amount('44000000-0000-0000-0000-0000000000b2')),
          30.00, 'a lesson AFTER the handover pays the NEW coach''s rate');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT * FROM generate_coach_payouts('88888888-0000-0000-0000-000000000001','2026-12');

-- Asserted on THIS PERIOD'S OWN lessons (is_adjustment = FALSE) rather than
-- gross_amount: gross also carries adjustments from earlier frozen months,
-- which is unrelated to attribution — and is itself buggy, see the note at the
-- end of this file.
SELECT is(
  (SELECT COALESCE(SUM(i.amount),0) FROM coach_payout_items i
     JOIN coach_payouts p ON p.id=i.payout_id JOIN coaches c ON c.id=p.coach_id
    WHERE p.period_month='2026-12' AND NOT i.is_adjustment
      AND c.profile_id='77000000-0000-0000-0000-000000000002'),
  135.00,
  'the OUTGOING coach is still paid for the lesson they taught before handing over'
);
SELECT is(
  (SELECT COALESCE(SUM(i.amount),0) FROM coach_payout_items i
     JOIN coach_payouts p ON p.id=i.payout_id JOIN coaches c ON c.id=p.coach_id
    WHERE p.period_month='2026-12' AND NOT i.is_adjustment
      AND c.profile_id='77000000-0000-0000-0000-000000000004'),
  30.00,
  'the INCOMING coach is paid only for lessons from the handover date onward'
);

-- ── A frozen payout must not move, and must not spawn adjustments ──────────
SELECT lives_ok(
  $$ SELECT mark_payout_paid((SELECT p.id FROM coach_payouts p JOIN coaches c ON c.id=p.coach_id
       WHERE p.period_month='2026-12' AND c.profile_id='77000000-0000-0000-0000-000000000002')) $$,
  'the outgoing coach''s December payout can be marked paid'
);

-- Now hand the class over AGAIN, retroactively enough to have repriced
-- December under the old engine. The paid record must be untouched.
RESET ROLE;
INSERT INTO class_rates (class_id, price_per_lesson, paid_coach_id, effective_from)
SELECT '66000000-0000-0000-0000-000000000001', 40.00, c.id, '2027-01-05'
  FROM coaches c WHERE c.profile_id='77000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT * FROM generate_coach_payouts('88888888-0000-0000-0000-000000000001','2027-01');

SELECT is(
  (SELECT COALESCE(SUM(i.amount),0) FROM coach_payout_items i
     JOIN coach_payouts p ON p.id=i.payout_id JOIN coaches c ON c.id=p.coach_id
    WHERE p.period_month='2026-12' AND NOT i.is_adjustment
      AND c.profile_id='77000000-0000-0000-0000-000000000002'),
  135.00,
  'the FROZEN December payout is unchanged after a later handover'
);
SELECT is(
  (SELECT p.status FROM coach_payouts p JOIN coaches c ON c.id=p.coach_id
    WHERE p.period_month='2026-12' AND c.profile_id='77000000-0000-0000-0000-000000000002')::TEXT,
  'paid',
  'and is still frozen'
);
SELECT is(
  (SELECT COUNT(*)::INT FROM coach_payout_items i JOIN coach_payouts p ON p.id=i.payout_id
    WHERE p.period_month='2027-01' AND i.is_adjustment
      AND i.lesson_session_id IN ('44000000-0000-0000-0000-0000000000b1',
                                  '44000000-0000-0000-0000-0000000000b2')),
  0,
  'a handover generates ZERO adjustments — attribution is not an amount change'
);

-- ── A lesson with no terms in force must refuse, not vanish ────────────────
RESET ROLE;
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, tenant_id)
SELECT '66000000-0000-0000-0000-000000000009', c.id, 'Rateless', 'sunday','10:00','11:00','Pool', 40,
       '88888888-0000-0000-0000-000000000001'
  FROM coaches c WHERE c.profile_id='77000000-0000-0000-0000-000000000002';
INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('44000000-0000-0000-0000-0000000000c1','66000000-0000-0000-0000-000000000009','2027-02-07','completed');
-- Break the invariant the floor-dated backfill guarantees.
DELETE FROM class_rates WHERE class_id='66000000-0000-0000-0000-000000000009';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM generate_coach_payouts('88888888-0000-0000-0000-000000000001','2027-02') $$,
  NULL,
  NULL,
  'payroll refuses outright rather than silently dropping a lesson with no terms'
);

-- ══════════════════════════════════════════════════════════════════════════
-- AN ADJUSTMENT IS CARRIED ONCE (20260719000900)
--
-- Found while writing the handover tests above: the -45.00 correction to the
-- 14 Mar lesson was re-emitted on 2026-04, 2026-12 AND 2027-01, and would have
-- recurred on every payout forever — docking the coach the same $45 each month.
-- The assertions above are scoped to non-adjustment items so they measure
-- attribution rather than this; these measure this directly.
-- ══════════════════════════════════════════════════════════════════════════

SELECT is(
  (SELECT COUNT(*)::INT FROM coach_payout_items i
     JOIN coach_payouts p ON p.id = i.payout_id
     JOIN coaches c ON c.id = p.coach_id
    WHERE c.profile_id='77000000-0000-0000-0000-000000000002'
      AND i.is_adjustment AND i.lesson_session_id='44000000-0000-0000-0000-00000000000b'),
  1,
  'the March correction is carried on exactly ONE payout, not re-emitted on every later one'
);

SELECT is(
  (SELECT COALESCE(SUM(i.amount),0) FROM coach_payout_items i
     JOIN coach_payouts p ON p.id = i.payout_id
     JOIN coaches c ON c.id = p.coach_id
    WHERE c.profile_id='77000000-0000-0000-0000-000000000002'
      AND i.is_adjustment AND i.lesson_session_id='44000000-0000-0000-0000-00000000000b'),
  -45.00,
  'and the total carried equals the correction exactly — once, not N times'
);

-- A SECOND genuine correction to the same already-paid lesson must still flow.
-- This is why the fix is a running total rather than "emit once, then never
-- again": that simpler rule would silently swallow this.
RESET ROLE;
UPDATE attendance SET status='present'
 WHERE lesson_session_id='44000000-0000-0000-0000-00000000000b';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT * FROM generate_coach_payouts('88888888-0000-0000-0000-000000000001','2027-03');

SELECT is(
  (SELECT COALESCE(SUM(i.amount),0) FROM coach_payout_items i
     JOIN coach_payouts p ON p.id = i.payout_id
     JOIN coaches c ON c.id = p.coach_id
    WHERE c.profile_id='77000000-0000-0000-0000-000000000002'
      AND i.is_adjustment AND i.lesson_session_id='44000000-0000-0000-0000-00000000000b'),
  0.00,
  'a SECOND correction restoring the lesson nets the carried adjustments back to zero'
);

SELECT * FROM finish();
ROLLBACK;
