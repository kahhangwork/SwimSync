-- ============================================================
-- Local dev seed — runs automatically after `supabase db reset`.
-- Creates the accounts you cannot self-register in the app:
--   superadmin@swimsync.test / password123   (admin panel)
--   coach@swimsync.test      / password123   (coach app)
-- ...plus one class owned by the coach, ready for assignment.
--
-- Register a PARENT yourself in the mobile app to test onboarding.
-- The handle_new_user trigger creates the profiles + coaches rows.
-- ============================================================

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
  '{"full_name":"Site Admin","role":"superadmin"}',
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
  '{"full_name":"Coach Marcus","role":"coach"}',
  NOW(), NOW(), '', '', '', ''
);

-- ---- A class owned by the coach (Saturday 10-11am) ----
INSERT INTO classes (
  coach_id, title, day_of_week, start_time, end_time,
  location_name, location_address, price_per_lesson
)
SELECT co.id, 'Saturday Beginners', 'saturday', '10:00', '11:00',
       'Buona Vista Swimming Complex', '76 Holland Dr, Singapore', 25.00
FROM coaches co
WHERE co.profile_id = 'c0000000-0000-0000-0000-000000000001';
