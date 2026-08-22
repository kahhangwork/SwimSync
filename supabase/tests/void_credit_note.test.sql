-- pgTAP: void_credit_note() (Item 3, 20260818000300) — CN001's destination.
--
-- Covers: undrawn void, fully-drawn void (invoice reopens, RISK 4), partially-drawn
-- void, authority (blank reason / coach / parent / wrong-tenant admin / already-
-- reversed), the CN001 exit end-to-end, the re-toggle-after-void (RED against the
-- 20260818000100 trigger without edit A), and the RISK 6 reconciliation invariant.
-- Rolled back.
--
-- Balances are set explicitly right before each void so the decrement math is tested
-- in isolation (the notes are seeded directly, as the engine/trigger would leave them).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(29);

-- ── Tenants: T1 (subject) and T2 (a foreign admin) ───────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('99999999-0000-0000-0000-0000000000d1', 'tap-void1', 'TAP Void 1', 'SWIM-VD01'),
  ('99999999-0000-0000-0000-0000000000d2', 'tap-void2', 'TAP Void 2', 'SWIM-VD02');

-- ── Users: T1 admin, T1 coach, parent, T2 admin ──────────────────────────────
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','tap-void-admin1@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Void Admin 1","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000d1"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','tap-void-coach1@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Void Coach 1","role":"coach","tenant_id":"99999999-0000-0000-0000-0000000000d1"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-0000000000b2',
   'authenticated','authenticated','tap-void-parent@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Void Parent","role":"parent"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','tap-void-admin2@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Void Admin 2","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000d2"}',
   now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE t.id IN ('99999999-0000-0000-0000-0000000000d1','99999999-0000-0000-0000-0000000000d2')
   AND NOT EXISTS (SELECT 1 FROM class_categories c
                    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'b1000000-0000-0000-0000-000000000001', co.id, 'Void Class', 'saturday',
       '10:00','11:00','Pool', 30.00,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = co.tenant_id AND lower(trim(cc.name)) = 'default group')
FROM coaches co WHERE co.profile_id = 'a1000000-0000-0000-0000-0000000000c1';

INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id)
VALUES ('c1000000-0000-0000-0000-000000000001', 'Void Kid', 'assigned', TRUE,'99999999-0000-0000-0000-0000000000d1');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c1000000-0000-0000-0000-000000000001'
FROM parents p WHERE p.profile_id = 'a1000000-0000-0000-0000-0000000000b2';

INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('c1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001', TRUE);

-- Parent id + balance row for the subject parent.
INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
SELECT p.id, '99999999-0000-0000-0000-0000000000d1', 0
FROM parents p WHERE p.profile_id = 'a1000000-0000-0000-0000-0000000000b2';

-- ── Helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.pid() RETURNS UUID AS $$
  SELECT id FROM parents WHERE profile_id = 'a1000000-0000-0000-0000-0000000000b2' $$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION pg_temp.bal() RETURNS NUMERIC AS $$
  SELECT credit_balance FROM parent_tenant_balances
   WHERE parent_id = pg_temp.pid() AND tenant_id = '99999999-0000-0000-0000-0000000000d1' $$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION pg_temp.setbal(v NUMERIC) RETURNS VOID AS $$
  UPDATE parent_tenant_balances SET credit_balance = v
   WHERE parent_id = pg_temp.pid() AND tenant_id = '99999999-0000-0000-0000-0000000000d1' $$ LANGUAGE sql;

-- debit_balance (the mirror; 20260822000100). Reads what the parent OWES.
CREATE OR REPLACE FUNCTION pg_temp.dbal() RETURNS NUMERIC AS $$
  SELECT debit_balance FROM parent_tenant_balances
   WHERE parent_id = pg_temp.pid() AND tenant_id = '99999999-0000-0000-0000-0000000000d1' $$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION pg_temp.actor(uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', uid)::text, true) $$ LANGUAGE sql;

-- A lesson+invoice+item+note factory returning the note id. status/drawn set by caller.
-- amount is the note amount; the invoice's gross/credit/net/status are passed in.
CREATE OR REPLACE FUNCTION pg_temp.seed_note(
  p_suffix TEXT, p_note_status TEXT, p_amount NUMERIC,
  p_inv_gross NUMERIC, p_inv_credit NUMERIC, p_inv_net NUMERIC, p_inv_status TEXT,
  p_paid BOOLEAN, p_date DATE, p_month TEXT)
RETURNS UUID AS $$
DECLARE
  v_ls  UUID := ('d1000000-0000-0000-0000-0000000000' || p_suffix)::uuid;
  v_inv UUID := ('e1000000-0000-0000-0000-0000000000' || p_suffix)::uuid;
  v_ii  UUID;
  v_cn  UUID;
BEGIN
  INSERT INTO lesson_sessions (id, class_id, session_date, status)
  VALUES (v_ls, 'b1000000-0000-0000-0000-000000000001', p_date, 'completed');

  INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status, paid_at, paid_marked_by)
  VALUES ('99999999-0000-0000-0000-0000000000d1', v_inv, pg_temp.pid(), p_month,
          p_inv_gross, p_inv_credit, p_inv_net, p_inv_status::invoice_status,
          CASE WHEN p_paid THEN now() ELSE NULL END,
          CASE WHEN p_paid THEN 'a1000000-0000-0000-0000-0000000000a1'::uuid ELSE NULL END);

  INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
  VALUES (v_inv, 'c1000000-0000-0000-0000-000000000001', v_ls, 'present', p_amount, 'Void Class', p_date)
  RETURNING id INTO v_ii;

  INSERT INTO credit_notes (reference_number, parent_id, student_id, student_name, invoice_id,
    invoice_item_id, lesson_session_id, amount, original_status, corrected_status, status, tenant_id,
    applied_to_invoice_id, applied_at)
  VALUES ('CN-'||p_suffix, pg_temp.pid(), 'c1000000-0000-0000-0000-000000000001', 'Void Kid', v_inv,
    v_ii, v_ls, p_amount, 'present', 'absent', p_note_status, '99999999-0000-0000-0000-0000000000d1',
    CASE WHEN p_note_status='applied' THEN v_inv ELSE NULL END,
    CASE WHEN p_note_status='applied' THEN now() ELSE NULL END)
  RETURNING id INTO v_cn;
  RETURN v_cn;
END $$ LANGUAGE plpgsql;

-- ══ SCENARIO A: undrawn void ═══════════════════════════════════════════════════
-- $30 note, available, no draws. Balance holds its $30.
DO $$ DECLARE v UUID; BEGIN
  v := pg_temp.seed_note('a1', 'available', 30.00, 30.00, 0.00, 30.00, 'outstanding', false, '2026-02-07', '2026-02');
END $$;
SELECT pg_temp.setbal(30.00);
SELECT pg_temp.actor('a1000000-0000-0000-0000-0000000000a1');
SELECT lives_ok(
  $$SELECT void_credit_note((SELECT id FROM credit_notes WHERE reference_number='CN-a1'), 'undrawn void')$$,
  '1: an admin can void an undrawn note');
SELECT is((SELECT status FROM credit_notes WHERE reference_number='CN-a1'), 'reversed',
  '2: the note is reversed');
SELECT is(pg_temp.bal(), 0.00, '3: the undrawn $30 is removed from the balance');
SELECT ok((SELECT reversed_at IS NOT NULL AND reversed_by = 'a1000000-0000-0000-0000-0000000000a1'
             FROM credit_notes WHERE reference_number='CN-a1'),
  '4: reversed_at/reversed_by stamped with the actor');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action='credit_note_voided'
             AND entity_id=(SELECT id FROM credit_notes WHERE reference_number='CN-a1')),
  1, '5: an audit row is written');

-- ══ SCENARIO B: fully-drawn void of a PAID invoice POSTS A DEBIT (20260822000100) ══
-- $30 note fully drawn against a $60 invoice whose $30 cash net was PAID. The paid
-- invoice is IMMUTABLE now: it is NOT reopened. The drawn value is recovered as a
-- debit_balance charge, and the draw is marked debited_at (NOT reversed_at).
DO $$ DECLARE v UUID; BEGIN
  v := pg_temp.seed_note('b1', 'applied', 30.00, 60.00, 30.00, 30.00, 'paid', true, '2026-03-07', '2026-03');
  INSERT INTO credit_applications (credit_note_id, invoice_id, amount)
  VALUES (v, 'e1000000-0000-0000-0000-0000000000b1', 30.00);
  INSERT INTO payment_records (invoice_id, marked_by, notes)
  VALUES ('e1000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-0000000000a1', 'cash net paid');
END $$;
SELECT pg_temp.setbal(0.00);  -- fully drawn note contributes nothing to the pool
SELECT pg_temp.actor('a1000000-0000-0000-0000-0000000000a1');
SELECT lives_ok(
  $$SELECT void_credit_note((SELECT id FROM credit_notes WHERE reference_number='CN-b1'), 'clawback')$$,
  '6: voiding a fully-drawn note against a PAID invoice succeeds');
SELECT ok((SELECT debited_at IS NOT NULL AND reversed_at IS NULL FROM credit_applications
             WHERE invoice_id='e1000000-0000-0000-0000-0000000000b1'),
  '7: the paid draw is marked debited_at, NOT reversed_at (the discount stands)');
SELECT row_eq(
  $$SELECT credit_applied, net_amount, status::text, paid_at IS NULL, paid_marked_by IS NULL
      FROM invoices WHERE id='e1000000-0000-0000-0000-0000000000b1'$$,
  ROW(30.00::numeric, 30.00::numeric, 'paid'::text, false, false),
  '8: the PAID invoice is UNCHANGED — credit 30, net 30, paid, stamps intact (immutable)');
SELECT is((SELECT count(*)::int FROM payment_records WHERE invoice_id='e1000000-0000-0000-0000-0000000000b1'),
  1, '9: the payment_records row is left untouched (immutable history)');
SELECT is(pg_temp.bal(), 0.00, '10: credit_balance unchanged — a fully-drawn note had no undrawn remainder');
SELECT is(pg_temp.dbal(), 30.00, '10b: the drawn $30 is recovered onto debit_balance');
-- RISK 6 invariant: credit_applied still reconciles with non-reversed applications.
SELECT is(
  (SELECT credit_applied FROM invoices WHERE id='e1000000-0000-0000-0000-0000000000b1'),
  (SELECT COALESCE(SUM(amount),0) FROM credit_applications
     WHERE invoice_id='e1000000-0000-0000-0000-0000000000b1' AND reversed_at IS NULL),
  '11: RISK 6 — credit_applied reconciles with non-reversed applications (paid draw is NOT reversed)');

-- ══ SCENARIO C: partially-drawn void ═══════════════════════════════════════════
-- $30 note, $20 drawn against a $50 invoice (net 30). Remainder $10 in the pool.
DO $$ DECLARE v UUID; BEGIN
  v := pg_temp.seed_note('c1', 'available', 30.00, 50.00, 20.00, 30.00, 'outstanding', false, '2026-04-04', '2026-04');
  INSERT INTO credit_applications (credit_note_id, invoice_id, amount)
  VALUES (v, 'e1000000-0000-0000-0000-0000000000c1', 20.00);
END $$;
SELECT pg_temp.setbal(10.00);  -- 30 issued − 20 drawn
SELECT pg_temp.actor('a1000000-0000-0000-0000-0000000000a1');
SELECT lives_ok(
  $$SELECT void_credit_note((SELECT id FROM credit_notes WHERE reference_number='CN-c1'), 'partial void')$$,
  '12: voiding a partially-drawn note succeeds');
SELECT is((SELECT credit_applied FROM invoices WHERE id='e1000000-0000-0000-0000-0000000000c1'),
  0.00, '13: the invoice gets its $20 back (credit_applied 0)');
SELECT is((SELECT net_amount FROM invoices WHERE id='e1000000-0000-0000-0000-0000000000c1'),
  50.00, '14: net rises by the reversed $20');
SELECT is(pg_temp.bal(), 0.00, '15: only the $10 undrawn remainder leaves the pool');

-- ══ SCENARIO D: authority + refusals ═══════════════════════════════════════════
DO $$ DECLARE v UUID; BEGIN
  v := pg_temp.seed_note('d1', 'available', 30.00, 30.00, 0.00, 30.00, 'outstanding', false, '2026-05-02', '2026-05');
END $$;
SELECT pg_temp.setbal(30.00);

SELECT pg_temp.actor('a1000000-0000-0000-0000-0000000000a1');
SELECT throws_ok(
  $$SELECT void_credit_note((SELECT id FROM credit_notes WHERE reference_number='CN-d1'), '   ')$$,
  NULL, NULL, '16: a blank reason is refused');

SELECT pg_temp.actor('a1000000-0000-0000-0000-0000000000c1');  -- the coach
SELECT throws_ok(
  $$SELECT void_credit_note((SELECT id FROM credit_notes WHERE reference_number='CN-d1'), 'x')$$,
  NULL, NULL, '17: a coach cannot void');

SELECT pg_temp.actor('a1000000-0000-0000-0000-0000000000b2');  -- the parent
SELECT throws_ok(
  $$SELECT void_credit_note((SELECT id FROM credit_notes WHERE reference_number='CN-d1'), 'x')$$,
  NULL, NULL, '18: a parent cannot void');

SELECT pg_temp.actor('a1000000-0000-0000-0000-0000000000a2');  -- another tenant's admin
SELECT throws_ok(
  $$SELECT void_credit_note((SELECT id FROM credit_notes WHERE reference_number='CN-d1'), 'x')$$,
  NULL, NULL, '19: a DIFFERENT business''s admin cannot void this note');

-- Nothing changed across the four refusals.
SELECT is((SELECT status FROM credit_notes WHERE reference_number='CN-d1'), 'available',
  '20: the note is untouched after every refusal');
SELECT is(pg_temp.bal(), 30.00, '21: balance untouched after every refusal');

-- The right admin can, and a second void is refused.
SELECT pg_temp.actor('a1000000-0000-0000-0000-0000000000a1');
SELECT lives_ok(
  $$SELECT void_credit_note((SELECT id FROM credit_notes WHERE reference_number='CN-d1'), 'ok now')$$,
  '22: the note''s own tenant admin can void it');
SELECT throws_ok(
  $$SELECT void_credit_note((SELECT id FROM credit_notes WHERE reference_number='CN-d1'), 'again')$$,
  NULL, NULL, '23: an already-reversed note cannot be voided twice');

-- ══ SCENARIO E: the CN001 exit + re-toggle-after-void (RED vs old trigger) ══════
-- Drive it through the real trigger. Lesson present + invoiced; correct to absent
-- (issues note via trigger); draw it (engine); un-correct → CN001; VOID; un-correct
-- now SUCCEEDS; re-correct (re-activates); un-correct again → clean reverse, NOT CN001.
INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('d1000000-0000-0000-0000-0000000000e1','b1000000-0000-0000-0000-000000000001','2026-06-06','completed');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('d1000000-0000-0000-0000-0000000000e1','c1000000-0000-0000-0000-000000000001','present','a1000000-0000-0000-0000-0000000000c1');
INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
VALUES ('99999999-0000-0000-0000-0000000000d1','e1000000-0000-0000-0000-0000000000e1', pg_temp.pid(), '2026-06', 30.00, 0.00, 30.00, 'outstanding');
INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
VALUES ('e1000000-0000-0000-0000-0000000000e1','c1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-0000000000e1','present', 30.00, 'Void Class', '2026-06-06');
SELECT pg_temp.setbal(0.00);

-- Correction issues the note (trigger), then the engine draws it.
UPDATE attendance SET status='absent', edit_reason='c1' WHERE lesson_session_id='d1000000-0000-0000-0000-0000000000e1';
INSERT INTO credit_applications (credit_note_id, invoice_id, amount)
SELECT id, 'e1000000-0000-0000-0000-0000000000e1', 30.00
  FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-0000000000e1';

SELECT throws_ok(
  $$UPDATE attendance SET status='present', edit_reason='undo' WHERE lesson_session_id='d1000000-0000-0000-0000-0000000000e1'$$,
  'CN001', NULL, '24a-precondition: a spent credit blocks un-correction (CN001)');

SELECT pg_temp.actor('a1000000-0000-0000-0000-0000000000a1');
SELECT void_credit_note((SELECT id FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-0000000000e1'), 'admin void for CN001');
SELECT pg_temp.actor(NULL);  -- trigger uses auth.uid() only for reversed_by (nullable)

-- The un-correction now succeeds (the note is reversed, so the un-correction finds none),
-- then re-correct re-activates, and the FINAL un-correction reverses cleanly — the
-- reversed draw must NOT count as a spend signal (edit A). This whole tail is RED
-- against the 20260818000100 trigger.
SELECT lives_ok(
  $$UPDATE attendance SET status='present', edit_reason='undo2' WHERE lesson_session_id='d1000000-0000-0000-0000-0000000000e1'$$,
  '24: after the void, the same un-correction SUCCEEDS — CN001 has a real exit');

-- Re-toggle: re-correct RE-ACTIVATES the voided note (available again, its old draw
-- still marked reversed), and the FINAL un-correction must reverse it CLEANLY — a
-- reversed draw is NOT a spend signal (edit A). This is the assertion that is RED
-- against the 20260818000100 trigger: there v_cn_drawn counts ANY application, so
-- the stale reversed draw re-trips CN001 forever.
UPDATE attendance SET status='absent', edit_reason='recorrect'
  WHERE lesson_session_id='d1000000-0000-0000-0000-0000000000e1';
SELECT is((SELECT status FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-0000000000e1'),
  'available', '25: re-correction re-activates the voided note to available');
SELECT lives_ok(
  $$UPDATE attendance SET status='present', edit_reason='undo3' WHERE lesson_session_id='d1000000-0000-0000-0000-0000000000e1'$$,
  '26: a reversed draw is NOT a spend signal — the re-activated note un-corrects cleanly, no CN001 (edit A)');
SELECT is((SELECT status FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-0000000000e1'),
  'reversed', '27: and the note ends reversed, not stuck behind CN001');

SELECT * FROM finish();
ROLLBACK;
