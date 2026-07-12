-- pgTAP: PRD §11 billing edge cases that the schema/triggers enforce.
--   11.4 — a Trial must be classified Paid/Free: there is no bare 'trial'
--          attendance status, so an unclassified trial cannot be stored.
--   11.5 — a student changes class in future: after unenrolling, a new active
--          enrolment is allowed and the historical row stays intact (the
--          basic "two active enrolments" rejection lives in constraints.test.sql).
--   11.8 — a student leaves with outstanding credit: unenrolling does NOT touch
--          the parent's credit_balance and issues no auto-refund/application.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(6);

-- ── Seed: coach + parent (with credit) + child, enrolled in class 1 ──────────
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000e1',
   'authenticated','authenticated','edge-coach@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Edge Coach","role":"coach"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000e2',
   'authenticated','authenticated','edge-parent@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Edge Parent","role":"parent"}', now(), now(), '', '', '', '');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson)
SELECT 'b0000000-0000-0000-0000-0000000000e1', co.id, 'Edge Class 1', 'saturday','10:00','11:00','Pool', 30
FROM coaches co WHERE co.profile_id='a0000000-0000-0000-0000-0000000000e1';
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson)
SELECT 'b0000000-0000-0000-0000-0000000000e2', co.id, 'Edge Class 2', 'sunday','10:00','11:00','Pool', 30
FROM coaches co WHERE co.profile_id='a0000000-0000-0000-0000-0000000000e1';

INSERT INTO students (id, full_name, assignment_status)
VALUES ('c0000000-0000-0000-0000-0000000000e1','Edge Kid','assigned');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c0000000-0000-0000-0000-0000000000e1' FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000e2';

INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('c0000000-0000-0000-0000-0000000000e1','b0000000-0000-0000-0000-0000000000e1', TRUE);

INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('d0000000-0000-0000-0000-0000000000e1','b0000000-0000-0000-0000-0000000000e1','2026-01-03','completed');

-- Parent has an outstanding credit balance (e.g. from an earlier correction).
UPDATE parents SET credit_balance = 25.00 WHERE profile_id='a0000000-0000-0000-0000-0000000000e2';

-- ── 11.4  No bare 'trial' status — an unclassified trial can't be stored ─────
SELECT throws_ok($$
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
  VALUES ('d0000000-0000-0000-0000-0000000000e1','c0000000-0000-0000-0000-0000000000e1',
          'trial','a0000000-0000-0000-0000-0000000000e1')
$$, '22P02', NULL, '11.4: attendance has no bare ''trial'' status (must be trial_paid/trial_free)');

-- ── 11.8  Unenrolling leaves the credit balance untouched ────────────────────
UPDATE student_class_enrolments
  SET is_active = FALSE, unenrolled_at = now()
  WHERE student_id='c0000000-0000-0000-0000-0000000000e1' AND is_active;

SELECT is(
  (SELECT credit_balance FROM parents WHERE profile_id='a0000000-0000-0000-0000-0000000000e2'),
  25.00::numeric,
  '11.8: unenrolling a student does not change the parent''s credit_balance');

SELECT is(
  (SELECT count(*)::int FROM credit_applications ca
     JOIN credit_notes cn ON cn.id = ca.credit_note_id
     JOIN parents p ON p.id = cn.parent_id
    WHERE p.profile_id='a0000000-0000-0000-0000-0000000000e2'),
  0,
  '11.8: unenrolling issues no credit application / auto-refund');

-- ── 11.5  Re-enrolment after unenrol succeeds; history stays intact ──────────
-- (class 1 is now inactive from the 11.8 step, so a new active row is allowed)
SELECT lives_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active)
  VALUES ('c0000000-0000-0000-0000-0000000000e1','b0000000-0000-0000-0000-0000000000e2', TRUE)
$$, '11.5: a student can be re-enrolled into a new class after being unenrolled');

SELECT is(
  (SELECT count(*)::int FROM student_class_enrolments
    WHERE student_id='c0000000-0000-0000-0000-0000000000e1' AND is_active),
  1,
  '11.5: exactly one active enrolment after re-enrolment');

SELECT is(
  (SELECT count(*)::int FROM student_class_enrolments
    WHERE student_id='c0000000-0000-0000-0000-0000000000e1'),
  2,
  '11.5: the historical (unenrolled) row is preserved alongside the new one');

SELECT * FROM finish();
ROLLBACK;
