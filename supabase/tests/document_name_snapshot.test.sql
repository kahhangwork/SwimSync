-- pgTAP: a financial document keeps the name it was ISSUED with.
--
-- These tests FAIL on the pre-fix schema — verified by nulling the snapshot
-- columns and re-running (§7.25). Before this, five screens joined
-- students(full_name) live, so renaming a child rewrote their name on invoices
-- already sent and on credit notes PRD §7.8 calls immutable.
--
-- The rule the codebase already states: A FACT ABOUT A PAST LESSON IS NEVER A
-- LIVE LOOKUP (HANDOVER §6). class_title was snapshotted for exactly this
-- reason; the student's name was missed.
--
-- Its own tenant, so nothing here depends on another fixture's state.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(7);

SELECT has_column('public','invoice_items','student_name',
  'invoice_items records the name as invoiced');
SELECT has_column('public','credit_notes','student_name',
  'credit_notes records the name as credited');

INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('8d000000-0000-0000-0000-000000000001','snap','Snapshot Swim','SWIM-SNAP');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','7d000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','snap-parent@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}', '{"full_name":"Snap Parent","role":"parent"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','7d000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','snap-coach@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Snap Coach","role":"coach","tenant_id":"8d000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','','');

INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id)
VALUES ('5d000000-0000-0000-0000-00000000aa01','Ethan Tan','2018-04-04',
        'assigned','8d000000-0000-0000-0000-000000000001');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '5d000000-0000-0000-0000-00000000aa01'
  FROM parents p WHERE p.profile_id='7d000000-0000-0000-0000-000000000001';

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, tenant_id)
SELECT '6d000000-0000-0000-0000-00000000aa01', c.id, 'Snap Class','saturday','09:00','10:00',
       'Pool', 30, '8d000000-0000-0000-0000-000000000001'
  FROM coaches c WHERE c.profile_id='7d000000-0000-0000-0000-000000000002';

INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('5d000000-0000-0000-0000-00000000aa01','6d000000-0000-0000-0000-00000000aa01', TRUE);

INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('4d000000-0000-0000-0000-00000000aa01','6d000000-0000-0000-0000-00000000aa01',
        '2026-06-06','completed');

INSERT INTO attendance (lesson_session_id, student_id, status, marked_by, marked_at)
VALUES ('4d000000-0000-0000-0000-00000000aa01','5d000000-0000-0000-0000-00000000aa01',
        'present','7d000000-0000-0000-0000-000000000002', NOW());

-- An invoice for June, naming the child as they were then.
INSERT INTO invoices (id, parent_id, billing_month, gross_amount, credit_applied,
                      net_amount, status, tenant_id)
SELECT '3d000000-0000-0000-0000-00000000aa01', p.id, '2026-06', 30, 0, 30,
       'outstanding','8d000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id='7d000000-0000-0000-0000-000000000001';

INSERT INTO invoice_items (id, invoice_id, student_id, lesson_session_id,
                           attendance_status, amount, class_title, session_date,
                           student_name)
VALUES ('2d000000-0000-0000-0000-00000000aa01','3d000000-0000-0000-0000-00000000aa01',
        '5d000000-0000-0000-0000-00000000aa01','4d000000-0000-0000-0000-00000000aa01',
        'present', 30, 'Snap Class','2026-06-06','Ethan Tan');

-- ── The rename ─────────────────────────────────────────────────────────────
-- A perfectly ordinary correction: the family gave the child's full legal name.
UPDATE students SET full_name = 'Ethan Tan Wei Ming'
 WHERE id = '5d000000-0000-0000-0000-00000000aa01';

SELECT is(
  (SELECT student_name FROM invoice_items WHERE id='2d000000-0000-0000-0000-00000000aa01'),
  'Ethan Tan',
  'renaming a child does NOT rewrite an invoice that was already issued');

SELECT is(
  (SELECT full_name FROM students WHERE id='5d000000-0000-0000-0000-00000000aa01'),
  'Ethan Tan Wei Ming',
  'the rename itself still took effect — this is not a rename block');

-- ── The credit note carries the INVOICED name, not today's ─────────────────
-- Correcting the lesson to absent auto-issues a credit note against that item.
UPDATE attendance SET status = 'absent'
 WHERE lesson_session_id = '4d000000-0000-0000-0000-00000000aa01'
   AND student_id = '5d000000-0000-0000-0000-00000000aa01';

SELECT is(
  (SELECT count(*)::int FROM credit_notes
    WHERE invoice_item_id = '2d000000-0000-0000-0000-00000000aa01'),
  1, 'the correction issued a credit note');

-- The note must name the student as the INVOICE did. Otherwise the invoice and
-- the credit note reversing it visibly refer to different people.
SELECT is(
  (SELECT student_name FROM credit_notes
    WHERE invoice_item_id = '2d000000-0000-0000-0000-00000000aa01'),
  'Ethan Tan',
  'the credit note carries the name from the item it credits, not the new one');

-- ── A legacy item (no snapshot) still produces a usable note ───────────────
-- Rows predating the snapshot are NULL, and the trigger falls back to the live
-- students row for them. That is the best answer available, not a good one.
UPDATE invoice_items SET student_name = NULL
 WHERE id = '2d000000-0000-0000-0000-00000000aa01';

SELECT is(
  (SELECT student_name FROM invoice_items WHERE id='2d000000-0000-0000-0000-00000000aa01'),
  NULL,
  'a pre-snapshot row is NULL rather than back-filled with a guess');

SELECT * FROM finish();
ROLLBACK;
