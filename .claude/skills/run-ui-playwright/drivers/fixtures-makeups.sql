-- Fixture for verify-makeups.mjs.
--
-- The situation: a make-up is a BOOKING into ANOTHER same-category class — an
-- enrolled child guesting one lesson. The seed has one class ("Saturday
-- Beginners", Default Group), so this fixture adds the OTHER half of the
-- shape: a second Default Group class on SUNDAY (the child's home class,
-- cheaper than the host so the home-rate rule is observable), and an enrolled,
-- claimed child in it. The driver books the make-up through the real UI —
-- deliberately no makeup_bookings row here.
--
-- Load:
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-makeups.sql

-- ---- The parent ----
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000','7e000000-0000-0000-0000-0000000000d1',
  'authenticated','authenticated','makeupvis-parent@swimsync.test',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Makeupvis Parent","role":"parent"}',
  NOW(), NOW(), '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '70000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = '7e000000-0000-0000-0000-0000000000d1'
ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key DO NOTHING;

-- ---- The HOME class and the HOST class: same category, different days ----
-- Both get FIXED ids so the driver can deep-link (§7.58: tapping through the
-- tab navigator force-clicks whatever screen physically overlays; a fixed-id
-- gotoAuthed URL is the reliable route, the verify-attendance-guard pattern).
-- Home is cheaper than host ($20 vs $25) so a wrongly-host-priced make-up
-- line would be visibly wrong. tenant_id comes from class_tenant_fill.
INSERT INTO classes (
  id, coach_id, title, day_of_week, start_time, end_time,
  location_name, price_per_lesson, category_id
)
SELECT v.id, co.id, v.title, v.dow::day_of_week, v.t1::time, v.t2::time,
       'Test Pool', v.price, '7c000000-0000-0000-0000-000000000002'
FROM coaches co,
     (VALUES
       ('7e0c1a55-0000-0000-0000-000000000001'::uuid, 'Makeup Home Sunday',
        'sunday',   '09:00', '10:00', 20.00),
       ('7e0c1a55-0000-0000-0000-000000000002'::uuid, 'Makeup Host Saturday',
        'saturday', '11:00', '12:00', 25.00)
     ) AS v(id, title, dow, t1, t2, price)
WHERE co.profile_id = 'c0000000-0000-0000-0000-000000000001'
ON CONFLICT (id) DO NOTHING;

-- ---- The child: enrolled in the home class, claimed by the parent ----
INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active)
VALUES ('7e099999-0000-0000-0000-000000000001','Makeupvis Kid',
        '70000000-0000-0000-0000-000000000001','assigned', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '7e099999-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = '7e000000-0000-0000-0000-0000000000d1'
ON CONFLICT (parent_id, student_id) DO NOTHING;

INSERT INTO student_class_enrolments (student_id, class_id, is_active)
SELECT '7e099999-0000-0000-0000-000000000001',
       '7e0c1a55-0000-0000-0000-000000000001', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM student_class_enrolments
   WHERE student_id = '7e099999-0000-0000-0000-000000000001' AND is_active
);

-- ---- An off-schedule HOST session TODAY (SGT) ----
-- schedule_extra_lesson()'s shape. This is what lets the driver book the
-- make-up for TODAY whatever weekday it is, so the coach marking-screen
-- checks run on every run instead of only on Saturdays — and it exercises
-- book_makeup()'s existing-session branch through the real UI. Date derived
-- in SGT, never CURRENT_DATE (UTC is yesterday before 08:00 SGT).
INSERT INTO lesson_sessions (class_id, session_date, off_schedule_reason)
VALUES ('7e0c1a55-0000-0000-0000-000000000002',
        (now() AT TIME ZONE 'Asia/Singapore')::date,
        'driver: make-up marking today')
ON CONFLICT (class_id, session_date) DO NOTHING;

-- Expect: kid = 1, fixture_classes = 2, enrolment = 1.
SELECT
  (SELECT count(*) FROM students
    WHERE id = '7e099999-0000-0000-0000-000000000001')                    AS kid,
  (SELECT count(*) FROM classes
    WHERE id::text LIKE '7e0c1a55-%')                                     AS fixture_classes,
  (SELECT count(*) FROM student_class_enrolments
    WHERE student_id = '7e099999-0000-0000-0000-000000000001'
      AND is_active)                                                      AS enrolment;
