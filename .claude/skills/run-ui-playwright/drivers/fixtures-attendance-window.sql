-- Fixture for verify-attendance-window.mjs.
--
-- Assumes the machine clock is Thu 16 – Fri 17 Jul 2026 (the repo's July-2026
-- test present; the other fixtures assume the same window). Weekday refs:
--   Sat 11 Jul · Sun 12 Jul · Thu 16 Jul · Fri 17 Jul · Sat 18 Jul · Sun 19 Jul
--
-- One "Win" parent with two children exercises all four attendance-window states:
--   • Ana    — Saturday Beginners, enrolled 1 Jul, NO marks
--       coach roster → button targets the most recent expected Saturday (11 Jul)
--       parent      → "No lessons marked yet" (a lesson fell due, unmarked)
--   • Newkid — Sunday Newbies (new class), enrolled 16 Jul, NO marks
--       coach roster → "No lessons to mark yet" placeholder (nothing has fallen due)
--       parent      → "No lessons have taken place yet"
--
-- Load after `supabase db reset` (from repo root):
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-attendance-window.sql

-- Parent auth user (the handle_new_user trigger creates profiles + parents).
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'b0000000-0000-0000-0000-0000000000aa',
  'authenticated','authenticated','parent-win@swimsync.test',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Win Parent","role":"parent"}',
  NOW(), NOW(), '', '', '', ''
);

-- A Sunday class under the seed coach (coach@swimsync.test).
INSERT INTO classes (coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson)
SELECT co.id, 'Sunday Newbies', 'sunday', '09:00', '10:00', 'Test Pool', 40
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'coach@swimsync.test';

-- Child 1: Ana → Saturday Beginners since 1 July, no marks.
WITH p AS (SELECT id FROM parents WHERE profile_id='b0000000-0000-0000-0000-0000000000aa'),
     s AS (INSERT INTO students (full_name, assignment_status, is_active)
           VALUES ('Ana Win','assigned',true) RETURNING id)
INSERT INTO parent_students (parent_id, student_id) SELECT p.id, s.id FROM p CROSS JOIN s;

INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT st.id, c.id, '2026-07-01T02:00:00Z', true
FROM students st CROSS JOIN classes c
WHERE st.full_name='Ana Win' AND c.title='Saturday Beginners';

-- Child 2: Newkid → Sunday Newbies since 16 July (no Sunday has fallen due since), no marks.
WITH p AS (SELECT id FROM parents WHERE profile_id='b0000000-0000-0000-0000-0000000000aa'),
     s AS (INSERT INTO students (full_name, assignment_status, is_active)
           VALUES ('Newkid Win','assigned',true) RETURNING id)
INSERT INTO parent_students (parent_id, student_id) SELECT p.id, s.id FROM p CROSS JOIN s;

INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT st.id, c.id, '2026-07-16T02:00:00Z', true
FROM students st CROSS JOIN classes c
WHERE st.full_name='Newkid Win' AND c.title='Sunday Newbies';
