-- pgTAP: apply_credit_to_invoice() — the engine-side credit lock (Item 2,
-- 20260818000200). Drives the RPC directly and pins every branch of the drawdown
-- the engine used to do in JS: FIFO order, partial vs full consumption, the
-- balance cap and the cash (p_max) cap, a reversed note is never drawn, the
-- self-heal of a zero-remainder 'available' note, tenant scoping, balance never
-- negative, the return value, and — the new safety property — IDEMPOTENCY.
--
-- RED PROOF (§7.25): the function does not exist before 20260818000200, so the
-- whole file is red pre-migration. The behavioural pins below are what guard the
-- JS→SQL port; the idempotency test (12-14) is red against any body that draws
-- again on a second call.
--
-- Runs in a rolled-back transaction. The RPC is SECURITY INVOKER and granted to
-- service_role only, so the drawdown assertions run under SET LOCAL ROLE
-- service_role (§7.16) — the role the engine actually calls it as.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(29);

-- ── Tenants ──────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('99999999-0000-0000-0000-0000000000f1', 'tap-draw',  'TAP Draw',  'SWIM-DRW1'),
  ('99999999-0000-0000-0000-0000000000f2', 'tap-draw2', 'TAP Draw2', 'SWIM-DRW2');

-- ── Users → profiles/coaches/parents via handle_new_user ─────────────────────
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','tap-draw-coach@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Draw Coach","role":"coach","tenant_id":"99999999-0000-0000-0000-0000000000f1"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','tap-draw-p1@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Draw P1","role":"parent"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-0000000000b2',
   'authenticated','authenticated','tap-draw-p2@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Draw P2","role":"parent"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a2000000-0000-0000-0000-0000000000b3',
   'authenticated','authenticated','tap-draw-p3@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Draw P3","role":"parent"}',
   now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM class_categories c
    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'b2000000-0000-0000-0000-000000000001', co.id, 'Draw Class', 'saturday',
       '10:00','11:00','Pool', 30.00,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = co.tenant_id AND lower(trim(cc.name)) = 'default group')
FROM coaches co WHERE co.profile_id = 'a2000000-0000-0000-0000-0000000000c1';

INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id) VALUES
  ('c2000000-0000-0000-0000-000000000001', 'Draw Kid 1', 'assigned', TRUE, '99999999-0000-0000-0000-0000000000f1'),
  ('c2000000-0000-0000-0000-000000000002', 'Draw Kid 2', 'assigned', TRUE, '99999999-0000-0000-0000-0000000000f1'),
  ('c2000000-0000-0000-0000-000000000003', 'Draw Kid 3', 'assigned', TRUE, '99999999-0000-0000-0000-0000000000f1');

-- Six source sessions + one source invoice with six items, to hang notes on.
INSERT INTO lesson_sessions (id, class_id, session_date, status)
SELECT ('d2000000-0000-0000-0000-00000000000' || g)::uuid,
       'b2000000-0000-0000-0000-000000000001',
       ('2026-01-0' || g)::date, 'completed'
FROM generate_series(1,6) g;

INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT '99999999-0000-0000-0000-0000000000f1', 'e2000000-0000-0000-0000-0000000000f0',
       p.id, '2026-01', 180.00, 0.00, 180.00, 'outstanding'
FROM parents p WHERE p.profile_id = 'a2000000-0000-0000-0000-0000000000b1';

INSERT INTO invoice_items (id, invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
SELECT ('f2000000-0000-0000-0000-00000000000' || g)::uuid,
       'e2000000-0000-0000-0000-0000000000f0',
       'c2000000-0000-0000-0000-000000000001',
       ('d2000000-0000-0000-0000-00000000000' || g)::uuid,
       'present', 30.00, 'Draw Class', ('2026-01-0' || g)::date
FROM generate_series(1,6) g;

-- ── Notes. reference_number unique; issued_at fixes FIFO order. ───────────────
-- CN1 $20 (older), CN2 $30 (newer): P1/T1.  CN_T2 $50: P1/T2 (scoping).
-- CN3 $40: P2/T1 (partial).  CN4 $20 reversed + CN5 $10 self-heal: P3/T1.
INSERT INTO credit_notes (id, reference_number, tenant_id, parent_id, student_id, invoice_id,
  invoice_item_id, lesson_session_id, amount, original_status, corrected_status,
  issued_at, status)
SELECT v.id, v.ref, v.tenant::uuid,
       (SELECT p.id FROM parents p WHERE p.profile_id = v.prof::uuid),
       v.student::uuid, 'e2000000-0000-0000-0000-0000000000f0', v.item::uuid, v.sess::uuid,
       v.amount, 'present', 'absent', v.issued, v.status
FROM (VALUES
  ('11110000-0000-0000-0000-000000000001'::uuid,'CN-DRW-0001','99999999-0000-0000-0000-0000000000f1','a2000000-0000-0000-0000-0000000000b1',
     'c2000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001',
     20.00,'2026-01-10 00:00+00'::timestamptz,'available'),
  ('11110000-0000-0000-0000-000000000002'::uuid,'CN-DRW-0002','99999999-0000-0000-0000-0000000000f1','a2000000-0000-0000-0000-0000000000b1',
     'c2000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000002','d2000000-0000-0000-0000-000000000002',
     30.00,'2026-01-11 00:00+00'::timestamptz,'available'),
  ('11110000-0000-0000-0000-000000000063'::uuid,'CN-DRW-00T2','99999999-0000-0000-0000-0000000000f2','a2000000-0000-0000-0000-0000000000b1',
     'c2000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000003','d2000000-0000-0000-0000-000000000003',
     50.00,'2026-01-12 00:00+00'::timestamptz,'available'),
  ('11110000-0000-0000-0000-000000000003'::uuid,'CN-DRW-0003','99999999-0000-0000-0000-0000000000f1','a2000000-0000-0000-0000-0000000000b2',
     'c2000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000004','d2000000-0000-0000-0000-000000000004',
     40.00,'2026-01-13 00:00+00'::timestamptz,'available'),
  ('11110000-0000-0000-0000-000000000004'::uuid,'CN-DRW-0004','99999999-0000-0000-0000-0000000000f1','a2000000-0000-0000-0000-0000000000b3',
     'c2000000-0000-0000-0000-000000000003','f2000000-0000-0000-0000-000000000005','d2000000-0000-0000-0000-000000000005',
     20.00,'2026-01-14 00:00+00'::timestamptz,'reversed'),
  ('11110000-0000-0000-0000-000000000005'::uuid,'CN-DRW-0005','99999999-0000-0000-0000-0000000000f1','a2000000-0000-0000-0000-0000000000b3',
     'c2000000-0000-0000-0000-000000000003','f2000000-0000-0000-0000-000000000006','d2000000-0000-0000-0000-000000000006',
     10.00,'2026-01-15 00:00+00'::timestamptz,'available')
) AS v(id, ref, tenant, prof, student, item, sess, amount, issued, status);

-- CN5 already fully spent ($10 used) though still 'available' → self-heal target.
INSERT INTO credit_applications (credit_note_id, invoice_id, amount)
  VALUES ('11110000-0000-0000-0000-000000000005','e2000000-0000-0000-0000-0000000000f0', 10.00);

-- ── Balances (set directly — the drawdown reads them under lock) ──────────────
INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
SELECT p.id, '99999999-0000-0000-0000-0000000000f1', v.bal
FROM (VALUES
  ('a2000000-0000-0000-0000-0000000000b1', 50.00),
  ('a2000000-0000-0000-0000-0000000000b2', 40.00),
  ('a2000000-0000-0000-0000-0000000000b3', 30.00)
) AS v(prof, bal)
JOIN parents p ON p.profile_id = v.prof::uuid;
INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
SELECT p.id, '99999999-0000-0000-0000-0000000000f2', 50.00
FROM parents p WHERE p.profile_id = 'a2000000-0000-0000-0000-0000000000b1';

-- ── Target invoices to draw against ──────────────────────────────────────────
-- INV_A: P1, gross 100 (cash 100) → cap = min(100, bal 50) = 50, both notes drawn.
-- INV_B: P2, gross 25  (cash 25)  → cap = min(25,  bal 40) = 25, partial of CN3.
-- INV_C: P3, gross 50  (cash 50)  → CN4 reversed skipped, CN5 self-healed → 0 drawn.
INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, package_applied, credit_applied, net_amount, status)
SELECT '99999999-0000-0000-0000-0000000000f1', v.id,
       (SELECT p.id FROM parents p WHERE p.profile_id = v.prof::uuid),
       '2026-02', v.gross, 0.00, 0.00, v.gross, 'outstanding'
FROM (VALUES
  ('e2000000-0000-0000-0000-00000000000a'::uuid,'a2000000-0000-0000-0000-0000000000b1',100.00),
  ('e2000000-0000-0000-0000-00000000000b'::uuid,'a2000000-0000-0000-0000-0000000000b2', 25.00),
  ('e2000000-0000-0000-0000-00000000000c'::uuid,'a2000000-0000-0000-0000-0000000000b3', 50.00)
) AS v(id, prof, gross);

-- Helpers.
CREATE OR REPLACE FUNCTION pg_temp.bal(p_prof TEXT, p_tenant UUID) RETURNS NUMERIC AS $$
  SELECT COALESCE(b.credit_balance, 0) FROM parent_tenant_balances b
    JOIN parents p ON p.id = b.parent_id
   WHERE p.profile_id = p_prof::uuid AND b.tenant_id = p_tenant;
$$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.applied(p_inv UUID) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(amount), 0) FROM credit_applications WHERE invoice_id = p_inv;
$$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.napps(p_inv UUID) RETURNS INT AS $$
  SELECT count(*)::int FROM credit_applications WHERE invoice_id = p_inv;
$$ LANGUAGE sql;

-- The drawdown runs under service_role (below); let it read the helpers too.
GRANT EXECUTE ON FUNCTION pg_temp.bal(TEXT, UUID)  TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.applied(UUID)    TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.napps(UUID)      TO service_role;

SET LOCAL ROLE service_role;

-- ══ Scenario A — FIFO, full consumption, balance cap, return value ═══════════
SELECT is(apply_credit_to_invoice('e2000000-0000-0000-0000-00000000000a'), 50.00,
  '1: returns the actual allocation (cap = min(cash 100, balance 50))');
SELECT is((SELECT status FROM credit_notes WHERE id='11110000-0000-0000-0000-000000000001'),
  'applied', '2: CN1 ($20, oldest) fully consumed → applied');
SELECT is((SELECT status FROM credit_notes WHERE id='11110000-0000-0000-0000-000000000002'),
  'applied', '3: CN2 ($30) fully consumed → applied');
SELECT is((SELECT applied_to_invoice_id FROM credit_notes WHERE id='11110000-0000-0000-0000-000000000002'),
  'e2000000-0000-0000-0000-00000000000a'::uuid, '4: full draw stamps applied_to_invoice_id');
SELECT is(pg_temp.applied('e2000000-0000-0000-0000-00000000000a'), 50.00,
  '5: two applications summing to the allocation');
SELECT is(pg_temp.napps('e2000000-0000-0000-0000-00000000000a'), 2, '6: exactly two rows');
SELECT is((SELECT credit_applied FROM invoices WHERE id='e2000000-0000-0000-0000-00000000000a'), 50.00,
  '7: invoice credit_applied trued up in the same transaction');
SELECT is((SELECT net_amount FROM invoices WHERE id='e2000000-0000-0000-0000-00000000000a'), 50.00,
  '8: invoice net = gross − credit');
SELECT is((SELECT status FROM invoices WHERE id='e2000000-0000-0000-0000-00000000000a'), 'outstanding',
  '9: still outstanding (net > 0)');
SELECT is(pg_temp.bal('a2000000-0000-0000-0000-0000000000b1','99999999-0000-0000-0000-0000000000f1'), 0.00,
  '10: balance decremented by the allocation');
SELECT ok(pg_temp.bal('a2000000-0000-0000-0000-0000000000b1','99999999-0000-0000-0000-0000000000f1') >= 0,
  '11: balance never negative');

-- ══ Tenant scoping — T2 note and balance untouched by the T1 draw ════════════
SELECT is((SELECT status FROM credit_notes WHERE id='11110000-0000-0000-0000-000000000063'),
  'available', '12: the sibling-tenant note is never drawn');
SELECT is(pg_temp.bal('a2000000-0000-0000-0000-0000000000b1','99999999-0000-0000-0000-0000000000f2'), 50.00,
  '13: the sibling-tenant balance is unchanged');

-- ══ Scenario B — partial draw (note stays available) + cash cap ══════════════
SELECT is(apply_credit_to_invoice('e2000000-0000-0000-0000-00000000000b'), 25.00,
  '14: allocation capped by cash (25), not balance (40)');
SELECT is((SELECT status FROM credit_notes WHERE id='11110000-0000-0000-0000-000000000003'),
  'available', '15: a partially drawn note stays available');
SELECT is((SELECT applied_to_invoice_id FROM credit_notes WHERE id='11110000-0000-0000-0000-000000000003'),
  NULL, '16: a partial draw does not stamp applied_to_invoice_id');
SELECT is(pg_temp.applied('e2000000-0000-0000-0000-00000000000b'), 25.00, '17: one $25 application');
SELECT is(pg_temp.bal('a2000000-0000-0000-0000-0000000000b2','99999999-0000-0000-0000-0000000000f1'), 15.00,
  '18: balance decremented by 25');
SELECT is((SELECT net_amount FROM invoices WHERE id='e2000000-0000-0000-0000-00000000000b'), 0.00,
  '19: invoice fully covered → net 0');
SELECT is((SELECT status FROM invoices WHERE id='e2000000-0000-0000-0000-00000000000b'), 'paid',
  '20: net 0 → paid');

-- ══ IDEMPOTENCY — a second call on the SAME invoice must draw NOTHING ═════════
-- Tested on INV_B, whose note CN3 is still 'available' with $15 unspent: a
-- non-idempotent body would draw that $15 again (a real double-draw). RED
-- against any body missing the p_invoice_id guard (assertions 21, 22, 24).
SELECT is(apply_credit_to_invoice('e2000000-0000-0000-0000-00000000000b'), 25.00,
  '21: a second call returns the already-allocated sum, drawing nothing more');
SELECT is(pg_temp.napps('e2000000-0000-0000-0000-00000000000b'), 1,
  '22: no second application row (the note is not touched again)');
SELECT is((SELECT status FROM credit_notes WHERE id='11110000-0000-0000-0000-000000000003'),
  'available', '23: the partially-drawn note is unchanged by the retry');
SELECT is(pg_temp.bal('a2000000-0000-0000-0000-0000000000b2','99999999-0000-0000-0000-0000000000f1'), 15.00,
  '24: the balance moved exactly once');

-- ══ Scenario C — reversed note skipped, self-heal of a spent 'available' ═════
SELECT is(apply_credit_to_invoice('e2000000-0000-0000-0000-00000000000c'), 0.00,
  '25: nothing drawable → returns 0');
SELECT is((SELECT status FROM credit_notes WHERE id='11110000-0000-0000-0000-000000000004'),
  'reversed', '26: the reversed note is left untouched');
SELECT is((SELECT status FROM credit_notes WHERE id='11110000-0000-0000-0000-000000000005'),
  'applied', '27: the fully-spent available note is self-healed to applied');
SELECT is(pg_temp.napps('e2000000-0000-0000-0000-00000000000c'), 0,
  '28: no application written when nothing is drawn');

RESET ROLE;

-- ══ Grants — engine-only surface ═════════════════════════════════════════════
SELECT ok(
  has_function_privilege('service_role', 'public.apply_credit_to_invoice(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon',          'public.apply_credit_to_invoice(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.apply_credit_to_invoice(uuid)', 'EXECUTE'),
  '29: EXECUTE granted to service_role only (not anon, not authenticated)');

SELECT * FROM finish();
ROLLBACK;
