-- pgTAP: OWNER-ONLY ACCOUNTING PAGE — accounting_months() + accounting_summary()
-- (20260823000100). BACKLOG.md → "An owner-only accounting page".
--
-- WHAT THIS FILE PROTECTS. This is a P&L. Two failure modes are load-bearing:
--   (1) the wrong AUDIENCE reads it — a co-admin, another business, the platform
--       admin — so the owner gate is pinned against the exact template-gate
--       mistake it must not copy (⚠ RISK 4);
--   (2) a WRONG NUMBER reads as authoritative — a partial wage sum, a
--       balance_adjustment leaking into revenue, an adjustment lost to its own
--       month — so every figure is asserted against a hand-computed non-zero
--       value (§7.25; no expected 0 outside the two named cases: a reversed
--       settlement and a rate-less tenant).
--
-- METHOD (§7.16): probes run under SET LOCAL ROLE authenticated with JWT claims;
-- fixture writes happen as superuser between probes via RESET ROLE. Payout state
-- is built by DIRECT inserts (not generate_coach_payouts) so each wages_state —
-- run_payouts / draft / final — is constructed exactly.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(38);

-- ── Months + dates, from one SGT anchor ─────────────────────────────────────
--   mM   two months ago   SEALED (tenant A) — the main figures month
--   mM2  last month        SEALED (tenant A + tenant B)
--   mU   this month        NEVER sealed — the unsealed-refusal case
CREATE TEMP TABLE f AS
SELECT
  to_char((now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '2 month','YYYY-MM') AS mM,
  to_char((now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '1 month','YYYY-MM') AS mM2,
  to_char((now() AT TIME ZONE 'Asia/Singapore'),'YYYY-MM')                       AS mU,
  (date_trunc('month',(now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '2 month') + INTERVAL '7 days')::date AS dM,
  (date_trunc('month',(now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '1 month') + INTERVAL '7 days')::date AS dM2;
GRANT SELECT ON f TO PUBLIC;

-- ── Two businesses ──────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code, created_at) VALUES
  ('85000000-0000-0000-0000-0000000000a0','accta','Acct Business A','SWIM-ACTA', now()),
  ('85000000-0000-0000-0000-0000000000b0','acctb','Acct Business B','SWIM-ACTB', now());

-- Tenant A's OWNER must be the first tenant_admin inserted for A (handle_new_user
-- claims ownership only while owner_profile_id IS NULL) — so insert the owner in
-- its own statement, BEFORE the co-admin, to make the ordering explicit.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','85100000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','acct-owner-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Acct Owner A","role":"tenant_admin","tenant_id":"85000000-0000-0000-0000-0000000000a0"}', now(), now(), '', '', '', '');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','85100000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','acct-coadmin-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Acct CoAdmin A","role":"tenant_admin","tenant_id":"85000000-0000-0000-0000-0000000000a0"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','85100000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','acct-owner-b@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Acct Owner B","role":"tenant_admin","tenant_id":"85000000-0000-0000-0000-0000000000b0"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','85100000-0000-0000-0000-000000000ca1',
   'authenticated','authenticated','acct-coach-a1@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Acct Coach A1","role":"coach","tenant_id":"85000000-0000-0000-0000-0000000000a0"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','85100000-0000-0000-0000-000000000ca2',
   'authenticated','authenticated','acct-coach-a2@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Acct Coach A2","role":"coach","tenant_id":"85000000-0000-0000-0000-0000000000a0"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','85100000-0000-0000-0000-0000000000cb',
   'authenticated','authenticated','acct-coach-b@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Acct Coach B","role":"coach","tenant_id":"85000000-0000-0000-0000-0000000000b0"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','85100000-0000-0000-0000-00000000009f',
   'authenticated','authenticated','acct-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Acct Parent","role":"parent"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','85100000-0000-0000-0000-00000000009e',
   'authenticated','authenticated','acct-parent2@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Acct Parent 2","role":"parent"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','85100000-0000-0000-0000-0000000000da',
   'authenticated','authenticated','acct-platform@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Acct Platform","role":"platform_admin"}', now(), now(), '', '', '', '');

-- Coaches A1, A2 are RATED; coach B is NOT (a private coach — prod's shape).
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from)
SELECT id, 30, 60, (SELECT dM FROM f) - INTERVAL '1 year'
  FROM coaches WHERE profile_id IN ('85100000-0000-0000-0000-000000000ca1',
                                    '85100000-0000-0000-0000-000000000ca2');

INSERT INTO students (id, full_name, tenant_id) VALUES
  ('85500000-0000-0000-0000-000000000001','Acct Student A','85000000-0000-0000-0000-0000000000a0');

-- One class per rated coach, so lesson_sessions (which payout items require) exist.
INSERT INTO class_categories (tenant_id, name)
SELECT '85000000-0000-0000-0000-0000000000a0','Default Group'
 WHERE NOT EXISTS (SELECT 1 FROM class_categories
                    WHERE tenant_id='85000000-0000-0000-0000-0000000000a0'
                      AND lower(trim(name))='default group');

INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                     end_time, location_name, price_per_lesson, category_id)
SELECT v.id, '85000000-0000-0000-0000-0000000000a0',
       (SELECT id FROM coaches WHERE profile_id = v.coach),
       v.title,'monday','10:00','11:00','Pool',30,
       (SELECT id FROM class_categories
         WHERE tenant_id='85000000-0000-0000-0000-0000000000a0'
           AND lower(trim(name))='default group')
FROM (VALUES
  ('85700000-0000-0000-0000-000000000001'::UUID,'85100000-0000-0000-0000-000000000ca1'::UUID,'Acct Class A1'),
  ('85700000-0000-0000-0000-000000000002'::UUID,'85100000-0000-0000-0000-000000000ca2'::UUID,'Acct Class A2')
) AS v(id, coach, title);

INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time)
SELECT v.id, v.class_id, v.d, '10:00','11:00'
FROM f, (VALUES
  ('85800000-0000-0000-0000-000000000001'::UUID,'85700000-0000-0000-0000-000000000001'::UUID,'M'),   -- CA1 M
  ('85800000-0000-0000-0000-000000000002'::UUID,'85700000-0000-0000-0000-000000000001'::UUID,'M2'),  -- CA1 M2
  ('85800000-0000-0000-0000-000000000003'::UUID,'85700000-0000-0000-0000-000000000001'::UUID,'MA'),  -- CA1 adj (orig M), distinct date
  ('85800000-0000-0000-0000-000000000004'::UUID,'85700000-0000-0000-0000-000000000002'::UUID,'M'),   -- CA2 M
  ('85800000-0000-0000-0000-000000000005'::UUID,'85700000-0000-0000-0000-000000000002'::UUID,'M2')   -- CA2 M2
) AS w(id, class_id, key)
CROSS JOIN LATERAL (SELECT w.id, w.class_id,
  CASE w.key WHEN 'M' THEN f.dM
             WHEN 'MA' THEN f.dM + INTERVAL '1 day'
             ELSE f.dM2 END AS d) v;

-- ── Seals: A seals mM and mM2; B seals mM2. mU is never sealed. ──────────────
INSERT INTO billing_periods (billing_month, tenant_id, invoices_issued)
SELECT m, t::uuid, 1 FROM (VALUES
  ((SELECT mM  FROM f),'85000000-0000-0000-0000-0000000000a0'),
  ((SELECT mM2 FROM f),'85000000-0000-0000-0000-0000000000a0'),
  ((SELECT mM2 FROM f),'85000000-0000-0000-0000-0000000000b0')
) AS s(m, t);

-- ── Invoices ────────────────────────────────────────────────────────────────
-- Tenant A / mM:
--   A1: gross 100, net 100, OUTSTANDING          → outstanding = 100
--   A2: gross 80, package 10, credit 20, adj 15, net 65, PAID
--   revenue_invoiced(mM) = (100-0) + (65-15) = 150 ; components reconcile
--     150 = gross 180 − package 10 − credit 20
-- Tenant A / mM2:  A3: gross 300, net 300, PAID   → revenue_invoiced(mM2)=300
-- Tenant B / mM2:  B1: gross 300, net 300, PAID   → revenue(B)=300, wages 0
INSERT INTO invoices (id, parent_id, billing_month, gross_amount, package_applied,
                      credit_applied, balance_adjustment, net_amount, status,
                      tenant_id, reference_number, public_token)
SELECT v.id,
       (SELECT id FROM parents WHERE profile_id = v.pprofile::uuid),
       v.bm, v.gross, v.pkg, v.cred, v.adj, v.net, v.st::invoice_status, v.tenant::uuid, v.ref, v.tok
FROM f, (VALUES
  ('85600000-0000-0000-0000-000000000001'::UUID,'85100000-0000-0000-0000-00000000009f',(SELECT mM  FROM f),100.00,0.00,0.00,0.00,100.00,'outstanding','85000000-0000-0000-0000-0000000000a0','INV-8500-0001','acct-tok-0001'),
  ('85600000-0000-0000-0000-000000000002'::UUID,'85100000-0000-0000-0000-00000000009e',(SELECT mM  FROM f), 80.00,10.00,20.00,15.00, 65.00,'paid'       ,'85000000-0000-0000-0000-0000000000a0','INV-8500-0002','acct-tok-0002'),
  ('85600000-0000-0000-0000-000000000003'::UUID,'85100000-0000-0000-0000-00000000009f',(SELECT mM2 FROM f),300.00,0.00,0.00,0.00,300.00,'paid'       ,'85000000-0000-0000-0000-0000000000a0','INV-8500-0003','acct-tok-0003'),
  ('85600000-0000-0000-0000-000000000004'::UUID,'85100000-0000-0000-0000-00000000009f',(SELECT mM2 FROM f),300.00,0.00,0.00,0.00,300.00,'paid'       ,'85000000-0000-0000-0000-0000000000b0','INV-8500-0004','acct-tok-0004')
) AS v(id, pprofile, bm, gross, pkg, cred, adj, net, st, tenant, ref, tok);

-- ── Settlements (tenant A) ──────────────────────────────────────────────────
--   SS1: paid_outside 40 through dM (mM)   → counts in mM
--   SS2: paid_outside 999 through dM, REVERSED → excluded (named-zero case)
--   SS3: paid_outside 25 through dM2 (mM2)  → counts in mM2 ONLY (conservation)
INSERT INTO student_settlements (id, tenant_id, student_id, settled_through, kind,
                                 amount, recorded_by, reversed_at, reversed_by)
SELECT v.id,'85000000-0000-0000-0000-0000000000a0','85500000-0000-0000-0000-000000000001',
       v.through,'paid_outside',v.amt,'85100000-0000-0000-0000-0000000000a1',v.rev,v.revby
FROM f, (VALUES
  ('85900000-0000-0000-0000-000000000001'::UUID,(SELECT dM  FROM f), 40.00, NULL::timestamptz, NULL::uuid),
  ('85900000-0000-0000-0000-000000000002'::UUID,(SELECT dM  FROM f),999.00, now(), '85100000-0000-0000-0000-0000000000a1'::uuid),
  ('85900000-0000-0000-0000-000000000003'::UUID,(SELECT dM2 FROM f), 25.00, NULL::timestamptz, NULL::uuid)
) AS v(id, through, amt, rev, revby);

-- ── Payouts (direct inserts; CA2's mM payout added LATER, in phases) ─────────
-- CA1 mM (paid): non-adj 120
-- CA1 mM2 (paid): non-adj 200 + ADJUSTMENT 10 carrying original_period = mM
-- CA2 mM2 (paid): non-adj 30
-- => wages(mM2) = 200 + 30 = 230 (adjustment belongs to mM, not mM2)
-- => wages(mM) once CA2's mM payout exists = 120 + [CA2 mM] + 10 (adj)
INSERT INTO coach_payouts (id, tenant_id, coach_id, period_month, gross_amount, status)
SELECT v.id,'85000000-0000-0000-0000-0000000000a0',
       (SELECT id FROM coaches WHERE profile_id=v.coach::uuid), v.pm, v.gross, 'paid'
FROM (VALUES
  ('85a00000-0000-0000-0000-000000000001'::UUID,'85100000-0000-0000-0000-000000000ca1',(SELECT mM  FROM f),120.00),
  ('85a00000-0000-0000-0000-000000000002'::UUID,'85100000-0000-0000-0000-000000000ca1',(SELECT mM2 FROM f),210.00),
  ('85a00000-0000-0000-0000-000000000003'::UUID,'85100000-0000-0000-0000-000000000ca2',(SELECT mM2 FROM f), 30.00)
) AS v(id, coach, pm, gross);

INSERT INTO coach_payout_items (payout_id, lesson_session_id, class_title,
                                session_date, basis, amount, is_adjustment, original_period)
SELECT v.payout, v.ls, 'Acct Class', d.d, v.basis, v.amt, v.isadj, v.orig
FROM f, (VALUES
  ('85a00000-0000-0000-0000-000000000001'::UUID,'85800000-0000-0000-0000-000000000001'::UUID,'M','duration',120.00,FALSE,NULL::bpchar),
  ('85a00000-0000-0000-0000-000000000002'::UUID,'85800000-0000-0000-0000-000000000002'::UUID,'M2','duration',200.00,FALSE,NULL::bpchar),
  ('85a00000-0000-0000-0000-000000000002'::UUID,'85800000-0000-0000-0000-000000000003'::UUID,'M','adjustment',10.00,TRUE,(SELECT mM FROM f)::bpchar),
  ('85a00000-0000-0000-0000-000000000003'::UUID,'85800000-0000-0000-0000-000000000005'::UUID,'M2','duration',30.00,FALSE,NULL::bpchar)
) AS v(payout, ls, key, basis, amt, isadj, orig)
CROSS JOIN LATERAL (SELECT CASE v.key WHEN 'M' THEN f.dM ELSE f.dM2 END AS d) d;

-- ════════════════════════════════════════════════════════════════════════════
-- 1–4. Grant surface (§7.87): authenticated yes, anon never.
SELECT ok(has_function_privilege('authenticated','public.accounting_months(uuid)','EXECUTE'),
  'authenticated holds EXECUTE on accounting_months');
SELECT ok(NOT has_function_privilege('anon','public.accounting_months(uuid)','EXECUTE'),
  'anon holds no EXECUTE on accounting_months');
SELECT ok(has_function_privilege('authenticated','public.accounting_summary(uuid,character)','EXECUTE'),
  'authenticated holds EXECUTE on accounting_summary');
SELECT ok(NOT has_function_privilege('anon','public.accounting_summary(uuid,character)','EXECUTE'),
  'anon holds no EXECUTE on accounting_summary');

-- ── 5–8. accounting_summary gate: only the owner (⚠ RISK 4) ──────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"85100000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM accounting_summary('85000000-0000-0000-0000-0000000000a0', (SELECT mM FROM f)) $$,
  'only the business owner may read accounting figures',
  'a CO-ADMIN cannot read accounting_summary (this fails against a can_admin_tenant gate)');

SET LOCAL "request.jwt.claims" TO '{"sub":"85100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM accounting_summary('85000000-0000-0000-0000-0000000000a0', (SELECT mM FROM f)) $$,
  'only the business owner may read accounting figures',
  'another business''s OWNER cannot read tenant A''s figures');

SET LOCAL "request.jwt.claims" TO '{"sub":"85100000-0000-0000-0000-0000000000da","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM accounting_summary('85000000-0000-0000-0000-0000000000a0', (SELECT mM FROM f)) $$,
  'only the business owner may read accounting figures',
  'the PLATFORM admin is refused too — owner-only was the decision');

SET LOCAL "request.jwt.claims" TO '{"sub":"85100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT lives_ok(
  $$ SELECT * FROM accounting_summary('85000000-0000-0000-0000-0000000000a0', (SELECT mM FROM f)) $$,
  'the OWNER reads accounting_summary');

-- ── 9–10. accounting_months gate ─────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"85100000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM accounting_months('85000000-0000-0000-0000-0000000000a0') $$,
  'only the business owner may read accounting figures',
  'a co-admin cannot read accounting_months');
SET LOCAL "request.jwt.claims" TO '{"sub":"85100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM accounting_months('85000000-0000-0000-0000-0000000000a0') $$,
  'only the business owner may read accounting figures',
  'another business''s owner cannot read tenant A''s months');

-- ── 11–14. accounting_months content + unsealed refusal ──────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"85100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is(
  (SELECT count(*) FROM accounting_months('85000000-0000-0000-0000-0000000000a0'))::int,
  2, 'two sealed months for tenant A');
SELECT is(
  (SELECT billing_month FROM accounting_months('85000000-0000-0000-0000-0000000000a0') LIMIT 1),
  (SELECT mM2 FROM f), 'newest sealed month sorts first');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM accounting_months('85000000-0000-0000-0000-0000000000a0')
               WHERE billing_month = (SELECT mU FROM f)),
  'the unsealed current month is not offered');
SELECT throws_like(
  $$ SELECT * FROM accounting_summary('85000000-0000-0000-0000-0000000000a0', (SELECT mU FROM f)) $$,
  '%is not sealed for this business',
  '⚠ RISK 5: accounting_summary refuses an unsealed month on its own');

-- ── 15–23. Revenue components + outstanding, tenant A / mM (⚠ RISK 3, 7) ─────
SELECT is((SELECT revenue                    FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))), 190.00, 'revenue = invoiced 150 + settlements 40');
SELECT is((SELECT revenue_invoiced           FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))), 150.00, 'revenue_invoiced excludes balance_adjustment');
SELECT is((SELECT revenue_settlements        FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))),  40.00, 'settlements: live paid_outside in mM only (reversed 999 + mM2''s 25 excluded)');
SELECT is((SELECT revenue_gross              FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))), 180.00, 'revenue_gross = 100 + 80');
SELECT is((SELECT revenue_package_applied    FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))),  10.00, 'revenue_package_applied surfaced');
SELECT is((SELECT revenue_credit_applied     FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))),  20.00, 'revenue_credit_applied surfaced');
SELECT is((SELECT revenue_balance_adjustment FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))),  15.00, 'revenue_balance_adjustment surfaced');
SELECT is(
  (SELECT revenue_invoiced - (revenue_gross - revenue_package_applied - revenue_credit_applied)
     FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))),
  0.00, 'components reconcile: invoiced = gross − package − credit');
SELECT is((SELECT outstanding FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))), 100.00, 'outstanding = mM''s unpaid invoice net (raw net_amount, no adj subtraction)');

-- ── 24–29. Wages PHASE 1: mM run_payouts (CA2 has no mM payout); mM2 final ────
SELECT is((SELECT wages_state FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))), 'run_payouts', '⚠ RISK 1: a rated coach missing an mM payout row → run_payouts, not "final"');
SELECT is((SELECT wages FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))), NULL::numeric, 'run_payouts withholds wages (NULL, never a partial sum)');
SELECT is((SELECT net   FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))), NULL::numeric, 'run_payouts withholds net');
SELECT is((SELECT wages_state FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM2 FROM f))), 'final', 'mM2: every rated coach paid → final');
SELECT is((SELECT wages FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM2 FROM f))), 230.00, '⚠ RISK 2: wages(mM2)=230 — the adjustment (original_period=mM) does NOT leak into its host month');
SELECT is((SELECT revenue_settlements FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM2 FROM f))), 25.00, 'the mM2 settlement lands in mM2 exactly once');

-- ── 30–31. Wages PHASE 2: add CA2 mM payout as DRAFT → draft ─────────────────
RESET ROLE;
INSERT INTO coach_payouts (id, tenant_id, coach_id, period_month, gross_amount, status)
VALUES ('85a00000-0000-0000-0000-000000000004','85000000-0000-0000-0000-0000000000a0',
        (SELECT id FROM coaches WHERE profile_id='85100000-0000-0000-0000-000000000ca2'),
        (SELECT mM FROM f), 50.00, 'draft');
INSERT INTO coach_payout_items (payout_id, lesson_session_id, class_title, session_date, basis, amount)
SELECT '85a00000-0000-0000-0000-000000000004','85800000-0000-0000-0000-000000000004','Acct Class A2', dM, 'duration', 50.00 FROM f;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"85100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is((SELECT wages_state FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))), 'draft', 'all rated coaches present, one draft → draft');
SELECT is((SELECT wages FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))), 180.00, '⚠ RISK 2: wages(mM)=120+50+10 — the adjustment IS reallocated INTO mM by original_period');

-- ── 32–34. Wages PHASE 3: CA2 mM payout → paid → final ───────────────────────
RESET ROLE;
UPDATE coach_payouts SET status='paid' WHERE id='85a00000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"85100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is((SELECT wages_state FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))), 'final', 'all paid → final');
SELECT is((SELECT wages FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))), 180.00, 'final wages unchanged at 180');
SELECT is((SELECT net   FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))), 10.00, 'net = revenue 190 − wages 180');

-- ── 35. Wages PHASE 4: a DRAFT that holds mM's reallocated adjustment makes mM
--        'draft' even though mM's own payouts are all paid. CA1's mM2 payout
--        carries the original_period=mM adjustment; flip it to draft. Without the
--        broadened v_draft check this reports 'final' (the quiet wrong number). ─
RESET ROLE;
UPDATE coach_payouts SET status='draft' WHERE id='85a00000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"85100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is((SELECT wages_state FROM accounting_summary('85000000-0000-0000-0000-0000000000a0',(SELECT mM FROM f))), 'draft', 'a DRAFT payout holding mM''s reallocated adjustment makes mM ''draft'', not ''final''');

-- ── 36–38. Rate-less tenant + cross-tenant rate isolation (⚠ RISK 1) ─────────
SET LOCAL "request.jwt.claims" TO '{"sub":"85100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT is((SELECT wages_state FROM accounting_summary('85000000-0000-0000-0000-0000000000b0',(SELECT mM2 FROM f))), 'final', 'a RATE-LESS tenant is final even though tenant A has rated coaches (tenant-scoped rate lookup)');
SELECT is((SELECT wages FROM accounting_summary('85000000-0000-0000-0000-0000000000b0',(SELECT mM2 FROM f))),   0.00, 'rate-less tenant: wages 0 (named zero case)');
SELECT is((SELECT net   FROM accounting_summary('85000000-0000-0000-0000-0000000000b0',(SELECT mM2 FROM f))), 300.00, 'net = revenue for a rate-less tenant');

SELECT * FROM finish();
ROLLBACK;
