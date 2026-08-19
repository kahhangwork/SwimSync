-- Fixture for verify-admin-calendar.mjs.
--
-- The situation the calendar exists for: several classes at the SAME time, so the
-- admin can see by colour and count which one has a slot for a make-up. Two
-- fixture classes run on TODAY's weekday (SGT) and overlap (10:00–11:00 and
-- 10:30–11:30), so the day view has two lanes on every run regardless of the
-- weekday. One is FULL (capacity 3, three enrolled) and rose; the other is
-- emerald, capacity 6 via the class override, has one enrolled child and a
-- MAKE-UP guest booked for today ("1+1/6"), and a SUBSTITUTE coach on today's
-- lesson. Last week's lesson of the full class was marked for two of three
-- children (partial → dashed border, "2/3 marked").
--
-- ⚠ The driver must not create rows. The teardown's final SELECT reports the
-- lesson_sessions count for these classes; the driver asserts it is unchanged
-- after the whole run (the calendar is READ-ONLY — ADMIN_CALENDAR_PLAN RISK 4).
--
-- Load:
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-admin-calendar.sql

-- ---- A second coach, to be today's substitute on the emerald class ----
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000','ca100000-0000-0000-0000-0000000000c2',
  'authenticated','authenticated','calendar-sub@swimsync.test',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Calendar Sub","role":"coach","tenant_id":"70000000-0000-0000-0000-000000000001"}',
  NOW(), NOW(), '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- ---- Two overlapping classes on TODAY's weekday (SGT) ----
INSERT INTO classes (
  id, coach_id, title, day_of_week, start_time, end_time,
  location_name, price_per_lesson, category_id, capacity, colour
)
SELECT v.id, co.id, v.title,
       lower(trim(to_char((now() AT TIME ZONE 'Asia/Singapore')::date, 'FMDay')))::day_of_week,
       v.t1::time, v.t2::time, 'Calendar Pool', 25.00,
       '7c000000-0000-0000-0000-000000000002', v.cap, v.colour
FROM coaches co,
     (VALUES
       ('ca1c1a55-0000-0000-0000-000000000001'::uuid, 'Cal Rose Full',    '10:00', '11:00', 3, 'rose'),
       ('ca1c1a55-0000-0000-0000-000000000002'::uuid, 'Cal Emerald Open', '10:30', '11:30', 6, 'emerald')
     ) AS v(id, title, t1, t2, cap, colour)
WHERE co.profile_id = 'c0000000-0000-0000-0000-000000000001'
ON CONFLICT (id) DO NOTHING;

-- ---- Children ----
INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active) VALUES
  ('ca199999-0000-0000-0000-000000000001','Calkid Alpha','70000000-0000-0000-0000-000000000001','assigned', TRUE),
  ('ca199999-0000-0000-0000-000000000002','Calkid Bravo','70000000-0000-0000-0000-000000000001','assigned', TRUE),
  ('ca199999-0000-0000-0000-000000000003','Calkid Charlie','70000000-0000-0000-0000-000000000001','assigned', TRUE),
  ('ca199999-0000-0000-0000-000000000004','Calkid Delta','70000000-0000-0000-0000-000000000001','assigned', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Alpha, Bravo, Charlie → Rose (full). Delta → Emerald. Back-dated 30 days so
-- last week's lesson has an expected roster.
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
SELECT v.sid, v.cid, TRUE, now() - INTERVAL '30 days'
FROM (VALUES
  ('ca199999-0000-0000-0000-000000000001'::uuid, 'ca1c1a55-0000-0000-0000-000000000001'::uuid),
  ('ca199999-0000-0000-0000-000000000002'::uuid, 'ca1c1a55-0000-0000-0000-000000000001'::uuid),
  ('ca199999-0000-0000-0000-000000000003'::uuid, 'ca1c1a55-0000-0000-0000-000000000001'::uuid),
  ('ca199999-0000-0000-0000-000000000004'::uuid, 'ca1c1a55-0000-0000-0000-000000000002'::uuid)
) AS v(sid, cid)
WHERE NOT EXISTS (
  SELECT 1 FROM student_class_enrolments e WHERE e.student_id = v.sid AND e.class_id = v.cid
);

-- ---- Alpha guests into Emerald TODAY as a make-up ("1+1/6") ----
INSERT INTO makeup_bookings (tenant_id, student_id, class_id, session_date, category_id, home_class_id, booked_by)
SELECT '70000000-0000-0000-0000-000000000001',
       'ca199999-0000-0000-0000-000000000001',
       'ca1c1a55-0000-0000-0000-000000000002',
       (now() AT TIME ZONE 'Asia/Singapore')::date,
       '7c000000-0000-0000-0000-000000000002',
       'ca1c1a55-0000-0000-0000-000000000001',
       'c0000000-0000-0000-0000-000000000001'
WHERE NOT EXISTS (
  SELECT 1 FROM makeup_bookings
   WHERE student_id = 'ca199999-0000-0000-0000-000000000001'
     AND class_id   = 'ca1c1a55-0000-0000-0000-000000000002'
     AND session_date = (now() AT TIME ZONE 'Asia/Singapore')::date
     AND cancelled_at IS NULL
);

-- ---- Today's Emerald lesson exists (seeded as postgres) with a SUBSTITUTE ----
INSERT INTO lesson_sessions (id, class_id, session_date)
VALUES ('ca15e555-0000-0000-0000-000000000002','ca1c1a55-0000-0000-0000-000000000002',
        (now() AT TIME ZONE 'Asia/Singapore')::date)
ON CONFLICT (class_id, session_date) DO NOTHING;

INSERT INTO session_coaches (tenant_id, lesson_session_id, coach_id, assigned_by)
SELECT '70000000-0000-0000-0000-000000000001', ls.id, co.id, 'c0000000-0000-0000-0000-000000000001'
FROM lesson_sessions ls, coaches co
WHERE ls.class_id = 'ca1c1a55-0000-0000-0000-000000000002'
  AND ls.session_date = (now() AT TIME ZONE 'Asia/Singapore')::date
  AND co.profile_id = 'ca100000-0000-0000-0000-0000000000c2'
ON CONFLICT (lesson_session_id, coach_id) DO NOTHING;

-- ---- Last week's Rose lesson: two of three marked (partial) ----
INSERT INTO lesson_sessions (id, class_id, session_date)
VALUES ('ca15e555-0000-0000-0000-000000000001','ca1c1a55-0000-0000-0000-000000000001',
        (now() AT TIME ZONE 'Asia/Singapore')::date - 7)
ON CONFLICT (class_id, session_date) DO NOTHING;

INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
SELECT ls.id, v.sid, v.st::attendance_status, 'c0000000-0000-0000-0000-000000000001'
FROM lesson_sessions ls,
     (VALUES ('ca199999-0000-0000-0000-000000000001'::uuid, 'present'),
             ('ca199999-0000-0000-0000-000000000002'::uuid, 'absent')) AS v(sid, st)
WHERE ls.class_id = 'ca1c1a55-0000-0000-0000-000000000001'
  AND ls.session_date = (now() AT TIME ZONE 'Asia/Singapore')::date - 7
ON CONFLICT (lesson_session_id, student_id) DO NOTHING;

-- Expect: classes = 2, kids = 4, enrolments = 4, makeup = 1, sessions = 2, sub = 1, marks = 2.
SELECT
  (SELECT count(*) FROM classes WHERE id::text LIKE 'ca1c1a55-%')                          AS classes,
  (SELECT count(*) FROM students WHERE id::text LIKE 'ca199999-%')                         AS kids,
  (SELECT count(*) FROM student_class_enrolments WHERE class_id::text LIKE 'ca1c1a55-%')   AS enrolments,
  (SELECT count(*) FROM makeup_bookings WHERE class_id::text LIKE 'ca1c1a55-%')            AS makeup,
  (SELECT count(*) FROM lesson_sessions WHERE class_id::text LIKE 'ca1c1a55-%')            AS sessions,
  (SELECT count(*) FROM session_coaches sc JOIN lesson_sessions ls ON ls.id = sc.lesson_session_id
    WHERE ls.class_id::text LIKE 'ca1c1a55-%')                                             AS sub,
  (SELECT count(*) FROM attendance a JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
    WHERE ls.class_id::text LIKE 'ca1c1a55-%')                                             AS marks;
