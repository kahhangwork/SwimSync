-- Teardown for fixtures-invoice-overdue.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-invoice-overdue-teardown.sql
--
-- The driver's own writes: c1's due date (on the invoice) + its
-- invoice_due_date_changes row (ON DELETE CASCADE with the invoice), reminded_at
-- if a chat was opened, and the tenant's invoice_payment_days (on the tenant).

BEGIN;

DELETE FROM invoices WHERE tenant_id = 'da200000-0000-0000-0000-000000000001';

DELETE FROM parent_students WHERE student_id = 'da200000-0000-0000-0000-0000000000d1';
DELETE FROM students WHERE id = 'da200000-0000-0000-0000-0000000000d1';
DELETE FROM parent_tenants WHERE tenant_id = 'da200000-0000-0000-0000-000000000001';
DELETE FROM parents WHERE profile_id = 'da200000-0000-0000-0000-0000000000b1';

DELETE FROM coaches
 WHERE profile_id IN ('da200000-0000-0000-0000-0000000000a1',
                      'da200000-0000-0000-0000-0000000000a2',
                      'da200000-0000-0000-0000-0000000000b1');

DELETE FROM profiles
 WHERE id IN ('da200000-0000-0000-0000-0000000000a1',
              'da200000-0000-0000-0000-0000000000a2',
              'da200000-0000-0000-0000-0000000000b1');

DELETE FROM auth.users
 WHERE id IN ('da200000-0000-0000-0000-0000000000a1',
              'da200000-0000-0000-0000-0000000000a2',
              'da200000-0000-0000-0000-0000000000b1');

DELETE FROM tenant_role_permissions
 WHERE role_id IN (SELECT id FROM tenant_roles WHERE tenant_id = 'da200000-0000-0000-0000-000000000001');
DELETE FROM tenant_roles WHERE tenant_id = 'da200000-0000-0000-0000-000000000001';

DELETE FROM tenants WHERE id = 'da200000-0000-0000-0000-000000000001';

COMMIT;
