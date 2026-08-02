-- Fixture for verify-payment-collection.mjs (payment collection, PRD §7.21).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-payment-collection.sql
--
-- One tenant with a PayNow MOBILE proxy (the production shape — a private
-- coach on a personal number), one admin, one parent WITH a phone number,
-- and one outstanding invoice with a KNOWN reference + public token so the
-- driver can deep-link the tokenized page. Reference and token are supplied
-- explicitly — the assign trigger only fills NULLs — so the tenant's
-- invoice_counter is never touched and the round-trip footprint stays clean.
--
-- Idempotent, and RESETS driver side effects: a previous run leaves the
-- invoice paid/claimed with a payment_records row; reloading this fixture
-- puts it back to outstanding.

BEGIN;

INSERT INTO tenants (id, slug, display_name, join_code, paynow_mobile)
VALUES ('da100000-0000-0000-0000-000000000001','pay-driver','Pay Driver Swim',
        'SWIM-PAYD','91234567')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','da100000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','pay-driver-admin@swimsync.test',
   crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Pay Driver Admin","role":"tenant_admin","tenant_id":"da100000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','da100000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','pay-driver-parent@swimsync.test',
   crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Pay Driver Parent","role":"parent"}',
   now(), now(), '','','','')
ON CONFLICT (id) DO NOTHING;

-- The parent's phone is what the WhatsApp button dials — set it on the
-- trigger-created profile.
UPDATE profiles SET phone = '91112222'
 WHERE id = 'da100000-0000-0000-0000-0000000000b1';

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'da100000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = 'da100000-0000-0000-0000-0000000000b1'
ON CONFLICT DO NOTHING;

-- The admin can only read a parent's profile (name, PHONE — what the
-- WhatsApp button dials) through tenant_serves_parent(), which requires a
-- CHILD in the tenant — parent_tenants membership alone is not enough.
INSERT INTO students (id, full_name, assignment_status, tenant_id)
VALUES ('da100000-0000-0000-0000-0000000000d1','Pay Driver Kid','assigned',
        'da100000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'da100000-0000-0000-0000-0000000000d1'
  FROM parents p WHERE p.profile_id = 'da100000-0000-0000-0000-0000000000b1'
ON CONFLICT DO NOTHING;

INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount,
                      net_amount, reference_number, public_token)
SELECT 'da100000-0000-0000-0000-0000000000c1', p.id,
       'da100000-0000-0000-0000-000000000001', '2026-06', 88.00, 88.00,
       'INV-2026-9901', 'da100000c0ffee00da100000c0ffee00'
  FROM parents p WHERE p.profile_id = 'da100000-0000-0000-0000-0000000000b1'
ON CONFLICT (id) DO NOTHING;

-- Reset a previous run's side effects (paid/claimed/reminded + audit row).
DELETE FROM payment_records
 WHERE invoice_id = 'da100000-0000-0000-0000-0000000000c1';
UPDATE invoices
   SET status = 'outstanding', paid_at = NULL, paid_marked_by = NULL,
       paid_claimed_at = NULL, reminded_at = NULL
 WHERE id = 'da100000-0000-0000-0000-0000000000c1';

COMMIT;
