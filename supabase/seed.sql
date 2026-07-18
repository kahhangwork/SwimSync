-- ============================================================
-- Local dev seed — runs automatically after `supabase db reset`.
-- Creates the accounts you cannot self-register in the app:
--   superadmin@swimsync.test / password123   (admin panel)
--   coach@swimsync.test      / password123   (coach app)
-- ...plus one class owned by the coach, ready for assignment.
--
-- Register a PARENT yourself in the mobile app to test onboarding, then join
-- the tenant with the join code printed at the end of this file.
-- The handle_new_user trigger creates the profiles + coaches rows.
--
-- MULTI-TENANT SHAPE: the coach is a PRIVATE COACH — a tenant of one, holding
-- both tenant_admin and coach roles (TENANCY_DESIGN.md §1). That mirrors what
-- the production backfill produces, so local testing exercises the real shape
-- rather than a simplified one. The superadmin is the PLATFORM admin: no
-- tenant, sees everything, for support.
-- ============================================================

-- ---- The tenant (one business) ----
INSERT INTO tenants (id, slug, display_name, kind, join_code, paynow_qr_url)
VALUES (
  '70000000-0000-0000-0000-000000000001',
  'kahhang-swim',
  'Coach Kah Hang Swimming Classes',
  'private',
  'SWIM-TEST',
  NULL
);

-- ---- Superadmin auth user ----
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'superadmin@swimsync.test',
  crypt('password123', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Site Admin","role":"platform_admin"}',
  NOW(), NOW(), '', '', '', ''
);

-- ---- Coach auth user ----
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'c0000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'coach@swimsync.test',
  crypt('password123', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Coach Marcus","role":"tenant_admin","is_coach":true,"tenant_id":"70000000-0000-0000-0000-000000000001"}',
  NOW(), NOW(), '', '', '', ''
);

-- ---- A class owned by the coach (Saturday 10-11am) ----
-- tenant_id is filled by the class_tenant_fill trigger from the coach.
INSERT INTO classes (
  coach_id, title, day_of_week, start_time, end_time,
  location_name, location_address, price_per_lesson
)
SELECT co.id, 'Saturday Beginners', 'saturday', '10:00', '11:00',
       'Buona Vista Swimming Complex', '76 Holland Dr, Singapore', 25.00
FROM coaches co
WHERE co.profile_id = 'c0000000-0000-0000-0000-000000000001';
