-- Fixture for verify-roles.mjs — owner-defined roles (ROLES_PERMISSIONS_PLAN.md
-- step 7, migrations 20260927000300–000600).
--
-- One persona: rolesdesk@swimsync.test, a PURE co-admin of the seed tenant
-- (whose owner is coach@swimsync.test). Created with no role in metadata, so
-- handle_new_user puts them on "Co-admin (as before)" — exactly where every
-- pre-roles co-admin landed. The DRIVER then creates a "Driver Viewer" role
-- through the UI and moves them onto it, then onto Full admin.
--
-- Idempotent per fixture protocol; the driver is not (it creates a role), so a
-- re-run needs fixtures-roles-teardown.sql (or the sweep's per-driver reset).

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  ('00000000-0000-0000-0000-000000000000',
   'ad200000-0000-0000-0000-00000000b001',
   'authenticated', 'authenticated', 'rolesdesk@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),  -- clock-real: auth.users stamps are real time
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Roles Desk","role":"tenant_admin","tenant_id":"70000000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', '')  -- clock-real: auth.users stamps are real time
ON CONFLICT (id) DO NOTHING;
