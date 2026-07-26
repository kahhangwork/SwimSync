-- Fixture for verify-stale-screen.mjs — §7.62, attendance written to the wrong
-- lesson because the marking screen never reloaded.
--
-- DATES ARE COMPUTED FROM THE CLOCK, like fixtures-attendance-guard.sql and
-- deliberately unlike the unit suites (§7.33). The behaviour under test is
-- "today's lesson vs last week's lesson", which only means anything relative to
-- now(). today_sg() rather than CURRENT_DATE — CURRENT_DATE is the server's UTC
-- date, a day behind before 08:00 SGT (§7.7).
--
-- Load after `supabase db reset` (from repo root):
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-stale-screen.sql
--
-- WHAT IT SETS UP — one class on TODAY'S weekday, two children, no sessions:
--   • the class appears under "Today's Classes"
--   • last week's same-weekday lesson appears under "Unmarked Lessons"
--
-- That is the exact shape production was in: Tanglin View Sun 845am with a
-- 19 Jul backlog row and a 26 Jul card, reachable from one screen. The coach
-- marks TODAY first, then taps the backlog row — same route, new ?date= — and
-- the reused screen writes last week's marks onto today's session.
--
-- The enrolment is 8 DAYS OLD, not 60. The coach's backlog floor is
-- max(1st of last month, earliest enrolment), so an old enrolment would put
-- every same-weekday date since the 1st of last month in the backlog and the
-- driver would have to pick one out of eight. Eight days back yields exactly
-- one past lesson, which is also what production had.

\set ON_ERROR_STOP on

CREATE TEMP TABLE ss AS
WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS today)
SELECT
  today,
  (today - 7) AS d_prev,
  (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  )[EXTRACT(DOW FROM today)::int + 1]::day_of_week AS today_dow
FROM t;

-- ── The class, on today's weekday, owned by the seed coach ─────────────────
INSERT INTO classes (
  id, coach_id, title, day_of_week, start_time, end_time,
  location_name, price_per_lesson, category_id, tenant_id, is_active
)
SELECT
  'e1000000-0000-0000-0000-0000000000c1',
  co.id, 'Stale Screen Club', ss.today_dow, '08:45', '09:30',
  'Tanglin View', 30.00,
  '7c000000-0000-0000-0000-000000000002',
  '70000000-0000-0000-0000-000000000001', true
FROM coaches co, ss
WHERE co.profile_id = 'c0000000-0000-0000-0000-000000000001';

-- ── Two children, enrolled 8 days ago ──────────────────────────────────────
INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id)
VALUES
  ('e1000000-0000-0000-0000-00000000a001', 'Stale One', 'assigned', true,
   '70000000-0000-0000-0000-000000000001'),
  ('e1000000-0000-0000-0000-00000000a002', 'Stale Two', 'assigned', true,
   '70000000-0000-0000-0000-000000000001');

INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT s.id, 'e1000000-0000-0000-0000-0000000000c1',
       (ss.today - 8)::timestamptz, true
FROM (VALUES ('e1000000-0000-0000-0000-00000000a001'::uuid),
             ('e1000000-0000-0000-0000-00000000a002'::uuid)) AS s(id), ss;

-- NO lesson_sessions and NO attendance, deliberately. Both today's lesson and
-- last week's are unmarked, which is what puts one on each list.

SELECT today AS today, d_prev AS last_weeks_lesson, today_dow AS weekday FROM ss;
