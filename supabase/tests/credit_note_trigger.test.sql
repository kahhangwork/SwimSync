-- pgTAP: the auto credit-note trigger (handle_attendance_update).
-- Runs in a transaction that is rolled back, so the seed leaves no trace.
-- Verifies a credit note is issued ONLY when an already-invoiced lesson goes
-- from a billable status to a non-billable one — and not otherwise.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(11);

-- ── Seed (fixed UUIDs) ──────────────────────────────────────────────────────
-- Coach + parent auth users; the handle_new_user trigger creates their
-- profiles + coaches/parents rows.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','tap-coach@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"TAP Coach","role":"coach"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000b2',
   'authenticated','authenticated','tap-parent@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"TAP Parent","role":"parent"}',
   now(), now(), '', '', '', '');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson)
SELECT 'b0000000-0000-0000-0000-000000000001', co.id, 'TAP Class', 'saturday',
       '10:00','11:00','Pool', 30.00
FROM coaches co WHERE co.profile_id = 'a0000000-0000-0000-0000-0000000000c1';

INSERT INTO students (id, full_name, assignment_status, is_active)
VALUES ('c0000000-0000-0000-0000-000000000001', 'TAP Kid', 'assigned', TRUE);

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c0000000-0000-0000-0000-000000000001'
FROM parents p WHERE p.profile_id = 'a0000000-0000-0000-0000-0000000000b2';

INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('c0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001', TRUE);

-- session1 = invoiced, session2 = not invoiced
INSERT INTO lesson_sessions (id, class_id, session_date, status) VALUES
  ('d0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','2026-01-03','completed'),
  ('d0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','2026-01-10','completed');

INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','present','a0000000-0000-0000-0000-0000000000c1'),
  ('d0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','present','a0000000-0000-0000-0000-0000000000c1');

-- Invoice + item making ONLY session1 "already invoiced"
INSERT INTO invoices (id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT 'e0000000-0000-0000-0000-000000000001', p.id, '2026-01', 30.00, 0.00, 30.00, 'outstanding'
FROM parents p WHERE p.profile_id = 'a0000000-0000-0000-0000-0000000000b2';

INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
VALUES ('e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-000000000001','present', 30.00, 'TAP Class', '2026-01-03');

-- ── Negative: edit on a NON-invoiced lesson issues no credit note ────────────
UPDATE attendance SET status = 'absent'
  WHERE lesson_session_id = 'd0000000-0000-0000-0000-000000000002';
SELECT is(
  (SELECT count(*)::int FROM credit_notes WHERE lesson_session_id = 'd0000000-0000-0000-0000-000000000002'),
  0, 'no credit note for an edit on a non-invoiced lesson');

-- ── Negative: billable -> billable on the invoiced lesson issues no note ─────
UPDATE attendance SET status = 'trial_paid'
  WHERE lesson_session_id = 'd0000000-0000-0000-0000-000000000001';
SELECT is(
  (SELECT count(*)::int FROM credit_notes WHERE lesson_session_id = 'd0000000-0000-0000-0000-000000000001'),
  0, 'no credit note for a billable->billable change (present->trial_paid)');

-- ── Positive: billable -> non-billable on the invoiced lesson issues a note ──
UPDATE attendance SET status = 'absent', edit_reason = 'correction'
  WHERE lesson_session_id = 'd0000000-0000-0000-0000-000000000001';
SELECT is(
  (SELECT count(*)::int FROM credit_notes WHERE lesson_session_id = 'd0000000-0000-0000-0000-000000000001'),
  1, 'exactly one credit note issued on invoiced billable->non-billable');
SELECT is(
  (SELECT amount FROM credit_notes WHERE lesson_session_id = 'd0000000-0000-0000-0000-000000000001'),
  30.00, 'credit note amount equals the invoiced item amount');
SELECT is(
  (SELECT status FROM credit_notes WHERE lesson_session_id = 'd0000000-0000-0000-0000-000000000001'),
  'available', 'new credit note is available');
SELECT is(
  (SELECT credit_balance FROM parents WHERE profile_id = 'a0000000-0000-0000-0000-0000000000b2'),
  30.00, 'parent credit_balance incremented by the credit amount');

-- ── 11.6  The correction must NOT modify or delete the original invoice ──────
-- The invoice stays a historical record; only a credit note is issued (applied
-- to the next cycle). Assert the original invoice is intact and the note links back.
SELECT is(
  (SELECT count(*)::int FROM invoices WHERE id = 'e0000000-0000-0000-0000-000000000001'),
  1, '11.6: the original invoice still exists (the correction did not delete it)');
SELECT is(
  (SELECT gross_amount FROM invoices WHERE id = 'e0000000-0000-0000-0000-000000000001'),
  30.00, '11.6: the original invoice gross_amount is unchanged (historical record)');
SELECT is(
  (SELECT status::text FROM invoices WHERE id = 'e0000000-0000-0000-0000-000000000001'),
  'outstanding', '11.6: the original invoice status is unchanged (not re-computed)');
SELECT is(
  (SELECT invoice_id FROM credit_notes WHERE lesson_session_id = 'd0000000-0000-0000-0000-000000000001'),
  'e0000000-0000-0000-0000-000000000001'::uuid,
  '11.6: the credit note links back to the original invoice');

-- ── Negative: a no-op update (status unchanged) issues no further note ───────
UPDATE attendance SET edit_reason = 'noop'
  WHERE lesson_session_id = 'd0000000-0000-0000-0000-000000000001';
SELECT is(
  (SELECT count(*)::int FROM credit_notes WHERE lesson_session_id = 'd0000000-0000-0000-0000-000000000001'),
  1, 'a same-status update does not issue another credit note');

SELECT * FROM finish();
ROLLBACK;
