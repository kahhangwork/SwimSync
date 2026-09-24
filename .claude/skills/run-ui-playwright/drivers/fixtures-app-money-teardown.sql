-- Teardown for fixtures-app-money.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-app-money-teardown.sql
--
-- Everything lives under the fixture's own tenant, so this is a tenant-scoped
-- sweep. The driver's writes — the invoice claim, the package request it makes
-- and cancels — go with the tenant's invoices and parent_packages.

BEGIN;

DELETE FROM parent_packages
 WHERE tenant_id = 'ac300000-0000-0000-0000-000000000001';
DELETE FROM package_products
 WHERE tenant_id = 'ac300000-0000-0000-0000-000000000001';

DELETE FROM payment_records
 WHERE invoice_id = 'ac300000-0000-0000-0000-0000000000c1';
DELETE FROM invoices
 WHERE id = 'ac300000-0000-0000-0000-0000000000c1';

DELETE FROM parent_students
 WHERE student_id = 'ac300000-0000-0000-0000-0000000000d1';
DELETE FROM students
 WHERE id = 'ac300000-0000-0000-0000-0000000000d1';

-- audit_log.actor_id is NOT NULL / NO ACTION — before the profile (§7.50).
DELETE FROM audit_log
 WHERE actor_id = 'ac300000-0000-0000-0000-0000000000b1';
DELETE FROM parent_tenants
 WHERE tenant_id = 'ac300000-0000-0000-0000-000000000001';
DELETE FROM parents
 WHERE profile_id = 'ac300000-0000-0000-0000-0000000000b1';
DELETE FROM profiles
 WHERE id = 'ac300000-0000-0000-0000-0000000000b1';
DELETE FROM auth.users
 WHERE id = 'ac300000-0000-0000-0000-0000000000b1';

DELETE FROM tenants
 WHERE id = 'ac300000-0000-0000-0000-000000000001';

COMMIT;

SELECT
  (SELECT count(*) FROM tenants WHERE id = 'ac300000-0000-0000-0000-000000000001') AS fixture_tenant_left, -- 0
  (SELECT count(*) FROM auth.users WHERE email = 'app-money-parent@swimsync.test') AS fixture_users_left, -- 0
  (SELECT count(*) FROM tenants WHERE id = '70000000-0000-0000-0000-000000000001') AS seed_tenant_kept;   -- 1
