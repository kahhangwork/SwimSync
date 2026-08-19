-- Teardown for fixtures-admin-calendar.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-admin-calendar-teardown.sql
--
-- Deletes by exact fixture id / fixture class, never by pattern on a name
-- (§8.12). Lesson rows go BY CLASS (every date — §7.132): the calendar must not
-- create any, but a teardown that assumed so would hide the bug it exists to
-- catch, so it sweeps the class regardless.

BEGIN;

CREATE TEMP TABLE cal_sessions AS
  SELECT id FROM lesson_sessions
   WHERE class_id IN ('ca1c1a55-0000-0000-0000-000000000001',
                      'ca1c1a55-0000-0000-0000-000000000002');

DELETE FROM attendance             WHERE lesson_session_id IN (SELECT id FROM cal_sessions);
DELETE FROM session_coach_absences WHERE lesson_session_id IN (SELECT id FROM cal_sessions);
DELETE FROM session_coaches        WHERE lesson_session_id IN (SELECT id FROM cal_sessions);
DELETE FROM audit_log
 WHERE entity_type = 'lesson_session' AND entity_id IN (SELECT id FROM cal_sessions);
DELETE FROM lesson_sessions        WHERE id IN (SELECT id FROM cal_sessions);

DELETE FROM makeup_bookings WHERE class_id IN ('ca1c1a55-0000-0000-0000-000000000001',
                                               'ca1c1a55-0000-0000-0000-000000000002')
                               OR home_class_id IN ('ca1c1a55-0000-0000-0000-000000000001',
                                                    'ca1c1a55-0000-0000-0000-000000000002');
DELETE FROM trial_bookings  WHERE class_id IN ('ca1c1a55-0000-0000-0000-000000000001',
                                               'ca1c1a55-0000-0000-0000-000000000002');
DELETE FROM class_shadow_coaches WHERE class_id IN ('ca1c1a55-0000-0000-0000-000000000001',
                                                    'ca1c1a55-0000-0000-0000-000000000002');

DELETE FROM student_class_enrolments
 WHERE student_id IN ('ca199999-0000-0000-0000-000000000001',
                      'ca199999-0000-0000-0000-000000000002',
                      'ca199999-0000-0000-0000-000000000003',
                      'ca199999-0000-0000-0000-000000000004');
DELETE FROM parent_students
 WHERE student_id IN ('ca199999-0000-0000-0000-000000000001',
                      'ca199999-0000-0000-0000-000000000002',
                      'ca199999-0000-0000-0000-000000000003',
                      'ca199999-0000-0000-0000-000000000004');
DELETE FROM students
 WHERE id IN ('ca199999-0000-0000-0000-000000000001',
              'ca199999-0000-0000-0000-000000000002',
              'ca199999-0000-0000-0000-000000000003',
              'ca199999-0000-0000-0000-000000000004');

-- class_rates / coach_rates seeded by the class trigger go with the class.
DELETE FROM class_rates WHERE class_id IN ('ca1c1a55-0000-0000-0000-000000000001',
                                           'ca1c1a55-0000-0000-0000-000000000002');
DELETE FROM classes WHERE id IN ('ca1c1a55-0000-0000-0000-000000000001',
                                 'ca1c1a55-0000-0000-0000-000000000002');

-- The substitute coach and their account.
DELETE FROM coach_rates WHERE coach_id IN (
  SELECT id FROM coaches WHERE profile_id = 'ca100000-0000-0000-0000-0000000000c2');
DELETE FROM coaches WHERE profile_id = 'ca100000-0000-0000-0000-0000000000c2';
DELETE FROM auth.users WHERE id = 'ca100000-0000-0000-0000-0000000000c2';
DELETE FROM profiles   WHERE id = 'ca100000-0000-0000-0000-0000000000c2';

-- Proof: 0 left of everything the fixture owns; 1 = the seed coach survived.
SELECT
  (SELECT count(*) FROM classes WHERE id::text LIKE 'ca1c1a55-%')                   AS classes_left,
  (SELECT count(*) FROM lesson_sessions WHERE class_id::text LIKE 'ca1c1a55-%')     AS sessions_left,
  (SELECT count(*) FROM students WHERE id::text LIKE 'ca199999-%')                  AS kids_left,
  (SELECT count(*) FROM coaches WHERE profile_id = 'ca100000-0000-0000-0000-0000000000c2') AS sub_left,
  (SELECT count(*) FROM coaches WHERE profile_id = 'c0000000-0000-0000-0000-000000000001') AS seed_coach;

COMMIT;
