-- pgTAP: partial-payment via debit_balance (20260822000100).
--
-- Pins the NEW paths the void/credit tests don't cover:
--   • apply_credit_to_invoice folds a pure debit onto an invoice (net = cash + debit)
--   • it NETS credit against debit when both are present (50 credit + 30 debit on a
--     20 cash invoice → net 0, both cleared) — the plan's headline case
--   • idempotency: a second apply on a folded invoice does not re-fold / drive
--     debit_balance negative
--   • re-correcting a voided-and-debited note is REFUSED (CN002)
--   • debit_balance can never go negative (CHECK)
--
-- RED PROOF (§7.25): balance_adjustment / debit_balance / debited_at and the fold
-- do not exist before this migration; every fold/net/idempotency/CN002 assertion is
-- red against the prior body. Rolled back. apply_credit_to_invoice is SECURITY
-- INVOKER granted to service_role, so its calls run under SET LOCAL ROLE service_role.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(17);

-- ── Tenant / users / class / student / parent ────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('99999999-0000-0000-0000-0000000000a7', 'tap-pp', 'TAP PP', 'SWIM-PP01');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','af000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','tap-pp-admin@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"PP Admin","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000a7"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','af000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','tap-pp-coach@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"PP Coach","role":"coach","tenant_id":"99999999-0000-0000-0000-0000000000a7"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','af000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','tap-pp-parent@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"PP Parent","role":"parent"}',
   now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT '99999999-0000-0000-0000-0000000000a7', 'Default Group'
 WHERE NOT EXISTS (SELECT 1 FROM class_categories c
                    WHERE c.tenant_id='99999999-0000-0000-0000-0000000000a7' AND lower(trim(c.name))='default group');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'bf000000-0000-0000-0000-000000000001', co.id, 'PP Class', 'saturday', '10:00','11:00','Pool', 30.00,
       (SELECT cc.id FROM class_categories cc WHERE cc.tenant_id=co.tenant_id AND lower(trim(cc.name))='default group')
FROM coaches co WHERE co.profile_id='af000000-0000-0000-0000-0000000000c1';

INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id)
VALUES ('cf000000-0000-0000-0000-000000000001', 'PP Kid', 'assigned', TRUE, '99999999-0000-0000-0000-0000000000a7');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'cf000000-0000-0000-0000-000000000001' FROM parents p WHERE p.profile_id='af000000-0000-0000-0000-0000000000b1';

INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('cf000000-0000-0000-0000-000000000001','bf000000-0000-0000-0000-000000000001', TRUE);

INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance, debit_balance)
SELECT p.id, '99999999-0000-0000-0000-0000000000a7', 0, 0
FROM parents p WHERE p.profile_id='af000000-0000-0000-0000-0000000000b1';

-- ── Helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.pid() RETURNS UUID AS $$
  SELECT id FROM parents WHERE profile_id='af000000-0000-0000-0000-0000000000b1' $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.setbals(c NUMERIC, d NUMERIC) RETURNS VOID AS $$
  UPDATE parent_tenant_balances SET credit_balance=c, debit_balance=d
   WHERE parent_id=pg_temp.pid() AND tenant_id='99999999-0000-0000-0000-0000000000a7' $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.cbal() RETURNS NUMERIC AS $$
  SELECT credit_balance FROM parent_tenant_balances WHERE parent_id=pg_temp.pid() AND tenant_id='99999999-0000-0000-0000-0000000000a7' $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.dbal() RETURNS NUMERIC AS $$
  SELECT debit_balance FROM parent_tenant_balances WHERE parent_id=pg_temp.pid() AND tenant_id='99999999-0000-0000-0000-0000000000a7' $$ LANGUAGE sql;

-- A bare outstanding invoice (gross given, no items needed for apply). Distinct
-- billing_month per call — invoices are UNIQUE(parent_id, billing_month).
CREATE OR REPLACE FUNCTION pg_temp.mkinv(p_id UUID, p_gross NUMERIC, p_month TEXT) RETURNS VOID AS $$
  INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, package_applied, credit_applied, net_amount, status)
  VALUES ('99999999-0000-0000-0000-0000000000a7', p_id, pg_temp.pid(), p_month, p_gross, 0, 0, p_gross, 'outstanding') $$ LANGUAGE sql;

-- ══ SCENARIO 1: apply folds a PURE debit (no credit) ═══════════════════════════
SELECT pg_temp.setbals(0.00, 40.00);
SELECT pg_temp.mkinv('ef000000-0000-0000-0000-000000000001', 30.00, '2026-01');
SET LOCAL ROLE service_role;
SELECT is(apply_credit_to_invoice('ef000000-0000-0000-0000-000000000001'), 0.00,
  '1: no credit drawn (credit_balance 0)');
RESET ROLE;
SELECT row_eq(
  $$SELECT balance_adjustment, net_amount, credit_applied, status::text
      FROM invoices WHERE id='ef000000-0000-0000-0000-000000000001'$$,
  ROW(40.00::numeric, 70.00::numeric, 0.00::numeric, 'outstanding'::text),
  '2: the $40 debit is folded — adj 40, net 30+40=70, outstanding');
SELECT is(pg_temp.dbal(), 0.00, '3: debit_balance consumed to 0');

-- ══ SCENARIO 2: apply NETS credit against debit (the headline case) ════════════
-- 50 credit + 30 debit on a 20 cash invoice → net 0, both cleared.
SELECT pg_temp.setbals(50.00, 30.00);
SELECT pg_temp.mkinv('ef000000-0000-0000-0000-000000000002', 20.00, '2026-02');
-- The available note needs provenance rows (all NOT NULL): a lesson + an item.
INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('df000000-0000-0000-0000-0000000000d2','bf000000-0000-0000-0000-000000000001','2026-02-07','completed');
INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
VALUES ('ef000000-0000-0000-0000-000000000002','cf000000-0000-0000-0000-000000000001','df000000-0000-0000-0000-0000000000d2','present', 20.00, 'PP Class', '2026-02-07');
INSERT INTO credit_notes (reference_number, parent_id, student_id, student_name, invoice_id,
  invoice_item_id, lesson_session_id, amount, original_status, corrected_status, status, tenant_id, issued_at)
SELECT 'CN-pp2', pg_temp.pid(), 'cf000000-0000-0000-0000-000000000001', 'PP Kid',
  'ef000000-0000-0000-0000-000000000002', ii.id, 'df000000-0000-0000-0000-0000000000d2',
  50.00, 'present', 'absent', 'available', '99999999-0000-0000-0000-0000000000a7', now()
FROM invoice_items ii WHERE ii.lesson_session_id='df000000-0000-0000-0000-0000000000d2';
SET LOCAL ROLE service_role;
SELECT is(apply_credit_to_invoice('ef000000-0000-0000-0000-000000000002'), 50.00,
  '4: credit draws the full 50 against the debit-inclusive cash base (20+30)');
RESET ROLE;
SELECT row_eq(
  $$SELECT balance_adjustment, credit_applied, net_amount, status::text
      FROM invoices WHERE id='ef000000-0000-0000-0000-000000000002'$$,
  ROW(30.00::numeric, 50.00::numeric, 0.00::numeric, 'paid'::text),
  '5: net 0, paid — 50 credit + 30 debit net out the 20 lessons + 30 carried debit');
SELECT is(pg_temp.cbal(), 0.00, '6: credit_balance consumed');
SELECT is(pg_temp.dbal(), 0.00, '7: debit_balance consumed');
SELECT is((SELECT COALESCE(SUM(amount),0) FROM credit_applications
             WHERE invoice_id='ef000000-0000-0000-0000-000000000002' AND reversed_at IS NULL),
  50.00, '8: a live credit_application of 50 backs the draw');

-- ══ SCENARIO 3: idempotency — a second apply does not re-fold ══════════════════
SELECT pg_temp.setbals(0.00, 25.00);
SELECT pg_temp.mkinv('ef000000-0000-0000-0000-000000000003', 30.00, '2026-03');
SET LOCAL ROLE service_role;
SELECT is(apply_credit_to_invoice('ef000000-0000-0000-0000-000000000003'), 0.00, '9: first apply');
SELECT is(apply_credit_to_invoice('ef000000-0000-0000-0000-000000000003'), 0.00, '10: second apply is a no-op');
RESET ROLE;
SELECT row_eq(
  $$SELECT balance_adjustment, net_amount FROM invoices WHERE id='ef000000-0000-0000-0000-000000000003'$$,
  ROW(25.00::numeric, 55.00::numeric),
  '11: adj still 25, net still 55 after the second call (not re-folded)');
SELECT is(pg_temp.dbal(), 0.00, '12: debit_balance NOT driven negative by the second call');

-- ══ SCENARIO 4: re-correcting a voided-and-debited note is REFUSED (CN002) ══════
-- A present, billed, PAID lesson whose note was voided and recovered as a debit.
INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('df000000-0000-0000-0000-000000000004','bf000000-0000-0000-0000-000000000001','2026-08-01','completed');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('df000000-0000-0000-0000-000000000004','cf000000-0000-0000-0000-000000000001','present','af000000-0000-0000-0000-0000000000c1');
INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status, paid_at, paid_marked_by)
VALUES ('99999999-0000-0000-0000-0000000000a7','ef000000-0000-0000-0000-000000000004', pg_temp.pid(), '2026-08', 30.00, 30.00, 0.00, 'paid', now(), 'af000000-0000-0000-0000-0000000000a1');
INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
VALUES ('ef000000-0000-0000-0000-000000000004','cf000000-0000-0000-0000-000000000001','df000000-0000-0000-0000-000000000004','present', 30.00, 'PP Class', '2026-08-01');
-- The note as a paid-void would leave it: reversed, its draw debited. The draw is
-- also FOLDED (billed on a later invoice) — under 20260822000200 an UNFOLDED debit
-- auto-unwinds on re-correction; only a folded (or written-off) one still refuses.
INSERT INTO credit_notes (reference_number, parent_id, student_id, student_name, invoice_id,
  invoice_item_id, lesson_session_id, amount, original_status, corrected_status, status, tenant_id, reversed_at)
SELECT 'CN-pp4', pg_temp.pid(), 'cf000000-0000-0000-0000-000000000001', 'PP Kid',
  'ef000000-0000-0000-0000-000000000004', ii.id, 'df000000-0000-0000-0000-000000000004',
  30.00, 'present', 'absent', 'reversed', '99999999-0000-0000-0000-0000000000a7', now()
FROM invoice_items ii WHERE ii.invoice_id='ef000000-0000-0000-0000-000000000004';
INSERT INTO credit_applications (credit_note_id, invoice_id, amount, debited_at, debited_by, folded_at, folded_invoice_id)
SELECT cn.id, 'ef000000-0000-0000-0000-000000000004', 30.00, now(), 'af000000-0000-0000-0000-0000000000a1',
       now(), 'ef000000-0000-0000-0000-000000000004'
FROM credit_notes cn WHERE cn.reference_number='CN-pp4';

SELECT throws_ok(
  $$UPDATE attendance SET status='absent', edit_reason='recorrect a debited note'
      WHERE lesson_session_id='df000000-0000-0000-0000-000000000004'$$,
  'CN002', NULL, '13: re-correcting a voided-and-debited note is refused (CN002)');
SELECT is((SELECT status FROM attendance WHERE lesson_session_id='df000000-0000-0000-0000-000000000004'),
  'present', '14: the refusal left attendance unchanged');
SELECT is((SELECT status::text FROM invoices WHERE id='ef000000-0000-0000-0000-000000000004'),
  'paid', '15: and the paid invoice is untouched');

-- ══ SCENARIO 5: debit_balance can never go negative (CHECK) ═════════════════════
SELECT throws_ok(
  $$UPDATE parent_tenant_balances SET debit_balance = -1
      WHERE parent_id=pg_temp.pid() AND tenant_id='99999999-0000-0000-0000-0000000000a7'$$,
  '23514', NULL, '16: debit_balance < 0 is refused by the CHECK');

-- Reconciliation: after everything, no invoice violates the identity for OUTSTANDING
-- invoices (paid invoices are frozen history and may diverge). Every debit folded
-- traces to a debited_at application.
SELECT is(
  (SELECT count(*)::int FROM invoices i
    WHERE i.tenant_id='99999999-0000-0000-0000-0000000000a7'
      AND i.status='outstanding'
      AND i.net_amount <> i.gross_amount - i.package_applied - i.credit_applied + i.balance_adjustment),
  0, '17: every OUTSTANDING invoice satisfies net = gross − package − credit + adjustment');

SELECT * FROM finish();
ROLLBACK;
