-- Fixture for verify-stale-screen.mjs — §7.64, attendance written to the wrong
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
-- max(the business's marking floor, earliest enrolment), so an old enrolment
-- would put every same-weekday date since that floor in the backlog and the
-- driver would have to pick one out of eight. Eight days back yields exactly
-- one past lesson, which is also what production had.
--
-- The floor is the 1st of last month FOR THIS FIXTURE because the seed tenant
-- has no sealed billing months. Since 20260806000200 it can reach further back
-- when a business has unsealed months (markable_floor), so if this fixture ever
-- gains a billing_periods row, re-check the "exactly one past lesson" premise —
-- it is what makes the driver's row unambiguous.

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

-- A SECOND class on the same weekday, because the navigation half (§7.65)
-- needs two lessons to stack. The coach marks the first from Today, goes back,
-- marks the second — and `router.back()` used to land them on the FIRST one.
-- One class cannot express that.
INSERT INTO classes (
  id, coach_id, title, day_of_week, start_time, end_time,
  location_name, price_per_lesson, category_id, tenant_id, is_active
)
SELECT
  'e1000000-0000-0000-0000-0000000000c2',
  co.id, 'Stale Screen Second', ss.today_dow, '09:30', '10:15',
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
   '70000000-0000-0000-0000-000000000001'),
  ('e1000000-0000-0000-0000-00000000b001', 'Second One', 'assigned', true,
   '70000000-0000-0000-0000-000000000001'),
  ('e1000000-0000-0000-0000-00000000b002', 'Second Two', 'assigned', true,
   '70000000-0000-0000-0000-000000000001');

-- The two-child class first, then the second class's single child. A distinct
-- name per class is what lets the driver tell WHICH lesson it is looking at —
-- the class title alone is not enough, because the screen it navigated away
-- from stays mounted and its title is still in document.body.innerText (§7.58).
-- Class A's children are 8 days in, so last week's lesson is expected of them
-- and lands in the backlog. Class B's child is only 3 days in, so class B has
-- NO past lesson — which keeps "Unmarked Lessons" at exactly one entry and the
-- driver's press on it unambiguous. Class B exists to be marked TODAY, as the
-- second lesson in one sitting.
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT s.id, s.class_id, (ss.today - s.days_ago)::timestamptz, true
FROM (VALUES
  ('e1000000-0000-0000-0000-00000000a001'::uuid, 'e1000000-0000-0000-0000-0000000000c1'::uuid, 8),
  ('e1000000-0000-0000-0000-00000000a002'::uuid, 'e1000000-0000-0000-0000-0000000000c1'::uuid, 8),
  ('e1000000-0000-0000-0000-00000000b001'::uuid, 'e1000000-0000-0000-0000-0000000000c2'::uuid, 3),
  ('e1000000-0000-0000-0000-00000000b002'::uuid, 'e1000000-0000-0000-0000-0000000000c2'::uuid, 3)
) AS s(id, class_id, days_ago), ss;

-- ── CLASS B'S LESSON TODAY IS *PARTIALLY* MARKED ───────────────────────────
-- One of its two children has an attendance row; the other does not. That
-- asymmetry is the whole of §7.67: the screen sent the attendance PK only for
-- rows that already existed, so the key sets differed, `id` entered PostgREST's
-- column list, and the unmarked child was inserted with id = NULL against a
-- NOT NULL column. Postgres refused the entire statement and the lesson became
-- permanently unsaveable.
--
-- A fully unmarked lesson (class A's, above) cannot reproduce it, and neither
-- can a fully marked one — which is exactly why this reached production looking
-- like "only one date is broken".
INSERT INTO lesson_sessions (id, class_id, session_date, status)
SELECT 'e1000000-0000-0000-0000-0000000000d1',
       'e1000000-0000-0000-0000-0000000000c2', ss.today, 'scheduled'
FROM ss;

INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('e1000000-0000-0000-0000-0000000000d1',
        'e1000000-0000-0000-0000-00000000b001', 'present',
        'c0000000-0000-0000-0000-000000000001');

-- NO lesson_sessions and NO attendance, deliberately. Both today's lesson and
-- last week's are unmarked, which is what puts one on each list.

SELECT today AS today, d_prev AS last_weeks_lesson, today_dow AS weekday FROM ss;
