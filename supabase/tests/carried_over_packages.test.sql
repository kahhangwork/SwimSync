-- pgTAP: CARRIED-OVER PACKAGES — a package bought before SwimSync, brought in mid-cycle (20261118000200).
-- docs/plans/CARRIED_OVER_PACKAGES_PLAN.md (plan-reviewed; D1–D4 + Q1 are the user's, 2026-11-18).
--
-- WHAT THIS FILE PROTECTS.
--   (1) the row: balance = remaining × rate, S$0 paid, coverage starts TODAY, expiry = ORIGINAL start + weeks (D1/D2);
--   (2) nothing dated before today draws, and an earlier unmarked lesson does not block today's mark (D1);
--   (3) every expiry recompute — holiday, cancel, Extend, activation, Change child — anchors on the ORIGINAL start;
--       the nominal holiday window ends at original + weeks and starts at today (the START side is unchanged);
--   (4) refund cap = value left NOW (Q1); S$0 package revenue on Accounting (D3);
--   (5) no referral discount, no reward settled, no referrer reward minted (D6; a PENDING referral is refused since
--       20261118000400); an open offer is superseded (RISK 12);
--   (6) refusals: bounds, dates, roles, tenant, kind, direct table writes, the double-submit index (D8);
--   (7) the census lint — no function recomputes expiry from start_date alone (§6, permanent); grants (§7.87).
--
-- METHOD (§7.16): probes run as `authenticated` with an explicit jwt sub; fixture writes and marks as postgres.
--
-- FIXTURE (prefix c0…). Clock 2026-11-18 (Wed). Tenant A created 200 days ago, never billed → every Wednesday since
-- is markable. One Wednesday class. Product C10 = 10 lessons @ S$30, 10 weeks, any class; N5 = 5 @ S$30 (a normal
-- sale); S10 = one-child 10 @ S$30; RET = retired. Families: d1 Ava · d2 Ben · d3 Cai+Cal · d4 Dee · d5 Eli ·
-- d6 Fay · d7 not in A.
--
-- RED FIRST (§7.25): before 20261118000200 the file fails at 2 — record_carried_over_package does not exist.
-- MUTATION PROOFS are listed at the end of the file.

BEGIN;
SELECT set_config('swimsync.now', '2026-11-18 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(52);
SELECT is(app_today(), '2026-11-18'::date, 'clock pinned');

INSERT INTO tenants (id, slug, display_name, join_code, created_at, referral_enabled,
                     referral_discount_type, referral_discount_value) VALUES
  ('c0000000-0000-0000-0000-0000000000a0','co-a','CO A','SWIM-COAA', app_now() - INTERVAL '200 days', TRUE, 'percent', 10),
  ('c0000000-0000-0000-0000-0000000000b0','co-b','CO B','SWIM-COBB', app_now() - INTERVAL '200 days', FALSE, NULL, NULL);

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;

-- a1 owner A · b1 owner B · c1 coach A · d1..d7 parents
SELECT pg_temp.mkuser('c0100000-0000-0000-0000-0000000000a1','co-owner@test.local',
  '{"full_name":"CO Owner","role":"tenant_admin","tenant_id":"c0000000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('c0100000-0000-0000-0000-0000000000b1','co-owner2@test.local',
  '{"full_name":"CO Owner2","role":"tenant_admin","tenant_id":"c0000000-0000-0000-0000-0000000000b0"}');
SELECT pg_temp.mkuser('c0100000-0000-0000-0000-0000000000c1','co-coach@test.local',
  '{"full_name":"CO Coach","role":"coach","tenant_id":"c0000000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser(('c0100000-0000-0000-0000-0000000000d' || n)::uuid, 'co-parent' || n || '@test.local',
  jsonb_build_object('full_name','CO Parent ' || n,'role','parent'))
  FROM generate_series(1, 7) n;
UPDATE tenants SET owner_profile_id = 'c0100000-0000-0000-0000-0000000000a1' WHERE id = 'c0000000-0000-0000-0000-0000000000a0';
UPDATE tenants SET owner_profile_id = 'c0100000-0000-0000-0000-0000000000b1' WHERE id = 'c0000000-0000-0000-0000-0000000000b0';

CREATE TEMP TABLE ids (k TEXT PRIMARY KEY, v UUID);
GRANT ALL ON ids TO PUBLIC;
INSERT INTO ids SELECT 'P' || n, p.id FROM generate_series(1, 7) n
  JOIN parents p ON p.profile_id = ('c0100000-0000-0000-0000-0000000000d' || n)::uuid;
CREATE OR REPLACE FUNCTION pg_temp.id(p_k TEXT) RETURNS UUID AS $$ SELECT v FROM ids WHERE k = p_k $$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT pg_temp.id('P' || n), 'c0000000-0000-0000-0000-0000000000a0' FROM generate_series(1, 6) n;
INSERT INTO parent_tenants (parent_id, tenant_id) VALUES (pg_temp.id('P7'), 'c0000000-0000-0000-0000-0000000000b0');

INSERT INTO locations (id, tenant_id, name) VALUES
  ('c0800000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000a0','CO Pool');
INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('c0400000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000a0','CO Group');
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT 'c0500000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000a0', c.id, 'CO Dolphins',
       'wednesday', '09:00', '10:00', 'c0800000-0000-0000-0000-000000000001', 40.00, 'c0400000-0000-0000-0000-000000000001'
  FROM coaches c WHERE c.profile_id = 'c0100000-0000-0000-0000-0000000000c1';

INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id) VALUES
  ('c0300000-0000-0000-0000-000000000001','CO Ava','assigned',TRUE,'c0000000-0000-0000-0000-0000000000a0'),
  ('c0300000-0000-0000-0000-000000000002','CO Ben','assigned',TRUE,'c0000000-0000-0000-0000-0000000000a0'),
  ('c0300000-0000-0000-0000-000000000003','CO Cai','assigned',TRUE,'c0000000-0000-0000-0000-0000000000a0'),
  ('c0300000-0000-0000-0000-000000000004','CO Cal','assigned',TRUE,'c0000000-0000-0000-0000-0000000000a0'),
  ('c0300000-0000-0000-0000-000000000005','CO Dee','assigned',TRUE,'c0000000-0000-0000-0000-0000000000a0'),
  ('c0300000-0000-0000-0000-000000000006','CO Eli','assigned',TRUE,'c0000000-0000-0000-0000-0000000000a0'),
  ('c0300000-0000-0000-0000-000000000007','CO Fay','assigned',TRUE,'c0000000-0000-0000-0000-0000000000a0');
INSERT INTO parent_students (parent_id, student_id) VALUES
  (pg_temp.id('P1'),'c0300000-0000-0000-0000-000000000001'),
  (pg_temp.id('P2'),'c0300000-0000-0000-0000-000000000002'),
  (pg_temp.id('P3'),'c0300000-0000-0000-0000-000000000003'), (pg_temp.id('P3'),'c0300000-0000-0000-0000-000000000004'),
  (pg_temp.id('P4'),'c0300000-0000-0000-0000-000000000005'),
  (pg_temp.id('P5'),'c0300000-0000-0000-0000-000000000006'),
  (pg_temp.id('P6'),'c0300000-0000-0000-0000-000000000007');
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT s, 'c0500000-0000-0000-0000-000000000001', (DATE '2026-10-07' + TIME '12:00') AT TIME ZONE 'Asia/Singapore', TRUE
  FROM unnest(ARRAY['c0300000-0000-0000-0000-000000000001','c0300000-0000-0000-0000-000000000003',
                    'c0300000-0000-0000-0000-000000000004','c0300000-0000-0000-0000-000000000005',
                    'c0300000-0000-0000-0000-000000000006']::uuid[]) s;

INSERT INTO package_products (id, tenant_id, name, lesson_count, rate_per_lesson, validity_weeks, single_child, is_active) VALUES
  ('c0600000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000a0','C10',10,30.00,10,FALSE,TRUE),
  ('c0600000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-0000000000a0','N5', 5,30.00,10,FALSE,TRUE),
  ('c0600000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000000a0','S10',10,30.00,10,TRUE,TRUE),
  ('c0600000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-0000000000a0','RET',10,30.00,10,FALSE,FALSE);

CREATE OR REPLACE FUNCTION pg_temp.s(p_date DATE) RETURNS UUID AS $$
DECLARE v UUID;
BEGIN
  SELECT id INTO v FROM lesson_sessions WHERE class_id = 'c0500000-0000-0000-0000-000000000001' AND session_date = p_date;
  IF v IS NULL THEN
    INSERT INTO lesson_sessions (class_id, session_date, start_time, end_time)
    VALUES ('c0500000-0000-0000-0000-000000000001', p_date, '09:00', '10:00') RETURNING id INTO v;
  END IF;
  RETURN v;
END $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION pg_temp.mark(p_date DATE, p_student UUID, p_status TEXT) RETURNS VOID AS $$
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
  VALUES (pg_temp.s(p_date), p_student, p_status::attendance_status, 'c0100000-0000-0000-0000-0000000000a1')
  ON CONFLICT (lesson_session_id, student_id) DO UPDATE SET status = EXCLUDED.status $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.pkg(p_parent TEXT) RETURNS UUID AS $$
  SELECT id FROM parent_packages WHERE parent_id = pg_temp.id(p_parent) AND carried_over_start IS NOT NULL
   ORDER BY confirmed_at DESC, id LIMIT 1 $$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION pg_temp.row(p_id UUID) RETURNS TEXT AS $$
  SELECT value_remaining || '/' || amount_payable || '/' || discount_amount || '/' || start_date || '/' || expires_on
         || '/' || status || '/' || lesson_count || '/' || carried_over_lessons
    FROM parent_packages WHERE id = p_id $$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION pg_temp.apps(p_date DATE, p_student UUID) RETURNS INTEGER AS $$
  SELECT count(*)::int FROM package_applications pa JOIN lesson_sessions ls ON ls.id = pa.lesson_session_id
   WHERE ls.class_id = 'c0500000-0000-0000-0000-000000000001' AND ls.session_date = p_date
     AND pa.student_id = p_student AND pa.reversed_at IS NULL $$ LANGUAGE sql STABLE;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

-- Referral state for Fay (d6): referee of a CONVERTED referral from Ben's parent, and holds an AVAILABLE manual reward.
-- (Was a PENDING referral + its referee_first reward until 20261118000400, which REFUSES a bring-in for a family with
-- a pending referral — pinned in carried_over_referral_block.test.sql. 20–23 still prove D6 for the rewards a
-- brought-in family CAN hold: no discount taken, the reward untouched, no referrer reward minted.)
INSERT INTO referrals (id, tenant_id, referrer_parent_id, referee_parent_id, code_used, status, converted_at)
VALUES ('c0900000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000a0',
        pg_temp.id('P2'), pg_temp.id('P6'), 'REF-COTEST', 'converted', '2026-10-01 10:00+08');
INSERT INTO referral_rewards (id, tenant_id, parent_id, kind, referral_id, status)
VALUES ('c0910000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000a0', pg_temp.id('P6'),
        'manual', NULL, 'available');

-- Eli (d5) was on holiday TODAY and LAST WEEK before his package is brought in (activation test, 8).
SELECT pg_temp.mark('2026-11-18', 'c0300000-0000-0000-0000-000000000006', 'holiday');
SELECT pg_temp.mark('2026-11-11', 'c0300000-0000-0000-0000-000000000006', 'holiday');

-- ══ 2–4. Bring in Ava's package: 6 of 10 left, originally started 2026-10-07 ══════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ SELECT record_carried_over_package(pg_temp.id('P1'), 'c0600000-0000-0000-0000-000000000001',
                                                      '2026-10-07', 6) $$,
  '2: the owner brings in a carried-over package');
RESET ROLE;
SELECT is(pg_temp.row(pg_temp.pkg('P1')),
  '180.00/0.00/0.00/2026-11-18/2026-12-16/active/10/6',
  '3: balance 6 × 30, S$0 paid, no discount, coverage from TODAY, expiry = original + 10 weeks, a 10-pack');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'package_carried_over' AND entity_id = pg_temp.pkg('P1')
            AND new_value->>'original_start' = '2026-10-07' AND (new_value->>'lessons_remaining')::int = 6),
  1, '4: the bring-in is audited with the original start and lessons remaining');

-- ══ 5. A double-submit is refused (D8) ════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P1'), 'c0600000-0000-0000-0000-000000000001',
                                                       '2026-10-07', 5) $$,
  '23514', 'This package has already been brought in.', '5: the same package brought in twice is refused');
RESET ROLE;

-- ══ 6–9. Nothing before today draws; today does; an earlier unmarked lesson does not block (D1) ═══════════════
SELECT pg_temp.mark('2026-11-11', 'c0300000-0000-0000-0000-000000000001', 'present');
SELECT is(pg_temp.apps('2026-11-11', 'c0300000-0000-0000-0000-000000000001') || '/' ||
          (SELECT value_remaining FROM parent_packages WHERE id = pg_temp.pkg('P1')),
  '0/180.00', '6: a lesson dated BEFORE the bring-in does not draw (it is ad-hoc)');
SELECT pg_temp.mark('2026-11-18', 'c0300000-0000-0000-0000-000000000001', 'present');
SELECT is(pg_temp.apps('2026-11-18', 'c0300000-0000-0000-0000-000000000001') || '/' ||
          (SELECT value_remaining FROM parent_packages WHERE id = pg_temp.pkg('P1')),
  '1/150.00', '7: today''s lesson draws at the package rate');

-- Dee: ONE lesson left, five earlier Wednesdays unmarked. Marking today as the coach must not be refused (PK001).
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000a1');
SELECT record_carried_over_package(pg_temp.id('P4'), 'c0600000-0000-0000-0000-000000000001', '2026-10-07', 1);
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000c1');
SELECT lives_ok($$
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
  VALUES ((SELECT id FROM lesson_sessions WHERE class_id = 'c0500000-0000-0000-0000-000000000001' AND session_date = '2026-11-18'),
          'c0300000-0000-0000-0000-000000000005', 'present', 'c0100000-0000-0000-0000-0000000000c1') $$,
  '8: an earlier unmarked lesson does not block marking today (the order guard sees only lessons from today)');
RESET ROLE;
SELECT is((SELECT value_remaining FROM parent_packages WHERE id = pg_temp.pkg('P4')), 0.00::numeric,
  '9: ...and it drew the one lesson left');

-- ══ 10–15. Every expiry recompute anchors on the ORIGINAL start ═══════════════════════════════════════════════
-- Ava today: present → holiday returns the lesson and extends by the tenant's 7 days.
SELECT pg_temp.mark('2026-11-18', 'c0300000-0000-0000-0000-000000000001', 'holiday');
SELECT is((SELECT value_remaining || '/' || holiday_extension_days || '/' || expires_on FROM parent_packages WHERE id = pg_temp.pkg('P1')),
  '180.00/7/2026-12-23', '10: a holiday today returns the lesson and extends original + 70 + 7');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000a1');
SELECT extend_package(pg_temp.pkg('P1'), 7, 'goodwill');
RESET ROLE;
SELECT is((SELECT expires_on FROM parent_packages WHERE id = pg_temp.pkg('P1')), DATE '2026-12-30',
  '11: Extend +7 adds on top of the original-anchored expiry');
-- Advance-cancel 2026-11-25 (inside the true window) and 2026-12-30 (after original + 70, before today + 70).
INSERT INTO lesson_sessions (class_id, session_date, start_time, end_time, status, cancelled_at, cancelled_by, cancellation_reason)
VALUES ('c0500000-0000-0000-0000-000000000001','2026-11-25','09:00','10:00', 'cancelled', app_now(), 'c0100000-0000-0000-0000-0000000000a1','pool closed');
SELECT is((SELECT cancel_extension_days || '/' || expires_on FROM parent_packages WHERE id = pg_temp.pkg('P1')),
  '7/2027-01-06', '12: an advance-cancelled lesson inside the window extends once');
INSERT INTO lesson_sessions (class_id, session_date, start_time, end_time, status, cancelled_at, cancelled_by, cancellation_reason)
VALUES ('c0500000-0000-0000-0000-000000000001','2026-12-30','09:00','10:00', 'cancelled', app_now(), 'c0100000-0000-0000-0000-0000000000a1','pool closed');
SELECT is((SELECT cancel_extension_days || '/' || expires_on FROM parent_packages WHERE id = pg_temp.pkg('P1')),
  '7/2027-01-06', '13: a cancelled lesson AFTER original + 10 weeks does not extend (the nominal window ends there)');
SELECT is(holiday_covering_package('c0300000-0000-0000-0000-000000000001', '2026-12-30', NULL,
                                   'c0000000-0000-0000-0000-0000000000a0'), NULL,
  '14: the nominal window ends at original + 70 (2026-12-30 is outside it)');
SELECT is(holiday_covering_package('c0300000-0000-0000-0000-000000000001', '2026-11-11', NULL,
                                   'c0000000-0000-0000-0000-0000000000a0'), NULL,
  '15: the nominal window starts at the bring-in (2026-11-11 is outside it)');

-- ══ 16–17. Activation: a holiday already marked today counts once; one before the bring-in does not ════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000a1');
SELECT record_carried_over_package(pg_temp.id('P5'), 'c0600000-0000-0000-0000-000000000001', '2026-10-14', 4);
RESET ROLE;
SELECT is((SELECT holiday_extension_days || '/' || expires_on FROM parent_packages WHERE id = pg_temp.pkg('P5')),
  '7/2026-12-30', '16: activation picks up TODAY''s holiday once (2026-10-14 + 70 + 7), not last week''s');
SELECT is((SELECT count(*)::int FROM package_holiday_extensions WHERE parent_package_id = pg_temp.pkg('P5')),
  1, '17: one holiday-extension row');

-- ══ 18–19. Change child keeps the original-anchored window ════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000a1');
SELECT record_carried_over_package(pg_temp.id('P3'), 'c0600000-0000-0000-0000-000000000003', '2026-10-07', 8,
                                   'c0300000-0000-0000-0000-000000000003');
SELECT lives_ok($$ SELECT reassign_package_child(pg_temp.pkg('P3'), 'c0300000-0000-0000-0000-000000000004') $$,
  '18: a one-child carried package can change child before any draw');
RESET ROLE;
SELECT is((SELECT student_id || '/' || expires_on || '/' || value_remaining FROM parent_packages WHERE id = pg_temp.pkg('P3')),
  'c0300000-0000-0000-0000-000000000004/2026-12-23/240.00',
  '19: ...expiry = original + 70 + the 2026-11-25 cancel (Cal is enrolled), never today + 70; balance 8 × 30');

-- ══ 20–23. Referral: no discount, reward untouched, no referrer reward minted (D6) ═══════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ SELECT record_carried_over_package(pg_temp.id('P6'), 'c0600000-0000-0000-0000-000000000001',
                                                      '2026-10-21', 5) $$,
  '20: a family holding a referral reward can bring a package in');
RESET ROLE;
SELECT is((SELECT discount_amount || '/' || amount_payable || '/' || COALESCE(referral_reward_id::text, 'none')
             FROM parent_packages WHERE id = pg_temp.pkg('P6')),
  '0.00/0.00/none', '21: no referral discount is applied');
SELECT is((SELECT status FROM referral_rewards WHERE id = 'c0910000-0000-0000-0000-000000000001'),
  'available', '22: the family''s reward is still available for a real purchase');
SELECT is((SELECT r.status || '/' || (SELECT count(*) FROM referral_rewards WHERE tenant_id = 'c0000000-0000-0000-0000-0000000000a0')
             FROM referrals r WHERE r.id = 'c0900000-0000-0000-0000-000000000001'),
  'converted/1', '23: the converted referral is unchanged and no referrer reward is minted');

-- ══ 24–25. A normal sale + an open offer; the bring-in supersedes the offer (RISK 12) ═════════════════════════
INSERT INTO parent_packages (tenant_id, parent_id, product_id, status, start_date)
VALUES ('c0000000-0000-0000-0000-0000000000a0', pg_temp.id('P2'), 'c0600000-0000-0000-0000-000000000002', 'active', '2026-11-18');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000a1');
SELECT create_package_offer(pg_temp.id('P2'), 'c0600000-0000-0000-0000-000000000002', '2026-12-01');
SELECT lives_ok($$ SELECT record_carried_over_package(pg_temp.id('P2'), 'c0600000-0000-0000-0000-000000000001',
                                                      '2026-10-21', 3) $$,
  '24: a family with an open offer can bring a package in');
RESET ROLE;
SELECT is((SELECT status || '/' || (superseded_by = pg_temp.pkg('P2'))::text FROM parent_packages
            WHERE parent_id = pg_temp.id('P2') AND offered_by IS NOT NULL),
  'cancelled/true', '25: ...and the open offer is superseded by it (the modal warns first)');

-- ══ 26–29. Refund cap = the value left NOW (Q1) ═══════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000a1');
UPDATE parent_packages SET status = 'cancelled' WHERE id IN (pg_temp.pkg('P1'), pg_temp.pkg('P4'));
SELECT throws_ok($$ SELECT record_package_refund(pg_temp.pkg('P1'), 180.01, '2026-11-18') $$,
  'P0001', 'A refund cannot be more than the value left on the package (S$180.00).',
  '26: a refund above the value left is refused');
SELECT lives_ok($$ SELECT record_package_refund(pg_temp.pkg('P1'), 180.00, '2026-11-18') $$,
  '27: a refund of the value left is accepted (S$0 was paid here)');
SELECT throws_ok($$ SELECT record_package_refund(pg_temp.pkg('P4'), 30.00, '2026-11-18') $$,
  'P0001', 'A refund cannot be more than the value left on the package (S$0.00).',
  '28: a refund of a lesson already taught in SwimSync is refused (cap is now, not at bring-in)');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM package_refunds WHERE parent_package_id = pg_temp.pkg('P1') AND reversed_at IS NULL),
  1, '29: one refund recorded');

-- ══ 30. Accounting: package revenue counts only the normal sale ════════════════════════════════════════════════
INSERT INTO billing_periods (billing_month, tenant_id, invoices_issued) VALUES ('2026-11','c0000000-0000-0000-0000-0000000000a0',0);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000a1');
SELECT is((SELECT revenue_packages FROM accounting_summary('c0000000-0000-0000-0000-0000000000a0', '2026-11')),
  150.00::numeric, '30: November package revenue = the N5 sale (150) only — carried packages add S$0');

-- ══ 31–46. Refusals ═══════════════════════════════════════════════════════════════════════════════════════════
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P5'), 'c0600000-0000-0000-0000-000000000001', '2026-10-28', 0) $$,
  '23514', 'Lessons remaining must be between 1 and 10.', '31: zero lessons remaining is refused');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P5'), 'c0600000-0000-0000-0000-000000000001', '2026-10-28', 11) $$,
  '23514', 'Lessons remaining must be between 1 and 10.', '32: more than the package holds is refused');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P5'), 'c0600000-0000-0000-0000-000000000001', '2026-11-19', 3) $$,
  '23514', 'The original start date can''t be in the future.', '33: a future original start is refused');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P5'), 'c0600000-0000-0000-0000-000000000001', '2026-09-01', 3) $$,
  '23514', 'That package expired on 10 Nov 2026 — it can''t be brought in.', '34: an already-expired package is refused');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P5'), 'c0600000-0000-0000-0000-000000000004', '2026-10-28', 3) $$,
  '23514', 'That package is no longer offered.', '35: a retired product is refused');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P7'), 'c0600000-0000-0000-0000-000000000001', '2026-10-28', 3) $$,
  '23514', 'That family is not in this business.', '36: a family from another business is refused');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P5'), 'c0600000-0000-0000-0000-000000000001', '2026-10-28', 3,
                                                       'c0300000-0000-0000-0000-000000000006') $$,
  '23514', 'This package is shared — it can''t be tied to one child.', '37: a shared product with a child is refused');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P1'), 'c0600000-0000-0000-0000-000000000003', '2026-10-28', 3) $$,
  '23514', 'Choose which child this package is for.', '38: a one-child product without a child is refused');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P2'), 'c0600000-0000-0000-0000-000000000003', '2026-10-28', 3,
                                                       'c0300000-0000-0000-0000-000000000002') $$,
  '23514', NULL, '39: the other package kind is refused while the family holds a live shared package');
SELECT throws_ok($$ INSERT INTO parent_packages (tenant_id, parent_id, product_id, status, start_date, carried_over_start, carried_over_lessons)
                   VALUES ('c0000000-0000-0000-0000-0000000000a0', pg_temp.id('P5'), 'c0600000-0000-0000-0000-000000000001',
                           'active', '2026-11-18', '2026-10-28', 3) $$,
  '23514', 'A carried-over package is recorded with Bring in package, not inserted directly.',
  '40: the admin cannot write a carried row directly to the table');
SELECT throws_ok($$ UPDATE parent_packages SET carried_over_lessons = 9 WHERE id = pg_temp.pkg('P5') $$,
  '23514', 'A package''s terms are a record of the sale and cannot be edited.', '41: the admin cannot edit carried_over_*');
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000d5');
SELECT throws_ok($$ INSERT INTO parent_packages (tenant_id, parent_id, product_id, status, carried_over_start, carried_over_lessons)
                   VALUES ('c0000000-0000-0000-0000-0000000000a0', pg_temp.id('P5'), 'c0600000-0000-0000-0000-000000000001',
                           'pending', '2026-10-28', 3) $$,
  '23514', 'A carried-over package is recorded with Bring in package, not inserted directly.',
  '42: a parent cannot write a carried row directly to the table');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P5'), 'c0600000-0000-0000-0000-000000000001', '2026-10-28', 3) $$,
  '42501', NULL, '43: a parent cannot bring a package in');
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000c1');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P5'), 'c0600000-0000-0000-0000-000000000001', '2026-10-28', 3) $$,
  '42501', NULL, '44: a coach cannot bring a package in');
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000b1');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P5'), 'c0600000-0000-0000-0000-000000000001', '2026-10-28', 3) $$,
  '42501', NULL, '45: another business''s admin cannot bring a package in');
RESET ROLE;
SELECT throws_ok($$ UPDATE parent_packages SET carried_over_start = '2026-10-01' WHERE id = pg_temp.pkg('P5') $$,
  '23514', 'A package''s terms are a record of the sale and cannot be edited.',
  '46: not even a SECURITY DEFINER path (postgres) can edit carried_over_*');

-- ══ 47. A start_date passed on a privileged insert is ignored — coverage is always today ═════════════════════
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, start_date, carried_over_start, carried_over_lessons)
VALUES ('c0700000-0000-0000-0000-000000000047','c0000000-0000-0000-0000-0000000000a0', pg_temp.id('P1'),
        'c0600000-0000-0000-0000-000000000001', 'active', '2026-10-28', '2026-10-28', 2);
SELECT is((SELECT start_date FROM parent_packages WHERE id = 'c0700000-0000-0000-0000-000000000047'), DATE '2026-11-18',
  '47: the trigger sets coverage to today whatever start_date was sent');

-- ══ 48. D7: a retired product's carried package keeps working ═════════════════════════════════════════════════
UPDATE package_products SET is_active = FALSE WHERE id = 'c0600000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('c0100000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ SELECT extend_package(pg_temp.pkg('P5'), 1, 'after retire') $$,
  '48: a carried package can still be extended after its product is retired');
RESET ROLE;

-- ══ 49. Census lint (§6, permanent): no function recomputes an expiry from start_date alone ════════════════════
SELECT is((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND (pg_get_functiondef(p.oid) ~ 'package_effective_end\(\s*(\w+\.)?start_date'
                   OR pg_get_functiondef(p.oid) ~ 'start_date\s*\+\s*\(\s*(\w+\.)?validity_weeks')),
  NULL, '49: every expiry recompute anchors on COALESCE(carried_over_start, start_date)');

-- ══ 50–52. Grants (§7.87) ═════════════════════════════════════════════════════════════════════════════════════
SELECT ok(has_function_privilege('authenticated', 'public.record_carried_over_package(uuid,uuid,date,integer,uuid)', 'EXECUTE'),
  '50: authenticated may call record_carried_over_package');
SELECT ok(NOT has_function_privilege('anon', 'public.record_carried_over_package(uuid,uuid,date,integer,uuid)', 'EXECUTE'),
  '51: anon may not');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                       WHERE p.oid = 'public.record_carried_over_package(uuid,uuid,date,integer,uuid)'::regprocedure
                         AND a.grantee = 0),
  '52: PUBLIC holds no EXECUTE');

SELECT * FROM finish();
ROLLBACK;

-- MUTATION PROOFS (§7.25), each applied to the live function, file re-run, then reverted:
--   M1 lifecycle carried arm removed (start_date/balance/price not set)  → 3 red (cop_price raises at 2)
--   M2 extend_package anchor reverted to start_date                       → 11 red (cop_expiry raises)
--   M3 holiday_covering_package END anchor reverted to start_date         → 13, 14 red
--   M4 holiday_covering_package START side changed to COALESCE            → 15 red
--   M5 apply_referral_reward early return removed                         → 20, 21 red (cop_price raises)
--   M6 record_package_refund carried cap → amount_payable                 → 27 red
--   M7 census lint: any one site reverted                                 → 49 red, naming it
