-- Fixture for verify-invoice-overdue.mjs — due dates and Overdue end to end
-- (docs/plans/OVERDUE_INVOICES_PLAN.md Unit 5, migration 20261112000100).
--
-- NAMED fixtures-invoice-overdue.sql ON PURPOSE: run-all-drivers.sh resolves
-- `fixtures-<driver>.sql` by name (§7.102).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-invoice-overdue.sql
--
-- One business (14 days to pay, the default), a billing-EDIT admin (the
-- trusted-superuser path puts them on "Co-admin (as before)"), a billing-VIEW
-- admin on a fixture-owned role, one parent with a phone, and four outstanding
-- invoices. Overdue comes from the FIXTURE, never from a pinned future clock
-- (--now replays only the past, §7.360): each invoice's generated_at is
-- BACKDATED from app_now(), and the insert trigger derives its due date.
--
--   c1  INV-2026-9921  generated 20 days ago → due 6 days ago   → OVERDUE (the admin moves it)
--   c2  INV-2026-9922  generated 20 days ago, claimed           → CLAIMED (beats Overdue, D4)
--   c3  INV-2026-9923  generated 14 days ago → due TODAY        → OUTSTANDING (the boundary)
--   c4  INV-2026-9924  generated 30 days ago → due 16 days ago  → OVERDUE (parent + public page)
--
-- uuid block da200000-… (0 hits on `git grep da200000-` when written, §7.280).
-- Reference and token are supplied explicitly so the tenant counter is never
-- touched. Re-run: teardown first (the driver moves c1's due date).

BEGIN;

INSERT INTO tenants (id, slug, display_name, join_code, paynow_mobile)
VALUES ('da200000-0000-0000-0000-000000000001', 'overdue-driver', 'Overdue Driver Swim',
        'SWIM-OVRD', '91234567')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','da200000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','overdue-driver-admin@swimsync.test',
   crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}',  -- clock-real: auth.users stamps are real time
   '{"full_name":"Overdue Driver Admin","role":"tenant_admin","tenant_id":"da200000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),  -- clock-real: auth.users stamps are real time
  ('00000000-0000-0000-0000-000000000000','da200000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','overdue-driver-viewer@swimsync.test',
   crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}',  -- clock-real: auth.users stamps are real time
   '{"full_name":"Overdue Driver Viewer","role":"tenant_admin","tenant_id":"da200000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),  -- clock-real: auth.users stamps are real time
  ('00000000-0000-0000-0000-000000000000','da200000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','overdue-driver-parent@swimsync.test',
   crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}',  -- clock-real: auth.users stamps are real time
   '{"full_name":"Overdue Driver Parent","role":"parent"}',
   now(), now(), '','','','')  -- clock-real: auth.users stamps are real time
ON CONFLICT (id) DO NOTHING;

-- A billing-VIEW role (no standard role is view-only on billing): Operations
-- view (the grid rule) + Billing view, every other area none.
INSERT INTO tenant_roles (id, tenant_id, name)
VALUES ('da200000-0000-0000-0000-0000000000e1', 'da200000-0000-0000-0000-000000000001', 'Billing viewer')
ON CONFLICT (id) DO NOTHING;
INSERT INTO tenant_role_permissions (role_id, area, level)
SELECT 'da200000-0000-0000-0000-0000000000e1', a.area::admin_area,
       (CASE a.area WHEN 'operations' THEN 'view' WHEN 'billing' THEN 'view' ELSE 'none' END)::admin_level
  FROM unnest(ARRAY['operations','profile','admins','pricing','billing','packages','wages','accounting']) AS a(area)
ON CONFLICT DO NOTHING;
UPDATE profiles SET admin_role_id = 'da200000-0000-0000-0000-0000000000e1'
 WHERE id = 'da200000-0000-0000-0000-0000000000a2';

UPDATE profiles SET phone = '91113333'
 WHERE id = 'da200000-0000-0000-0000-0000000000b1';

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'da200000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = 'da200000-0000-0000-0000-0000000000b1'
ON CONFLICT DO NOTHING;

INSERT INTO students (id, full_name, assignment_status, tenant_id)
VALUES ('da200000-0000-0000-0000-0000000000d1', 'Overdue Driver Kid', 'assigned',
        'da200000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'da200000-0000-0000-0000-0000000000d1'
  FROM parents p WHERE p.profile_id = 'da200000-0000-0000-0000-0000000000b1'
ON CONFLICT DO NOTHING;

-- due_date is NOT given: the insert trigger derives it from generated_at.
INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount, net_amount,
                      reference_number, public_token, generated_at, paid_claimed_at)
SELECT v.id::uuid, p.id, 'da200000-0000-0000-0000-000000000001', v.month, v.amt, v.amt,
       v.ref, v.tok, app_now() - v.age, CASE WHEN v.claimed THEN app_now() - interval '1 day' END
  FROM parents p,
       (VALUES
         ('da200000-0000-0000-0000-0000000000c1', '2026-01', 61.00, 'INV-2026-9921', 'da200000c0ffee00da200000c0ffee01', interval '20 days', false),
         ('da200000-0000-0000-0000-0000000000c2', '2026-02', 62.00, 'INV-2026-9922', 'da200000c0ffee00da200000c0ffee02', interval '20 days', true),
         ('da200000-0000-0000-0000-0000000000c3', '2026-03', 63.00, 'INV-2026-9923', 'da200000c0ffee00da200000c0ffee03', interval '14 days', false),
         ('da200000-0000-0000-0000-0000000000c4', '2026-04', 64.00, 'INV-2026-9924', 'da200000c0ffee00da200000c0ffee04', interval '30 days', false)
       ) AS v(id, month, amt, ref, tok, age, claimed)
 WHERE p.profile_id = 'da200000-0000-0000-0000-0000000000b1'
ON CONFLICT (id) DO NOTHING;

-- Self-check: the four states the driver claims to test, from the database's own verdict.
DO $$
DECLARE v TEXT;
BEGIN
  SELECT string_agg(reference_number || '=' || CASE WHEN i.paid_claimed_at IS NOT NULL THEN 'claimed'
                                                    WHEN is_overdue(i) THEN 'overdue' ELSE 'due' END, ','
                    ORDER BY reference_number)
    INTO v FROM invoices i WHERE tenant_id = 'da200000-0000-0000-0000-000000000001';
  IF v IS DISTINCT FROM 'INV-2026-9921=overdue,INV-2026-9922=claimed,INV-2026-9923=due,INV-2026-9924=overdue' THEN
    RAISE EXCEPTION 'fixtures-invoice-overdue: unexpected states %', v;
  END IF;
  IF (SELECT due_date FROM invoices WHERE id = 'da200000-0000-0000-0000-0000000000c3')
     IS DISTINCT FROM app_today() THEN
    RAISE EXCEPTION 'fixtures-invoice-overdue: c3 must be due today';
  END IF;
END $$;

COMMIT;
