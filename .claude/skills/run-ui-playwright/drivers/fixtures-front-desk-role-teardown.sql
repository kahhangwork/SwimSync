-- Teardown for fixtures-front-desk-role.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-front-desk-role-teardown.sql
--
-- Deletes by the fixture's id block (f0de0000-…) and the persona's auth row.
-- THE DRIVER WRITES MORE THAN THE FIXTURE: a lesson_sessions row + attendance
-- for class 1 (random session id — deleted BY CLASS, every date, §7.132), a
-- make-up booking into class 2, Cara's enrolment in class 1, and the audit rows
-- all of those leave (actor = the persona).

BEGIN;

CREATE TEMP TABLE fd_sessions AS
  SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'f0de0000-%';

DELETE FROM credit_applications WHERE credit_note_id IN
  (SELECT id FROM credit_notes WHERE lesson_session_id IN (SELECT id FROM fd_sessions));
DELETE FROM credit_notes           WHERE lesson_session_id IN (SELECT id FROM fd_sessions);
DELETE FROM invoice_items          WHERE lesson_session_id IN (SELECT id FROM fd_sessions);
DELETE FROM attendance             WHERE lesson_session_id IN (SELECT id FROM fd_sessions);
DELETE FROM session_coach_absences WHERE lesson_session_id IN (SELECT id FROM fd_sessions);
DELETE FROM session_coaches        WHERE lesson_session_id IN (SELECT id FROM fd_sessions);

DELETE FROM audit_log
 WHERE actor_id = 'f0de0000-0000-0000-0000-00000000ad01'
    OR entity_id::text LIKE 'f0de0000-%'
    OR entity_id IN (SELECT id FROM fd_sessions);

DELETE FROM lesson_sessions WHERE id IN (SELECT id FROM fd_sessions);

DELETE FROM makeup_bookings WHERE class_id::text LIKE 'f0de0000-%' OR home_class_id::text LIKE 'f0de0000-%'
                               OR student_id::text LIKE 'f0de0000-%';
DELETE FROM trial_bookings  WHERE class_id::text LIKE 'f0de0000-%' OR student_id::text LIKE 'f0de0000-%';

DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'f0de0000-%' OR class_id::text LIKE 'f0de0000-%';
DELETE FROM students                 WHERE id::text LIKE 'f0de0000-%';

-- class_rates seeded by the class trigger go with the class.
DELETE FROM class_shadow_coaches WHERE class_id::text LIKE 'f0de0000-%';
DELETE FROM class_rates          WHERE class_id::text LIKE 'f0de0000-%';
DELETE FROM classes              WHERE id::text LIKE 'f0de0000-%';
DELETE FROM locations            WHERE id::text LIKE 'f0de0000-%';

-- The coach, then both accounts (auth.users → profiles cascades).
DELETE FROM coach_rates WHERE coach_id IN (
  SELECT id FROM coaches WHERE profile_id = 'f0de0000-0000-0000-0000-0000000000c1');
DELETE FROM coaches    WHERE profile_id = 'f0de0000-0000-0000-0000-0000000000c1';
DELETE FROM auth.users WHERE id IN ('f0de0000-0000-0000-0000-0000000000c1',
                                    'f0de0000-0000-0000-0000-00000000ad01');
DELETE FROM profiles   WHERE id IN ('f0de0000-0000-0000-0000-0000000000c1',
                                    'f0de0000-0000-0000-0000-00000000ad01');

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM classes WHERE id::text LIKE 'f0de0000-%')
     OR EXISTS (SELECT 1 FROM students WHERE id::text LIKE 'f0de0000-%')
     OR EXISTS (SELECT 1 FROM profiles WHERE id::text LIKE 'f0de0000-%') THEN
    RAISE EXCEPTION 'fixtures-front-desk-role teardown: fixture rows survived';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_roles
                  WHERE tenant_id = '70000000-0000-0000-0000-000000000001' AND standard_key = 'front_desk') THEN
    RAISE EXCEPTION 'fixtures-front-desk-role teardown: the seed Front desk role is gone — it must never be touched';
  END IF;
END $$;

COMMIT;
