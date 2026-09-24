-- Teardown for fixtures-app-auth.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-app-auth-teardown.sql
--
-- Removes the fixture parent + child AND the driver's own write: the invited
-- user (app-auth-invite@swimsync.test). The driver restores the seed coach's
-- password itself; nothing here touches the seed coach.

BEGIN;

DELETE FROM student_class_enrolments
 WHERE student_id = 'ac100000-0000-0000-0000-0000000000d1';
DELETE FROM parent_students
 WHERE student_id = 'ac100000-0000-0000-0000-0000000000d1';
DELETE FROM students
 WHERE id = 'ac100000-0000-0000-0000-0000000000d1';

-- audit_log.actor_id is NOT NULL / NO ACTION — before the profiles (§7.50).
DELETE FROM audit_log WHERE actor_id IN
  (SELECT id FROM auth.users
    WHERE id = 'ac100000-0000-0000-0000-0000000000b1'
       OR email = 'app-auth-invite@swimsync.test');
DELETE FROM parent_tenants WHERE parent_id IN
  (SELECT p.id FROM parents p JOIN auth.users u ON u.id = p.profile_id
    WHERE u.id = 'ac100000-0000-0000-0000-0000000000b1'
       OR u.email = 'app-auth-invite@swimsync.test');
DELETE FROM parents WHERE profile_id IN
  (SELECT id FROM auth.users
    WHERE id = 'ac100000-0000-0000-0000-0000000000b1'
       OR email = 'app-auth-invite@swimsync.test');
DELETE FROM profiles WHERE id IN
  (SELECT id FROM auth.users
    WHERE id = 'ac100000-0000-0000-0000-0000000000b1'
       OR email = 'app-auth-invite@swimsync.test');
DELETE FROM auth.users
 WHERE id = 'ac100000-0000-0000-0000-0000000000b1'
    OR email = 'app-auth-invite@swimsync.test';

COMMIT;

SELECT
  (SELECT count(*) FROM auth.users WHERE email LIKE 'app-auth-%@swimsync.test') AS fixture_users_left,   -- 0
  (SELECT count(*) FROM students WHERE id = 'ac100000-0000-0000-0000-0000000000d1') AS students_left,     -- 0
  (SELECT count(*) FROM auth.users WHERE email = 'coach@swimsync.test') AS seed_coach_kept;               -- 1
