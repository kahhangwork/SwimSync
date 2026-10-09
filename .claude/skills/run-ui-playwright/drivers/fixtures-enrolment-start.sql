-- Fixture for verify-enrolment-start.mjs — "Starts on" and "Change start date".
-- Plan: docs/plans/WAVE4_START_DATE_FRONT_DESK_PLAN.md §1.5 (migration 20261005000100).
--
-- NAMED fixtures-enrolment-start.sql ON PURPOSE: run-all-drivers.sh's fixture_for()
-- maps verify-enrolment-start.mjs to this name (§7.102). Renaming it silently
-- drops it from the nightly.
--
-- Fixture-owned rows (uuid block e5e50000-…; 0 hits on `git grep e5e50000-` when written, §7.280):
--   ES Coach Ana   a coach of the seed tenant; paid coach of the class.
--   ES Squad       runs on TODAY's weekday (SGT) at 06:00, nobody enrolled.
--   ES Dana        active, in no class. The driver adds her with Starts on = D1
--                  (7 days ago), marks D1, tries to move the start past the mark
--                  (refused), then moves it one week EARLIER to D2 and marks D2 —
--                  so the run leaves no unmarked lesson behind (§7.103, RISK 12).
--
-- Dates are derived (no literals, §7.305). D2 = today − 14 is always ≥ the 1st of
-- last month (session_window_start), so both lessons are markable.
--
-- Load:  docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 < this
-- Re-run: teardown first.

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000','e5e50000-0000-0000-0000-0000000000c1',
  'authenticated','authenticated','es-coach-ana@swimsync.test',
  crypt('password123', gen_salt('bf')), NOW(),  -- clock-real: auth.users stamps are real time
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"ES Coach Ana","role":"coach","tenant_id":"70000000-0000-0000-0000-000000000001"}',
  NOW(), NOW(), '', '', '', ''  -- clock-real: auth.users stamps are real time
) ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, tenant_id, name) VALUES
  ('e5e50000-0000-0000-0000-0000000010c1','70000000-0000-0000-0000-000000000001','ES Pool')
ON CONFLICT (id) DO NOTHING;

INSERT INTO classes (
  id, coach_id, title, day_of_week, start_time, end_time,
  location_id, price_per_lesson, category_id, capacity, colour
)
SELECT 'e5e50000-0000-0000-0000-000000000001', co.id, 'ES Squad',
       lower(trim(to_char(app_today(), 'FMDay')))::day_of_week,
       '06:00'::time, '06:45'::time, 'e5e50000-0000-0000-0000-0000000010c1', 30.00,
       '7c000000-0000-0000-0000-000000000002', 6, 'sky'
  FROM coaches co
 WHERE co.profile_id = 'e5e50000-0000-0000-0000-0000000000c1'
ON CONFLICT (id) DO NOTHING;

INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active) VALUES
  ('e5e50000-0000-0000-0000-00000000d001','ES Dana','70000000-0000-0000-0000-000000000001','unassigned',TRUE)
ON CONFLICT (id) DO NOTHING;

-- ---- Self-check: a half-worked fixture fails HERE, not in the driver (§7.251) ----
DO $$
DECLARE
  t  uuid := '70000000-0000-0000-0000-000000000001';
  d2 date := app_today() - 14;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = 'e5e50000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'fixtures-enrolment-start: the class did not load';
  END IF;
  IF EXISTS (SELECT 1 FROM student_class_enrolments WHERE student_id = 'e5e50000-0000-0000-0000-00000000d001') THEN
    RAISE EXCEPTION 'fixtures-enrolment-start: ES Dana already has an enrolment — run the teardown first';
  END IF;
  IF d2 < markable_floor(t) THEN
    RAISE EXCEPTION 'fixtures-enrolment-start: D2 % is below the marking floor %', d2, markable_floor(t);
  END IF;
END $$;
