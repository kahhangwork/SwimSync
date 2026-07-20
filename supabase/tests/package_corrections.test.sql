-- pgTAP: corrections on package-funded lessons (migration 20260720000200).
--
-- The trigger under test is a LIVE COACH PATH that has broken twice before in
-- migrations, so both directions are pinned:
--   • package-funded line → restore the package, NO cash credit note, tenant
--     credit balance untouched (the double-refund case is an explicit
--     expected-absence test);
--   • ad-hoc line → the existing credit-note path, byte-identical;
--   • flip-flop corrections refund AT MOST ONCE;
--   • restore works on an EXPIRED package (value wrongly taken is returned).
--
-- The invoiced state is constructed directly (invoice + item + ledger row)
-- rather than by running the TS engine — what is under test is the trigger.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

-- ── Fixtures ────────────────────────────────────────────────────────────────

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('ba000000-0000-0000-0000-000000000001','pkc-a','Pkg Corrections Swim','SWIM-PKCA');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','bd000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','pkc-coach@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Pkc Coach","role":"tenant_admin","is_coach":true,"tenant_id":"ba000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','bb000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','pkc-parent@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Pkc Parent","role":"parent"}',
   now(), now(), '','','','');

CREATE TEMP TABLE pkc AS
SELECT
  (SELECT p.id FROM parents p JOIN profiles pr ON pr.id = p.profile_id
    WHERE pr.email = 'pkc-parent@test.local') AS parent_id,
  (SELECT co.id FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
    WHERE pr.email = 'pkc-coach@test.local') AS coach_id;

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT parent_id, 'ba000000-0000-0000-0000-000000000001' FROM pkc;

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson)
SELECT 'be000000-0000-0000-0000-000000000001', coach_id, 'Corr Class', 'saturday',
       '10:00','11:00','Test Pool', 50.00 FROM pkc;

INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id)
VALUES ('b5000000-0000-0000-0000-000000000001','Corr Kid','2018-01-01','assigned',
        'ba000000-0000-0000-0000-000000000001');
INSERT INTO parent_students (parent_id, student_id)
SELECT parent_id, 'b5000000-0000-0000-0000-000000000001' FROM pkc;

INSERT INTO package_products (id, tenant_id, name, lesson_count, rate_per_lesson, validity_months)
VALUES ('bd100000-0000-0000-0000-000000000001','ba000000-0000-0000-0000-000000000001',
        'Corr 10-pack', 10, 40.00, 12);

-- Active package that has drawn one $40 lesson (360 of 400 left).
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, confirmed_at)
SELECT 'bf000000-0000-0000-0000-000000000001','ba000000-0000-0000-0000-000000000001',
       parent_id, 'bd100000-0000-0000-0000-000000000001', 'active',
       now() - interval '30 days'
FROM pkc;
UPDATE parent_packages SET value_remaining = 360.00
 WHERE id = 'bf000000-0000-0000-0000-000000000001';

-- Two invoiced sessions: one package-funded ($40 line), one ad-hoc ($50 line).
INSERT INTO lesson_sessions (id, class_id, session_date) VALUES
  ('b6000000-0000-0000-0000-000000000001','be000000-0000-0000-0000-000000000001',
   (now() AT TIME ZONE 'Asia/Singapore')::date - 14),
  ('b6000000-0000-0000-0000-000000000002','be000000-0000-0000-0000-000000000001',
   (now() AT TIME ZONE 'Asia/Singapore')::date - 7);

INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('b6000000-0000-0000-0000-000000000001','b5000000-0000-0000-0000-000000000001',
   'present','bd000000-0000-0000-0000-000000000001'),
  ('b6000000-0000-0000-0000-000000000002','b5000000-0000-0000-0000-000000000001',
   'present','bd000000-0000-0000-0000-000000000001');

INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount,
                      package_applied, credit_applied, net_amount, status)
SELECT 'b7000000-0000-0000-0000-000000000001', parent_id,
       'ba000000-0000-0000-0000-000000000001',
       to_char(now() - interval '1 month', 'YYYY-MM'),
       90.00, 40.00, 0.00, 50.00, 'outstanding'
FROM pkc;

INSERT INTO invoice_items (id, invoice_id, student_id, lesson_session_id,
                           attendance_status, amount, class_title, session_date, student_name)
VALUES
  ('b8000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001',
   'b5000000-0000-0000-0000-000000000001','b6000000-0000-0000-0000-000000000001',
   'present', 40.00, 'Corr Class',
   (now() AT TIME ZONE 'Asia/Singapore')::date - 14, 'Corr Kid'),
  ('b8000000-0000-0000-0000-000000000002','b7000000-0000-0000-0000-000000000001',
   'b5000000-0000-0000-0000-000000000001','b6000000-0000-0000-0000-000000000002',
   'present', 50.00, 'Corr Class',
   (now() AT TIME ZONE 'Asia/Singapore')::date - 7, 'Corr Kid');

-- The $40 line is package-funded.
INSERT INTO package_applications (id, parent_package_id, invoice_item_id, amount)
VALUES ('b9000000-0000-0000-0000-000000000001','bf000000-0000-0000-0000-000000000001',
        'b8000000-0000-0000-0000-000000000001', 40.00);

-- ── Package-funded correction: restore, and ONLY restore ───────────────────

UPDATE attendance SET status = 'absent', edit_reason = 'was away'
 WHERE lesson_session_id = 'b6000000-0000-0000-0000-000000000001'
   AND student_id = 'b5000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT value_remaining FROM parent_packages
    WHERE id = 'bf000000-0000-0000-0000-000000000001'),
  400.00::numeric, 'the drawn value goes BACK on the package');

SELECT isnt(
  (SELECT reversed_at FROM package_applications
    WHERE id = 'b9000000-0000-0000-0000-000000000001'),
  NULL, 'the ledger row is REVERSED, not deleted — append-only history');

SELECT is(
  (SELECT count(*)::int FROM credit_notes
    WHERE tenant_id = 'ba000000-0000-0000-0000-000000000001'),
  0, 'NO cash credit note for a package-funded line (the double-refund hole)');

SELECT is(
  (SELECT count(*)::int FROM parent_tenant_balances
    WHERE tenant_id = 'ba000000-0000-0000-0000-000000000001'
      AND credit_balance <> 0),
  0, 'the tenant cash-credit balance is untouched');

-- ── Flip-flop: refunded AT MOST ONCE ────────────────────────────────────────

UPDATE attendance SET status = 'present'
 WHERE lesson_session_id = 'b6000000-0000-0000-0000-000000000001'
   AND student_id = 'b5000000-0000-0000-0000-000000000001';
UPDATE attendance SET status = 'absent', edit_reason = 'flip-flop'
 WHERE lesson_session_id = 'b6000000-0000-0000-0000-000000000001'
   AND student_id = 'b5000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT value_remaining FROM parent_packages
    WHERE id = 'bf000000-0000-0000-0000-000000000001'),
  400.00::numeric, 'a second correction of the same line does NOT restore twice');

SELECT is(
  (SELECT count(*)::int FROM credit_notes
    WHERE tenant_id = 'ba000000-0000-0000-0000-000000000001'),
  0, '…and does NOT fall through to a cash credit note either');

SELECT is(
  (SELECT count(*)::int FROM package_applications
    WHERE invoice_item_id = 'b8000000-0000-0000-0000-000000000001'),
  1, 'still exactly one ledger row for the line — nothing minted by the flip-flop');

-- ── Ad-hoc line on the SAME invoice: the credit-note path, unchanged ───────

UPDATE attendance SET status = 'cancelled_rain', edit_reason = 'storm'
 WHERE lesson_session_id = 'b6000000-0000-0000-0000-000000000002'
   AND student_id = 'b5000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM credit_notes
    WHERE tenant_id = 'ba000000-0000-0000-0000-000000000001'
      AND invoice_item_id = 'b8000000-0000-0000-0000-000000000002'),
  1, 'an AD-HOC line still gets its cash credit note exactly as before');

SELECT is(
  (SELECT amount FROM credit_notes
    WHERE invoice_item_id = 'b8000000-0000-0000-0000-000000000002'),
  50.00::numeric, '…for the invoiced amount');

SELECT is(
  (SELECT credit_balance FROM parent_tenant_balances ptb
    WHERE ptb.tenant_id = 'ba000000-0000-0000-0000-000000000001'
      AND ptb.parent_id = (SELECT parent_id FROM pkc)),
  50.00::numeric, '…accruing to the tenant cash balance');

SELECT is(
  (SELECT value_remaining FROM parent_packages
    WHERE id = 'bf000000-0000-0000-0000-000000000001'),
  400.00::numeric, '…and the package is not involved at all');

-- ── Restore works on an EXPIRED package ─────────────────────────────────────
-- New line funded by the package, which then expires before the correction.

UPDATE parent_packages SET value_remaining = 360.00
 WHERE id = 'bf000000-0000-0000-0000-000000000001';

INSERT INTO lesson_sessions (id, class_id, session_date) VALUES
  ('b6000000-0000-0000-0000-000000000003','be000000-0000-0000-0000-000000000001',
   (now() AT TIME ZONE 'Asia/Singapore')::date - 21);
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('b6000000-0000-0000-0000-000000000003','b5000000-0000-0000-0000-000000000001',
   'present','bd000000-0000-0000-0000-000000000001');
INSERT INTO invoice_items (id, invoice_id, student_id, lesson_session_id,
                           attendance_status, amount, class_title, session_date, student_name)
VALUES ('b8000000-0000-0000-0000-000000000003','b7000000-0000-0000-0000-000000000001',
        'b5000000-0000-0000-0000-000000000001','b6000000-0000-0000-0000-000000000003',
        'present', 40.00, 'Corr Class',
        (now() AT TIME ZONE 'Asia/Singapore')::date - 21, 'Corr Kid');
INSERT INTO package_applications (parent_package_id, invoice_item_id, amount)
VALUES ('bf000000-0000-0000-0000-000000000001','b8000000-0000-0000-0000-000000000003', 40.00);

-- Expire it (postgres may move these fields; clients may not).
UPDATE parent_packages
   SET expires_on = (now() AT TIME ZONE 'Asia/Singapore')::date - 1
 WHERE id = 'bf000000-0000-0000-0000-000000000001';

UPDATE attendance SET status = 'absent', edit_reason = 'late correction'
 WHERE lesson_session_id = 'b6000000-0000-0000-0000-000000000003'
   AND student_id = 'b5000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT value_remaining FROM parent_packages
    WHERE id = 'bf000000-0000-0000-0000-000000000001'),
  400.00::numeric,
  'value wrongly taken is returned even to an EXPIRED package');

SELECT * FROM finish();
ROLLBACK;
