-- Fixture for verify-coach-schedule-roles.mjs — the coach Schedule tab's role
-- badges, location chips (and their clamp), and a DONE row's tap
-- (BACKLOG → Foundations; docs/plans/DRIVER_BACKLOG_PLAN.md U11). Promotes the
-- old docs/refactor coach-schedule hand-check, whose SQL was layered on top of
-- fixtures-coach-roster.sql and wrote into the SEED tenant as the seed coach —
-- this owns everything.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-coach-schedule-roles.sql
--
-- ITS OWN BUSINESS ("CoachSched Swim", prefix d8000000-), never billed. Three
-- PLAIN coaches (role 'coach', none an admin, §7.131):
--   CoachSched Owner   owns both classes
--   CoachSched Sub     the rostered SUBSTITUTE on today's Covered lesson
--   CoachSched Shadow  the ACTIVE class shadow of the Shadowed class
--
-- BOTH CLASSES RUN ON TODAY'S WEEKDAY (today_sg(), re-asserted on every load
-- because the weekday moves daily), at times unambiguously AFTER 12:00 — the
-- driver pins the browser clock to 12:00 SGT (plan rule 13), so both of
-- today's lessons are upcoming and unmarked at any real hour:
--   CoachSched Covered   16:00–17:00 at CoachSched North. Today's lesson EXISTS
--                        and CoachSched Sub holds its session_coaches row →
--                        Sub sees "Covering" + Mark Attendance, the Owner sees
--                        "Covered" + View lesson.
--   CoachSched Shadowed  17:30–18:15 at CoachSched South. CoachSched Shadow is
--                        its active shadow → "Shadowing" + View lesson.
-- TWO LOCATIONS, so the Owner's week shows the location chips.
--
-- THE DONE ROW: the Shadowed class's lesson 7 days ago (last week, same
-- weekday) EXISTS with its one expected child MARKED present — so it is filed
-- under DONE (never NEEDS MARKING) in the Owner's "Last week" view. The
-- Covered class's child is enrolled only 3 days ago, so its lesson 7 days ago
-- expects nobody and nags nobody. Nothing else is expected anywhere in the
-- markable window, so the Owner has NO needs-marking row at all.
--
-- IDEMPOTENT AND RESETTING: re-loading puts both classes back to active (the
-- driver's clamp step retires the Covered class mid-run and restores it in a
-- `finally`; a crash between the two is undone here), and rebuilds every
-- session / attendance / roster row. Teardown: fixtures-coach-schedule-roles-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

-- ── The business and its people ─────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('d8000000-0000-0000-0000-000000000001','coach-sched','CoachSched Swim','SWIM-CSCH')
ON CONFLICT (id) DO NOTHING;

-- handle_new_user builds profiles + coaches from raw_user_meta_data.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
 ('00000000-0000-0000-0000-000000000000','d8000000-0000-0000-0000-0000000000a1',
  'authenticated','authenticated','coach-sched-owner@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"CoachSched Owner","role":"coach","tenant_id":"d8000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','d8000000-0000-0000-0000-0000000000a2',
  'authenticated','authenticated','coach-sched-sub@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"CoachSched Sub","role":"coach","tenant_id":"d8000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','d8000000-0000-0000-0000-0000000000a3',
  'authenticated','authenticated','coach-sched-shadow@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"CoachSched Shadow","role":"coach","tenant_id":"d8000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','','')
ON CONFLICT (id) DO NOTHING;

INSERT INTO class_categories (id, tenant_id, name)
VALUES ('d8000000-0000-0000-0000-00000000cc01','d8000000-0000-0000-0000-000000000001','CoachSched Group')
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, tenant_id, name)
VALUES ('d8000000-0000-0000-0000-0000000010c1','d8000000-0000-0000-0000-000000000001','CoachSched North'),
       ('d8000000-0000-0000-0000-0000000010c2','d8000000-0000-0000-0000-000000000001','CoachSched South')
ON CONFLICT (id) DO NOTHING;

-- ── Reset: every session-hung row on the fixture's classes ──────────────────
DELETE FROM audit_log
 WHERE tenant_id = 'd8000000-0000-0000-0000-000000000001'
    OR entity_id IN (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'd8000000-%');
DELETE FROM session_coaches
 WHERE lesson_session_id IN (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'd8000000-%');
DELETE FROM attendance
 WHERE lesson_session_id IN (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'd8000000-%');
DELETE FROM lesson_sessions WHERE class_id::text LIKE 'd8000000-%';

-- ── Everything keyed on a random coaches.id, or on today ────────────────────
DO $$
DECLARE
  t      CONSTANT uuid := 'd8000000-0000-0000-0000-000000000001';
  v_own  uuid;
  v_sub  uuid;
  v_sh   uuid;
  v_sg   date := today_sg();
  v_dow  day_of_week;
BEGIN
  SELECT id INTO v_own FROM coaches WHERE profile_id = 'd8000000-0000-0000-0000-0000000000a1';
  SELECT id INTO v_sub FROM coaches WHERE profile_id = 'd8000000-0000-0000-0000-0000000000a2';
  SELECT id INTO v_sh  FROM coaches WHERE profile_id = 'd8000000-0000-0000-0000-0000000000a3';
  IF v_own IS NULL OR v_sub IS NULL OR v_sh IS NULL THEN
    RAISE EXCEPTION 'fixture: owner/sub/shadow coach rows were not created by the auth trigger';
  END IF;
  v_dow := lower(trim(to_char(v_sg, 'FMDay')))::day_of_week;

  INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                       end_time, location_id, price_per_lesson, category_id, is_active)
  SELECT v.id, t, v_own, v.title, v_dow, v.st, v.et, v.loc, 30.00,
         'd8000000-0000-0000-0000-00000000cc01', TRUE
    FROM (VALUES
      ('d8000000-0000-0000-0000-0000000000c1'::uuid,'CoachSched Covered', '16:00'::time,'17:00'::time,
       'd8000000-0000-0000-0000-0000000010c1'::uuid),
      ('d8000000-0000-0000-0000-0000000000c2'::uuid,'CoachSched Shadowed','17:30'::time,'18:15'::time,
       'd8000000-0000-0000-0000-0000000010c2'::uuid)
    ) AS v(id, title, st, et, loc)
  ON CONFLICT (id) DO UPDATE SET day_of_week = EXCLUDED.day_of_week, coach_id = EXCLUDED.coach_id,
                                 start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
                                 location_id = EXCLUDED.location_id,
                                 is_active = TRUE, deactivated_at = NULL;

  INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active)
  VALUES ('d8000000-0000-0000-0000-0000000000d1','CoachSched Coverkid',  t,'assigned',TRUE),
         ('d8000000-0000-0000-0000-0000000000d2','CoachSched Shadowkid', t,'assigned',TRUE)
  ON CONFLICT (id) DO UPDATE SET is_active = TRUE, assignment_status = 'assigned';

  DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'd8000000-%';
  INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
  VALUES ('d8000000-0000-0000-0000-0000000000d1','d8000000-0000-0000-0000-0000000000c1', TRUE, v_sg - 3),
         ('d8000000-0000-0000-0000-0000000000d2','d8000000-0000-0000-0000-0000000000c2', TRUE, v_sg - 10);

  -- TODAY's Covered lesson, with CoachSched Sub as its substitute.
  INSERT INTO lesson_sessions (id, class_id, session_date, status)
  VALUES ('d8000000-0000-0000-0000-0000000000e1','d8000000-0000-0000-0000-0000000000c1', v_sg, 'scheduled');
  INSERT INTO session_coaches (id, tenant_id, lesson_session_id, coach_id)
  VALUES ('d8000000-0000-0000-0000-0000000005c1', t, 'd8000000-0000-0000-0000-0000000000e1', v_sub);

  -- LAST WEEK's Shadowed lesson, its one child MARKED present → DONE.
  INSERT INTO lesson_sessions (id, class_id, session_date, status)
  VALUES ('d8000000-0000-0000-0000-0000000000e2','d8000000-0000-0000-0000-0000000000c2', v_sg - 7, 'completed');
  INSERT INTO attendance (id, lesson_session_id, student_id, status, marked_by)
  VALUES ('d8000000-0000-0000-0000-0000000000f2','d8000000-0000-0000-0000-0000000000e2',
          'd8000000-0000-0000-0000-0000000000d2','present','d8000000-0000-0000-0000-0000000000a1');

  -- The shadow: ACTIVE on the Shadowed class, open-ended.
  INSERT INTO class_shadow_coaches (id, tenant_id, class_id, coach_id, effective_from,
                                    effective_to, assigned_by)
  VALUES ('d8000000-0000-0000-0000-0000000005a1', t, 'd8000000-0000-0000-0000-0000000000c2',
          v_sh, v_sg - 30, NULL, NULL)
  ON CONFLICT (id) DO UPDATE SET coach_id = EXCLUDED.coach_id, effective_from = EXCLUDED.effective_from,
                                 effective_to = NULL, ended_by = NULL, ended_at = NULL;
END $$;

-- ── Postconditions — fail at load time, not ten checks later ──────────────
DO $$
DECLARE
  v_admins int; v_active int; v_dow_ok int; v_locs int; v_sub int; v_shadow int;
  v_done int; v_sessions int; v_floor date;
BEGIN
  -- §7.131: every login must authorise as a coach, never through an admin branch.
  SELECT count(*) INTO v_admins FROM profiles
   WHERE id::text LIKE 'd8000000-%' AND role <> 'coach';
  SELECT count(*) INTO v_active FROM classes
   WHERE tenant_id = 'd8000000-0000-0000-0000-000000000001' AND is_active AND deactivated_at IS NULL;
  SELECT count(*) INTO v_dow_ok FROM classes
   WHERE tenant_id = 'd8000000-0000-0000-0000-000000000001'
     AND day_of_week = lower(trim(to_char(today_sg(), 'FMDay')))::day_of_week;
  SELECT count(DISTINCT location_id) INTO v_locs FROM classes
   WHERE tenant_id = 'd8000000-0000-0000-0000-000000000001';
  SELECT count(*) INTO v_sub FROM session_coaches sc
    JOIN lesson_sessions s ON s.id = sc.lesson_session_id
    JOIN coaches c ON c.id = sc.coach_id
   WHERE s.class_id = 'd8000000-0000-0000-0000-0000000000c1' AND s.session_date = today_sg()
     AND c.profile_id = 'd8000000-0000-0000-0000-0000000000a2';
  SELECT count(*) INTO v_shadow FROM class_shadow_coaches s JOIN coaches c ON c.id = s.coach_id
   WHERE s.class_id = 'd8000000-0000-0000-0000-0000000000c2'
     AND c.profile_id = 'd8000000-0000-0000-0000-0000000000a3'
     AND s.effective_from <= today_sg() AND s.effective_to IS NULL;
  SELECT count(*) INTO v_done FROM attendance a JOIN lesson_sessions s ON s.id = a.lesson_session_id
   WHERE s.class_id = 'd8000000-0000-0000-0000-0000000000c2' AND s.session_date = today_sg() - 7
     AND a.status = 'present';
  SELECT count(*) INTO v_sessions FROM lesson_sessions WHERE class_id::text LIKE 'd8000000-%';
  v_floor := markable_floor('d8000000-0000-0000-0000-000000000001');
  IF v_admins <> 0 OR v_active <> 2 OR v_dow_ok <> 2 OR v_locs <> 2 OR v_sub <> 1
     OR v_shadow <> 1 OR v_done <> 1 OR v_sessions <> 2 OR today_sg() - 7 < v_floor THEN
    RAISE EXCEPTION 'fixture: expected admins 0 / active 2 / on today''s weekday 2 / locations 2 / sub 1 / shadow 1 / done 1 / sessions 2 / today-7 >= floor (%), got % / % / % / % / % / % / % / %',
      v_floor, v_admins, v_active, v_dow_ok, v_locs, v_sub, v_shadow, v_done, v_sessions;
  END IF;
END $$;

COMMIT;
