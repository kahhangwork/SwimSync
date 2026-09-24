-- Fixture for verify-app-money.mjs (the parent money actions no other driver
-- presses — promoted from docs/refactor/app-fgh-handchecks-G.mjs).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-app-money.sql
--
-- Its OWN tenant, so the driver never rewrites a seed row (the hand-check set
-- the seed tenant's paynow_mobile and needed two sibling fixtures loaded):
--   • a PayNow MOBILE proxy — the package page builds a dynamic QR from it
--   • one parent + child, the parent's membership carrying a KNOWN referral
--     code (the insert trigger mints a random one; this overwrites it)
--   • one OUTSTANDING, UNCLAIMED invoice with explicit reference + token, so
--     the tenant's invoice counter is never touched
--   • one active package product, for "Request & pay"
--
-- Idempotent, and RESETS the driver's side effects: the invoice back to
-- outstanding/unclaimed and every package request the parent made removed.

BEGIN;

INSERT INTO tenants (id, slug, display_name, join_code, paynow_mobile)
VALUES ('ac300000-0000-0000-0000-000000000001','app-money','App Money Swim',
        'SWIM-APPM','91234567')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','ac300000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','app-money-parent@swimsync.test',
   crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"App Money Parent","role":"parent"}',
   now(), now(), '','','','')
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'ac300000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = 'ac300000-0000-0000-0000-0000000000b1'
ON CONFLICT DO NOTHING;

UPDATE parent_tenants SET referral_code = 'REF-APPM1', referral_code_disabled_at = NULL
 WHERE tenant_id = 'ac300000-0000-0000-0000-000000000001';

INSERT INTO students (id, full_name, date_of_birth, assignment_status, is_active, tenant_id)
VALUES ('ac300000-0000-0000-0000-0000000000d1','Money Driver Kid','2018-07-07',
        'assigned', TRUE, 'ac300000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'ac300000-0000-0000-0000-0000000000d1'
  FROM parents p WHERE p.profile_id = 'ac300000-0000-0000-0000-0000000000b1'
ON CONFLICT DO NOTHING;

INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount,
                      net_amount, reference_number, public_token)
SELECT 'ac300000-0000-0000-0000-0000000000c1', p.id,
       'ac300000-0000-0000-0000-000000000001', '2026-06', 88.00, 88.00,
       'INV-2026-9931', 'ac300000c0ffee00ac300000c0ffee00'
  FROM parents p WHERE p.profile_id = 'ac300000-0000-0000-0000-0000000000b1'
ON CONFLICT (id) DO NOTHING;

-- category NULL = valid for all the business's classes (the private-coach shape).
INSERT INTO package_products (id, tenant_id, name, lesson_count, rate_per_lesson, validity_weeks)
VALUES ('ac300000-0000-0000-0000-0000000000e1','ac300000-0000-0000-0000-000000000001',
        'App Money 4-Pack', 4, 30.00, 8)
ON CONFLICT (id) DO NOTHING;

-- Reset a previous run's side effects.
DELETE FROM payment_records
 WHERE invoice_id = 'ac300000-0000-0000-0000-0000000000c1';
UPDATE invoices
   SET status = 'outstanding', paid_at = NULL, paid_marked_by = NULL,
       paid_claimed_at = NULL, reminded_at = NULL
 WHERE id = 'ac300000-0000-0000-0000-0000000000c1';
DELETE FROM parent_packages
 WHERE tenant_id = 'ac300000-0000-0000-0000-000000000001';

COMMIT;
