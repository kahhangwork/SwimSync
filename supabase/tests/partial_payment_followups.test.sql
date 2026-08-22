-- pgTAP: partial-payment FOLLOW-UPS (20260822000200).
--
-- Pins the NEW paths:
--   (a) auto-unwind of a voided-and-DEBITED note when the debit is still PENDING:
--       • partial draw → note back to 'available', remainder SPENDABLE (RISK 1)
--       • subtracts the DRAWN sum, not the note amount (RISK 2)
--       • full draw → note 'applied' with applied_to_invoice_id restored (RISK 8)
--       • a FOLDED or WRITTEN-OFF debit still refuses (CN002)
--   (b) apply_credit_to_invoice stamps folded_at + reconciles (RISK 5)
--   guard: a family owing a debit cannot be offboarded — on the shared trigger, so
--          set_students_active's consequence rule cannot bypass it (RISK 3); credit
--          does NOT block.
--   ramp: write_off_parent_balance zeroes the debit, stamps written_off_at,
--         reconciles, admin-only.
--
-- RED PROOF (§7.25): folded_at / written_off_at / the auto-unwind branch / the guard
-- trigger / write_off_parent_balance do not exist before this migration. Against the
-- 20260822000100 body every auto-unwind assertion is red (the old body RAISES CN002),
-- the guard assertions are red (no trigger), and write_off is red (no function).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(33);

-- ── Fixture ──────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('99999999-0000-0000-0000-0000000000a7', 'tap-ppf', 'TAP PPF', 'SWIM-PPF1'),
  ('99999999-0000-0000-0000-0000000000a8', 'tap-ppf-b', 'TAP PPF B', 'SWIM-PPF2');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','af000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','tap-ppf-admin@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"PPF Admin","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000a7"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','af000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','tap-ppf-coach@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"PPF Coach","role":"coach","tenant_id":"99999999-0000-0000-0000-0000000000a7"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','af000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','tap-ppf-parent@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"PPF Parent","role":"parent"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','af000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','tap-ppf-adminB@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"PPF Admin B","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000a8"}',
   now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT '99999999-0000-0000-0000-0000000000a7', 'Default Group'
 WHERE NOT EXISTS (SELECT 1 FROM class_categories c
                    WHERE c.tenant_id='99999999-0000-0000-0000-0000000000a7' AND lower(trim(c.name))='default group');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'bf000000-0000-0000-0000-000000000001', co.id, 'PPF Class', 'saturday', '10:00','11:00','Pool', 30.00,
       (SELECT cc.id FROM class_categories cc WHERE cc.tenant_id=co.tenant_id AND lower(trim(cc.name))='default group')
FROM coaches co WHERE co.profile_id='af000000-0000-0000-0000-0000000000c1';

INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id)
VALUES ('cf000000-0000-0000-0000-000000000001', 'PPF Kid', 'assigned', TRUE, '99999999-0000-0000-0000-0000000000a7');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'cf000000-0000-0000-0000-000000000001' FROM parents p WHERE p.profile_id='af000000-0000-0000-0000-0000000000b1';

INSERT INTO parent_tenants (parent_id, tenant_id, is_active)
SELECT p.id, '99999999-0000-0000-0000-0000000000a7', TRUE FROM parents p WHERE p.profile_id='af000000-0000-0000-0000-0000000000b1';

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
CREATE OR REPLACE FUNCTION pg_temp.mkinv(p_id UUID, p_gross NUMERIC, p_month TEXT) RETURNS VOID AS $$
  INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, package_applied, credit_applied, net_amount, status)
  VALUES ('99999999-0000-0000-0000-0000000000a7', p_id, pg_temp.pid(), p_month, p_gross, 0, 0, p_gross, 'outstanding') $$ LANGUAGE sql;

-- Clears any leftover PENDING debited draws for the parent, so each scenario's
-- reconciliation sees only its own (the parent is shared across scenarios).
CREATE OR REPLACE FUNCTION pg_temp.reset_pending_debits() RETURNS VOID AS $$
  UPDATE credit_applications ca SET debited_at=NULL, debited_by=NULL
    FROM credit_notes cn
   WHERE ca.credit_note_id=cn.id AND cn.parent_id=pg_temp.pid()
     AND ca.folded_at IS NULL AND ca.written_off_at IS NULL AND ca.debited_at IS NOT NULL $$ LANGUAGE sql;

-- Builds a voided-and-DEBITED note: lesson (+present attendance), a PAID invoice
-- carrying its item, a reversed credit_note, and a debited-pending application of
-- p_draw. Mirrors the state void_credit_note leaves on a paid draw.
CREATE OR REPLACE FUNCTION pg_temp.mk_debited(
  p_cn_ref TEXT, p_lesson UUID, p_inv UUID, p_month TEXT, p_date DATE,
  p_item_amt NUMERIC, p_draw NUMERIC, p_present BOOLEAN
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_item UUID; v_cn UUID;
BEGIN
  INSERT INTO lesson_sessions (id, class_id, session_date, status)
  VALUES (p_lesson, 'bf000000-0000-0000-0000-000000000001', p_date, 'completed');
  IF p_present THEN
    INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
    VALUES (p_lesson, 'cf000000-0000-0000-0000-000000000001', 'present', 'af000000-0000-0000-0000-0000000000c1');
  END IF;
  INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status, paid_at, paid_marked_by)
  VALUES ('99999999-0000-0000-0000-0000000000a7', p_inv, pg_temp.pid(), p_month, p_item_amt, p_item_amt, 0.00, 'paid', now(), 'af000000-0000-0000-0000-0000000000a1');
  INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
  VALUES (p_inv, 'cf000000-0000-0000-0000-000000000001', p_lesson, 'present', p_item_amt, 'PPF Class', p_date)
  RETURNING id INTO v_item;
  INSERT INTO credit_notes (reference_number, parent_id, student_id, student_name, invoice_id,
    invoice_item_id, lesson_session_id, amount, original_status, corrected_status, status, tenant_id, issued_at, reversed_at)
  VALUES (p_cn_ref, pg_temp.pid(), 'cf000000-0000-0000-0000-000000000001', 'PPF Kid', p_inv,
    v_item, p_lesson, p_item_amt, 'present','absent','reversed','99999999-0000-0000-0000-0000000000a7', now(), now())
  RETURNING id INTO v_cn;
  INSERT INTO credit_applications (credit_note_id, invoice_id, amount, debited_at, debited_by)
  VALUES (v_cn, p_inv, p_draw, now(), 'af000000-0000-0000-0000-0000000000a1');
END $$;

CREATE OR REPLACE FUNCTION pg_temp.recorrect(p_lesson UUID) RETURNS VOID AS $$
  UPDATE attendance SET status='absent', edit_reason='the kid did not attend after all'
   WHERE lesson_session_id=p_lesson $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.cn_status(p_ref TEXT) RETURNS TEXT AS $$
  SELECT status FROM credit_notes WHERE reference_number=p_ref $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.app_folded(p_ref TEXT) RETURNS TIMESTAMPTZ AS $$
  SELECT ca.folded_at FROM credit_applications ca JOIN credit_notes cn ON cn.id=ca.credit_note_id
   WHERE cn.reference_number=p_ref ORDER BY ca.folded_at NULLS LAST LIMIT 1 $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.mark_folded(p_ref TEXT, p_inv UUID) RETURNS VOID AS $$
  UPDATE credit_applications ca SET folded_at=now(), folded_invoice_id=p_inv
    FROM credit_notes cn WHERE cn.id=ca.credit_note_id AND cn.reference_number=p_ref $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.mark_writtenoff(p_ref TEXT) RETURNS VOID AS $$
  UPDATE credit_applications ca SET written_off_at=now(), written_off_by='af000000-0000-0000-0000-0000000000a1'
    FROM credit_notes cn WHERE cn.id=ca.credit_note_id AND cn.reference_number=p_ref $$ LANGUAGE sql;

-- ══ A: partial draw → 'available', remainder SPENDABLE (RISK 1) ═════════════════
SELECT pg_temp.reset_pending_debits();
SELECT pg_temp.setbals(0.00, 12.00);
SELECT pg_temp.mk_debited('CN-fa', 'daf00000-0000-0000-0000-0000000000a1',
  'eaf00000-0000-0000-0000-0000000000a1', '2027-01', '2027-01-10', 20.00, 12.00, TRUE);
SELECT pg_temp.recorrect('daf00000-0000-0000-0000-0000000000a1');
SELECT is(pg_temp.dbal(), 0.00, 'A1: the pending debit is unwound to 0');
SELECT is(pg_temp.cbal(), 8.00, 'A2: the $8 undrawn remainder returns to the pool');
SELECT is(pg_temp.cn_status('CN-fa'), 'available', 'A3: a partially-drawn note goes back to AVAILABLE');
-- the $8 must be SPENDABLE by the FIFO loop (RISK 1: 'applied' would strand it):
SELECT pg_temp.mkinv('eaf00000-0000-0000-0000-0000000000a2', 50.00, '2027-02');
SET LOCAL ROLE service_role;
SELECT is(apply_credit_to_invoice('eaf00000-0000-0000-0000-0000000000a2'), 8.00,
  'A4: the restored note''s $8 remainder draws against a fresh invoice');
RESET ROLE;
SELECT is(pg_temp.cbal(), 0.00, 'A5: credit_balance consumed to 0');

-- ══ B: subtract the DRAWN sum, never the note amount (RISK 2) ═══════════════════
-- Two debited notes (12 + 10 = 22). Unwinding the 12 must leave 10, not 22-20.
SELECT pg_temp.reset_pending_debits();
SELECT pg_temp.setbals(0.00, 22.00);
SELECT pg_temp.mk_debited('CN-fb1', 'daf00000-0000-0000-0000-0000000000b1',
  'eaf00000-0000-0000-0000-0000000000b1', '2027-03', '2027-03-07', 12.00, 12.00, TRUE);
SELECT pg_temp.mk_debited('CN-fb2', 'daf00000-0000-0000-0000-0000000000b2',
  'eaf00000-0000-0000-0000-0000000000b2', '2027-04', '2027-04-04', 10.00, 10.00, TRUE);
SELECT pg_temp.recorrect('daf00000-0000-0000-0000-0000000000b1');
SELECT is(pg_temp.dbal(), 10.00, 'B1: only CN-fb1''s $12 was unwound — $10 remains');
SELECT is(pg_temp.cn_status('CN-fb1'), 'applied', 'B2: the fully-drawn note goes to APPLIED');

-- ══ C: full draw → 'applied' with applied_to_invoice_id restored (RISK 8) ═══════
SELECT pg_temp.reset_pending_debits();
SELECT pg_temp.setbals(0.00, 20.00);
SELECT pg_temp.mk_debited('CN-fc', 'daf00000-0000-0000-0000-0000000000c1',
  'eaf00000-0000-0000-0000-0000000000c1', '2027-05', '2027-05-02', 20.00, 20.00, TRUE);
SELECT pg_temp.recorrect('daf00000-0000-0000-0000-0000000000c1');
SELECT is(pg_temp.dbal(), 0.00, 'C1: debit unwound');
SELECT is(pg_temp.cbal(), 0.00, 'C2: no remainder, so no credit added');
SELECT is(pg_temp.cn_status('CN-fc'), 'applied', 'C3: fully-drawn note is APPLIED');
SELECT is((SELECT applied_to_invoice_id FROM credit_notes WHERE reference_number='CN-fc'),
  'eaf00000-0000-0000-0000-0000000000c1'::uuid, 'C4: applied_to_invoice_id restored (RISK 8)');
SELECT isnt((SELECT applied_at FROM credit_notes WHERE reference_number='CN-fc'), NULL,
  'C5: applied_at restored');

-- ══ D: apply stamps folded_at and reconciles (RISK 5) ══════════════════════════
SELECT pg_temp.reset_pending_debits();
SELECT pg_temp.setbals(0.00, 15.00);
SELECT pg_temp.mk_debited('CN-fd', 'daf00000-0000-0000-0000-0000000000d1',
  'eaf00000-0000-0000-0000-0000000000d1', '2027-06', '2027-06-06', 15.00, 15.00, FALSE);
SELECT pg_temp.mkinv('eaf00000-0000-0000-0000-0000000000d9', 30.00, '2027-07');
SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT apply_credit_to_invoice('eaf00000-0000-0000-0000-0000000000d9')$$,
  'D0: the fold reconciles (stamped 15 = consumed 15)');
RESET ROLE;
SELECT is(pg_temp.dbal(), 0.00, 'D1: debit consumed by the fold');
SELECT isnt(pg_temp.app_folded('CN-fd'), NULL, 'D2: the debited draw is stamped folded_at');
SELECT is((SELECT balance_adjustment FROM invoices WHERE id='eaf00000-0000-0000-0000-0000000000d9'),
  15.00, 'D3: balance_adjustment = the folded debit');

-- ══ D2: a fold whose stamp ≠ the consumed debit RAISES (RISK 5 drift) ══════════
SELECT pg_temp.reset_pending_debits();
SELECT pg_temp.mk_debited('CN-fe', 'daf00000-0000-0000-0000-0000000000e1',
  'eaf00000-0000-0000-0000-0000000000e1', '2027-08', '2027-08-01', 10.00, 10.00, FALSE);
SELECT pg_temp.setbals(0.00, 15.00);   -- LIE: balance 15 but only a 10 draw traces
SELECT pg_temp.mkinv('eaf00000-0000-0000-0000-0000000000e9', 30.00, '2027-09');
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT apply_credit_to_invoice('eaf00000-0000-0000-0000-0000000000e9')$$,
  'P0001', NULL, 'D4: fold reconciliation drift is refused');
RESET ROLE;

-- ══ E: a FOLDED or WRITTEN-OFF debit still refuses re-correction (CN002) ═══════
SELECT pg_temp.reset_pending_debits();
SELECT pg_temp.mk_debited('CN-ff', 'daf00000-0000-0000-0000-0000000000f1',
  'eaf00000-0000-0000-0000-0000000000f1', '2027-10', '2027-10-03', 20.00, 20.00, TRUE);
SELECT pg_temp.mark_folded('CN-ff', 'eaf00000-0000-0000-0000-0000000000d9');
SELECT pg_temp.setbals(0.00, 4.00);   -- a known unrelated balance, to prove it is untouched
SELECT throws_ok($$SELECT pg_temp.recorrect('daf00000-0000-0000-0000-0000000000f1')$$,
  'CN002', NULL, 'E1: a FOLDED (billed) debit still refuses (CN002)');
SELECT is((SELECT status FROM attendance WHERE lesson_session_id='daf00000-0000-0000-0000-0000000000f1'),
  'present', 'E2: the refusal left attendance unchanged');
SELECT is(pg_temp.dbal(), 4.00, 'E2b: the refusal touched no balance (Risk 7)');

SELECT pg_temp.reset_pending_debits();
SELECT pg_temp.mk_debited('CN-fg', 'daf00000-0000-0000-0000-0000000000f2',
  'eaf00000-0000-0000-0000-0000000000f2', '2027-11', '2027-11-07', 20.00, 20.00, TRUE);
SELECT pg_temp.mark_writtenoff('CN-fg');
SELECT throws_ok($$SELECT pg_temp.recorrect('daf00000-0000-0000-0000-0000000000f2')$$,
  'CN002', NULL, 'E3: a WRITTEN-OFF debit still refuses (CN002)');

-- ══ F: write_off_parent_balance zeroes + stamps + reconciles, then offboard OK ═
SELECT pg_temp.reset_pending_debits();
SELECT pg_temp.mk_debited('CN-fh', 'daf00000-0000-0000-0000-0000000000f3',
  'eaf00000-0000-0000-0000-0000000000f3', '2027-12', '2027-12-05', 20.00, 20.00, FALSE);
SELECT pg_temp.setbals(0.00, 20.00);
-- Authority reads auth.uid() from the JWT claim, not the DB role — so we set only
-- the claim (switching to the authenticated role would deny the pg_temp helpers).
SET LOCAL "request.jwt.claims" TO '{"sub":"af000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is(write_off_parent_balance(pg_temp.pid(), '99999999-0000-0000-0000-0000000000a7', 'leaver, settled by PayNow'),
  20.00, 'F1: write_off returns the amount cleared');
RESET "request.jwt.claims";
SELECT is(pg_temp.dbal(), 0.00, 'F2: debit_balance zeroed');
SELECT isnt((SELECT written_off_at FROM credit_applications ca JOIN credit_notes cn ON cn.id=ca.credit_note_id
              WHERE cn.reference_number='CN-fh'), NULL, 'F3: the draw is stamped written_off_at');
SELECT is((SELECT count(*)::int FROM audit_log
            WHERE action='parent_debit_written_off' AND entity_id=pg_temp.pid()),
  1, 'F4: an audit row was written');
SELECT lives_ok(
  $$UPDATE parent_tenants SET is_active=FALSE
      WHERE parent_id=pg_temp.pid() AND tenant_id='99999999-0000-0000-0000-0000000000a7'$$,
  'F5: with the debit cleared, offboard succeeds');

-- ══ G: the guard (RISK 3) + write-off authority ═══════════════════════════════
-- Reactivate (does not fire the guard — WHEN is true→false only).
UPDATE parent_tenants SET is_active=TRUE
 WHERE parent_id=pg_temp.pid() AND tenant_id='99999999-0000-0000-0000-0000000000a7';

-- G1: a direct parent_tenants offboard with a debit owing is refused.
SELECT pg_temp.setbals(0.00, 7.00);
SELECT throws_ok(
  $$UPDATE parent_tenants SET is_active=FALSE
      WHERE parent_id=pg_temp.pid() AND tenant_id='99999999-0000-0000-0000-0000000000a7'$$,
  'OFB01', NULL, 'G1: offboarding a family that owes a debit is refused');

-- G2: the SAME guard fires through set_students_active's consequence rule — the
-- everyday offboard path a per-RPC guard would miss (RISK 3).
SET LOCAL "request.jwt.claims" TO '{"sub":"af000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT throws_ok(
  $$SELECT set_students_active(ARRAY['cf000000-0000-0000-0000-000000000001'::uuid], FALSE)$$,
  'OFB01', NULL, 'G2: deactivating the last child (family flip) is refused too');
RESET "request.jwt.claims";

-- G3: credit does NOT block offboard — it is preserved across offboard by design.
SELECT pg_temp.setbals(10.00, 0.00);
SELECT lives_ok(
  $$UPDATE parent_tenants SET is_active=FALSE
      WHERE parent_id=pg_temp.pid() AND tenant_id='99999999-0000-0000-0000-0000000000a7'$$,
  'G3: a credit-only balance does not block offboard');

-- G4: write_off is admin-only — a coach is refused.
SELECT pg_temp.setbals(0.00, 5.00);
SET LOCAL "request.jwt.claims" TO '{"sub":"af000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
SELECT throws_ok(
  $$SELECT write_off_parent_balance(pg_temp.pid(), '99999999-0000-0000-0000-0000000000a7', 'x')$$,
  'P0001', NULL, 'G4: a coach cannot write off a balance');
RESET "request.jwt.claims";

-- G5: write_off refuses when there is nothing to write off.
SELECT pg_temp.setbals(0.00, 0.00);
SET LOCAL "request.jwt.claims" TO '{"sub":"af000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT throws_ok(
  $$SELECT write_off_parent_balance(pg_temp.pid(), '99999999-0000-0000-0000-0000000000a7', 'x')$$,
  'P0001', NULL, 'G5: write_off refuses a zero balance');
RESET "request.jwt.claims";

-- G6: a DIFFERENT tenant's admin cannot write off THIS tenant's parent (cross-tenant).
SELECT pg_temp.setbals(0.00, 5.00);
SET LOCAL "request.jwt.claims" TO '{"sub":"af000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok(
  $$SELECT write_off_parent_balance(pg_temp.pid(), '99999999-0000-0000-0000-0000000000a7', 'x')$$,
  'P0001', NULL, 'G6: an admin of tenant B cannot write off a tenant-A parent''s balance');
RESET "request.jwt.claims";

-- G7: the guard is per-tenant — a debit at tenant B does not block offboarding at
-- tenant A. Give the parent a debited membership at B, zero A, then offboard A.
INSERT INTO parent_tenants (parent_id, tenant_id, is_active)
SELECT pg_temp.pid(), '99999999-0000-0000-0000-0000000000a8', TRUE
 WHERE NOT EXISTS (SELECT 1 FROM parent_tenants WHERE parent_id=pg_temp.pid() AND tenant_id='99999999-0000-0000-0000-0000000000a8');
INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance, debit_balance)
VALUES (pg_temp.pid(), '99999999-0000-0000-0000-0000000000a8', 0, 9.00)
ON CONFLICT (parent_id, tenant_id) DO UPDATE SET debit_balance=9.00;
SELECT pg_temp.setbals(0.00, 0.00);   -- tenant A owes nothing
UPDATE parent_tenants SET is_active=TRUE
 WHERE parent_id=pg_temp.pid() AND tenant_id='99999999-0000-0000-0000-0000000000a7';
SELECT lives_ok(
  $$UPDATE parent_tenants SET is_active=FALSE
      WHERE parent_id=pg_temp.pid() AND tenant_id='99999999-0000-0000-0000-0000000000a7'$$,
  'G7: a debit at tenant B does not block offboarding at tenant A');

SELECT * FROM finish();
ROLLBACK;
