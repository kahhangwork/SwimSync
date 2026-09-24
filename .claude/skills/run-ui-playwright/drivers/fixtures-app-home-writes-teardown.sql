-- Teardown for fixtures-app-home-writes.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-app-home-writes-teardown.sql
--
-- Removes the fixture parent, both children and the claim, AND the driver's
-- own write: the parent registered through the UI (app-home-register@), with
-- the seed-tenant membership its join code made.

BEGIN;

DELETE FROM student_claims
 WHERE id = 'ac200000-0000-0000-0000-00000000c1a1';
DELETE FROM parent_students
 WHERE student_id IN ('ac200000-0000-0000-0000-0000000000d1',
                      'ac200000-0000-0000-0000-0000000000d2');
DELETE FROM students
 WHERE id IN ('ac200000-0000-0000-0000-0000000000d1',
              'ac200000-0000-0000-0000-0000000000d2');

-- audit_log.actor_id is NOT NULL / NO ACTION — before the profiles (§7.50).
DELETE FROM audit_log WHERE actor_id IN
  (SELECT id FROM auth.users
    WHERE id = 'ac200000-0000-0000-0000-0000000000b1'
       OR email = 'app-home-register@swimsync.test');
DELETE FROM parent_tenants WHERE parent_id IN
  (SELECT p.id FROM parents p JOIN auth.users u ON u.id = p.profile_id
    WHERE u.id = 'ac200000-0000-0000-0000-0000000000b1'
       OR u.email = 'app-home-register@swimsync.test');
DELETE FROM parents WHERE profile_id IN
  (SELECT id FROM auth.users
    WHERE id = 'ac200000-0000-0000-0000-0000000000b1'
       OR email = 'app-home-register@swimsync.test');
DELETE FROM profiles WHERE id IN
  (SELECT id FROM auth.users
    WHERE id = 'ac200000-0000-0000-0000-0000000000b1'
       OR email = 'app-home-register@swimsync.test');
DELETE FROM auth.users
 WHERE id = 'ac200000-0000-0000-0000-0000000000b1'
    OR email = 'app-home-register@swimsync.test';

COMMIT;

SELECT
  (SELECT count(*) FROM auth.users WHERE email LIKE 'app-home-%@swimsync.test') AS fixture_users_left,     -- 0
  (SELECT count(*) FROM student_claims WHERE id = 'ac200000-0000-0000-0000-00000000c1a1') AS claims_left, -- 0
  (SELECT count(*) FROM tenants WHERE id = '70000000-0000-0000-0000-000000000001') AS seed_tenant_kept;   -- 1
