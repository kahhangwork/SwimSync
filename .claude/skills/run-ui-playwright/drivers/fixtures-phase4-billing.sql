-- Fixture for verify-tenant-branding.mjs.
--
-- Gives the seeded parent an invoice from the seed business AND one from a
-- SECOND business in the same month — the shape the old
-- UNIQUE (parent_id, billing_month) forbade outright, and the one the user
-- expects to be common (multiple kids, multiple private coaches).
--
-- Idempotent: safe to re-run against a reset database.

DO $$
DECLARE
  v_t1 UUID;
  v_t2 UUID;
  v_parent UUID;
  v_student1 UUID;
  v_student2 UUID;
  v_coach2 UUID;
BEGIN
  SELECT id INTO v_t1 FROM tenants WHERE slug = 'marcus-swim';

  -- Second business, with its own PayNow QR so the parent can be shown the
  -- WRONG payee if the resolution is broken.
  INSERT INTO tenants (slug, display_name, join_code, paynow_qr_url)
  VALUES ('harbour-swim', 'Harbour Swim Club', 'SWIM-HARB',
          'https://example.test/harbour-qr.png')
  ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO v_t2;

  UPDATE tenants SET paynow_qr_url = 'https://example.test/marcus-qr.png'
   WHERE id = v_t1 AND paynow_qr_url IS NULL;

  -- The parent. verify-tenant-branding.mjs registers them through the real UI
  -- before applying this fixture — but CI has no browser, and until 2026-08-01
  -- this fixture simply RAISEd when they were absent, which made it the one
  -- fixture check-fixture-roundtrip.sh could not load at all. So seed them here
  -- when they are missing.
  --
  -- The test is on the EMAIL, not on a uuid: registration through the UI mints a
  -- random one, so `ON CONFLICT (id)` would insert a SECOND user for the same
  -- person. The password matches the driver's ('password123') so a seeded parent
  -- is loginable and the driver works either way round.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'phase4-parent@test.local') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      'f4000000-0000-0000-0000-000000000001',
      'authenticated', 'authenticated', 'phase4-parent@test.local',
      crypt('password123', gen_salt('bf')),
      NOW(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Phase4 Parent","role":"parent"}',
      NOW(), NOW(), '', '', '', ''
    );
    -- handle_new_user fans this out into profiles + parents in the same
    -- transaction, so the lookup below finds it.
  END IF;

  SELECT p.id INTO v_parent
    FROM parents p JOIN profiles pr ON pr.id = p.profile_id
   WHERE pr.email = 'phase4-parent@test.local';

  -- Now unreachable, and kept anyway: it is the honest failure if the auth
  -- trigger ever stops creating the parents row (§7 — the trigger has broken
  -- before).
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'seed the parent phase4-parent@test.local first';
  END IF;

  INSERT INTO parent_tenants (parent_id, tenant_id) VALUES (v_parent, v_t1)
    ON CONFLICT DO NOTHING;
  INSERT INTO parent_tenants (parent_id, tenant_id) VALUES (v_parent, v_t2)
    ON CONFLICT DO NOTHING;

  INSERT INTO students (full_name, assignment_status, tenant_id)
  VALUES ('Phase4 KidA', 'assigned', v_t1) RETURNING id INTO v_student1;
  INSERT INTO students (full_name, assignment_status, tenant_id)
  VALUES ('Phase4 KidB', 'assigned', v_t2) RETURNING id INTO v_student2;

  INSERT INTO parent_students (parent_id, student_id) VALUES
    (v_parent, v_student1), (v_parent, v_student2);

  -- One invoice per business, SAME month.
  INSERT INTO invoices (parent_id, tenant_id, billing_month, gross_amount, net_amount)
  VALUES (v_parent, v_t1, '2026-06', 50.00, 50.00);
  INSERT INTO invoices (parent_id, tenant_id, billing_month, gross_amount, net_amount)
  VALUES (v_parent, v_t2, '2026-06', 80.00, 80.00);

  -- Credit at ONE business only, to prove the home total and the per-business
  -- split are both right.
  INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance)
  VALUES (v_parent, v_t2, 15.00)
  ON CONFLICT (parent_id, tenant_id) DO UPDATE SET credit_balance = 15.00;
END $$;
