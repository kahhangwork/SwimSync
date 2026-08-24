-- pgTAP: the re-toggled attendance correction must NOT double the credit
-- (Wave D fix, 20260818000100). Symmetric ledger, one credit_notes row reused
-- per invoice_item_id; un-correction voids an undrawn note and REFUSES a drawn
-- one. Runs in a rolled-back transaction.
--
-- RED PROOF (§7.25): against the pre-fix trigger (schema/index in place), tests
-- 5-7 fail — the old code reverses NOTHING on absent→present. The re-correction's
-- second INSERT is then caught by the UNIQUE index (unique_violation), so the raw
-- $60 double is only reproducible against the true pre-migration state (pre-fix
-- trigger AND no index); that was verified separately (2 rows, balance 60.00).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(15);

INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('99999999-0000-0000-0000-0000000000d1', 'tap-cndc', 'TAP CN-DC', 'SWIM-CND1');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','tap-cndc-coach@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"CNDC Coach","role":"coach","tenant_id":"99999999-0000-0000-0000-0000000000d1"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-0000000000b2',
   'authenticated','authenticated','tap-cndc-parent@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"CNDC Parent","role":"parent"}',
   now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM class_categories c
    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

-- classes.location_id is NOT NULL since the location contract migration
-- (20260824000200). Give every tenant one location to hang classes off,
-- tenant-agnostic and idempotent (mirrors the Default Group category block).
INSERT INTO locations (tenant_id, name)
SELECT t.id, 'Default location' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM locations l
    WHERE l.tenant_id = t.id AND lower(trim(l.name)) = 'default location');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT 'b1000000-0000-0000-0000-000000000001', co.id, 'CNDC Class', 'saturday',
       '10:00','11:00',(SELECT l.id FROM locations l WHERE l.tenant_id = co.tenant_id AND lower(trim(l.name)) = 'default location'), 30.00,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = co.tenant_id AND lower(trim(cc.name)) = 'default group')
FROM coaches co WHERE co.profile_id = 'a1000000-0000-0000-0000-0000000000c1';

INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id)
VALUES ('c1000000-0000-0000-0000-000000000001', 'CNDC Kid', 'assigned', TRUE,'99999999-0000-0000-0000-0000000000d1');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c1000000-0000-0000-0000-000000000001'
FROM parents p WHERE p.profile_id = 'a1000000-0000-0000-0000-0000000000b2';

INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('c1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001', TRUE);

INSERT INTO lesson_sessions (id, class_id, session_date, status) VALUES
  ('d1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','2026-02-07','completed');

INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('d1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','present','a1000000-0000-0000-0000-0000000000c1');

INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT '99999999-0000-0000-0000-0000000000d1', 'e1000000-0000-0000-0000-000000000001', p.id, '2026-02', 30.00, 0.00, 30.00, 'outstanding'
FROM parents p WHERE p.profile_id = 'a1000000-0000-0000-0000-0000000000b2';

INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
VALUES ('e1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
        'd1000000-0000-0000-0000-000000000001','present', 30.00, 'CNDC Class', '2026-02-07');

-- Helper: the parent's credit balance at the issuing tenant.
CREATE OR REPLACE FUNCTION pg_temp.bal() RETURNS NUMERIC AS $$
  SELECT COALESCE(b.credit_balance, 0) FROM parent_tenant_balances b
    JOIN parents p ON p.id = b.parent_id
   WHERE p.profile_id = 'a1000000-0000-0000-0000-0000000000b2'
     AND b.tenant_id = '99999999-0000-0000-0000-0000000000d1';
$$ LANGUAGE sql;

-- ── Correction #1: present → absent ──────────────────────────────────────────
UPDATE attendance SET status = 'absent', edit_reason = 'correction 1'
  WHERE lesson_session_id = 'd1000000-0000-0000-0000-000000000001';

SELECT is((SELECT count(*)::int FROM credit_notes WHERE invoice_item_id =
  (SELECT id FROM invoice_items WHERE lesson_session_id='d1000000-0000-0000-0000-000000000001')),
  1, '1: one credit note after the first correction');
SELECT is((SELECT status FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-000000000001'),
  'available', '2: it is available');
SELECT is(pg_temp.bal(), 30.00, '3: balance is one lesson of credit');

-- Simulate the email having been sent, to prove the re-issue resets it (RISK 3).
UPDATE credit_notes SET email_sent_at = NOW()
  WHERE lesson_session_id='d1000000-0000-0000-0000-000000000001';

-- ── Un-correction: absent → present (voids the undrawn note) ─────────────────
UPDATE attendance SET status = 'present', edit_reason = 'un-correct'
  WHERE lesson_session_id = 'd1000000-0000-0000-0000-000000000001';

SELECT is((SELECT count(*)::int FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-000000000001'),
  1, '4: still ONE row for the line (reused, not a second note)');
SELECT is((SELECT status FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-000000000001'),
  'reversed', '5: the note is reversed on un-correction');
SELECT is(pg_temp.bal(), 0.00, '6: balance returns to zero on un-correction');
SELECT ok((SELECT reversed_at IS NOT NULL FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-000000000001'),
  '7: reversed_at is stamped');

-- ── Re-correction: present → absent (re-activates, never doubles) ────────────
UPDATE attendance SET status = 'absent', edit_reason = 'correction 2'
  WHERE lesson_session_id = 'd1000000-0000-0000-0000-000000000001';

SELECT is((SELECT count(*)::int FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-000000000001'),
  1, '8: still ONE row after re-correction (the double-credit bug is fixed)');
SELECT is((SELECT status FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-000000000001'),
  'available', '9: re-activated to available');
SELECT is(pg_temp.bal(), 30.00, '10: balance is ONE lesson, not two (was 60 pre-fix)');
SELECT ok((SELECT email_sent_at IS NULL FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-000000000001'),
  '11: email_sent_at reset so the re-issued credit emails again (RISK 3)');

-- ── Drawn refusal: a spent credit cannot be un-corrected ─────────────────────
-- Draw the note down against its invoice (what the engine does at billing).
INSERT INTO credit_applications (credit_note_id, invoice_id, amount)
SELECT id, 'e1000000-0000-0000-0000-000000000001', 30.00
FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-000000000001';

SELECT throws_ok(
  $$UPDATE attendance SET status='present', edit_reason='undo after spend'
      WHERE lesson_session_id='d1000000-0000-0000-0000-000000000001'$$,
  'CN001',
  NULL,
  '12: un-correcting an already-drawn credit is refused (CN001)');

-- The refused edit changed nothing.
SELECT is((SELECT status FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-000000000001'),
  'available', '13: the note is untouched after the refusal');
SELECT is(pg_temp.bal(), 30.00, '14: balance unchanged by the refused un-correction');

-- ── The UNIQUE index is a structural backstop: no second note per line ───────
SELECT throws_ok(
  $$INSERT INTO credit_notes (reference_number, parent_id, student_id, student_name,
       invoice_id, invoice_item_id, lesson_session_id, amount, original_status,
       corrected_status, status, tenant_id)
     SELECT 'DUP-X', parent_id, student_id, student_name, invoice_id, invoice_item_id,
       lesson_session_id, amount, original_status, corrected_status, 'available', tenant_id
     FROM credit_notes WHERE lesson_session_id='d1000000-0000-0000-0000-000000000001'$$,
  '23505',
  NULL,
  '15: UNIQUE(invoice_item_id) rejects a second note on the same invoice line');

SELECT * FROM finish();
ROLLBACK;
