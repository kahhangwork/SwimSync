-- Verification scenario: a July 2026 Saturday that was never marked.
-- Today is 2026-07-15, so July's Saturdays so far are the 4th and 11th.
-- We mark the 4th fully and leave the 11th with no session row at all.

-- Parent auth user (the handle_new_user trigger creates profiles + parents)
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'b0000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'parent@swimsync.test',
  crypt('password123', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Test Parent","role":"parent"}',
  NOW(), NOW(), '', '', '', ''
);

-- Two children, linked to the parent, enrolled since 1 July
WITH p AS (
  SELECT id FROM parents WHERE profile_id = 'b0000000-0000-0000-0000-000000000001'
), s AS (
  INSERT INTO students (full_name, assignment_status, is_active)
  VALUES ('Ana Tan', 'assigned', true), ('Ben Tan', 'assigned', true)
  RETURNING id
)
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.id FROM p CROSS JOIN s;

INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT st.id, c.id, '2026-07-01T02:00:00Z', true
FROM students st
CROSS JOIN classes c
WHERE c.title = 'Saturday Beginners';

-- Saturday 4 July: session exists, both students marked present.
WITH sess AS (
  INSERT INTO lesson_sessions (class_id, session_date, status)
  SELECT id, '2026-07-04', 'completed' FROM classes WHERE title = 'Saturday Beginners'
  RETURNING id
)
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by, marked_at)
SELECT sess.id, st.id, 'present', 'c0000000-0000-0000-0000-000000000001', NOW()
FROM sess CROSS JOIN students st;

-- Saturday 11 July: DELIBERATELY ABSENT. No lesson_sessions row, no attendance.
-- This is the lesson the coach forgot, and the whole point of the feature.

-- A third child who is NOT assigned to any class — the state a parent lands in
-- during onboarding (PRD §5.1). No enrolment, so she contributes no expected
-- lessons and is invisible to the coach/admin coverage checks; she exists so the
-- parent Attendance screen's "not assigned yet" state is reachable.
WITH p AS (
  SELECT id FROM parents WHERE profile_id = 'b0000000-0000-0000-0000-000000000001'
), s AS (
  INSERT INTO students (full_name, assignment_status, is_active)
  VALUES ('Julia Tan', 'unassigned', true)
  RETURNING id
)
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.id FROM p CROSS JOIN s;

SELECT session_date, (SELECT count(*) FROM attendance a WHERE a.lesson_session_id = ls.id) AS marked
FROM lesson_sessions ls ORDER BY session_date;
