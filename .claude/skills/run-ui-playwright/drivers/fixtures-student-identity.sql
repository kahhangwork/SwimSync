-- Fixture for verify-student-identity.mjs.
--
-- The scenario the identity rule exists for: TWO CHILDREN WITH THE SAME NAME
-- on one roster, distinguishable only by date of birth. Plus a normally-named
-- child (ordinary age display) and one with NO DOB (the legacy row that must
-- render as "Age unknown" rather than "Age 0").
--
-- Today is pinned to 2026-07-19 by the driver, so the ages below are fixed:
--   Ethan Tan  b.2018-03-10 -> 8   (birthday passed this year)
--   Ethan Tan  b.2019-11-02 -> 6   (birthday NOT yet passed — the off-by-one
--                                   case a naive year-subtraction gets wrong)
--   Maya Tan   b.2020-07-19 -> 6   (birthday is TODAY — ages on the day)
--   Noah Lim   b.NULL       -> null
DO $$
DECLARE v_tenant UUID; v_parent UUID; v_class UUID;
BEGIN
  SELECT id INTO v_tenant FROM tenants LIMIT 1;
  SELECT id INTO v_class FROM classes WHERE title = 'Saturday Beginners';

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-00000000ade1',
    'authenticated','authenticated','identity@test.local', crypt('password123', gen_salt('bf')), now(),
    '{"provider":"email"}', '{"full_name":"Identity Parent","role":"parent"}', now(), now(), '','','','')
  ON CONFLICT (id) DO NOTHING;

  SELECT id INTO v_parent FROM parents WHERE profile_id='a0000000-0000-0000-0000-00000000ade1';

  INSERT INTO parent_tenants (parent_id, tenant_id) VALUES (v_parent, v_tenant)
    ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key DO NOTHING;

  -- Same name, different birthdays. The database permits this precisely
  -- because the identity is name + DOB, not name alone.
  INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, is_active) VALUES
    ('5e000000-0000-0000-0000-000000000001','Ethan Tan','2018-03-10','assigned', v_tenant, TRUE),
    ('5e000000-0000-0000-0000-000000000002','Ethan Tan','2019-11-02','assigned', v_tenant, TRUE),
    ('5e000000-0000-0000-0000-000000000003','Maya Tan', '2020-07-19','assigned', v_tenant, TRUE),
    ('5e000000-0000-0000-0000-000000000004','Noah Lim', NULL,        'assigned', v_tenant, TRUE)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO parent_students (parent_id, student_id) VALUES
    (v_parent,'5e000000-0000-0000-0000-000000000001'),
    (v_parent,'5e000000-0000-0000-0000-000000000002'),
    (v_parent,'5e000000-0000-0000-0000-000000000003'),
    (v_parent,'5e000000-0000-0000-0000-000000000004')
  ON CONFLICT DO NOTHING;

  INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active) VALUES
    ('5e000000-0000-0000-0000-000000000001', v_class, '2026-07-01T02:00:00Z', TRUE),
    ('5e000000-0000-0000-0000-000000000002', v_class, '2026-07-01T02:00:00Z', TRUE),
    ('5e000000-0000-0000-0000-000000000003', v_class, '2026-07-01T02:00:00Z', TRUE),
    ('5e000000-0000-0000-0000-000000000004', v_class, '2026-07-01T02:00:00Z', TRUE)
  ON CONFLICT DO NOTHING;
END $$;

SELECT full_name, date_of_birth FROM students ORDER BY full_name, date_of_birth;
