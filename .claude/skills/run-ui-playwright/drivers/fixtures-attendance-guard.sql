-- Fixture for verify-attendance-guard.mjs.
--
-- DATES ARE COMPUTED FROM THE CLOCK, not hardcoded — deliberately the opposite
-- of §7.33's rule for the *unit* suites. The behaviour under test IS relative to
-- now() (the window floor is "the 1st of last month"), and this driver is run by
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
-- WHAT IT SETS UP — one Saturday class in the seed tenant, two children:
--   • Ana Guard    enrolled long ago            → on every roster below
--   • Late Joiner  enrolled 3 days ago          → must NOT appear on d_past
--
-- and three dates the driver navigates to by URL:
--   d_past      three Saturdays back, IN window  → roster must omit Late Joiner
--   d_closed    20 Saturdays back, OUT of window → "That lesson is closed"
--   d_wrongday  two days ago, not a Saturday     → "That isn't a lesson day"

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
  (last_sat - 140) AS d_closed,    -- far below the window floor
  -- Two days back, nudged off Saturday so it is unambiguously a non-lesson day.
  CASE WHEN EXTRACT(DOW FROM today - 2) = 6 THEN today - 3 ELSE today - 2 END
    AS d_wrongday,
  -- Three days ahead, likewise not a Saturday — the admin's extra lesson.
  CASE WHEN EXTRACT(DOW FROM today + 3) = 6 THEN today + 4 ELSE today + 3 END
    AS d_extra
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

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.id
  FROM parents p, students s
 WHERE p.profile_id = 'd0000000-0000-0000-0000-0000000000aa'
   AND s.id IN ('d0000000-0000-0000-0000-0000000000b1',
                'd0000000-0000-0000-0000-0000000000b2');

INSERT INTO parent_tenants (parent_id, tenant_id, is_active)
SELECT p.id, c.tenant_id, TRUE
  FROM parents p, classes c
 WHERE p.profile_id = 'd0000000-0000-0000-0000-0000000000aa'
   AND c.title = 'Saturday Beginners'
ON CONFLICT DO NOTHING;

-- Ana has been here for months; Late Joiner arrived three days ago. That gap is
-- the whole fixture: d_past falls between the two.
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT 'd0000000-0000-0000-0000-0000000000b1', c.id, (d.d_past - 30)::timestamptz, TRUE
  FROM classes c, d WHERE c.title = 'Saturday Beginners';
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT 'd0000000-0000-0000-0000-0000000000b2', c.id, (d.today - 3)::timestamptz, TRUE
  FROM classes c, d WHERE c.title = 'Saturday Beginners';

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
SELECT
  (SELECT id FROM classes WHERE title = 'Saturday Beginners') AS class_id,
  today, d_past, d_closed, d_wrongday, d_extra
FROM d;
