-- pgTAP: IN-APP PACKAGE REFUNDS (20260928000200). docs/plans/PACKAGE_REVENUE_REFUNDS_PLAN.md U2.
--
-- WHAT THIS FILE PROTECTS. A refund is money leaving the business, recorded after the fact:
--   (1) only packages:edit (or the platform admin) records or reverses one — a view-only role, another business,
--       a coach, a parent are all refused, and anon holds nothing;
--   (2) only a CANCELLED package that was PAID can be refunded, for at most what the family PAID;
--   (3) its date is today-or-earlier in SGT, never before the package was paid, never in a CLOSED month —
--       so closed Accounting figures never change;
--   (4) one LIVE refund per package, refused readably (P0001), never a raw 23505;
--   (5) Accounting subtracts it in its own month only, ignores a reversed one, and can go negative;
--   (6) every record/reverse leaves an audit row under the package's business (§7.297).
--
-- FIXTURE (prefix 88d…). Tenant A: owner OA, a co-admin VA on a custom role with packages:VIEW +
-- accounting:VIEW only (a real role row — §7.294), coach CA, parent PA. Tenant B: owner OB. Platform admin PX.
-- A has NO rated coach → wages_state 'final', so net is asserted, not NULL (§7.298). Sealed months: mP (two
-- months ago) and mS (last month); this month is OPEN. "Today" is computed here independently of today_sg().
--   K1  payable 200, paid mP-05, CANCELLED        — amount / date / one-live / reverse / re-record
--   K2  payable 100, paid TODAY 07:30 SGT, CANCELLED — the pre-confirmation boundary (D allowed, D−1 refused)
--   K3  pending · K4 declined (pending→cancelled) · K5 active                    — refused
--   KS  payable 100, paid mS-10, active                                          — mS package revenue
--   KR  payable 200, paid mP-05, CANCELLED, refund 150 on mS-20 (live) + 999 on mS-20 (REVERSED), both superuser
--   KB  tenant B, payable 300, paid mP-05, CANCELLED
--   mS: packages 100 − refunds 150 → revenue −50, net −50.   mP: packages K1 200 + K5 100 + KR 200 = 500, refunds 0.
--
-- RED-FIRST PROOF (§7.25, §7.299 — each guard mutated out of the NEW body, one at a time, 2026-09-27):
--   record: gate removed → 7-8, 10-11 · status check → 13-15 · cap → 18 · decimals → 17 · future → 19 ·
--           closed month → 20 · pre-confirmation → 21-22 · one-live check → 25 (raw 23505) ·
--           confirmed_at::date without the SGT zone → 21-22
--   reverse: closed-month check → 29 · gate → 30
--   accounting_summary: reversed refunds counted → 32-33

BEGIN;
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(40);
SELECT is(app_today(), '2026-09-15'::date, 'clock pinned');

-- Wave 7: literals = the former derivation evaluated at the pinned clock (2026-09-15 10:00+08).
CREATE TEMP TABLE f AS
SELECT
  '2026-09-15'::date AS today,
  '2026-09-01'::date AS this1,
  '2026-08'::text    AS ms,
  '2026-07'::text    AS mp,
  '2026-08-01'::date AS ms1,
  '2026-07-01'::date AS mp1;
GRANT SELECT ON f TO PUBLIC;

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('88d00000-0000-0000-0000-0000000000a0','pkrefund-a','PkgRefund A','SWIM-PRFA'),
  ('88d00000-0000-0000-0000-0000000000b0','pkrefund-b','PkgRefund B','SWIM-PRFB');

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;

-- The owners first: the first tenant_admin of a business claims it.
SELECT pg_temp.mkuser('88d10000-0000-0000-0000-0000000000a1','pkrf-owner-a@test.local',
  '{"full_name":"PkRf Owner A","role":"tenant_admin","tenant_id":"88d00000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('88d10000-0000-0000-0000-0000000000b1','pkrf-owner-b@test.local',
  '{"full_name":"PkRf Owner B","role":"tenant_admin","tenant_id":"88d00000-0000-0000-0000-0000000000b0"}');

-- A custom VIEW-only role (packages + accounting at view, every other area none).
INSERT INTO tenant_roles (id, tenant_id, name)
VALUES ('88d20000-0000-0000-0000-000000000001','88d00000-0000-0000-0000-0000000000a0','Refund Viewer');
INSERT INTO tenant_role_permissions (role_id, area, level)
SELECT '88d20000-0000-0000-0000-000000000001', a,
       CASE WHEN a IN ('packages','accounting') THEN 'view'::admin_level ELSE 'none'::admin_level END
  FROM unnest(enum_range(NULL::admin_area)) a;

SELECT pg_temp.mkuser('88d10000-0000-0000-0000-0000000000a2','pkrf-viewer-a@test.local',
  '{"full_name":"PkRf Viewer A","role":"tenant_admin","tenant_id":"88d00000-0000-0000-0000-0000000000a0","admin_role_id":"88d20000-0000-0000-0000-000000000001"}');
SELECT pg_temp.mkuser('88d10000-0000-0000-0000-0000000000c1','pkrf-coach-a@test.local',
  '{"full_name":"PkRf Coach A","role":"coach","tenant_id":"88d00000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('88d10000-0000-0000-0000-00000000009f','pkrf-parent@test.local',
  '{"full_name":"PkRf Parent","role":"parent"}');
SELECT pg_temp.mkuser('88d10000-0000-0000-0000-0000000000d1','pkrf-platform@test.local',
  '{"full_name":"PkRf Platform","role":"platform_admin"}');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, t FROM parents p,
  (VALUES ('88d00000-0000-0000-0000-0000000000a0'::uuid), ('88d00000-0000-0000-0000-0000000000b0'::uuid)) v(t)
 WHERE p.profile_id = '88d10000-0000-0000-0000-00000000009f';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('88d30000-0000-0000-0000-0000000000a0','88d00000-0000-0000-0000-0000000000a0','Group'),
  ('88d30000-0000-0000-0000-0000000000b0','88d00000-0000-0000-0000-0000000000b0','Group');
INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count, rate_per_lesson, validity_months) VALUES
  ('88d40000-0000-0000-0000-000000000200','88d00000-0000-0000-0000-0000000000a0','Ten @20','88d30000-0000-0000-0000-0000000000a0',10,20.00,12),
  ('88d40000-0000-0000-0000-000000000100','88d00000-0000-0000-0000-0000000000a0','Five @20','88d30000-0000-0000-0000-0000000000a0', 5,20.00,12),
  ('88d40000-0000-0000-0000-000000000300','88d00000-0000-0000-0000-0000000000b0','B ten','88d30000-0000-0000-0000-0000000000b0',10,30.00,12);

-- Superuser: confirmed_at honoured as written (§7.300). Ids: K1..K5 = …01..05, KS = …0a, KR = …0b, KB = …0c.
INSERT INTO parent_packages (id, parent_id, product_id, status, confirmed_at)
SELECT v.id, (SELECT id FROM parents WHERE profile_id = '88d10000-0000-0000-0000-00000000009f'), v.prod, v.st, v.conf
FROM f, LATERAL (VALUES
  ('88d50000-0000-0000-0000-000000000001'::uuid,'88d40000-0000-0000-0000-000000000200'::uuid,'active',
     ((f.mP1 + 4) + TIME '12:00') AT TIME ZONE 'Asia/Singapore'),
  ('88d50000-0000-0000-0000-000000000002','88d40000-0000-0000-0000-000000000100','active',
     (f.today + TIME '07:30') AT TIME ZONE 'Asia/Singapore'),
  ('88d50000-0000-0000-0000-000000000003','88d40000-0000-0000-0000-000000000100','pending', NULL::timestamptz),
  ('88d50000-0000-0000-0000-000000000004','88d40000-0000-0000-0000-000000000100','pending', NULL),
  ('88d50000-0000-0000-0000-000000000005','88d40000-0000-0000-0000-000000000100','active',
     ((f.mP1 + 4) + TIME '12:00') AT TIME ZONE 'Asia/Singapore'),
  ('88d50000-0000-0000-0000-00000000000a','88d40000-0000-0000-0000-000000000100','active',
     ((f.mS1 + 9) + TIME '12:00') AT TIME ZONE 'Asia/Singapore'),
  ('88d50000-0000-0000-0000-00000000000b','88d40000-0000-0000-0000-000000000200','active',
     ((f.mP1 + 4) + TIME '12:00') AT TIME ZONE 'Asia/Singapore'),
  ('88d50000-0000-0000-0000-00000000000c','88d40000-0000-0000-0000-000000000300','active',
     ((f.mP1 + 4) + TIME '12:00') AT TIME ZONE 'Asia/Singapore')
) AS v(id, prod, st, conf);

UPDATE parent_packages SET status = 'cancelled'
 WHERE id IN ('88d50000-0000-0000-0000-000000000001','88d50000-0000-0000-0000-000000000002',
              '88d50000-0000-0000-0000-000000000004','88d50000-0000-0000-0000-00000000000b',
              '88d50000-0000-0000-0000-00000000000c');

-- KR's refunds, written directly (superuser) INTO the sealed month mS: one live 150, one reversed 999.
INSERT INTO package_refunds (id, tenant_id, parent_package_id, amount, refunded_on, recorded_by, reversed_at, reversed_by)
SELECT v.id, '88d00000-0000-0000-0000-0000000000a0', '88d50000-0000-0000-0000-00000000000b', v.amt, f.mS1 + 19,
       '88d10000-0000-0000-0000-0000000000a1', v.rev, v.revby
FROM f, LATERAL (VALUES
  ('88d60000-0000-0000-0000-000000000001'::uuid, 150.00, NULL::timestamptz, NULL::uuid),
  ('88d60000-0000-0000-0000-000000000002'::uuid, 999.00, app_now(), '88d10000-0000-0000-0000-0000000000a1'::uuid)
) AS v(id, amt, rev, revby);

INSERT INTO billing_periods (billing_month, tenant_id, invoices_issued)
SELECT m, '88d00000-0000-0000-0000-0000000000a0', 1 FROM f, LATERAL (VALUES (f.mP), (f.mS)) s(m);

CREATE OR REPLACE FUNCTION pg_temp.as_user(p UUID) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$ LANGUAGE sql;

-- ════════════════════════════════════════════════════════════════════════════
-- 1–4. Grants (§7.87): SELECT only on the table; EXECUTE on the RPCs for authenticated; anon nothing.
SELECT ok(has_table_privilege('authenticated','public.package_refunds','SELECT')
          AND NOT has_table_privilege('authenticated','public.package_refunds','INSERT')
          AND NOT has_table_privilege('authenticated','public.package_refunds','UPDATE')
          AND NOT has_table_privilege('authenticated','public.package_refunds','DELETE'),
  'authenticated holds SELECT only on package_refunds — writes go through the RPCs');
SELECT ok(NOT has_table_privilege('anon','public.package_refunds','SELECT'), 'anon cannot read package_refunds');
SELECT ok(has_function_privilege('authenticated','public.record_package_refund(uuid,numeric,date,text)','EXECUTE')
          AND has_function_privilege('authenticated','public.reverse_package_refund(uuid)','EXECUTE'),
  'authenticated holds EXECUTE on both refund RPCs');
SELECT ok(NOT has_function_privilege('anon','public.record_package_refund(uuid,numeric,date,text)','EXECUTE')
          AND NOT has_function_privilege('anon','public.reverse_package_refund(uuid)','EXECUTE'),
  'anon holds EXECUTE on neither refund RPC');

-- 5. RLS on, CASCADE FKs pinned (fixture resets delete parent_packages / tenants — §7.281, §7.258).
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.package_refunds'::regclass)
          AND (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.package_refunds'::regclass
                 AND contype = 'f' AND confdeltype = 'c'
                 AND confrelid IN ('public.tenants'::regclass, 'public.parent_packages'::regclass)) = 2,
  'RLS is enabled, and the tenant + package FKs cascade on delete');

-- ── 6–9. Who may act ─────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"88d10000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM package_refunds), 2, 'a packages:VIEW co-admin can READ the business''s refunds');
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000001', 10, (SELECT this1 FROM f)) $$,
  'P0001', 'Your role cannot record refunds for this business.', 'a packages:VIEW co-admin cannot record a refund');
SET LOCAL "request.jwt.claims" TO '{"sub":"88d10000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000001', 10, (SELECT this1 FROM f)) $$,
  'P0001', 'Your role cannot record refunds for this business.', 'another business''s owner cannot refund A''s package');
SELECT is((SELECT count(*)::int FROM package_refunds), 0, 'another business''s owner reads none of A''s refunds');
SET LOCAL "request.jwt.claims" TO '{"sub":"88d10000-0000-0000-0000-0000000000c1","role":"authenticated"}';
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000001', 10, (SELECT this1 FROM f)) $$,
  'P0001', 'Your role cannot record refunds for this business.', 'a coach cannot record a refund');
SET LOCAL "request.jwt.claims" TO '{"sub":"88d10000-0000-0000-0000-00000000009f","role":"authenticated"}';
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000001', 10, (SELECT this1 FROM f)) $$,
  'P0001', 'Your role cannot record refunds for this business.', 'a parent cannot record a refund');
SELECT is((SELECT count(*)::int FROM package_refunds), 0, 'a parent reads no refunds');

-- ── 13–15. Which packages ────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"88d10000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000003', 10, (SELECT this1 FROM f)) $$,
  'P0001', 'Only a cancelled package that was paid for can be refunded.', 'a PENDING request cannot be refunded');
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000004', 10, (SELECT this1 FROM f)) $$,
  'P0001', 'Only a cancelled package that was paid for can be refunded.', 'a DECLINED request (never paid) cannot be refunded');
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000005', 10, (SELECT this1 FROM f)) $$,
  'P0001', 'Only a cancelled package that was paid for can be refunded.', 'an ACTIVE package cannot be refunded');

-- ── 16–18. How much (K1 paid 200) ────────────────────────────────────────────
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000001', 0, (SELECT this1 FROM f)) $$,
  'P0001', 'Enter a refund amount above S$0.', 'a S$0 refund is refused');
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000001', 10.005, (SELECT this1 FROM f)) $$,
  'P0001', 'A refund amount can have at most two decimal places.', 'a refund with three decimals is refused');
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000001', 200.01, (SELECT this1 FROM f)) $$,
  'P0001', 'A refund cannot be more than the family paid (S$200.00).', 'a refund above what was paid is refused (the SQL is the cap)');

-- ── 19–22. When (SGT boundaries, computed independently of today_sg()) ──────
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000001', 10, (SELECT today + 1 FROM f)) $$,
  'P0001', 'A refund cannot be dated in the future.', 'tomorrow (SGT) is refused');
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000001', 10, (SELECT this1 - 1 FROM f)) $$,
  'P0001', 'That month is closed — refunds can only be dated in an open month.',
  'the LAST day of the sealed month is refused — closed figures never change');
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000002', 10, (SELECT today - 1 FROM f)) $$,
  'P0001', 'A refund cannot be dated before the package was paid (15 Sept 2026).',
  'K2 paid today 07:30 SGT (yesterday in UTC): a refund dated yesterday is refused');
SELECT lives_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000002', 10, (SELECT today FROM f)) $$,
  'K2: a refund dated today (its SGT paid date) is allowed');

-- ── 23–27. One live refund; reverse; re-record ──────────────────────────────
SELECT lives_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000001', 200, (SELECT this1 FROM f), '  moved away  ') $$,
  'K1: a refund of exactly what was paid, dated the 1st of the open month, is allowed');
SELECT is((SELECT (amount, refunded_on, note, recorded_by) FROM package_refunds
            WHERE parent_package_id = '88d50000-0000-0000-0000-000000000001' AND reversed_at IS NULL),
  (200.00::numeric(10,2), (SELECT this1 FROM f), 'moved away'::text, '88d10000-0000-0000-0000-0000000000a1'::uuid),
  'the row holds the amount, date, trimmed note and the recorder');
SELECT throws_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000001', 5, (SELECT this1 FROM f)) $$,
  'P0001', 'This package already has a refund recorded. Reverse it first to record a different one.',
  'a second live refund is refused readably (P0001, not the index''s 23505)');
SELECT lives_ok($$ SELECT reverse_package_refund((SELECT id FROM package_refunds
    WHERE parent_package_id = '88d50000-0000-0000-0000-000000000001' AND reversed_at IS NULL)) $$,
  'the owner reverses it (its month is open)');
SELECT lives_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-000000000001', 50, (SELECT this1 FROM f)) $$,
  'after the reversal, a corrected refund can be recorded');

-- ── 28–29. Reversal guards ───────────────────────────────────────────────────
SELECT throws_ok($$ SELECT reverse_package_refund('88d60000-0000-0000-0000-000000000002') $$,
  'P0001', 'This refund has already been reversed.', 'a reversed refund cannot be reversed again');
SELECT throws_ok($$ SELECT reverse_package_refund('88d60000-0000-0000-0000-000000000001') $$,
  'P0001', 'That refund''s month is closed — it can no longer be reversed.', 'a refund in a CLOSED month cannot be reversed');

-- 30. The view-only co-admin cannot reverse either.
SET LOCAL "request.jwt.claims" TO '{"sub":"88d10000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok($$ SELECT reverse_package_refund((SELECT id FROM package_refunds
    WHERE parent_package_id = '88d50000-0000-0000-0000-000000000001' AND reversed_at IS NULL)) $$,
  'P0001', 'Your role cannot reverse refunds for this business.', 'a packages:VIEW co-admin cannot reverse a refund');

-- 31. The platform admin may record (support).
SET LOCAL "request.jwt.claims" TO '{"sub":"88d10000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT lives_ok($$ SELECT record_package_refund('88d50000-0000-0000-0000-00000000000c', 30, (SELECT this1 FROM f)) $$,
  'the platform admin can record a refund on any business');

-- ── 32–36. Accounting ───────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"88d10000-0000-0000-0000-0000000000a1","role":"authenticated"}';
CREATE TEMP TABLE sS ON COMMIT DROP AS SELECT * FROM accounting_summary('88d00000-0000-0000-0000-0000000000a0', (SELECT mS FROM f));
CREATE TEMP TABLE sP ON COMMIT DROP AS SELECT * FROM accounting_summary('88d00000-0000-0000-0000-0000000000a0', (SELECT mP FROM f));
SELECT is((SELECT revenue_package_refunds FROM sS), 150.00::numeric,
  'mS refunds = the live 150; the reversed 999 is ignored');
SELECT is((SELECT (revenue, wages_state, net) FROM sS), (-50.00::numeric, 'final'::text, -50.00::numeric),
  'mS: packages 100 − refunds 150 → revenue and net −50 on a wages-final month (it can go negative)');
SELECT is((SELECT revenue FROM sS), (SELECT revenue_invoiced + revenue_settlements + revenue_packages - revenue_package_refunds FROM sS),
  'revenue = invoiced + settlements + packages − refunds');
SELECT is((SELECT (revenue_packages, revenue_package_refunds, revenue) FROM sP), (500.00::numeric, 0.00::numeric, 500.00::numeric),
  'mP: KR''s refund lands in its own month only — mP keeps K1 200 + K5 100 + KR 200 = 500');
RESET ROLE;

-- ── 36–38. Audit (§7.297) ────────────────────────────────────────────────────
SELECT is((SELECT count(*)::int FROM audit_log WHERE entity_type = 'parent_package'
            AND entity_id = '88d50000-0000-0000-0000-000000000001'), 3,
  'K1: record + reverse + re-record = 3 audit rows');
SELECT ok((SELECT bool_and(tenant_id = '88d00000-0000-0000-0000-0000000000a0') FROM audit_log
            WHERE entity_type = 'parent_package' AND entity_id = '88d50000-0000-0000-0000-000000000001'),
  'every K1 audit row names business A');
SELECT is((SELECT array_agg(action ORDER BY created_at, action) FROM audit_log
            WHERE entity_type = 'parent_package' AND entity_id = '88d50000-0000-0000-0000-000000000001'),
  ARRAY['package_refund','package_refund','package_refund_reversed'],
  'the audit actions are two refunds and one reversal');

-- 39. Exactly one accounting_summary, EXECUTE for authenticated only.
SELECT ok((SELECT count(*) FROM pg_proc WHERE proname = 'accounting_summary') = 1
          AND has_function_privilege('authenticated','public.accounting_summary(uuid,character)','EXECUTE')
          AND NOT has_function_privilege('anon','public.accounting_summary(uuid,character)','EXECUTE')
          AND NOT has_function_privilege('service_role','public.accounting_summary(uuid,character)','EXECUTE'),
  'one accounting_summary after the second DROP/CREATE; EXECUTE for authenticated only');

SELECT * FROM finish();
ROLLBACK;
