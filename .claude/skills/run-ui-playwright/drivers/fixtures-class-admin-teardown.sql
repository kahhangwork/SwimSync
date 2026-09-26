-- Teardown for fixtures-class-admin.sql — removes the ClsAdm business and
-- everything in it, including what the DRIVER wrote (End stamps the ongoing
-- class_shadow_coaches row, which lives on the fixture's class).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-class-admin-teardown.sql
--
-- Scoped by the tenant id and the full 'd4000000-' block, never a 2-char
-- prefix (§7.280). Order is FK order: assignments before classes and coaches,
-- coaches before profiles.

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM class_shadow_coaches   WHERE tenant_id = 'd4000000-0000-0000-0000-000000000001';
DELETE FROM class_shadow_coaches   WHERE class_id::text LIKE 'd4000000-%';
DELETE FROM audit_log              WHERE entity_id::text LIKE 'd4000000-%';
DELETE FROM audit_log              WHERE tenant_id = 'd4000000-0000-0000-0000-000000000001';
DELETE FROM class_rates            WHERE class_id::text LIKE 'd4000000-%';
DELETE FROM classes                WHERE tenant_id = 'd4000000-0000-0000-0000-000000000001';
DELETE FROM locations              WHERE tenant_id = 'd4000000-0000-0000-0000-000000000001';
DELETE FROM class_categories       WHERE tenant_id = 'd4000000-0000-0000-0000-000000000001';
DELETE FROM skill_grade_levels     WHERE tenant_id = 'd4000000-0000-0000-0000-000000000001';
DELETE FROM coach_rates            WHERE coach_id IN
  (SELECT id FROM coaches WHERE profile_id::text LIKE 'd4000000-%');
UPDATE tenants SET owner_profile_id = NULL WHERE id = 'd4000000-0000-0000-0000-000000000001';
DELETE FROM coaches                WHERE profile_id::text LIKE 'd4000000-%';
DELETE FROM profiles               WHERE id::text LIKE 'd4000000-%';
DELETE FROM auth.users             WHERE id::text LIKE 'd4000000-%';
DELETE FROM tenants                WHERE id = 'd4000000-0000-0000-0000-000000000001';

COMMIT;

-- Expect 0, 0, 0.
SELECT (SELECT count(*) FROM tenants    WHERE id = 'd4000000-0000-0000-0000-000000000001') AS tenant,
       (SELECT count(*) FROM classes    WHERE id::text LIKE 'd4000000-%')                   AS classes,
       (SELECT count(*) FROM auth.users WHERE id::text LIKE 'd4000000-%')                   AS users;
