-- Teardown for fixtures-roles.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-roles-teardown.sql
--
-- THE DRIVER CREATES MORE THAN THE FIXTURE DOES: the "Driver Viewer" role (a
-- random uuid — deleted by NAME within the seed tenant) and audit rows for the
-- role and for the persona's role changes. Order: audit rows → the persona
-- (auth.users → profiles cascades, which releases admin_role_id's RESTRICT) →
-- the role.

BEGIN;

DELETE FROM audit_log
 WHERE entity_id = 'ad200000-0000-0000-0000-00000000b001'
    OR actor_id  = 'ad200000-0000-0000-0000-00000000b001'
    OR entity_id IN (SELECT id FROM tenant_roles
                      WHERE tenant_id = '70000000-0000-0000-0000-000000000001'
                        AND name = 'Driver Viewer');

DELETE FROM auth.users WHERE id = 'ad200000-0000-0000-0000-00000000b001';

DELETE FROM tenant_roles
 WHERE tenant_id = '70000000-0000-0000-0000-000000000001'
   AND name = 'Driver Viewer';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE id = 'ad200000-0000-0000-0000-00000000b001') THEN
    RAISE EXCEPTION 'fixtures-roles teardown: the persona survived';
  END IF;
  IF (SELECT count(*) FROM tenant_roles WHERE tenant_id = '70000000-0000-0000-0000-000000000001') <> 4 THEN
    RAISE EXCEPTION 'fixtures-roles teardown: the seed tenant should hold exactly its 4 standard roles';
  END IF;
END $$;

COMMIT;
