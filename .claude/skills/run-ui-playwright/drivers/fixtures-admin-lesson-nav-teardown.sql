-- Teardown for fixtures-admin-lesson-nav.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-admin-lesson-nav-teardown.sql
--
-- Deletes by the fixture's full id block (e9000000-…), never by name. Lesson
-- rows go BY CLASS (every date — §7.132): the driver's Save creates one, and a
-- substitute assigned through the UI creates another.

BEGIN;

CREATE TEMP TABLE nav_sessions AS
  SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'e9000000-%';

DELETE FROM credit_applications WHERE credit_note_id IN
  (SELECT id FROM credit_notes WHERE lesson_session_id IN (SELECT id FROM nav_sessions));
DELETE FROM credit_notes           WHERE lesson_session_id IN (SELECT id FROM nav_sessions);
DELETE FROM invoice_items          WHERE lesson_session_id IN (SELECT id FROM nav_sessions);
DELETE FROM attendance             WHERE lesson_session_id IN (SELECT id FROM nav_sessions);
DELETE FROM session_coach_absences WHERE lesson_session_id IN (SELECT id FROM nav_sessions);
DELETE FROM session_coaches        WHERE lesson_session_id IN (SELECT id FROM nav_sessions);
DELETE FROM audit_log
 WHERE entity_type = 'lesson_session' AND entity_id IN (SELECT id FROM nav_sessions);
DELETE FROM lesson_sessions        WHERE id IN (SELECT id FROM nav_sessions);

DELETE FROM makeup_bookings WHERE class_id::text LIKE 'e9000000-%' OR home_class_id::text LIKE 'e9000000-%';
DELETE FROM trial_bookings  WHERE class_id::text LIKE 'e9000000-%';
DELETE FROM class_shadow_coaches WHERE class_id::text LIKE 'e9000000-%';

DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'e9000000-%';
DELETE FROM students                 WHERE id::text LIKE 'e9000000-%';

-- class_rates seeded by the class trigger go with the class.
DELETE FROM class_rates WHERE class_id::text LIKE 'e9000000-%';
DELETE FROM classes     WHERE id::text LIKE 'e9000000-%';
DELETE FROM locations   WHERE id::text LIKE 'e9000000-%';

-- The substitute coach and their account.
DELETE FROM coach_rates WHERE coach_id IN (
  SELECT id FROM coaches WHERE profile_id = 'e9000000-0000-0000-0000-0000000000c2');
DELETE FROM coaches    WHERE profile_id = 'e9000000-0000-0000-0000-0000000000c2';
DELETE FROM auth.users WHERE id = 'e9000000-0000-0000-0000-0000000000c2';
DELETE FROM profiles   WHERE id = 'e9000000-0000-0000-0000-0000000000c2';

-- Proof: 0 left of everything the fixture owns; 1 = the seed coach survived.
SELECT
  (SELECT count(*) FROM classes WHERE id::text LIKE 'e9000000-%')                 AS classes_left,
  (SELECT count(*) FROM lesson_sessions WHERE class_id::text LIKE 'e9000000-%')   AS sessions_left,
  (SELECT count(*) FROM students WHERE id::text LIKE 'e9000000-%')                AS kids_left,
  (SELECT count(*) FROM coaches WHERE profile_id = 'e9000000-0000-0000-0000-0000000000c2') AS sub_left,
  (SELECT count(*) FROM coaches WHERE profile_id = 'c0000000-0000-0000-0000-000000000001') AS seed_coach;

COMMIT;
