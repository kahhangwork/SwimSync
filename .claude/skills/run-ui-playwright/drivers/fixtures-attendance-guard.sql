-- Fixture for verify-attendance-guard.mjs.
--
-- DATES ARE COMPUTED FROM THE CLOCK, not hardcoded — deliberately the opposite
-- of §7.33's rule for the *unit* suites. The behaviour under test IS relative to
-- now() (the window floor is the 1st of last month OR EARLIER — see the sealed
-- month below), and this driver is run by
-- hand against a live stack, so a fixed date would simply stop meaning anything
-- next month. Everything derives from ONE anchor so the relationships hold
-- whatever day it runs.
--
-- today_sg() rather than CURRENT_DATE: CURRENT_DATE is the SERVER's UTC date,
-- a day behind before 08:00 SGT (§7.7).
--
-- Load after `supabase db reset` (from repo root):
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-attendance-guard.sql
--
-- WHAT IT SETS UP — three classes in the seed tenant, four children, one parent:
--
--   Saturday Beginners  (the seed class — the window RULE is tested here)
--     • Ana Guard        enrolled long ago     → on every roster below
--     • Late Joiner      enrolled 3 days ago   → must NOT appear on d_past
--   Guard Newbies       (weekday = TOMORROW's, so its first lesson is ahead)
--     • Newjoiner Guard  enrolled today        → nothing has fallen due
--   Guard Waiting       (weekday = YESTERDAY's, so a lesson is always overdue)
--     • Waiting Guard    enrolled 30 days ago, never marked → coach is behind
--
-- The last two carry the empty states folded in from the retired
-- fixtures-attendance-window.sql (2026-08-01). They are separate classes on
-- purpose: a third child on Saturday Beginners would join the roster the
-- save-path checks mark, and `pressByText("Present")` would stop being
-- unambiguous.
--
-- and the dates the driver navigates to by URL:
--   d_past      three Saturdays back, IN window  → roster must omit Late Joiner
--   d_reopen    ten Saturdays back                → BELOW the calendar rule and
--                                                   ABOVE this business's floor,
--                                                   so it must OPEN for marking
--   d_closed    20 Saturdays back, OUT of window → "That lesson is closed"
--   d_wrongday  two days ago, not a Saturday     → "That isn't a lesson day"
--   d_extra     three days ahead, not a Saturday → the admin's extra lesson
--
-- ── THE SEALED MONTH IS PART OF THE FIXTURE, NOT SCENERY ───────────────────
-- Since 20260806000200 the floor is markable_floor(tenant): the 1st of last
-- month, OR the month after the business's latest SEALED billing month if that
-- is earlier. This fixture seals a month four back, which puts the floor three
-- months back — so d_reopen (about ten weeks back) sits in the gap that only
-- exists because of that migration.
--
-- That gap is the whole point of the feature. Without it, billing a month LATE
-- names an unmarked lesson nobody may record any more — no coach, no admin, no
-- override by design — and the month can never bill (ATTENDANCE_WINDOW_PLAN
-- §10.1). Only a driver can prove the fix works end to end, because the failure
-- was never in the database: it was the coach's screen never OFFERING the date.

\set ON_ERROR_STOP on

-- ── The anchor, and everything derived from it ─────────────────────────────
CREATE TEMP TABLE g AS
WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS today)
SELECT
  today,
  -- The most recent Saturday on or before today. DOW: Saturday = 6.
  (today - ((EXTRACT(DOW FROM today)::int + 1) % 7)) AS last_sat
FROM t;

CREATE TEMP TABLE d AS
SELECT
  today,
  (last_sat - 21)  AS d_past,      -- in window, before Late Joiner enrolled
  -- 70 days is a whole number of weeks, so this stays a Saturday — otherwise
  -- the WEEKDAY rule would refuse it and this fixture would prove nothing about
  -- the floor. It lands 70–76 days back, while the calendar rule floors at
  -- 30–61 days back and the sealed-month floor at 89–123: comfortably between
  -- the two on every day of the year, which is what makes it a stable probe.
  (last_sat - 70)  AS d_reopen,
  (last_sat - 140) AS d_closed,    -- below BOTH floors, on every run
  -- Two days back, nudged off Saturday so it is unambiguously a non-lesson day.
  CASE WHEN EXTRACT(DOW FROM today - 2) = 6 THEN today - 3 ELSE today - 2 END
    AS d_wrongday,
  -- Three days ahead, likewise not a Saturday — the admin's extra lesson.
  CASE WHEN EXTRACT(DOW FROM today + 3) = 6 THEN today + 4 ELSE today + 3 END
    AS d_extra,
  -- The first lesson of the "nothing has fallen due yet" class (see below).
  -- Tomorrow, EXCEPT when tomorrow is a Saturday — 'Guard Newbies' must not
  -- share a weekday with 'Saturday Beginners'. If it did, the coach would have
  -- two Saturday classes, a Saturday could already have fallen due for the new
  -- child, and the "nothing has happened yet" premise this fixture exists to
  -- build would silently collapse — on Fridays only. That is exactly the
  -- date-rot this fixture replaced `fixtures-attendance-window.sql` for, so it
  -- is guarded here rather than left to whoever runs it next.
  CASE WHEN EXTRACT(DOW FROM today + 1) = 6 THEN today + 2 ELSE today + 1 END
    AS d_firstlesson,
  -- ...and the mirror: a class whose lesson has ALREADY passed, for the
  -- due-but-unmarked state. Yesterday, likewise never a Saturday.
  -- These two can never share a weekday (they are 2-4 days apart), so the two
  -- parent states below are always both reachable in the same run.
  CASE WHEN EXTRACT(DOW FROM today - 1) = 6 THEN today - 2 ELSE today - 1 END
    AS d_lastlesson
FROM g;

-- ── A parent with two children ─────────────────────────────────────────────
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'd0000000-0000-0000-0000-0000000000aa',
  'authenticated','authenticated','parent-guard@swimsync.test',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Guard Parent","role":"parent"}',
  NOW(), NOW(), '', '', '', ''
);

INSERT INTO students (id, full_name, assignment_status, tenant_id)
SELECT 'd0000000-0000-0000-0000-0000000000b1', 'Ana Guard', 'assigned', c.tenant_id
  FROM classes c WHERE c.title = 'Saturday Beginners';
INSERT INTO students (id, full_name, assignment_status, tenant_id)
SELECT 'd0000000-0000-0000-0000-0000000000b2', 'Late Joiner', 'assigned', c.tenant_id
  FROM classes c WHERE c.title = 'Saturday Beginners';

-- ── A class whose first lesson has NOT happened yet, and a child who just
--    joined it ───────────────────────────────────────────────────────────────
-- Folded in from the retired fixtures-attendance-window.sql (2026-08-01). It
-- carries the two empty states nothing else guards: the coach roster's
-- "No lessons to mark yet" placeholder, and the parent's "No lessons have taken
-- place yet" — which is a DIFFERENT sentence from "No lessons marked yet", and
-- telling a family the coach is behind when nothing has happened is the bug
-- (PRD §5.1).
--
-- The old fixture pinned this to 2026-07-16 and needed "no Sunday since", true
-- for three days in July 2026. Derived from the anchor, it holds any day.
INSERT INTO classes (id, coach_id, tenant_id, title, day_of_week,
                     start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'd0000000-0000-0000-0000-0000000000e1',
       co.id, co.tenant_id, 'Guard Newbies',
       lower(to_char(d.d_firstlesson, 'FMDay'))::day_of_week,
       '09:00', '10:00', 'Test Pool', 40,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = co.tenant_id
           AND lower(trim(cc.name)) = 'default group')
  FROM coaches co
  JOIN profiles pr ON pr.id = co.profile_id, d
 WHERE pr.email = 'coach@swimsync.test';

INSERT INTO students (id, full_name, assignment_status, tenant_id)
SELECT 'd0000000-0000-0000-0000-0000000000b3', 'Newjoiner Guard', 'assigned', c.tenant_id
  FROM classes c WHERE c.id = 'd0000000-0000-0000-0000-0000000000e1';

-- The OTHER half of the parent distinction: a lesson HAS fallen due and the
-- coach has not marked it. It needs its own class, not Saturday Beginners —
-- a fourth child there would join the roster the save-path checks mark, and
-- `pressByText("Present")` would stop being unambiguous. Its weekday is
-- yesterday's, so a lesson is always overdue whatever day this runs; the old
-- fixture leaned on Ana Win having no marks, which is not available here
-- because Ana Guard is deliberately marked on the out-of-window lesson.
INSERT INTO classes (id, coach_id, tenant_id, title, day_of_week,
                     start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'd0000000-0000-0000-0000-0000000000e2',
       co.id, co.tenant_id, 'Guard Waiting',
       lower(to_char(d.d_lastlesson, 'FMDay'))::day_of_week,
       '11:00', '12:00', 'Test Pool', 40,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = co.tenant_id
           AND lower(trim(cc.name)) = 'default group')
  FROM coaches co
  JOIN profiles pr ON pr.id = co.profile_id, d
 WHERE pr.email = 'coach@swimsync.test';

INSERT INTO students (id, full_name, assignment_status, tenant_id)
SELECT 'd0000000-0000-0000-0000-0000000000b4', 'Waiting Guard', 'assigned', c.tenant_id
  FROM classes c WHERE c.id = 'd0000000-0000-0000-0000-0000000000e2';

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.id
  FROM parents p, students s
 WHERE p.profile_id = 'd0000000-0000-0000-0000-0000000000aa'
   AND s.id IN ('d0000000-0000-0000-0000-0000000000b1',
                'd0000000-0000-0000-0000-0000000000b2',
                'd0000000-0000-0000-0000-0000000000b3',
                'd0000000-0000-0000-0000-0000000000b4');

INSERT INTO parent_tenants (parent_id, tenant_id, is_active)
SELECT p.id, c.tenant_id, TRUE
  FROM parents p, classes c
 WHERE p.profile_id = 'd0000000-0000-0000-0000-0000000000aa'
   AND c.title = 'Saturday Beginners'
ON CONFLICT DO NOTHING;

-- Ana has been here for months; Late Joiner arrived three days ago. That gap is
-- the whole fixture: d_past falls between the two.
--
-- Ana is dated from d_reopen, not d_past, so she is already enrolled on the
-- reopened lesson too. The roster answers "who was expected here" from enrolment
-- SPANS (20260727000100), so an enrolment starting after d_reopen would leave
-- that lesson with an empty roster and the reopened-window check would pass
-- vacuously — green for the wrong reason.
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT 'd0000000-0000-0000-0000-0000000000b1', c.id, (d.d_reopen - 30)::timestamptz, TRUE
  FROM classes c, d WHERE c.title = 'Saturday Beginners';
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT 'd0000000-0000-0000-0000-0000000000b2', c.id, (d.today - 3)::timestamptz, TRUE
  FROM classes c, d WHERE c.title = 'Saturday Beginners';

-- Enrolled TODAY into a class whose weekday is still ahead, so no lesson of
-- theirs has fallen due. That is the whole of the "nothing has happened yet"
-- state — no lesson_sessions row, no attendance, deliberately.
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT 'd0000000-0000-0000-0000-0000000000b3',
       'd0000000-0000-0000-0000-0000000000e1', d.today::timestamptz, TRUE
  FROM d;

-- Enrolled a month back into the class whose day has already passed, and never
-- marked: at least four lessons are overdue. NO attendance rows, deliberately.
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT 'd0000000-0000-0000-0000-0000000000b4',
       'd0000000-0000-0000-0000-0000000000e2', (d.today - 30)::timestamptz, TRUE
  FROM d;

-- ── A SEALED billing month, which is what moves this business's floor ──────
-- Four months back, so markable_floor() lands on the 1st of three months back
-- and d_reopen falls in the reopened gap. Without this row the floor is the
-- plain calendar rule and d_reopen would be refused — which is exactly what a
-- run against the pre-20260806000200 database does, and how the new checks
-- below were proven red.
INSERT INTO billing_periods (tenant_id, billing_month, invoices_issued, notes)
SELECT c.tenant_id,
       to_char(d.today - INTERVAL '4 months', 'YYYY-MM'),
       0,
       'fixtures-attendance-guard: seals a month so the floor reaches back'
  FROM classes c, d
 WHERE c.title = 'Saturday Beginners'
ON CONFLICT DO NOTHING;

-- ── A real, already-billed lesson far outside the window ───────────────────
-- Written as postgres, which the guard exempts by design: a fixture builds the
-- past that the rule is about. Ana is marked; Late Joiner is not (they did not
-- exist yet), which is exactly the state a coach must not be asked to "fix".
INSERT INTO lesson_sessions (id, class_id, session_date)
SELECT 'd0000000-0000-0000-0000-0000000000c1', c.id, d.d_closed
  FROM classes c, d WHERE c.title = 'Saturday Beginners';

INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('d0000000-0000-0000-0000-0000000000c1',
        'd0000000-0000-0000-0000-0000000000b1',
        'present', 'c0000000-0000-0000-0000-000000000001');

-- ── Print the dates the driver needs ───────────────────────────────────────
-- Read by verify-attendance-guard.mjs so the two agree on one anchor rather
-- than each deriving its own and drifting at a month boundary.
-- new_class_dow is printed so the DRIVER can assert it is not 'saturday'. A
-- collision with 'Saturday Beginners' would break the premise silently; this
-- makes it fail loudly instead.
SELECT
  (SELECT id FROM classes WHERE title = 'Saturday Beginners') AS class_id,
  today, d_past, d_reopen, d_closed, d_wrongday, d_extra,
  -- Printed so the driver can assert the premise rather than assume it:
  -- d_reopen must be BELOW the calendar rule (or it proves nothing) and the
  -- floor must be BELOW d_reopen (or the check would fail for the right answer
  -- and the wrong reason).
  session_window_start()                                      AS calendar_floor,
  markable_floor((SELECT tenant_id FROM classes
                   WHERE title = 'Saturday Beginners'))       AS business_floor,
  'd0000000-0000-0000-0000-0000000000e1'                      AS new_class_id,
  d_firstlesson,
  lower(to_char(d_firstlesson, 'FMDay'))                      AS new_class_dow,
  lower(to_char(d_lastlesson,  'FMDay'))                      AS waiting_class_dow
FROM d;
