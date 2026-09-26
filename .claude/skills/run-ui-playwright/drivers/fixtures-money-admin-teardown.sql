-- Teardown for fixtures-money-admin.sql — removes the MoneyAdm business and
-- everything in it, including what the DRIVER wrote (a voided credit note and
-- its audit row, a granted / voided referral reward, a saved shadow rate, a
-- payroll run).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-money-admin-teardown.sql
--
-- Scoped by the tenant id and the full 'c4000000-' block, never a 2-char
-- prefix (§7.280). Order is FK order: applications before notes, notes before
-- invoice items / invoices / sessions, payouts before sessions and coaches,
-- rewards before referrals, parents and coaches before profiles.

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM coach_payouts          WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM credit_applications    WHERE credit_note_id IN
  (SELECT id FROM credit_notes WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001');
DELETE FROM credit_notes           WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM invoice_items          WHERE invoice_id IN
  (SELECT id FROM invoices WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001');
DELETE FROM invoices               WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM referral_rewards       WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM referrals              WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM parent_tenant_balances WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM parent_tenants         WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM attendance             WHERE lesson_session_id IN
  (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'c4000000-%');
DELETE FROM lesson_sessions        WHERE class_id::text LIKE 'c4000000-%';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'c4000000-%';
DELETE FROM parent_students        WHERE student_id::text LIKE 'c4000000-%';
DELETE FROM audit_log              WHERE entity_id::text LIKE 'c4000000-%';
DELETE FROM audit_log              WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM students               WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM class_rates            WHERE class_id::text LIKE 'c4000000-%';
DELETE FROM classes                WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM locations              WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM class_categories       WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM skill_grade_levels     WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM coach_rates            WHERE coach_id IN
  (SELECT id FROM coaches WHERE profile_id::text LIKE 'c4000000-%');
UPDATE tenants SET owner_profile_id = NULL WHERE id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM coaches                WHERE profile_id::text LIKE 'c4000000-%';
DELETE FROM parents                WHERE profile_id::text LIKE 'c4000000-%';
DELETE FROM profiles               WHERE id::text LIKE 'c4000000-%';
DELETE FROM auth.users             WHERE id::text LIKE 'c4000000-%';
DELETE FROM tenants                WHERE id = 'c4000000-0000-0000-0000-000000000001';

COMMIT;

-- Expect 0, 0, 0.
SELECT (SELECT count(*) FROM tenants    WHERE id = 'c4000000-0000-0000-0000-000000000001') AS tenant,
       (SELECT count(*) FROM students   WHERE id::text LIKE 'c4000000-%')                   AS students,
       (SELECT count(*) FROM auth.users WHERE id::text LIKE 'c4000000-%')                   AS users;
