-- Teardown for fixtures-payment-collection.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-payment-collection-teardown.sql
--
-- The driver's own writes are payment_records (via confirm_invoice_paid) and
-- timestamp columns on the fixture invoice — both removed with the invoice.
-- The fixture supplies reference + token explicitly, so no tenant counter
-- state needs restoring.

BEGIN;

DELETE FROM payment_records
 WHERE invoice_id = 'da100000-0000-0000-0000-0000000000c1';

DELETE FROM invoices
 WHERE id = 'da100000-0000-0000-0000-0000000000c1';

DELETE FROM parent_students
 WHERE student_id = 'da100000-0000-0000-0000-0000000000d1';

DELETE FROM students
 WHERE id = 'da100000-0000-0000-0000-0000000000d1';

DELETE FROM parent_tenants
 WHERE tenant_id = 'da100000-0000-0000-0000-000000000001';

DELETE FROM parents
 WHERE profile_id = 'da100000-0000-0000-0000-0000000000b1';

-- The admin metadata carries role tenant_admin; the auth trigger may also
-- have minted a coaches row shape in other fixtures — delete defensively.
DELETE FROM coaches
 WHERE profile_id IN ('da100000-0000-0000-0000-0000000000a1',
                      'da100000-0000-0000-0000-0000000000b1');

DELETE FROM profiles
 WHERE id IN ('da100000-0000-0000-0000-0000000000a1',
              'da100000-0000-0000-0000-0000000000b1');

DELETE FROM auth.users
 WHERE id IN ('da100000-0000-0000-0000-0000000000a1',
              'da100000-0000-0000-0000-0000000000b1');

DELETE FROM tenants
 WHERE id = 'da100000-0000-0000-0000-000000000001';

COMMIT;
