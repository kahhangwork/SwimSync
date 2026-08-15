-- pgTAP: parent referral codes — double-sided package discount.
-- Plan: docs/plans/REFERRAL_PLAN.md — RISKS 1, 2, 4, 5, 6, 7, 11, 13.
--
-- METHOD (§7.16): every client probe runs under SET LOCAL ROLE authenticated +
-- request.jwt.claims. Outside a role SET LOCAL ROLE is a no-op and RLS is
-- bypassed, so a "passing" assertion proves nothing. State reads run as postgres.
-- Each scenario owns its own family so the reward queue never crosses scenarios.
-- Self-contained; rolls back. Runs under pg_prove (no psql backslash commands).
--
-- PROVEN RED: against the schema before 20260815000700 every object here is
-- absent, so the file cannot even plan. The per-guard red-before checks
-- (RISK 11 pin, RISK 6 void) are called out inline.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(57);

-- ── Tenants: A (referral ON, 10% inherit, 14-day expiry), B (OFF), C (suspended)
INSERT INTO tenants (id, slug, display_name, join_code, referral_enabled,
                     referral_discount_type, referral_discount_value,
                     referral_reward_expiry_days) VALUES
  ('d1000000-0000-0000-0000-000000000001','ref-a','Ref Swim A','SWIM-REFA', true,  'percent', 10, 14),
  ('d1000000-0000-0000-0000-000000000002','ref-b','Ref Swim B','SWIM-REFB', false, NULL, NULL, NULL),
  ('d1000000-0000-0000-0000-000000000003','ref-c','Ref Swim C','SWIM-REFC', true,  'percent', 10, NULL);

-- Admin of A (private-coach shape so the tenant can own classes/products).
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change) VALUES
  ('00000000-0000-0000-0000-000000000000','d1d00000-0000-0000-0000-000000000001',
   'authenticated','authenticated','ref-admin-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Ref Admin A","role":"tenant_admin","is_coach":true,"tenant_id":"d1000000-0000-0000-0000-000000000001"}',
   now(), now(),'','','','');

-- 20 parent families (handle_new_user makes profiles + parents).
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000',
       ('d1b00000-0000-0000-0000-0000000000'||lpad(g::text,2,'0'))::uuid,
       'authenticated','authenticated','ref-p'||lpad(g::text,2,'0')||'@test.local',
       crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
       json_build_object('full_name','Ref P'||g||' Family','role','parent')::jsonb,
       now(), now(),'','','',''
FROM generate_series(1,20) g;

-- Convenience: profile id 'd1b00000-…-0000000NN' → parents.id.
CREATE TEMP TABLE pm AS
  SELECT p.profile_id, p.id AS parent_id FROM parents p
  WHERE p.profile_id::text LIKE 'd1b00000-%';

-- Members of A: everyone EXCEPT p02 (referee, joins), p04 (throwaway joiner),
-- p10 (same-household referee, joins), p20 (swim-joiner).
INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT parent_id, 'd1000000-0000-0000-0000-000000000001'
FROM pm WHERE profile_id::text NOT IN (
  'd1b00000-0000-0000-0000-000000000002',
  'd1b00000-0000-0000-0000-000000000004',
  'd1b00000-0000-0000-0000-000000000010',
  'd1b00000-0000-0000-0000-000000000020');

-- p05 referrer is INACTIVE; p03 also joins C (for the suspended-tenant probe).
UPDATE parent_tenants SET is_active = false
  WHERE parent_id = (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000005')
    AND tenant_id = 'd1000000-0000-0000-0000-000000000001';
INSERT INTO parent_tenants (parent_id, tenant_id)
  SELECT parent_id, 'd1000000-0000-0000-0000-000000000003' FROM pm
   WHERE profile_id='d1b00000-0000-0000-0000-000000000003';
UPDATE tenants SET suspended_at = now() WHERE id = 'd1000000-0000-0000-0000-000000000003';

-- Same-household: p09 (referrer) and p10 (referee) share a phone.
UPDATE profiles SET phone = '90000009'
  WHERE id IN ('d1b00000-0000-0000-0000-000000000009','d1b00000-0000-0000-0000-000000000010');

-- Category + products in A. P1 inherits the tenant 10%; PA overrides to $25;
-- P0 overrides to $0 (explicit no-discount). PB lives in the disabled tenant B.
INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('d1c00000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','Ref Group');
INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count,
                              rate_per_lesson, validity_months, validity_weeks, is_active,
                              referral_discount_type, referral_discount_value) VALUES
  ('d1e00000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001',
   'Ref 8 Group','d1c00000-0000-0000-0000-000000000001',8,40.00,12,4,true, NULL, NULL),
  ('d1e00000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001',
   'Ref Amount25','d1c00000-0000-0000-0000-000000000001',8,40.00,12,4,true, 'amount', 25),
  ('d1e00000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000001',
   'Ref Zero','d1c00000-0000-0000-0000-000000000001',8,40.00,12,4,true, 'amount', 0),
  ('d1e00000-0000-0000-0000-000000000009','d1000000-0000-0000-0000-000000000002',
   'Ref B Prod',NULL,8,40.00,12,4,true, NULL, NULL);

-- Referral codes are random; capture the ones the role-switched probes need into
-- a NON-RLS temp table (parent_tenants RLS would hide another family's code from
-- a joiner). Grant both helper tables to authenticated so probes can read them.
CREATE TEMP TABLE codes AS
  SELECT 'R_A'::text AS label,
         (SELECT referral_code FROM parent_tenants
           WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000001')
             AND tenant_id='d1000000-0000-0000-0000-000000000001') AS code
  UNION ALL SELECT 'p05_A',
         (SELECT referral_code FROM parent_tenants
           WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000005')
             AND tenant_id='d1000000-0000-0000-0000-000000000001')
  UNION ALL SELECT 'p03_C',
         (SELECT referral_code FROM parent_tenants
           WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000003')
             AND tenant_id='d1000000-0000-0000-0000-000000000003');
GRANT SELECT ON pm    TO authenticated;
GRANT SELECT ON codes TO authenticated;

-- ═══ GROUP 1 — codes ═════════════════════════════════════════════════════════
SELECT matches(
  (SELECT referral_code FROM parent_tenants
    WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000001')
      AND tenant_id='d1000000-0000-0000-0000-000000000001'),
  '^REF-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$',
  'a membership INSERT mints a well-formed REF- code');

SELECT isnt(
  (SELECT referral_code FROM parent_tenants
    WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000001')
      AND tenant_id='d1000000-0000-0000-0000-000000000001'),
  (SELECT referral_code FROM parent_tenants
    WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000003')
      AND tenant_id='d1000000-0000-0000-0000-000000000001'),
  'two memberships get distinct codes');

-- ═══ GROUP 2 — referral_discount_for (no reward needed) ══════════════════════
SELECT is((SELECT discount_type||':'||discount_value FROM referral_discount_for('d1e00000-0000-0000-0000-000000000001')),
  'percent:10.00', 'P1 inherits the tenant default (percent 10)');
SELECT is((SELECT discount_type||':'||discount_value FROM referral_discount_for('d1e00000-0000-0000-0000-000000000002')),
  'amount:25.00', 'a product override beats the tenant default');
SELECT is((SELECT discount_value FROM referral_discount_for('d1e00000-0000-0000-0000-000000000003')),
  0::numeric, 'a $0 product override is an explicit no-discount (D4)');
SELECT is((SELECT discount_type FROM referral_discount_for('d1e00000-0000-0000-0000-000000000009')),
  NULL, 'the disabled tenant B yields no discount (master switch, D15)');

-- ═══ GROUP 3 — join happy path: p02 (E) joins A via p01 (R) ═══════════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1b00000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT is(
  (SELECT referred FROM join_tenant_by_code((SELECT code FROM codes WHERE label='R_A'))),
  true, 'joining by a REF- code returns referred = true');
RESET ROLE;

SELECT is(
  (SELECT status FROM referrals
    WHERE referee_parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000002')
      AND tenant_id='d1000000-0000-0000-0000-000000000001'),
  'pending', 'the referral row is recorded, pending');
SELECT is(
  (SELECT status FROM referral_rewards
    WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000002')
      AND kind='referee_first'),
  'available', 'the referee''s first-package reward is minted, available');

-- swim-join: p20 joins A by the plain SWIM- code → no referral.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1b00000-0000-0000-0000-000000000020","role":"authenticated"}';
SELECT is((SELECT referred FROM join_tenant_by_code('SWIM-REFA')), false,
  'joining by the plain tenant code is not a referral');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM referrals
    WHERE referee_parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000020')),
  0, 'a SWIM- join records no referral row');

-- ═══ GROUP 4 — join failures all speak the ONE generic message ═══════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1b00000-0000-0000-0000-000000000004","role":"authenticated"}';
SELECT throws_ok($$ SELECT join_tenant_by_code('REF-ZZZZZ') $$,
  'that join code was not recognised', 'an unknown REF- code is not recognised');
SELECT throws_ok(
  $$ SELECT join_tenant_by_code((SELECT code FROM codes WHERE label='p05_A')) $$,
  'that join code was not recognised', 'an INACTIVE referrer''s code is not recognised');
SELECT throws_ok(
  $$ SELECT join_tenant_by_code((SELECT code FROM codes WHERE label='p03_C')) $$,
  'that join code was not recognised', 'a SUSPENDED tenant''s referral code is not recognised');
RESET ROLE;
-- disabled code: disable p01's A code, p04 tries it.
UPDATE parent_tenants SET referral_code_disabled_at = now()
  WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000001')
    AND tenant_id='d1000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1b00000-0000-0000-0000-000000000004","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT join_tenant_by_code((SELECT code FROM codes WHERE label='R_A')) $$,
  'that join code was not recognised', 'a DISABLED code is not recognised (RISK 15)');
RESET ROLE;
UPDATE parent_tenants SET referral_code_disabled_at = NULL
  WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000001')
    AND tenant_id='d1000000-0000-0000-0000-000000000001';
-- self-referral: p01 uses their own A code.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1b00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT join_tenant_by_code((SELECT code FROM codes WHERE label='R_A')) $$,
  'that join code was not recognised', 'a self-referral is not recognised');
RESET ROLE;

-- already-member (p06 uses p01's code) → joins, no referral.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1b00000-0000-0000-0000-000000000006","role":"authenticated"}';
SELECT is(
  (SELECT referred FROM join_tenant_by_code((SELECT code FROM codes WHERE label='R_A'))),
  false, 'an already-member re-joining by a REF- code earns no referral');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM referrals
    WHERE referee_parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000006')),
  0, 'no referral row for an already-member');

-- ═══ GROUP 5 — preview, reserve, discount snapshot, RISK 2, FIFO ═════════════
-- RISK 7: preview equals what the insert will write (E has an available reward).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1d00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(
  (SELECT total_value||'/'||discount_amount||'/'||amount_payable
     FROM preview_package_price(
       (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000002'),
       'd1e00000-0000-0000-0000-000000000001')),
  '320.00/32.00/288.00', 'preview_package_price = 320 − 32 = 288 (RISK 7)');
RESET ROLE;

-- E requests P1 → apply reserves referee_first, snapshots the discount.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1b00000-0000-0000-0000-000000000002","role":"authenticated"}';
INSERT INTO parent_packages (tenant_id, parent_id, product_id)
VALUES ('d1000000-0000-0000-0000-000000000001',
        (SELECT id FROM parents WHERE profile_id='d1b00000-0000-0000-0000-000000000002'),
        'd1e00000-0000-0000-0000-000000000001');
RESET ROLE;
SELECT is((SELECT discount_amount FROM parent_packages
   WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000002')),
  32.00::numeric, 'the requested package snapshots discount_amount = 32');
SELECT is((SELECT amount_payable FROM parent_packages
   WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000002')),
  288.00::numeric, 'amount_payable = 288');
SELECT isnt((SELECT referral_reward_id FROM parent_packages
   WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000002')),
  NULL, 'the package points at the reward it consumed');
SELECT is((SELECT status FROM referral_rewards
   WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000002')
     AND kind='referee_first'),
  'reserved', 'the referee_first reward is now reserved');

-- RISK 2: a BARE parent INSERT with a reward available inserts one row and
-- reserves the reward, with NO deferred-FK error. p11 has a manual reward.
INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id, status)
VALUES ('d1000000-0000-0000-0000-000000000001',
        (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000011'),
        'manual', NULL, 'available');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1b00000-0000-0000-0000-000000000011","role":"authenticated"}';
SELECT lives_ok(
  $$ INSERT INTO parent_packages (tenant_id, parent_id, product_id)
     VALUES ('d1000000-0000-0000-0000-000000000001',
             (SELECT id FROM parents WHERE profile_id='d1b00000-0000-0000-0000-000000000011'),
             'd1e00000-0000-0000-0000-000000000001') $$,
  'RISK 2: a bare parent INSERT with a reward available does not raise a deferred-FK error');
RESET ROLE;
SELECT is((SELECT status FROM referral_rewards
   WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000011')),
  'reserved', 'RISK 2: that reward is reserved');

-- FIFO: p08 has three available rewards; the earliest reserves first.
INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id, status, earned_at)
VALUES
 ('d1000000-0000-0000-0000-000000000001',(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000008'),'manual',NULL,'available', now() - interval '3 days'),
 ('d1000000-0000-0000-0000-000000000001',(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000008'),'manual',NULL,'available', now() - interval '2 days'),
 ('d1000000-0000-0000-0000-000000000001',(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000008'),'manual',NULL,'available', now() - interval '1 days');
INSERT INTO parent_packages (tenant_id, parent_id, product_id)
VALUES ('d1000000-0000-0000-0000-000000000001',
        (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000008'),
        'd1e00000-0000-0000-0000-000000000001');
SELECT is(
  (SELECT date_trunc('day', earned_at) FROM referral_rewards
    WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000008')
      AND status='reserved'),
  date_trunc('day', now() - interval '3 days'),
  'FIFO: the earliest-earned reward reserves first');

-- ═══ GROUP 6 — activate → convert, idempotency, D8 ═══════════════════════════
-- Admin activates E's package.
UPDATE parent_packages SET status='active'
  WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000002');
SELECT is((SELECT status FROM referrals
   WHERE referee_parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000002')),
  'converted', 'activating the referee''s first package converts the referral');
SELECT is((SELECT status FROM referral_rewards
   WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000002')
     AND kind='referee_first'),
  'used', 'the referee_first reward is now used');
SELECT is(
  (SELECT count(*)::int FROM referral_rewards
    WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000001')
      AND kind='referrer' AND status='available'
      AND expires_at BETWEEN now() + interval '13 days' AND now() + interval '15 days'),
  1, 'the referrer earns one reward, expiring in ~14 days');

-- Idempotency: a further UPDATE that does not re-cross into active mints nothing.
UPDATE parent_packages SET value_remaining = value_remaining - 1
  WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000002');
SELECT is(
  (SELECT count(*)::int FROM referral_rewards
    WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000001')
      AND kind='referrer'),
  1, 'conversion is once-only — a later update mints no second referrer reward');

-- D8: cancelling the referee's ACTIVE package does not revoke the referrer reward.
UPDATE parent_packages SET status='cancelled'
  WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000002');
SELECT is(
  (SELECT status FROM referral_rewards
    WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000001')
      AND kind='referrer'),
  'available', 'D8: cancelling the referee''s package leaves the referrer reward intact');

-- ═══ GROUP 7 — release on cancel, expiry at reservation and at settle ════════
-- p12 release-on-cancel.
INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id, status)
VALUES ('d1000000-0000-0000-0000-000000000001',(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000012'),'manual',NULL,'available');
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id)
VALUES ('d1f00000-0000-0000-0000-000000000012','d1000000-0000-0000-0000-000000000001',
        (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000012'),
        'd1e00000-0000-0000-0000-000000000001');
UPDATE parent_packages SET status='cancelled' WHERE id='d1f00000-0000-0000-0000-000000000012';
SELECT is((SELECT status FROM referral_rewards
   WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000012')),
  'available', 'cancelling a pending package releases its reserved reward');

-- p13 expired-at-reservation: an expired reward is never reserved.
INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id, status, expires_at)
VALUES ('d1000000-0000-0000-0000-000000000001',(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000013'),'manual',NULL,'available', now() - interval '1 day');
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id)
VALUES ('d1f00000-0000-0000-0000-000000000013','d1000000-0000-0000-0000-000000000001',
        (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000013'),
        'd1e00000-0000-0000-0000-000000000001');
SELECT is((SELECT amount_payable FROM parent_packages WHERE id='d1f00000-0000-0000-0000-000000000013'),
  320.00::numeric, 'an expired reward is skipped at reservation — full price stands');

-- p14 expired-while-reserved, UNCLAIMED → reward expired, package zeroed.
INSERT INTO referral_rewards (id, tenant_id, parent_id, kind, referral_id, status)
VALUES ('d1a00000-0000-0000-0000-000000000014','d1000000-0000-0000-0000-000000000001',
        (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000014'),'manual',NULL,'available');
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id)
VALUES ('d1f00000-0000-0000-0000-000000000014','d1000000-0000-0000-0000-000000000001',
        (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000014'),
        'd1e00000-0000-0000-0000-000000000001');
UPDATE referral_rewards SET expires_at = now() - interval '1 minute' WHERE id='d1a00000-0000-0000-0000-000000000014';
UPDATE parent_packages SET status='active' WHERE id='d1f00000-0000-0000-0000-000000000014';
SELECT is((SELECT status FROM referral_rewards WHERE id='d1a00000-0000-0000-0000-000000000014'),
  'expired', 'RISK 13: a reward that expired while reserved settles as expired (unclaimed)');
SELECT is((SELECT amount_payable FROM parent_packages WHERE id='d1f00000-0000-0000-0000-000000000014'),
  320.00::numeric, 'RISK 13: the unclaimed package is restored to full price');

-- p15 expired-while-reserved, CLAIMED → price kept, reward used.
INSERT INTO referral_rewards (id, tenant_id, parent_id, kind, referral_id, status)
VALUES ('d1a00000-0000-0000-0000-000000000015','d1000000-0000-0000-0000-000000000001',
        (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000015'),'manual',NULL,'available');
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id)
VALUES ('d1f00000-0000-0000-0000-000000000015','d1000000-0000-0000-0000-000000000001',
        (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000015'),
        'd1e00000-0000-0000-0000-000000000001');
UPDATE parent_packages SET paid_claimed_at = now() WHERE id='d1f00000-0000-0000-0000-000000000015';
UPDATE referral_rewards SET expires_at = now() - interval '1 minute' WHERE id='d1a00000-0000-0000-0000-000000000015';
UPDATE parent_packages SET status='active' WHERE id='d1f00000-0000-0000-0000-000000000015';
SELECT is((SELECT amount_payable FROM parent_packages WHERE id='d1f00000-0000-0000-0000-000000000015'),
  288.00::numeric, 'RISK 6/13: a CLAIMED package keeps the price it was given');
SELECT is((SELECT status FROM referral_rewards WHERE id='d1a00000-0000-0000-0000-000000000015'),
  'used', 'RISK 13: the claimed row''s reward settles as used, not expired');

-- ═══ GROUP 8 — RISK 4: a request over an open discounted offer ═══════════════
-- p16 has a reward; the admin opens an offer (reserves it); then a parent
-- request arrives → the request reclaims the reward, the offer is superseded,
-- and exactly ONE reward is reserved, on the new row.
INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id, status)
VALUES ('d1000000-0000-0000-0000-000000000001',(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000016'),'manual',NULL,'available');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1d00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT create_package_offer(
  (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000016'),
  'd1e00000-0000-0000-0000-000000000001', NULL);
RESET ROLE;
-- the parent then requests the package themselves
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1b00000-0000-0000-0000-000000000016","role":"authenticated"}';
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id)
VALUES ('d1f00000-0000-0000-0000-000000000016','d1000000-0000-0000-0000-000000000001',
        (SELECT id FROM parents WHERE profile_id='d1b00000-0000-0000-0000-000000000016'),
        'd1e00000-0000-0000-0000-000000000001');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM referral_rewards
    WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000016')
      AND status='reserved'),
  1, 'RISK 4: exactly one reward stays reserved across the supersede');
SELECT is(
  (SELECT reserved_package_id FROM referral_rewards
    WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000016')
      AND status='reserved'),
  'd1f00000-0000-0000-0000-000000000016',
  'RISK 4: the reward is now held by the new request, and the request is discounted');
SELECT is((SELECT amount_payable FROM parent_packages WHERE id='d1f00000-0000-0000-0000-000000000016'),
  288.00::numeric, 'RISK 4: the new request carries the discount');

-- ═══ GROUP 9 — RISK 1-family: no cross-family reservation ════════════════════
INSERT INTO referral_rewards (id, tenant_id, parent_id, kind, referral_id, status)
VALUES ('d1a00000-0000-0000-0000-000000000017','d1000000-0000-0000-0000-000000000001',
        (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000017'),'manual',NULL,'available');
INSERT INTO parent_packages (tenant_id, parent_id, product_id)  -- p18 buys, has NO reward
VALUES ('d1000000-0000-0000-0000-000000000001',
        (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000018'),
        'd1e00000-0000-0000-0000-000000000001');
SELECT is((SELECT status FROM referral_rewards WHERE id='d1a00000-0000-0000-0000-000000000017'),
  'available', 'RISK 1-family: another family''s insert cannot reserve X''s reward');
SELECT is((SELECT amount_payable FROM parent_packages
   WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000018')),
  320.00::numeric, 'RISK 1-family: the family with no reward pays full price');

-- ═══ GROUP 10 — RISK 11: the discount snapshot is not client-writable ════════
-- p19 owns a pending package with a reserved reward (discount applied).
INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id, status)
VALUES ('d1000000-0000-0000-0000-000000000001',(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000019'),'manual',NULL,'available');
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id)
VALUES ('d1f00000-0000-0000-0000-000000000019','d1000000-0000-0000-0000-000000000001',
        (SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000019'),
        'd1e00000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1b00000-0000-0000-0000-000000000019","role":"authenticated"}';
SELECT throws_ok(
  $$ UPDATE parent_packages SET amount_payable = 0.01 WHERE id='d1f00000-0000-0000-0000-000000000019' $$,
  'Referral discount fields are set by the system, not edited directly.',
  'RISK 11: a parent cannot PATCH amount_payable');
SELECT throws_ok(
  $$ UPDATE parent_packages SET discount_amount = 999 WHERE id='d1f00000-0000-0000-0000-000000000019' $$,
  'Referral discount fields are set by the system, not edited directly.',
  'RISK 11: a parent cannot PATCH discount_amount');
SELECT throws_ok(
  $$ UPDATE parent_packages SET referral_reward_id = NULL WHERE id='d1f00000-0000-0000-0000-000000000019' $$,
  'Referral discount fields are set by the system, not edited directly.',
  'RISK 11: a parent cannot PATCH referral_reward_id');
SELECT is((SELECT count(*)::int FROM referral_rewards WHERE parent_id=
     (SELECT id FROM parents WHERE profile_id='d1b00000-0000-0000-0000-000000000019') ),
  1, 'RISK 5: a parent can read their own rewards (grant behind the policy)');
-- parent cannot write the referral tables at all (no grant / no write policy).
SELECT throws_ok(
  $$ UPDATE referral_rewards SET status='available' WHERE parent_id=
       (SELECT id FROM parents WHERE profile_id='d1b00000-0000-0000-0000-000000000019') $$,
  NULL::text, 'a parent cannot UPDATE referral_rewards');
SELECT throws_ok(
  $$ UPDATE referrals SET status='converted' WHERE referee_parent_id=
       (SELECT id FROM parents WHERE profile_id='d1b00000-0000-0000-0000-000000000002') $$,
  NULL::text, 'a parent cannot UPDATE referrals');
RESET ROLE;

-- ═══ GROUP 11 — RISK 6: void ═════════════════════════════════════════════════
-- void refused on a CLAIMED reserved package.
UPDATE parent_packages SET paid_claimed_at = now() WHERE id='d1f00000-0000-0000-0000-000000000019';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1d00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT void_referral_reward((SELECT referral_reward_id FROM parent_packages
       WHERE id='d1f00000-0000-0000-0000-000000000019'), 'oops') $$,
  'This reward is on a package the family has already paid — it cannot be voided.',
  'RISK 6: a reward on a claimed package cannot be voided');
RESET ROLE;
-- void on an UNCLAIMED reserved row zeroes the package.
UPDATE parent_packages SET paid_claimed_at = NULL WHERE id='d1f00000-0000-0000-0000-000000000019';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1d00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT lives_ok(
  $$ SELECT void_referral_reward((SELECT referral_reward_id FROM parent_packages
       WHERE id='d1f00000-0000-0000-0000-000000000019'), 'goodwill removed') $$,
  'RISK 6: an unclaimed reserved reward can be voided');
RESET ROLE;
SELECT is((SELECT amount_payable FROM parent_packages WHERE id='d1f00000-0000-0000-0000-000000000019'),
  320.00::numeric, 'voiding an unclaimed reserved reward restores full price');

-- ═══ GROUP 12 — RISK 5: referrer cannot see the referee''s identity ══════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1b00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM profiles WHERE id='d1b00000-0000-0000-0000-000000000002'),
  0, 'RISK 5: a referrer sees 0 rows of the referee''s profile');
SELECT is(
  (SELECT referee_first_name FROM my_referrals()
    WHERE referee_first_name IS NOT NULL LIMIT 1),
  'Ref', 'RISK 5: my_referrals() exposes only the referee''s first name');
RESET ROLE;

-- ═══ GROUP 13 — grants: admin RPCs refuse a parent caller ════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1b00000-0000-0000-0000-000000000007","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT grant_referral_reward((SELECT id FROM parents WHERE profile_id='d1b00000-0000-0000-0000-000000000007'), 'x') $$,
  'Not authorized to grant a referral reward.', 'a parent cannot grant a referral reward');
SELECT throws_ok(
  $$ SELECT set_referral_code_disabled((SELECT id FROM parent_tenants WHERE parent_id=
       (SELECT id FROM parents WHERE profile_id='d1b00000-0000-0000-0000-000000000007') LIMIT 1), true) $$,
  'Not authorized.', 'a parent cannot disable a referral code');
RESET ROLE;
-- admin grant works.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d1d00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT lives_ok(
  $$ SELECT grant_referral_reward((SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000007'), 'goodwill') $$,
  'an admin can grant a manual referral reward');
RESET ROLE;
SELECT is(
  (SELECT kind FROM referral_rewards
    WHERE parent_id=(SELECT parent_id FROM pm WHERE profile_id='d1b00000-0000-0000-0000-000000000007')
      AND kind='manual'),
  'manual', 'the manual reward is recorded');

SELECT * FROM finish();
ROLLBACK;
