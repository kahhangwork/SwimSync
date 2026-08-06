-- Fixture for verify-admins.mjs — co-admin management (§8.31, 20260806000100).
--
-- The seed tenant's admin (coach@swimsync.test) claimed ownership when the
-- seed ran, so everyone below is deliberately a NON-owner: two co-admins in
-- every shape the feature distinguishes (pure, and admin-who-coaches), one
-- disposable pure admin for the typed-DELETE path, and one PLAIN COACH for
-- the panel's role gate — the account that used to get a half-working
-- read-only panel and must now get "use the SwimSync app".
--
-- Inserting auth.users rows fires handle_new_user, which builds profiles
-- (+ coaches for is_coach / role coach) AND leaves tenants.owner_profile_id
-- alone — it is already claimed. The teardown asserts that survival.
--
-- Idempotent per fixture protocol; NOTE the DRIVER is not — it deletes
-- admindelete@ and invites driver-invited@, so a re-run needs the teardown
-- (or the per-driver reset the nightly sweep does) first.

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  -- A pure co-admin: deactivation must also BAN this account.
  ('00000000-0000-0000-0000-000000000000',
   'ad100000-0000-0000-0000-00000000a001',
   'authenticated', 'authenticated', 'adminpure@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Pure Co-admin","role":"tenant_admin","tenant_id":"70000000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', ''),
  -- An admin who also coaches: deactivation must NOT ban, and "delete" means
  -- demotion to coach.
  ('00000000-0000-0000-0000-000000000000',
   'ad100000-0000-0000-0000-00000000a002',
   'authenticated', 'authenticated', 'admincoach@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Coaching Co-admin","role":"tenant_admin","tenant_id":"70000000-0000-0000-0000-000000000001","is_coach":true}',
   NOW(), NOW(), '', '', '', ''),
  -- The disposable one: unreferenced, never signs in, exists to be deleted.
  ('00000000-0000-0000-0000-000000000000',
   'ad100000-0000-0000-0000-00000000a003',
   'authenticated', 'authenticated', 'admindelete@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Deletable Admin","role":"tenant_admin","tenant_id":"70000000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', ''),
  -- A plain coach — NOT an admin. The role gate's persona.
  ('00000000-0000-0000-0000-000000000000',
   'ad100000-0000-0000-0000-00000000a004',
   'authenticated', 'authenticated', 'gatecoach@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Gate Coach","role":"coach","tenant_id":"70000000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;
