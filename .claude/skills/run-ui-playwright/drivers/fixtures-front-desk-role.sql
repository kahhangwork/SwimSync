-- Fixture for verify-front-desk-role.mjs — the hire's day, done as the hire.
-- Plan: docs/plans/WAVE4_START_DATE_FRONT_DESK_PLAN.md, Lane 2 (§2.1).
--
-- NAMED fixtures-front-desk-role.sql ON PURPOSE: run-all-drivers.sh's
-- fixture_for() resolves `fixtures-<driver>.sql` by name (§7.102). Renaming it
-- silently drops it from the nightly.
--
-- One persona: frontdesk@swimsync.test (password123), a PURE co-admin of the
-- seed tenant (owner coach@swimsync.test) on that tenant's STANDARD Front desk
-- role — Operations = Edit, every money area = None. The role is looked up by
-- (tenant_id, standard_key = 'front_desk'), never by name: the owner may rename
-- it. The DO block at the end RAISEs unless that role's permissions are exactly
-- what the driver claims to test.
--
-- Lesson data, all fixture-owned (uuid block f0de0000-…; 0 hits on
-- `git grep f0de0000-` when written — §7.280):
--
--   FD Coach Wen        a coach of the seed tenant; the PAID coach of both
--                       classes (the class trigger seeds class_rates from
--                       classes.coach_id).
--   FD Monday Squad     runs on YESTERDAY's weekday (SGT) at 07:00. Its lesson
--     (class 1)         D = yesterday is the one the driver marks. FD Alba and
--                       FD Bruno are enrolled ON D (12:00 SGT), so the expected
--                       lessons since enrolment are exactly {D} — which the
--                       driver marks (§7.103). The next one is 6 days out.
--   FD Guest Lane       same category, runs on TODAY's weekday, nobody enrolled
--     (class 2)         (so it expects nothing). The driver books Alba a make-up
--                       into its lesson a week from today.
--   FD Cara             active, in no class — the driver adds her to class 1
--                       from the Students page (check 6). Her start is today, so
--                       her first expected lesson is 6 days out.
--
-- Dates are derived from now() AT TIME ZONE 'Asia/Singapore' (no literals,
-- §7.305); D = yesterday is always ≥ session_window_start() (the 1st of LAST
-- month) — the self-check below also asserts D ≥ markable_floor(tenant).
--
-- Load:
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-front-desk-role.sql
-- Re-run: teardown first (the driver writes attendance, a make-up, an enrolment).

-- ---- The persona (a co-admin; trusted superuser path of handle_new_user) ----
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  ('00000000-0000-0000-0000-000000000000',
   'f0de0000-0000-0000-0000-00000000ad01',
   'authenticated', 'authenticated', 'frontdesk@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"FD Frontdesk","role":"tenant_admin","tenant_id":"70000000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- handle_new_user put them on "Co-admin (as before)"; move them to Front desk.
UPDATE profiles
   SET admin_role_id = (SELECT id FROM tenant_roles
                         WHERE tenant_id = '70000000-0000-0000-0000-000000000001'
                           AND standard_key = 'front_desk')
 WHERE id = 'f0de0000-0000-0000-0000-00000000ad01';

-- ---- The teaching (paid) coach ----
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000','f0de0000-0000-0000-0000-0000000000c1',
  'authenticated','authenticated','fd-coach-wen@swimsync.test',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"FD Coach Wen","role":"coach","tenant_id":"70000000-0000-0000-0000-000000000001"}',
  NOW(), NOW(), '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, tenant_id, name) VALUES
  ('f0de0000-0000-0000-0000-0000000010c1','70000000-0000-0000-0000-000000000001','FD Pool')
ON CONFLICT (id) DO NOTHING;

-- ---- Two classes, same category. Class 1 = yesterday's weekday, class 2 = today's ----
INSERT INTO classes (
  id, coach_id, title, day_of_week, start_time, end_time,
  location_id, price_per_lesson, category_id, capacity, colour
)
SELECT v.id, co.id, v.title,
       lower(trim(to_char((now() AT TIME ZONE 'Asia/Singapore')::date + v.day_offset, 'FMDay')))::day_of_week,
       '07:00'::time, '07:45'::time, 'f0de0000-0000-0000-0000-0000000010c1', 30.00,
       '7c000000-0000-0000-0000-000000000002', 6, 'sky'
FROM coaches co,
     (VALUES
       ('f0de0000-0000-0000-0000-000000000001'::uuid, 'FD Monday Squad', -1),
       ('f0de0000-0000-0000-0000-000000000002'::uuid, 'FD Guest Lane',    0)
     ) AS v(id, title, day_offset)
WHERE co.profile_id = 'f0de0000-0000-0000-0000-0000000000c1'
ON CONFLICT (id) DO NOTHING;

-- ---- Three children ----
INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active) VALUES
  ('f0de0000-0000-0000-0000-00000000a001','FD Alba', '70000000-0000-0000-0000-000000000001','assigned',   TRUE),
  ('f0de0000-0000-0000-0000-00000000a002','FD Bruno','70000000-0000-0000-0000-000000000001','assigned',   TRUE),
  ('f0de0000-0000-0000-0000-00000000a003','FD Cara', '70000000-0000-0000-0000-000000000001','unassigned', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Enrolled ON the lesson date the driver marks (§7.103), at 12:00 SGT so the
-- UTC and SGT dates agree for every reader (plan D10).
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
SELECT v.sid, 'f0de0000-0000-0000-0000-000000000001', TRUE,
       (((now() AT TIME ZONE 'Asia/Singapore')::date - 1) + TIME '12:00') AT TIME ZONE 'Asia/Singapore'
FROM (VALUES ('f0de0000-0000-0000-0000-00000000a001'::uuid),
             ('f0de0000-0000-0000-0000-00000000a002'::uuid)) AS v(sid)
WHERE NOT EXISTS (
  SELECT 1 FROM student_class_enrolments e
   WHERE e.student_id = v.sid AND e.class_id = 'f0de0000-0000-0000-0000-000000000001'
);

-- ---- Self-check: a half-worked fixture fails HERE, not in the driver (§7.251) ----
DO $$
DECLARE
  t      uuid := '70000000-0000-0000-0000-000000000001';
  d      date := (now() AT TIME ZONE 'Asia/Singapore')::date - 1;
  v_role uuid;
  v_bad  text;
  n      int;
BEGIN
  -- RISK 10: the right role, or fail loudly.
  SELECT id INTO v_role FROM tenant_roles WHERE tenant_id = t AND standard_key = 'front_desk';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'front-desk fixture: the seed tenant has no standard Front desk role';
  END IF;
  SELECT string_agg(area || '=' || level, ', ' ORDER BY area) INTO v_bad
    FROM tenant_role_permissions
   WHERE role_id = v_role
     AND NOT ((area = 'operations' AND level = 'edit')
           OR (area IN ('profile','admins','pricing','billing','packages','wages','accounting') AND level = 'none'));
  SELECT count(*) INTO n FROM tenant_role_permissions WHERE role_id = v_role;
  IF v_bad IS NOT NULL OR n <> 8 THEN
    RAISE EXCEPTION 'front-desk fixture: Front desk is not Operations=Edit + all else None (% rows; off: %)', n, v_bad;
  END IF;
  IF (SELECT admin_role_id FROM profiles WHERE id = 'f0de0000-0000-0000-0000-00000000ad01') IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'front-desk fixture: the persona is not on the Front desk role';
  END IF;
  IF EXISTS (SELECT 1 FROM tenants WHERE id = t AND owner_profile_id = 'f0de0000-0000-0000-0000-00000000ad01') THEN
    RAISE EXCEPTION 'front-desk fixture: the persona became the OWNER — owners pass every area';
  END IF;

  IF d < markable_floor(t) THEN
    RAISE EXCEPTION 'front-desk fixture: lesson date % is before the marking floor %', d, markable_floor(t);
  END IF;

  SELECT count(*) INTO n FROM classes c
   WHERE c.id::text LIKE 'f0de0000-%'
     AND EXISTS (SELECT 1 FROM class_rates r JOIN coaches co ON co.id = r.paid_coach_id
                  WHERE r.class_id = c.id AND r.effective_from <= d
                    AND co.profile_id = 'f0de0000-0000-0000-0000-0000000000c1');
  IF n <> 2 THEN
    RAISE EXCEPTION 'front-desk fixture: expected 2 classes paid to FD Coach Wen on %, got %', d, n;
  END IF;

  SELECT count(*) INTO n FROM student_class_enrolments
   WHERE class_id = 'f0de0000-0000-0000-0000-000000000001'
     AND (enrolled_at AT TIME ZONE 'Asia/Singapore')::date = d;
  IF n <> 2 THEN
    RAISE EXCEPTION 'front-desk fixture: expected 2 enrolments starting %, got %', d, n;
  END IF;
END $$;

-- Expect: classes = 2, kids = 3, enrolments = 2, role = Front desk.
SELECT
  (SELECT count(*) FROM classes WHERE id::text LIKE 'f0de0000-%')                        AS classes,
  (SELECT count(*) FROM students WHERE id::text LIKE 'f0de0000-%')                       AS kids,
  (SELECT count(*) FROM student_class_enrolments WHERE class_id::text LIKE 'f0de0000-%') AS enrolments,
  (SELECT r.name FROM profiles p JOIN tenant_roles r ON r.id = p.admin_role_id
    WHERE p.id = 'f0de0000-0000-0000-0000-00000000ad01')                                 AS role;
