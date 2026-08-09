-- Teardown for fixtures-paynow-fallback.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-paynow-fallback-teardown.sql
--
-- Run this instead of `supabase db reset` — one database serves every worktree
-- (§7.55).
--
-- The seed tenant's paynow_uen / paynow_mobile / paynow_qr_url are restored by
-- the DRIVER's finally block, not here: it is the driver that changes them,
-- and a teardown nobody runs after a crash would leave the seed tenant
-- configured for every later driver. Restoring them here too is belt and
-- braces for the case where the driver was killed outright.

BEGIN;

-- parent_packages → package_applications cascade is not relied on: this
-- package is 'pending' and has never been drawn against. Deleted explicitly so
-- the row is gone even if the status was advanced by a driver run.
DELETE FROM parent_packages WHERE id = 'ef000000-0000-0000-0000-0000000000f1';
DELETE FROM package_products WHERE id = 'df000000-0000-0000-0000-0000000000f1';
DELETE FROM class_categories WHERE id = 'cf000000-0000-0000-0000-0000000000f1';

-- Audit rows written by or about these profiles, before the users they
-- reference: audit_log.actor_id is a NOT NULL FK with no cascade (§7.50).
DELETE FROM audit_log
 WHERE actor_id IN ('b1000000-0000-0000-0000-0000000000f1',
                    'b1000000-0000-0000-0000-0000000000f2');

-- auth.users → profiles → parents / coaches / parent_tenants all cascade.
DELETE FROM auth.users
 WHERE id IN ('b1000000-0000-0000-0000-0000000000f1',
              'b1000000-0000-0000-0000-0000000000f2');

-- The driver's own edit, reverted. The seed tenant ships with all three NULL;
-- anything else here is a driver that died between setting and restoring.
UPDATE tenants
   SET paynow_uen = NULL, paynow_mobile = NULL, paynow_qr_url = NULL
 WHERE id = '70000000-0000-0000-0000-000000000001';

COMMIT;

-- Expect: five zeros. The last one is the one that matters — a non-zero there
-- means the seed tenant is still carrying a PayNow ID this driver invented,
-- and every later driver would be running against a business it did not
-- configure.
SELECT
  (SELECT count(*) FROM auth.users
    WHERE id::text LIKE 'b1000000-0000-0000-0000-0000000000f%')     AS fixture_users,
  (SELECT count(*) FROM parent_packages
    WHERE id = 'ef000000-0000-0000-0000-0000000000f1')              AS fixture_packages,
  (SELECT count(*) FROM package_products
    WHERE id = 'df000000-0000-0000-0000-0000000000f1')              AS fixture_products,
  (SELECT count(*) FROM class_categories
    WHERE id = 'cf000000-0000-0000-0000-0000000000f1')              AS fixture_categories,
  (SELECT count(*) FROM tenants
    WHERE id = '70000000-0000-0000-0000-000000000001'
      AND (paynow_uen IS NOT NULL OR paynow_mobile IS NOT NULL
           OR paynow_qr_url IS NOT NULL))                           AS seed_tenant_dirty;
