-- Fixture for verify-accounting-packages.mjs — package revenue on the Accounting page
-- (docs/plans/PACKAGE_REVENUE_REFUNDS_PLAN.md U1, migration 20260928000100).
--
-- WHY ITS OWN BUSINESS (§7.301). Accounting only shows SEALED months, and the current month is never sealed —
-- so a package sold by a driver today can never appear there. This fixture writes a PAST month as superuser and
-- seals it for "AcctPkg Swim" only. Never seal the seed tenant: markable_floor follows billing_periods.
--
-- Last month (SGT), AcctPkg Swim:
--   one package, total 300 DISCOUNTED to payable 270, confirmed on the 10th     → Packages sold S$270.00
--   one invoice, gross 200, package_applied 60, net 140, paid                   → invoiced S$140.00
--   no rated coaches → wages final 0                                             → Revenue = Net = S$410.00
--
-- Persona (password123): acctpkg-owner@swimsync.test — owner of AcctPkg Swim.
-- Ids: the full 'ac700000-' block (§7.280). Idempotent; teardown: fixtures-accounting-packages-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('ac700000-0000-0000-0000-000000000001','acct-packages','AcctPkg Swim','SWIM-ACPK')
ON CONFLICT (id) DO NOTHING;

-- handle_new_user builds the profile (owner of AcctPkg Swim — the first tenant_admin claims it) and the parent.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','ac700000-0000-0000-0000-00000000a001',
   'authenticated','authenticated','acctpkg-owner@swimsync.test', crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"AcctPkg Owner","role":"tenant_admin","tenant_id":"ac700000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','ac700000-0000-0000-0000-00000000b001',
   'authenticated','authenticated','acctpkg-parent@swimsync.test', crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"AcctPkg Parent","role":"parent"}',
   NOW(), NOW(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'ac700000-0000-0000-0000-000000000001' FROM parents p
 WHERE p.profile_id = 'ac700000-0000-0000-0000-00000000b001'
ON CONFLICT DO NOTHING;

INSERT INTO class_categories (id, tenant_id, name)
VALUES ('ac700000-0000-0000-0000-00000000c001','ac700000-0000-0000-0000-000000000001','AcctPkg Group')
ON CONFLICT (id) DO NOTHING;

INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count, rate_per_lesson, validity_months)
VALUES ('ac700000-0000-0000-0000-00000000d001','ac700000-0000-0000-0000-000000000001','AcctPkg Ten',
        'ac700000-0000-0000-0000-00000000c001',10,30.00,12)
ON CONFLICT (id) DO NOTHING;

-- Superuser insert: confirmed_at is honoured as written (the pin is `authenticated`-only, §7.300).
INSERT INTO parent_packages (id, parent_id, product_id, status, confirmed_at)
SELECT 'ac700000-0000-0000-0000-00000000e001', p.id, 'ac700000-0000-0000-0000-00000000d001', 'active',
       ((date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '1 month')::date + 9) + TIME '12:00')
         AT TIME ZONE 'Asia/Singapore'
  FROM parents p WHERE p.profile_id = 'ac700000-0000-0000-0000-00000000b001'
ON CONFLICT (id) DO NOTHING;
-- The discount is set AFTER the insert — the lifecycle trigger resets it on every INSERT (§7.300).
UPDATE parent_packages SET discount_amount = 30.00, amount_payable = 270.00
 WHERE id = 'ac700000-0000-0000-0000-00000000e001';

INSERT INTO invoices (id, parent_id, billing_month, gross_amount, package_applied, credit_applied,
                      balance_adjustment, net_amount, status, tenant_id, reference_number, public_token)
SELECT 'ac700000-0000-0000-0000-00000000f001', p.id,
       to_char((now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '1 month','YYYY-MM'),
       200.00, 60.00, 0, 0, 140.00, 'paid', 'ac700000-0000-0000-0000-000000000001',
       'INV-2026-9701', 'acctpkg-tok-0001'
  FROM parents p WHERE p.profile_id = 'ac700000-0000-0000-0000-00000000b001'
ON CONFLICT (id) DO NOTHING;

INSERT INTO billing_periods (billing_month, tenant_id, invoices_issued)
VALUES (to_char((now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '1 month','YYYY-MM'),
        'ac700000-0000-0000-0000-000000000001', 1)
ON CONFLICT DO NOTHING;

DO $$ BEGIN
  IF (SELECT owner_profile_id FROM tenants WHERE id = 'ac700000-0000-0000-0000-000000000001')
       IS DISTINCT FROM 'ac700000-0000-0000-0000-00000000a001' THEN
    RAISE EXCEPTION 'fixtures-accounting-packages: the persona is not the owner of AcctPkg Swim';
  END IF;
  IF (SELECT (total_value, amount_payable) FROM parent_packages WHERE id = 'ac700000-0000-0000-0000-00000000e001')
       IS DISTINCT FROM (300.00::numeric(10,2), 270.00::numeric(10,2)) THEN
    RAISE EXCEPTION 'fixtures-accounting-packages: the package is not total 300 / payable 270 — the check is vacuous';
  END IF;
END $$;

COMMIT;
