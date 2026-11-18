-- pgTAP: A REFERRED FAMILY CANNOT BE BROUGHT IN; VOID REFERRAL (20261118000400).
-- docs/plans/CARRIED_OVER_REFERRAL_BLOCK_PLAN.md (decision: user, 2026-11-18; plan-reviewed 2026-11-19).
--
-- WHAT THIS FILE PROTECTS.
--   (1) record_carried_over_package refuses a family that is the REFEREE of a PENDING referral — and that refusal is
--       the LAST check: an expired start, a bad lesson count, or a missing child answer with THEIR message first
--       (RISK 1: the exit is an irreversible void). Nothing is inserted.
--   (2) it still allows a converted- or void-referral family, and a family that is only a REFERRER (decision 3).
--   (3) void_referral: only packages:edit / platform admin; only a PENDING referral; voids the referral AND its unused
--       referee_first reward together (price restored on an unpaid offer; refused, atomically, on a paid-claimed one);
--       an already-void reward is skipped; the family's referrer + manual rewards are untouched (RISK 4); the audit
--       row carries the referral's tenant (RISK 2, §7.297); a voided referral never converts.
--   (4) grants: authenticated EXECUTE, anon none (§7.87).
--
-- METHOD (§7.16): probes run as `authenticated` with an explicit jwt sub; fixture writes as postgres.
-- Every throws_ok names errcode AND message (§7.112) — three refusals share 23514.
--
-- FIXTURE (prefix b7c…). Clock 2026-11-18. Tenant A (referrals on, 10%) and B. Product C10 = 10 @ S$30, 10 weeks;
-- S10 = one-child. Parents (all in A):
--   P1 referee of PENDING R1 (W1 referee_first, available) + a manual reward + a referrer reward (it referred P6, R7)
--   P2 referee of CONVERTED R2 · P3 referee of VOID R3 · P4 REFERRER of pending R8 (to P5) · P5 referee of R8
--   P7 referee of PENDING R4 with W4 RESERVED on an unpaid offer · P8 PENDING R5 with W5 reserved on a PAID-claimed offer
--   P9 the referrer of R1–R6 · P10 referee of PENDING R6 whose reward W6 is already VOID (the Rewards page's Void)
--
-- RED FIRST (§7.25): before 20261118000400 the file fails at 2 (the refusal) and every void_referral test.
-- MUTATION PROOFS are listed at the end of the file.

BEGIN;
SELECT set_config('swimsync.now', '2026-11-18 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(36);
SELECT is(app_today(), '2026-11-18'::date, 'clock pinned');

INSERT INTO tenants (id, slug, display_name, join_code, created_at, referral_enabled,
                     referral_discount_type, referral_discount_value) VALUES
  ('b7c00000-0000-0000-0000-0000000000a0','rb-a','RB A','SWIM-RBAA', app_now() - INTERVAL '200 days', TRUE, 'percent', 10),
  ('b7c00000-0000-0000-0000-0000000000b0','rb-b','RB B','SWIM-RBBB', app_now() - INTERVAL '200 days', TRUE, 'percent', 10);

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;

-- a1 owner A · b1 owner B · c1 coach A · e1 packages-VIEW staff A · d1..d10 parents
SELECT pg_temp.mkuser('b7c10000-0000-0000-0000-0000000000a1','rb-owner@test.local',
  '{"full_name":"RB Owner","role":"tenant_admin","tenant_id":"b7c00000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('b7c10000-0000-0000-0000-0000000000b1','rb-owner2@test.local',
  '{"full_name":"RB Owner2","role":"tenant_admin","tenant_id":"b7c00000-0000-0000-0000-0000000000b0"}');
SELECT pg_temp.mkuser('b7c10000-0000-0000-0000-0000000000c1','rb-coach@test.local',
  '{"full_name":"RB Coach","role":"coach","tenant_id":"b7c00000-0000-0000-0000-0000000000a0"}');
INSERT INTO tenant_roles (id, tenant_id, name)
VALUES ('b7c20000-0000-0000-0000-000000000001','b7c00000-0000-0000-0000-0000000000a0','RB Viewer');
INSERT INTO tenant_role_permissions (role_id, area, level)
SELECT 'b7c20000-0000-0000-0000-000000000001', a,
       CASE WHEN a = 'packages' THEN 'view'::admin_level ELSE 'none'::admin_level END
  FROM unnest(enum_range(NULL::admin_area)) a;
SELECT pg_temp.mkuser('b7c10000-0000-0000-0000-0000000000e1','rb-viewer@test.local',
  '{"full_name":"RB Viewer","role":"tenant_admin","tenant_id":"b7c00000-0000-0000-0000-0000000000a0","admin_role_id":"b7c20000-0000-0000-0000-000000000001"}');
SELECT pg_temp.mkuser(('b7c10000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'rb-parent' || n || '@test.local',
  jsonb_build_object('full_name','RB Parent ' || n,'role','parent'))
  FROM generate_series(1, 10) n;
UPDATE tenants SET owner_profile_id = 'b7c10000-0000-0000-0000-0000000000a1' WHERE id = 'b7c00000-0000-0000-0000-0000000000a0';
UPDATE tenants SET owner_profile_id = 'b7c10000-0000-0000-0000-0000000000b1' WHERE id = 'b7c00000-0000-0000-0000-0000000000b0';

CREATE TEMP TABLE ids (k TEXT PRIMARY KEY, v UUID);
GRANT ALL ON ids TO PUBLIC;
INSERT INTO ids SELECT 'P' || n, p.id FROM generate_series(1, 10) n
  JOIN parents p ON p.profile_id = ('b7c10000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid;
CREATE OR REPLACE FUNCTION pg_temp.id(p_k TEXT) RETURNS UUID AS $$ SELECT v FROM ids WHERE k = p_k $$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.ref(p_n INT) RETURNS UUID AS $$
  SELECT ('b7c90000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION pg_temp.rw(p_n INT) RETURNS UUID AS $$
  SELECT ('b7c91000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$ LANGUAGE sql IMMUTABLE;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT pg_temp.id('P' || n), 'b7c00000-0000-0000-0000-0000000000a0' FROM generate_series(1, 10) n;

INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id) VALUES
  ('b7c30000-0000-0000-0000-000000000001','RB Kid One','assigned',TRUE,'b7c00000-0000-0000-0000-0000000000a0');
INSERT INTO parent_students (parent_id, student_id) VALUES (pg_temp.id('P1'),'b7c30000-0000-0000-0000-000000000001');

INSERT INTO package_products (id, tenant_id, name, lesson_count, rate_per_lesson, validity_weeks, single_child, is_active) VALUES
  ('b7c60000-0000-0000-0000-000000000001','b7c00000-0000-0000-0000-0000000000a0','RB C10',10,30.00,10,FALSE,TRUE),
  ('b7c60000-0000-0000-0000-000000000002','b7c00000-0000-0000-0000-0000000000a0','RB S10',10,30.00,10,TRUE,TRUE);

-- Referrals (all tenant A). P9 referred R1–R6; P1 referred P6 (R7, converted); P4 referred P5 (R8, pending).
INSERT INTO referrals (id, tenant_id, referrer_parent_id, referee_parent_id, code_used, status, converted_at, void_reason)
SELECT pg_temp.ref(n), 'b7c00000-0000-0000-0000-0000000000a0', pg_temp.id(r), pg_temp.id(e), 'REF-RBTEST', st,
       CASE WHEN st = 'converted' THEN TIMESTAMPTZ '2026-10-01 10:00+08' END,
       CASE WHEN st = 'void' THEN 'same_household' END
  FROM (VALUES (1,'P9','P1','pending'), (2,'P9','P2','converted'), (3,'P9','P3','void'), (4,'P9','P7','pending'),
               (5,'P9','P8','pending'), (6,'P9','P10','pending'), (7,'P1','P6','converted'), (8,'P4','P5','pending'))
       AS v(n, r, e, st);
INSERT INTO referral_rewards (id, tenant_id, parent_id, kind, referral_id, status) VALUES
  (pg_temp.rw(1),'b7c00000-0000-0000-0000-0000000000a0', pg_temp.id('P1'),'referee_first', pg_temp.ref(1),'available'),
  (pg_temp.rw(11),'b7c00000-0000-0000-0000-0000000000a0', pg_temp.id('P1'),'manual', NULL,'available'),
  (pg_temp.rw(17),'b7c00000-0000-0000-0000-0000000000a0', pg_temp.id('P1'),'referrer', pg_temp.ref(7),'available'),
  (pg_temp.rw(4),'b7c00000-0000-0000-0000-0000000000a0', pg_temp.id('P7'),'referee_first', pg_temp.ref(4),'available'),
  (pg_temp.rw(5),'b7c00000-0000-0000-0000-0000000000a0', pg_temp.id('P8'),'referee_first', pg_temp.ref(5),'available'),
  (pg_temp.rw(6),'b7c00000-0000-0000-0000-0000000000a0', pg_temp.id('P10'),'referee_first', pg_temp.ref(6),'void');

-- P7 and P8 each request an offer: apply_referral_reward reserves their referee_first reward on it. P8 then claims paid.
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id) VALUES
  ('b7c70000-0000-0000-0000-000000000007','b7c00000-0000-0000-0000-0000000000a0', pg_temp.id('P7'),'b7c60000-0000-0000-0000-000000000001'),
  ('b7c70000-0000-0000-0000-000000000008','b7c00000-0000-0000-0000-0000000000a0', pg_temp.id('P8'),'b7c60000-0000-0000-0000-000000000001');
UPDATE parent_packages SET paid_claimed_at = app_now() WHERE id = 'b7c70000-0000-0000-0000-000000000008';

-- ══ 2–8. The bring-in refusal, and that it is the LAST check (RISK 1) ════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b7c10000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P1'), 'b7c60000-0000-0000-0000-000000000001', '2026-10-21', 5) $$,
  '23514', 'This family joined with a referral code. Void their referral on the Referrals page (Void referral) before bringing in a package.',
  '2: a family with a PENDING referral is refused');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM parent_packages WHERE parent_id = pg_temp.id('P1')), 0,
  '3: ...and nothing was inserted');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'package_carried_over'
            AND entity_id IN (SELECT id FROM parent_packages WHERE tenant_id = 'b7c00000-0000-0000-0000-0000000000a0')), 0,
  '4: ...and no bring-in was audited');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b7c10000-0000-0000-0000-0000000000a1');
SELECT throws_like($$ SELECT record_carried_over_package(pg_temp.id('P1'), 'b7c60000-0000-0000-0000-000000000001', '2026-01-05', 5) $$,
  'That package expired on %',
  '5: RISK 1 — an expired start answers with the EXPIRED message, not the referral one');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P1'), 'b7c60000-0000-0000-0000-000000000001', '2026-10-21', 11) $$,
  '23514', 'Lessons remaining must be between 1 and 10.',
  '6: RISK 1 — a bad lesson count answers with the LESSONS message');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P1'), 'b7c60000-0000-0000-0000-000000000002', '2026-10-21', 5) $$,
  '23514', 'Choose which child this package is for.',
  '7: RISK 1 — a one-child product with no child answers with the CHILD message (raised during the INSERT)');
-- ══ 8–10. Allowed: converted, void, referrer-only ═════════════════════════════════════════════════════════════
SELECT lives_ok($$ SELECT record_carried_over_package(pg_temp.id('P2'), 'b7c60000-0000-0000-0000-000000000001', '2026-10-21', 5) $$,
  '8: a CONVERTED-referral family can be brought in');
SELECT lives_ok($$ SELECT record_carried_over_package(pg_temp.id('P3'), 'b7c60000-0000-0000-0000-000000000001', '2026-10-21', 5) $$,
  '9: a VOID-referral family can be brought in');
SELECT lives_ok($$ SELECT record_carried_over_package(pg_temp.id('P4'), 'b7c60000-0000-0000-0000-000000000001', '2026-10-21', 5) $$,
  '10: a family that is only a REFERRER (of a pending referral) can be brought in');

-- ══ 11–19. void_referral: who, and what ═══════════════════════════════════════════════════════════════════════
SELECT pg_temp.as_user('b7c10000-0000-0000-0000-000000000001');
SELECT throws_ok($$ SELECT void_referral(pg_temp.ref(1), 'x') $$, '42501', 'Not authorized to void this referral.',
  '11: a parent cannot void a referral (not even their own)');
SELECT pg_temp.as_user('b7c10000-0000-0000-0000-0000000000c1');
SELECT throws_ok($$ SELECT void_referral(pg_temp.ref(1), 'x') $$, '42501', 'Not authorized to void this referral.',
  '12: a coach cannot void a referral');
SELECT pg_temp.as_user('b7c10000-0000-0000-0000-0000000000e1');
SELECT throws_ok($$ SELECT void_referral(pg_temp.ref(1), 'x') $$, '42501', 'Not authorized to void this referral.',
  '13: a packages:VIEW staff admin cannot void a referral');
SELECT pg_temp.as_user('b7c10000-0000-0000-0000-0000000000b1');
SELECT throws_ok($$ SELECT void_referral(pg_temp.ref(1), 'x') $$, '42501', 'Not authorized to void this referral.',
  '14: another business''s owner cannot void a referral');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.void_referral(uuid,text)', 'EXECUTE'),
  '15: anon has no EXECUTE on void_referral');
SELECT ok(has_function_privilege('authenticated', 'public.void_referral(uuid,text)', 'EXECUTE'),
  '16: authenticated has EXECUTE on void_referral');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b7c10000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT void_referral('b7c90000-0000-0000-0000-0000000000ff', 'x') $$, 'P0002', 'No such referral.',
  '17: an unknown referral');
SELECT throws_ok($$ SELECT void_referral(pg_temp.ref(2), 'x') $$, '23514', 'Only a pending referral can be voided.',
  '18: a CONVERTED referral cannot be voided');
SELECT throws_ok($$ SELECT void_referral(pg_temp.ref(3), 'x') $$, '23514', 'Only a pending referral can be voided.',
  '19: an already-VOID referral cannot be voided again');

-- ══ 20–25. Void R1 (available reward) — together, by referral, audited ═════════════════════════════════════════
SELECT lives_ok($$ SELECT void_referral(pg_temp.ref(1), '  Existing customer  ') $$,
  '20: the owner voids P1''s pending referral');
RESET ROLE;
SELECT is((SELECT status || '/' || void_reason FROM referrals WHERE id = pg_temp.ref(1)), 'void/Existing customer',
  '21: the referral is void, with the trimmed reason');
SELECT is((SELECT status || '/' || void_reason || '/' || voided_by FROM referral_rewards WHERE id = pg_temp.rw(1)),
  'void/Existing customer/b7c10000-0000-0000-0000-0000000000a1',
  '22: ...and its referee_first reward is void, same reason, voided by the owner');
SELECT is((SELECT string_agg(kind || '=' || status, ',' ORDER BY kind) FROM referral_rewards
            WHERE parent_id = pg_temp.id('P1') AND id <> pg_temp.rw(1)), 'manual=available,referrer=available',
  '23: RISK 4 — P1''s manual and referrer rewards are untouched');
SELECT is((SELECT count(*)::int || '/' || min(tenant_id::text) FROM audit_log
            WHERE action = 'referral_voided' AND entity_type = 'referral' AND entity_id = pg_temp.ref(1)),
  '1/b7c00000-0000-0000-0000-0000000000a0',
  '24: RISK 2 — one referral_voided audit row, carrying the referral''s business');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b7c10000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ SELECT record_carried_over_package(pg_temp.id('P1'), 'b7c60000-0000-0000-0000-000000000001', '2026-10-21', 5) $$,
  '25: after the void, P1 can be brought in');

-- ══ 26–29. Void R4 — reward RESERVED on an unpaid offer → price restored ═══════════════════════════════════════
RESET ROLE;
SELECT is((SELECT rr.status || '/' || (pp.discount_amount > 0) FROM referral_rewards rr
             JOIN parent_packages pp ON pp.id = 'b7c70000-0000-0000-0000-000000000007'
            WHERE rr.id = pg_temp.rw(4)), 'reserved/true',
  '26: precondition — P7''s reward is reserved, its offer discounted');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b7c10000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ SELECT void_referral(pg_temp.ref(4), '') $$, '27: void R4 with a blank reason');
RESET ROLE;
SELECT is((SELECT discount_amount || '/' || (amount_payable = total_value) || '/' || COALESCE(referral_reward_id::text, 'none')
             FROM parent_packages WHERE id = 'b7c70000-0000-0000-0000-000000000007'), '0.00/true/none',
  '28: the unpaid offer is back at full price');
SELECT is((SELECT r.status || '/' || r.void_reason || '/' || rr.status FROM referrals r
             JOIN referral_rewards rr ON rr.referral_id = r.id WHERE r.id = pg_temp.ref(4)),
  'void/Voided by admin/void', '29: blank reason → "Voided by admin" on both');

-- ══ 30. Void R5 — reward reserved on a PAID-claimed offer → refused (atomicity: mutation M4) ════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b7c10000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT void_referral(pg_temp.ref(5), 'x') $$,
  '23514', 'This reward is on a package the family has already paid — it cannot be voided.',
  '30: a discount the family has already paid for refuses the whole void');

-- ══ 31–32. Void R6 — its reward was ALREADY void (the Rewards page's Void) ════════════════════════════════════
SELECT lives_ok($$ SELECT void_referral(pg_temp.ref(6), 'x') $$, '31: a referral whose reward is already void can be voided');
RESET ROLE;
SELECT is((SELECT status FROM referrals WHERE id = pg_temp.ref(6)), 'void', '32: ...and is void');

-- ══ 33–35. After a void, a real purchase does NOT convert and mints no referrer reward ══════════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b7c10000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ UPDATE parent_packages SET status = 'active' WHERE id = 'b7c70000-0000-0000-0000-000000000007' $$,
  '33: the owner confirms P7''s (now full-price) offer');
RESET ROLE;
SELECT is((SELECT status FROM referrals WHERE id = pg_temp.ref(4)), 'void', '34: R4 stays void — it never converts');
SELECT is((SELECT count(*)::int FROM referral_rewards WHERE parent_id = pg_temp.id('P9')), 0,
  '35: no referrer reward was minted for P9');

-- ══ 36. The plain bring-in was not loosened: P5 (referee of PENDING R8) is still refused ══════════════════════
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b7c10000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT record_carried_over_package(pg_temp.id('P5'), 'b7c60000-0000-0000-0000-000000000001', '2026-10-21', 5) $$,
  '23514', 'This family joined with a referral code. Void their referral on the Referrals page (Void referral) before bringing in a package.',
  '36: the referee of a referral whose REFERRER was brought in is still refused');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

-- MUTATION PROOFS (§7.25), each applied to the live function, file re-run, then reverted:
--   M1 the bring-in refusal removed                                       → 2, 3, 36 red
--   M2 the refusal moved BEFORE the INSERT (right after membership)       → 5, 6, 7 red
--   M3 void_referral selects the reward by parent_id, not referral_id     → 23 red
--   M4 PERFORM void_referral_reward wrapped in EXCEPTION WHEN OTHERS NULL → 30 red
--   M5 audit_log_tenant_of's 'referral' arm removed                       → 20 red (and the void tests after it)
