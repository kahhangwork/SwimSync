-- pgTAP: PACKAGE REVENUE ON THE ACCOUNTING PAGE (20260928000100).
-- docs/plans/PACKAGE_REVENUE_REFUNDS_PLAN.md U1; BACKLOG "Package revenue on the accounting page".
--
-- WHAT THIS FILE PROTECTS. A package purchase counts as revenue ONCE, in the SGT month it was PAID
-- (confirmed_at), at amount_payable (after any referral discount) — a deliberate cash-basis exception to the
-- accrual basis of the invoices. And confirmed_at can no longer be back-dated by a client, because it now
-- decides a revenue month.
--
-- FIXTURE. Its own two businesses (prefix 87c…). Tenant A has NO rated coaches → wages_state 'final', wages 0,
-- net non-NULL (§7.298: a net check on a run_payouts month passes on anything). Two SEALED months:
--   mP  two months ago
--   mM  last month
-- Packages (all fixture writes as superuser — §7.300: the lifecycle trigger resets amount_payable on every
-- INSERT, and pins confirmed_at to now() under `authenticated`):
--   P1  total 300, DISCOUNTED to payable 270, confirmed mM day 10           → 270 in mM
--   P2  total 100, confirmed mM-01 07:30 SGT (= the previous day in UTC)    → 100 in mM, NOT in mP
--   P3  pending, never confirmed                                            → 0
--   P4  pending → cancelled (declined)                                      → 0
--   P5  total 50, confirmed mM day 12, then CANCELLED                       → 50 in mM (it was still paid)
--   P6  tenant B, total 1000, confirmed mM                                  → never in A
--   P7  total 40, confirmed mP day 15                                       → 40 in mP
-- Invoice (A, mM): gross 200, package_applied 60, net 140, paid.
--   mM: revenue_packages 420, invoiced 140, revenue 560, net 560.   mP: revenue_packages 40, revenue 40.
--
-- RED-FIRST PROOF (§7.25, §7.299 — by mutating the NEW body, one at a time; each turned the named checks red):
--   (a) to_char(pp.confirmed_at,'YYYY-MM') without AT TIME ZONE   → tests 2, 3, 5, 7, 8 red
--   (b) SUM(pp.total_value) for amount_payable                     → tests 2, 5, 7 red
--   (c) AND pp.status <> 'cancelled'                               → tests 2, 5, 7 red
--   (d) net computed as (v_invoiced + v_settlements) - v_wages     → test 7 red
--   (e) the confirmed_at pin removed from the lifecycle trigger    → tests 10, 11 red
--   (run 2026-09-27; bodies restored and diffed back to the migration's afterwards)

BEGIN;
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(18);
SELECT is(app_today(), '2026-09-15'::date, 'clock pinned');

-- Wave 7: literals = the former derivation evaluated at the pinned clock (2026-09-15 10:00+08).
CREATE TEMP TABLE f AS
SELECT
  '2026-07'::text    AS mp,
  '2026-08'::text    AS mm,
  '2026-08-01'::date AS mm1,
  '2026-07-01'::date AS mp1;
GRANT SELECT ON f TO PUBLIC;

INSERT INTO tenants (id, slug, display_name, join_code, created_at) VALUES
  ('87c00000-0000-0000-0000-0000000000a0','pkrev-a','PkgRev Business A','SWIM-PKRA', app_now()),
  ('87c00000-0000-0000-0000-0000000000b0','pkrev-b','PkgRev Business B','SWIM-PKRB', app_now());

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','87c10000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','pkrev-owner-a@test.local', crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}',
   '{"full_name":"PkgRev Owner A","role":"tenant_admin","tenant_id":"87c00000-0000-0000-0000-0000000000a0"}', app_now(), app_now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','87c10000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','pkrev-owner-b@test.local', crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}',
   '{"full_name":"PkgRev Owner B","role":"tenant_admin","tenant_id":"87c00000-0000-0000-0000-0000000000b0"}', app_now(), app_now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','87c10000-0000-0000-0000-00000000009f',
   'authenticated','authenticated','pkrev-parent@test.local', crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}',
   '{"full_name":"PkgRev Parent","role":"parent"}', app_now(), app_now(), '', '', '', '');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, t FROM parents p,
  (VALUES ('87c00000-0000-0000-0000-0000000000a0'::uuid), ('87c00000-0000-0000-0000-0000000000b0'::uuid)) v(t)
 WHERE p.profile_id = '87c10000-0000-0000-0000-00000000009f';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('87c20000-0000-0000-0000-0000000000a0','87c00000-0000-0000-0000-0000000000a0','Group'),
  ('87c20000-0000-0000-0000-0000000000b0','87c00000-0000-0000-0000-0000000000b0','Group');

INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count, rate_per_lesson, validity_months) VALUES
  ('87c30000-0000-0000-0000-000000000300','87c00000-0000-0000-0000-0000000000a0','Ten @30','87c20000-0000-0000-0000-0000000000a0',10,30.00,12),
  ('87c30000-0000-0000-0000-000000000100','87c00000-0000-0000-0000-0000000000a0','Five @20','87c20000-0000-0000-0000-0000000000a0', 5,20.00,12),
  ('87c30000-0000-0000-0000-000000000050','87c00000-0000-0000-0000-0000000000a0','Two @25','87c20000-0000-0000-0000-0000000000a0', 2,25.00,12),
  ('87c30000-0000-0000-0000-000000000040','87c00000-0000-0000-0000-0000000000a0','Two @20','87c20000-0000-0000-0000-0000000000a0', 2,20.00,12),
  ('87c30000-0000-0000-0000-000000001000','87c00000-0000-0000-0000-0000000000b0','B ten','87c20000-0000-0000-0000-0000000000b0',10,100.00,12);

-- Superuser inserts: status/confirmed_at honoured as written (the pin is `authenticated`-only).
INSERT INTO parent_packages (id, parent_id, product_id, status, confirmed_at)
SELECT v.id, (SELECT id FROM parents WHERE profile_id = '87c10000-0000-0000-0000-00000000009f'),
       v.prod, v.st, v.conf
FROM f, LATERAL (VALUES
  ('87c40000-0000-0000-0000-000000000001'::uuid,'87c30000-0000-0000-0000-000000000300'::uuid,'active',
     (f.mM1 + 9 + TIME '12:00') AT TIME ZONE 'Asia/Singapore'),
  ('87c40000-0000-0000-0000-000000000002'::uuid,'87c30000-0000-0000-0000-000000000100'::uuid,'active',
     (f.mM1 + TIME '07:30') AT TIME ZONE 'Asia/Singapore'),
  ('87c40000-0000-0000-0000-000000000003'::uuid,'87c30000-0000-0000-0000-000000000100'::uuid,'pending', NULL::timestamptz),
  ('87c40000-0000-0000-0000-000000000004'::uuid,'87c30000-0000-0000-0000-000000000100'::uuid,'pending', NULL::timestamptz),
  ('87c40000-0000-0000-0000-000000000005'::uuid,'87c30000-0000-0000-0000-000000000050'::uuid,'active',
     (f.mM1 + 11 + TIME '12:00') AT TIME ZONE 'Asia/Singapore'),
  ('87c40000-0000-0000-0000-000000000006'::uuid,'87c30000-0000-0000-0000-000000001000'::uuid,'active',
     (f.mM1 + 9 + TIME '12:00') AT TIME ZONE 'Asia/Singapore'),
  ('87c40000-0000-0000-0000-000000000007'::uuid,'87c30000-0000-0000-0000-000000000040'::uuid,'active',
     (f.mP1 + 14 + TIME '12:00') AT TIME ZONE 'Asia/Singapore')
) AS v(id, prod, st, conf);

-- P1's referral discount — set AFTER the insert (§7.300), as superuser.
UPDATE parent_packages SET discount_amount = 30.00, amount_payable = 270.00
 WHERE id = '87c40000-0000-0000-0000-000000000001';
UPDATE parent_packages SET status = 'cancelled' WHERE id IN ('87c40000-0000-0000-0000-000000000004',
                                                              '87c40000-0000-0000-0000-000000000005');

INSERT INTO invoices (id, parent_id, billing_month, gross_amount, package_applied, credit_applied,
                      balance_adjustment, net_amount, status, tenant_id, reference_number, public_token)
SELECT '87c50000-0000-0000-0000-000000000001',
       (SELECT id FROM parents WHERE profile_id = '87c10000-0000-0000-0000-00000000009f'),
       f.mM, 200.00, 60.00, 0, 0, 140.00, 'paid', '87c00000-0000-0000-0000-0000000000a0',
       'INV-87C0-0001', 'pkrev-tok-0001'
FROM f;

INSERT INTO billing_periods (billing_month, tenant_id, invoices_issued)
SELECT m, t, 1 FROM f, LATERAL (VALUES
  (f.mP, '87c00000-0000-0000-0000-0000000000a0'::uuid),
  (f.mM, '87c00000-0000-0000-0000-0000000000a0'::uuid),
  (f.mM, '87c00000-0000-0000-0000-0000000000b0'::uuid)) AS s(m, t);

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Precondition: P1 really is discounted (else check 2's "270 not 300" is vacuous, §7.300).
SELECT ok((SELECT total_value = 300 AND amount_payable = 270 FROM parent_packages
            WHERE id = '87c40000-0000-0000-0000-000000000001'),
  'precondition: P1 is total 300, payable 270');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"87c10000-0000-0000-0000-0000000000a1","role":"authenticated"}';

CREATE TEMP TABLE sm ON COMMIT DROP AS SELECT * FROM accounting_summary('87c00000-0000-0000-0000-0000000000a0', (SELECT mM FROM f));
CREATE TEMP TABLE sp ON COMMIT DROP AS SELECT * FROM accounting_summary('87c00000-0000-0000-0000-0000000000a0', (SELECT mP FROM f));

-- 2. mM packages: P1 270 (payable, not 300) + P2 100 (07:30 SGT on the 1st) + P5 50 (paid, later cancelled).
--    P3/P4 (never paid) and P6 (tenant B) contribute nothing.
SELECT is((SELECT revenue_packages FROM sm), 420.00::numeric,
  'mM revenue_packages = 270 + 100 + 50 — payable not total, SGT month, cancelled-after-paid counted, unpaid and other tenant excluded');

-- 3. The boundary pair's other half: P2 is NOT in mP (a UTC bucket would put it there → 140).
SELECT is((SELECT revenue_packages FROM sp), 40.00::numeric,
  'mP revenue_packages = 40 only — the 07:30-SGT package on mM-01 is not bucketed into the previous UTC day''s month');

-- 4. Revenue = invoiced + settlements + packages.
SELECT is((SELECT revenue FROM sm), (SELECT revenue_invoiced + revenue_settlements + revenue_packages FROM sm),
  'revenue = invoiced + settlements + packages');
SELECT is((SELECT revenue FROM sm), 560.00::numeric, 'mM revenue = 140 invoiced + 420 packages');

-- 5. No double count: the package-funded invoice lines stay subtracted inside invoiced revenue (W2).
SELECT is((SELECT (revenue_gross, revenue_package_applied, revenue_invoiced) FROM sm),
  (200.00::numeric, 60.00::numeric, 140.00::numeric),
  'package-funded invoice lines stay subtracted (gross 200 − applied 60 = invoiced 140); the purchase is added once');

-- 6. Net reads the same revenue (§7.298), on a wages-FINAL month.
SELECT is((SELECT (wages_state, net) FROM sm), ('final'::text, 560.00::numeric),
  'net = revenue − wages on a wages-final month (wages 0 → net 560)');

SELECT is((SELECT revenue FROM sp), 40.00::numeric, 'mP revenue = the 40 package alone');

-- 8–9. The confirmed_at pin: an authenticated caller cannot back-date a confirmation.
SELECT lives_ok($$
  INSERT INTO parent_packages (id, parent_id, product_id, status, confirmed_at)
  SELECT '87c40000-0000-0000-0000-000000000008', p.id, '87c30000-0000-0000-0000-000000000100',
         'active', TIMESTAMPTZ '2020-01-01 12:00+08'
    FROM parents p WHERE p.profile_id = '87c10000-0000-0000-0000-00000000009f'
$$, 'the owner sells a package as active, supplying a past confirmed_at');

RESET ROLE;
INSERT INTO parent_packages (id, parent_id, product_id)
SELECT '87c40000-0000-0000-0000-000000000009', p.id, '87c30000-0000-0000-0000-000000000100'
  FROM parents p WHERE p.profile_id = '87c10000-0000-0000-0000-00000000009f';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"87c10000-0000-0000-0000-0000000000a1","role":"authenticated"}';
UPDATE parent_packages SET status = 'active', confirmed_at = TIMESTAMPTZ '2020-01-01 12:00+08'
 WHERE id = '87c40000-0000-0000-0000-000000000009';
RESET ROLE;

SELECT is((SELECT confirmed_at FROM parent_packages WHERE id = '87c40000-0000-0000-0000-000000000008'), app_now(),
  'INSERT-as-active by an authenticated caller: confirmed_at is pinned to app_now(), not the supplied 2020 date');
SELECT is((SELECT confirmed_at FROM parent_packages WHERE id = '87c40000-0000-0000-0000-000000000009'), app_now(),
  'pending→active by an authenticated caller: confirmed_at is pinned to app_now(), not the supplied 2020 date');

-- 11. The audit arm U2's refund RPCs rely on (§7.297).
SELECT is(audit_log_tenant_of('parent_package', '87c40000-0000-0000-0000-000000000001'),
  '87c00000-0000-0000-0000-0000000000a0'::uuid, 'audit_log_tenant_of(parent_package) returns the package''s tenant');

-- 12–16. Grants after the DROP + CREATE (§7.87, §7.39) — one function, EXECUTE for authenticated only.
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'accounting_summary'), 1,
  'exactly one accounting_summary (§7.124)');
SELECT ok(has_function_privilege('authenticated','public.accounting_summary(uuid,character)','EXECUTE'),
  'authenticated holds EXECUTE on accounting_summary');
SELECT ok(NOT has_function_privilege('anon','public.accounting_summary(uuid,character)','EXECUTE'),
  'anon holds no EXECUTE on accounting_summary');
SELECT ok(NOT has_function_privilege('service_role','public.accounting_summary(uuid,character)','EXECUTE'),
  'service_role holds no EXECUTE on accounting_summary');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                       WHERE p.oid = 'public.accounting_summary(uuid,character)'::regprocedure
                         AND a.grantee = 0),
  'PUBLIC holds no EXECUTE on accounting_summary');

SELECT * FROM finish();
ROLLBACK;
