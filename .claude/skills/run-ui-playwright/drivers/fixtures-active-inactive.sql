-- Fixture for verify-active-inactive.mjs: one family, two children, at the
-- seed business. Both start ACTIVE and UNASSIGNED, so the Unassigned queue is
-- a meaningful check (the regression is that an inactive child looks like a
-- new signup once 'inactive' leaves the assignment enum).
DO $$
DECLARE v_tenant UUID; v_parent UUID;
BEGIN
  SELECT id INTO v_tenant FROM tenants LIMIT 1;

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-00000000dddd',
    'authenticated','authenticated','tanfamily@test.local', crypt('x', gen_salt('bf')), now(),
    '{"provider":"email"}', '{"full_name":"Tan Family","role":"parent"}', now(), now(), '','','','')
  ON CONFLICT (id) DO NOTHING;

  SELECT id INTO v_parent FROM parents WHERE profile_id='a0000000-0000-0000-0000-00000000dddd';

  INSERT INTO parent_tenants (parent_id, tenant_id) VALUES (v_parent, v_tenant)
    ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key DO NOTHING;

  INSERT INTO students (id, full_name, assignment_status, tenant_id, is_active) VALUES
    ('5d000000-0000-0000-0000-000000000001','Ethan Tan','unassigned', v_tenant, TRUE),
    ('5d000000-0000-0000-0000-000000000002','Maya Tan','unassigned', v_tenant, TRUE)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO parent_students (parent_id, student_id) VALUES
    (v_parent,'5d000000-0000-0000-0000-000000000001'),
    (v_parent,'5d000000-0000-0000-0000-000000000002')
  ON CONFLICT DO NOTHING;
END $$;
