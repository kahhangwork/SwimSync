-- Fixture for verify-coach-roster.mjs — Wave 3's lesson-level coach roster
-- (20260811000200) and its follow-up guard (20260812000100).
--
-- ⚠ TWO NON-ADMIN COACHES, AND THAT IS THE WHOLE REASON THIS FIXTURE EXISTS
-- (§7.131). The seed coach `coach@swimsync.test` is deliberately ALSO the
-- tenant admin — it models a private coach. Every policy this wave touches has
-- the shape `coach_branch OR can_admin_tenant(...)`, so on that account the
-- admin branch answers for everything and NO narrowing can be observed: a Wave 3
-- probe "proved" the substitute narrowing had failed when
-- coach_is_main_on_session() had been right all along. `roster-sub@` and
-- `roster-shadow@` are plain coaches, and the postcondition block at the bottom
-- refuses to apply if either has somehow become an admin.
--
-- ⚠ THE LESSON UNDER TEST IS LAST WEEK'S, NOT TODAY'S, AND THAT IS A FIX FOR A
-- REAL VACUOUSNESS (§7.122 + RISK 4 of docs/plans/WAVE_3_FOLLOWUP_PLAN.md).
-- The coach's Schedule tab skips any lesson where `!hasLessonEnded(...)` —
-- "today's 5pm class at midday is Upcoming, not a straggler" — so a fixture on
-- TODAY's weekday with a literal end_time puts the lesson on NOBODY's NEEDS
-- MARKING list before that hour. Part C of the driver would pass every morning
-- while testing nothing, and the nightly sweep runs at a fixed hour, so it would
-- look permanently green.
--
-- Deriving the times from `now()` was the first attempt and it is WORSE, not
-- better: near midnight the only window that has already closed is yesterday's,
-- which moves the class's weekday off today — and a lesson on a weekday that is
-- not today renders as *Upcoming* on the week card rather than as a straggler.
-- Measured at 01:19 SGT, where it produced a green-looking fixture with an empty
-- NEEDS MARKING list.
--
-- The class runs on TODAY's weekday (so it is in the current week) and the
-- lesson under test is the SAME WEEKDAY LAST WEEK. A lesson seven days old has
-- ended whatever the clock says, so the fixture is weekday-agnostic AND
-- time-of-day-agnostic, and `end_time` can be an ordinary literal. Same shape as
-- fixtures-stale-screen.sql, whose straggler verify-schedule-week has relied on
-- through every sweep.
--
-- Everything is namespaced `RosterCov ` and keyed on fixed UUIDs so it is a
-- no-op on re-apply and the teardown can find it. Do NOT add a TRUNCATE and do
-- NOT reach for `supabase db reset` — one Postgres serves every worktree (§7.55).
--
-- ⚠ THE TEARDOWN IS SCOPED (class, month), NOT BY ID, and it has to be (§7.132):
-- assign_session_coach() RESOLVES-OR-CREATES its lesson_sessions row, so the
-- driver produces rows this fixture never named. check-fixture-roundtrip.sh
-- cannot catch those — it diffs the fixture, and the orphans come from the
-- driver.
--
-- Load (from repo root):
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-coach-roster.sql

\set ON_ERROR_STOP on

-- ── When the lesson is ────────────────────────────────────────────────────
-- today_sg(), not CURRENT_DATE: CURRENT_DATE is the server's UTC date, a day
-- behind before 08:00 SGT (§7.7).
CREATE TEMP TABLE rc AS
WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS today)
SELECT
  today,
  (today - 7)                                    AS lesson_date,
  (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  )[EXTRACT(DOW FROM today)::int + 1]::day_of_week AS lesson_dow,
  -- The OFF-PATTERN lesson: a different weekday, same calendar month as the
  -- lesson under test (the admin page is filtered by month, so a date in the
  -- next one would simply not be listed).
  CASE
    WHEN date_trunc('month', (today - 7) + 1) = date_trunc('month', (today - 7))
      THEN (today - 7) + 1
    ELSE (today - 7) - 1
  END AS extra_date
FROM t;

-- ── The two NON-ADMIN coaches ─────────────────────────────────────────────
-- handle_new_user builds their profiles + coaches rows from raw_user_meta_data.
-- role 'coach' + a tenant_id makes a coach OF that business and nothing more —
-- no tenant_admins row, which the postcondition block re-proves.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  ('00000000-0000-0000-0000-000000000000','c7000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','roster-sub@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"RosterCov Sub","role":"coach","tenant_id":"70000000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','c7000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','roster-shadow@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"RosterCov Shadow","role":"coach","tenant_id":"70000000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Both need a rate, or generate_coach_payouts skips them entirely — not
-- asserted by this driver, but a roster fixture whose coaches are unpayable
-- would quietly mislead the next person who reaches for it.
-- ⚠ THE SHADOW COACH NEEDS A **SHADOW** RATE, NOT A MAIN ONE. Since
-- 20260812000200 a rate carries a role, and generate_coach_payouts() REFUSES to
-- run for the whole business when an assigned shadow has no shadow rate in
-- force. A fixture that gave them a main rate would look fine here and block
-- payroll for anyone who reached for it.
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from, role)
SELECT c.id, v.amt, 60, '2026-01-01', v.rate_role::coach_rate_role
  FROM (VALUES ('c7000000-0000-0000-0000-000000000001'::uuid, 55.00, 'main'),
               ('c7000000-0000-0000-0000-000000000002'::uuid, 15.00, 'shadow'))
         AS v(pid, amt, rate_role)
  JOIN coaches c ON c.profile_id = v.pid
 WHERE NOT EXISTS (
   SELECT 1 FROM coach_rates r
    WHERE r.coach_id = c.id AND r.role = v.rate_role::coach_rate_role);

-- ── Two classes of the SEED coach's, both on the lesson's weekday ─────────
-- Class B is not decoration: check 17 asserts the replaced coach's week is
-- otherwise INTACT, and without a second unmarked lesson "the rest of the week"
-- is the empty set and the check is vacuous — "hid everything" would pass.
-- The location both classes sit at (contract: classes.location_id FK).
INSERT INTO locations (id, tenant_id, name) VALUES
  ('c7000000-0000-0000-0000-0000000010c1','70000000-0000-0000-0000-000000000001','RosterCov Pool')
ON CONFLICT (id) DO NOTHING;

INSERT INTO classes (
  id, coach_id, title, day_of_week, start_time, end_time,
  location_id, price_per_lesson, category_id, tenant_id, is_active
)
SELECT v.id, co.id, v.title, rc.lesson_dow, v.st::time, v.et::time,
       'c7000000-0000-0000-0000-0000000010c1', 40.00,
       '7c000000-0000-0000-0000-000000000002',
       '70000000-0000-0000-0000-000000000001', TRUE
  FROM rc,
       (VALUES ('c7000000-0000-0000-0000-00000000000a'::uuid,'RosterCov Lane',  '14:00','15:00'),
               ('c7000000-0000-0000-0000-00000000000b'::uuid,'RosterCov Second','15:15','16:15')
       ) AS v(id, title, st, et)
  CROSS JOIN coaches co
 WHERE co.profile_id = 'c0000000-0000-0000-0000-000000000001'
ON CONFLICT (id) DO NOTHING;

-- ── The children ──────────────────────────────────────────────────────────
-- A distinct name per class, because a screen the driver navigated AWAY from
-- stays mounted on RN-web and its text is still in document.body.innerText
-- (§7.58) — the class title alone cannot say which lesson is on screen.
INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id)
VALUES
  ('c7000000-0000-0000-0000-00000000000e','RosterCov Kid',  'assigned', TRUE,'70000000-0000-0000-0000-000000000001'),
  ('c7000000-0000-0000-0000-00000000000f','RosterCov Mate', 'assigned', TRUE,'70000000-0000-0000-0000-000000000001'),
  ('c7000000-0000-0000-0000-000000000010','RosterCov Guest','assigned', TRUE,'70000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Enrolled 3 days BEFORE the lesson under test, not 60: the coach's backlog
-- floor is max(the business's marking floor, earliest enrolment), so an old
-- enrolment would put every same-weekday date since that floor in the backlog
-- and the driver would have to pick one straggler out of several. This yields
-- exactly one past lesson per class.
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT v.sid, v.cid, (rc.lesson_date - 3)::timestamptz, TRUE
  FROM rc, (VALUES
    ('c7000000-0000-0000-0000-00000000000e'::uuid,'c7000000-0000-0000-0000-00000000000a'::uuid),
    ('c7000000-0000-0000-0000-00000000000f'::uuid,'c7000000-0000-0000-0000-00000000000b'::uuid)
  ) AS v(sid, cid)
 WHERE NOT EXISTS (
   SELECT 1 FROM student_class_enrolments e
    WHERE e.student_id = v.sid AND e.class_id = v.cid);

-- ── THE GUEST — the billing-deadlock check ────────────────────────────────
-- A substitute who cannot SEE the trial guest marks an incomplete lesson. The
-- engine still expects the guest, the block has no override (§8i), and no screen
-- anywhere says why the month will not close. This is the one thing in the walk
-- that no unit test can reach, because it needs the real RLS path in a browser.
INSERT INTO trial_bookings (student_id, class_id, session_date, tenant_id, category_id, booked_by)
SELECT 'c7000000-0000-0000-0000-000000000010','c7000000-0000-0000-0000-00000000000a',
       rc.lesson_date, '70000000-0000-0000-0000-000000000001',
       '7c000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001'
  FROM rc
 WHERE NOT EXISTS (
   SELECT 1 FROM trial_bookings b
    WHERE b.student_id = 'c7000000-0000-0000-0000-000000000010'
      AND b.class_id  = 'c7000000-0000-0000-0000-00000000000a');

-- ── THE OFF-PATTERN LESSON — check 8's `Extra` badge ──────────────────────
-- ⚠ IT CANNOT BE MADE THROUGH THE UI, WHICH IS WHY THE FIXTURE MAKES IT.
-- assign_session_coach() calls assert_class_runs_on() before creating a session
-- row, so every route the admin screen offers refuses a date the class does not
-- run on. Do NOT "fix" a failing check 8 by relaxing that guard — it is what
-- stops a roster row against a fabricated date being marked, paid and BILLED on
-- a day the class never met. (guard_session_date returns early for a superuser,
-- which is how this INSERT is permitted at all.)
INSERT INTO lesson_sessions (id, class_id, session_date, status)
SELECT 'c7000000-0000-0000-0000-0000000000d1','c7000000-0000-0000-0000-00000000000a',
       rc.extra_date, 'scheduled'
  FROM rc
ON CONFLICT (id) DO NOTHING;

-- ⚠ AND IT IS MARKED, WHICH IS NOT TIDINESS — IT IS WHAT KEEPS THE DRIVER'S
-- ABSENCE CHECK HONEST. Left unmarked, this extra lesson is a straggler of
-- RosterCov Lane that the class's own coach IS still main on, so the class title
-- stays on their NEEDS MARKING list no matter what happens to the covered
-- lesson — and check 16 ("the covered lesson has left the list") fails for a
-- reason that has nothing to do with the roster. Measured: 21/24 with this
-- lesson unmarked, and the failure looked exactly like a product bug.
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
SELECT 'c7000000-0000-0000-0000-0000000000d1','c7000000-0000-0000-0000-00000000000e',
       'present','c0000000-0000-0000-0000-000000000001'
 WHERE NOT EXISTS (
   SELECT 1 FROM attendance a
    WHERE a.lesson_session_id = 'c7000000-0000-0000-0000-0000000000d1'
      AND a.student_id = 'c7000000-0000-0000-0000-00000000000e');

-- ── CLASS B'S LESSON GETS A SESSION ROW, AND THAT IS NOT COSMETIC ─────────
-- The Schedule tab only PROBES a backlog lesson that already has a
-- lesson_sessions row (`if (owned && sess) probeIds.push(sess.id)`), and only a
-- probed lesson can be filtered out by the covered-out answer. Without this row
-- neither backlog item is probed, so sabotaging coveredOutFrom to hide
-- EVERYTHING changes nothing on screen and the driver scores a full 25/25 over a
-- broken client — measured, exactly that. This row is what makes check 17 able
-- to go red, which is the only thing that makes it a check.
--
-- Unmarked, deliberately: a marked lesson leaves the backlog altogether.
INSERT INTO lesson_sessions (id, class_id, session_date, status)
SELECT 'c7000000-0000-0000-0000-0000000000d2','c7000000-0000-0000-0000-00000000000b',
       rc.lesson_date, 'scheduled'
  FROM rc
ON CONFLICT (id) DO NOTHING;

-- ── POSTCONDITIONS — a fixture that cannot satisfy its own premises must ──
-- ── FAIL AT APPLY TIME, not produce a green driver twenty minutes later ───
DO $$
DECLARE
  v_subs INT; v_admins INT; v_dow day_of_week; v_end TIME; v_now TIME; v_date DATE;
BEGIN
  SELECT count(*) INTO v_subs FROM coaches c
   WHERE c.profile_id IN ('c7000000-0000-0000-0000-000000000001',
                          'c7000000-0000-0000-0000-000000000002');
  IF v_subs <> 2 THEN
    RAISE EXCEPTION 'fixture: expected 2 coaches rows for the roster coaches, found %. '
                    'handle_new_user may have built parents instead — check raw_user_meta_data.', v_subs;
  END IF;

  -- §7.131. If either of these became a tenant admin, every narrowing this
  -- driver claims to prove would pass through the admin branch instead.
  -- is_tenant_admin() reads profiles.role, so that is what is asserted — not a
  -- membership table, which is the shape this check was first written against.
  SELECT count(*) INTO v_admins FROM profiles p
   WHERE p.id IN ('c7000000-0000-0000-0000-000000000001',
                  'c7000000-0000-0000-0000-000000000002')
     AND p.role = 'tenant_admin';
  IF v_admins <> 0 THEN
    RAISE EXCEPTION 'fixture: a roster coach is ALSO a tenant admin (% rows). '
                    'No RLS narrowing can be demonstrated on such an account (§7.131).', v_admins;
  END IF;

  SELECT c.day_of_week, c.end_time INTO v_dow, v_end
    FROM classes c WHERE c.id = 'c7000000-0000-0000-0000-00000000000a';
  SELECT lesson_date INTO v_date FROM rc;
  v_now := (now() AT TIME ZONE 'Asia/Singapore')::time;

  -- The class must run on TODAY'S weekday, or its lesson is not in the current
  -- week and the week card renders it as Upcoming rather than as a straggler.
  IF v_dow <> (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
              )[EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Singapore')::date)::int + 1]::day_of_week THEN
    RAISE EXCEPTION 'fixture: the class weekday (%) is not today''s in SGT — '
                    'the lesson would render as Upcoming, not as a straggler.', v_dow;
  END IF;

  -- RISK 4. The whole of part C is vacuous if the lesson has not ended, which is
  -- why it is LAST week's and not today's. Re-proven rather than assumed.
  IF v_date >= (now() AT TIME ZONE 'Asia/Singapore')::date THEN
    RAISE EXCEPTION 'fixture: the lesson under test (%) is not in the past. '
                    'It would be Upcoming, on nobody''s NEEDS MARKING list, and '
                    'the replaced-coach checks would pass while testing nothing.', v_date;
  END IF;
END $$;

SELECT today, lesson_date, lesson_dow, extra_date FROM rc;
