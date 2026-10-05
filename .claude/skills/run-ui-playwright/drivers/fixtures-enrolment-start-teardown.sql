-- Teardown for fixtures-enrolment-start.sql. Deletes every row the fixture
-- OR the driver created under e5e50000-… — including the enrolment, marks, lesson
-- sessions and audit rows the UI wrote (RISK 12: leave no unmarked lesson behind).
BEGIN;
CREATE TEMP TABLE es_sessions AS
  SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'e5e50000-%';
DELETE FROM credit_applications WHERE credit_note_id IN
  (SELECT id FROM credit_notes WHERE lesson_session_id IN (SELECT id FROM es_sessions));
DELETE FROM credit_notes           WHERE lesson_session_id IN (SELECT id FROM es_sessions);
DELETE FROM invoice_items          WHERE lesson_session_id IN (SELECT id FROM es_sessions);
DELETE FROM attendance             WHERE lesson_session_id IN (SELECT id FROM es_sessions);
DELETE FROM session_coach_absences WHERE lesson_session_id IN (SELECT id FROM es_sessions);
DELETE FROM session_coaches        WHERE lesson_session_id IN (SELECT id FROM es_sessions);
DELETE FROM audit_log
 WHERE entity_id::text LIKE 'e5e50000-%'
    OR entity_id IN (SELECT id FROM es_sessions);
DELETE FROM lesson_sessions WHERE id IN (SELECT id FROM es_sessions);
DELETE FROM makeup_bookings WHERE class_id::text LIKE 'e5e50000-%' OR student_id::text LIKE 'e5e50000-%';
DELETE FROM trial_bookings  WHERE class_id::text LIKE 'e5e50000-%' OR student_id::text LIKE 'e5e50000-%';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'e5e50000-%' OR class_id::text LIKE 'e5e50000-%';
DELETE FROM students             WHERE id::text LIKE 'e5e50000-%';
DELETE FROM class_shadow_coaches WHERE class_id::text LIKE 'e5e50000-%';
DELETE FROM class_rates          WHERE class_id::text LIKE 'e5e50000-%';
DELETE FROM classes              WHERE id::text LIKE 'e5e50000-%';
DELETE FROM locations            WHERE id::text LIKE 'e5e50000-%';
DELETE FROM coach_rates WHERE coach_id IN (
  SELECT id FROM coaches WHERE profile_id = 'e5e50000-0000-0000-0000-0000000000c1');
DELETE FROM coaches    WHERE profile_id = 'e5e50000-0000-0000-0000-0000000000c1';
DELETE FROM auth.users WHERE id = 'e5e50000-0000-0000-0000-0000000000c1';
DELETE FROM profiles   WHERE id = 'e5e50000-0000-0000-0000-0000000000c1';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM classes WHERE id::text LIKE 'e5e50000-%')
     OR EXISTS (SELECT 1 FROM students WHERE id::text LIKE 'e5e50000-%')
     OR EXISTS (SELECT 1 FROM student_class_enrolments WHERE student_id::text LIKE 'e5e50000-%') THEN
    RAISE EXCEPTION 'fixtures-enrolment-start teardown: fixture rows survived';
  END IF;
END $$;
COMMIT;
