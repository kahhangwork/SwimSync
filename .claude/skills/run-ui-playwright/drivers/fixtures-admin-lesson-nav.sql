-- Fixture for verify-admin-lesson-nav.mjs — the admin lesson page's prev/next
-- strip (same coach, same date) and prev/next coach.
--
-- One coach's MORNING on today's weekday (SGT), plus one lesson a substitute
-- covers. The driver drives LAST WEEK's date (today − 7): every lesson has
-- ended and sits inside the marking window whatever hour the nightly runs.
--
--   07:00 Nav Early    Coach Marcus   Nav Pool A
--   08:00 Nav Tie      Coach Marcus   Nav Pool A  ─┐ same time AND title: the
--   08:00 Nav Tie      Coach Marcus   Nav Pool B  ─┘ order must not flip (RISK 4)
--   09:00 Nav Covered  Coach Marcus   Nav Pool A  → covered by Nav Sub on the drive
--                                                   date, so it sits in Nav Sub's
--                                                   sequence, not Marcus's
--
-- One enrolled child per class, back-dated 30 days, so each roster is exactly
-- that child — the driver uses it to prove a navigation landed on the right
-- lesson's data.
--
-- UUID prefix e9 (0 hits on `git grep -nE 'e9[0-9a-f]{6}-0000'` when written —
-- §7.280). Separate from fixtures-admin-calendar.sql on purpose: the calendar,
-- lesson-detail and cancel drivers count that fixture's lanes and lessons.
--
-- Load:
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-admin-lesson-nav.sql

-- ---- The substitute coach ----
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000','e9000000-0000-0000-0000-0000000000c2',
  'authenticated','authenticated','nav-sub@swimsync.test',
  crypt('password123', gen_salt('bf')), NOW(),  -- clock-real: auth.users stamps are real time
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Nav Sub","role":"coach","tenant_id":"70000000-0000-0000-0000-000000000001"}',
  NOW(), NOW(), '', '', '', ''  -- clock-real: auth.users stamps are real time
) ON CONFLICT (id) DO NOTHING;

-- ---- Two pools, so the two "Nav Tie" classes differ only by place ----
INSERT INTO locations (id, tenant_id, name) VALUES
  ('e9000000-0000-0000-0000-0000000010c1','70000000-0000-0000-0000-000000000001','Nav Pool A'),
  ('e9000000-0000-0000-0000-0000000010c2','70000000-0000-0000-0000-000000000001','Nav Pool B')
ON CONFLICT (id) DO NOTHING;

-- ---- Four classes on TODAY's weekday (SGT), all Coach Marcus ----
-- The class trigger seeds each one's class_rates row from 2000-01-01, so the
-- drive date resolves a teaching coach; the self-check below proves it.
INSERT INTO classes (
  id, coach_id, title, day_of_week, start_time, end_time,
  location_id, price_per_lesson, category_id, capacity, colour
)
SELECT v.id, co.id, v.title,
       lower(trim(to_char(app_today(), 'FMDay')))::day_of_week,
       v.t1::time, v.t2::time, v.loc, 25.00,
       '7c000000-0000-0000-0000-000000000002', 6, 'sky'
FROM coaches co,
     (VALUES
       ('e9000000-0000-0000-0000-000000000001'::uuid, 'Nav Early',   '07:00', '07:45', 'e9000000-0000-0000-0000-0000000010c1'::uuid),
       ('e9000000-0000-0000-0000-000000000002'::uuid, 'Nav Tie',     '08:00', '08:45', 'e9000000-0000-0000-0000-0000000010c1'::uuid),
       ('e9000000-0000-0000-0000-000000000003'::uuid, 'Nav Tie',     '08:00', '08:45', 'e9000000-0000-0000-0000-0000000010c2'::uuid),
       ('e9000000-0000-0000-0000-000000000004'::uuid, 'Nav Covered', '09:00', '09:45', 'e9000000-0000-0000-0000-0000000010c1'::uuid)
     ) AS v(id, title, t1, t2, loc)
WHERE co.profile_id = 'c0000000-0000-0000-0000-000000000001'
ON CONFLICT (id) DO NOTHING;

-- ---- One child per class ----
INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active) VALUES
  ('e9000000-0000-0000-0000-00000000a001','Navkid One','70000000-0000-0000-0000-000000000001','assigned', TRUE),
  ('e9000000-0000-0000-0000-00000000a002','Navkid Two','70000000-0000-0000-0000-000000000001','assigned', TRUE),
  ('e9000000-0000-0000-0000-00000000a003','Navkid Three','70000000-0000-0000-0000-000000000001','assigned', TRUE),
  ('e9000000-0000-0000-0000-00000000a004','Navkid Four','70000000-0000-0000-0000-000000000001','assigned', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
SELECT v.sid, v.cid, TRUE, app_now() - INTERVAL '30 days'
FROM (VALUES
  ('e9000000-0000-0000-0000-00000000a001'::uuid, 'e9000000-0000-0000-0000-000000000001'::uuid),
  ('e9000000-0000-0000-0000-00000000a002'::uuid, 'e9000000-0000-0000-0000-000000000002'::uuid),
  ('e9000000-0000-0000-0000-00000000a003'::uuid, 'e9000000-0000-0000-0000-000000000003'::uuid),
  ('e9000000-0000-0000-0000-00000000a004'::uuid, 'e9000000-0000-0000-0000-000000000004'::uuid)
) AS v(sid, cid)
WHERE NOT EXISTS (
  SELECT 1 FROM student_class_enrolments e WHERE e.student_id = v.sid AND e.class_id = v.cid
);

-- ---- The drive date's Nav Covered lesson, covered by Nav Sub ----
INSERT INTO lesson_sessions (id, class_id, session_date)
VALUES ('e9000000-0000-0000-0000-0000000005e4','e9000000-0000-0000-0000-000000000004',
        app_today() - 7)
ON CONFLICT (class_id, session_date) DO NOTHING;

INSERT INTO session_coaches (tenant_id, lesson_session_id, coach_id, assigned_by)
SELECT '70000000-0000-0000-0000-000000000001', ls.id, co.id, 'c0000000-0000-0000-0000-000000000001'
FROM lesson_sessions ls, coaches co
WHERE ls.class_id = 'e9000000-0000-0000-0000-000000000004'
  AND ls.session_date = app_today() - 7
  AND co.profile_id = 'e9000000-0000-0000-0000-0000000000c2'
ON CONFLICT (lesson_session_id, coach_id) DO NOTHING;

-- ---- Self-check: a fixture that half-worked must fail HERE, not read as a
-- product regression in the driver (§7.251, §7.62) ----
DO $$
DECLARE
  drive date := app_today() - 7;
  n int;
BEGIN
  SELECT count(*) INTO n FROM classes WHERE id::text LIKE 'e9000000-%';
  IF n <> 4 THEN RAISE EXCEPTION 'lesson-nav fixture: expected 4 classes, got %', n; END IF;

  SELECT count(*) INTO n FROM classes c
   WHERE c.id::text LIKE 'e9000000-%'
     AND NOT EXISTS (SELECT 1 FROM class_rates r WHERE r.class_id = c.id AND r.effective_from <= drive);
  IF n <> 0 THEN RAISE EXCEPTION 'lesson-nav fixture: % class(es) have no class_rates row covering %', n, drive; END IF;

  SELECT count(*) INTO n FROM session_coaches sc JOIN lesson_sessions ls ON ls.id = sc.lesson_session_id
   WHERE ls.class_id = 'e9000000-0000-0000-0000-000000000004' AND ls.session_date = drive;
  IF n <> 1 THEN RAISE EXCEPTION 'lesson-nav fixture: the Nav Covered substitute row is missing (% rows)', n; END IF;

  SELECT count(*) INTO n FROM student_class_enrolments WHERE class_id::text LIKE 'e9000000-%';
  IF n <> 4 THEN RAISE EXCEPTION 'lesson-nav fixture: expected 4 enrolments, got %', n; END IF;
END $$;

-- Expect: classes = 4, kids = 4, enrolments = 4, sessions = 1, sub = 1.
SELECT
  (SELECT count(*) FROM classes WHERE id::text LIKE 'e9000000-%')                        AS classes,
  (SELECT count(*) FROM students WHERE id::text LIKE 'e9000000-%')                       AS kids,
  (SELECT count(*) FROM student_class_enrolments WHERE class_id::text LIKE 'e9000000-%') AS enrolments,
  (SELECT count(*) FROM lesson_sessions WHERE class_id::text LIKE 'e9000000-%')          AS sessions,
  (SELECT count(*) FROM session_coaches sc JOIN lesson_sessions ls ON ls.id = sc.lesson_session_id
    WHERE ls.class_id::text LIKE 'e9000000-%')                                           AS sub;
