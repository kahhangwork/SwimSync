-- Fixture for verify-coach-disable.mjs — Wave 5 chunk 2 (20260813000200).
--
-- ⚠ TWO NON-ADMIN COACHES, for the same §7.131 reason as fixtures-coach-roster:
-- the seed coach@swimsync.test is ALSO the tenant admin, so no coach-side
-- narrowing is observable on that account — and the sole-coach guard would
-- refuse to disable them anyway. The postcondition block refuses to apply if
-- either fixture coach has become an admin.
--
-- What the driver needs:
--   dc-target@swimsync.test   the coach to DISABLE. Teaches an ACTIVE class
--                             (so the dialog demands a replacement) and is the
--                             SUBSTITUTE on an unmarked PAST lesson of the
--                             other coach's class (so the ⚠ RISK 8 list has a
--                             row to show).
--   dc-replace@swimsync.test  the replacement. Owns the other class; after the
--                             disable they own both.
--
-- The class runs on TODAY's weekday so the replacement's landing WEEK shows it
-- (fixtures-coach-roster's reasoning); the override lesson is LAST week's so
-- it has ended whatever the clock says (§7.122).
--
-- Idempotent per fixture protocol. The DRIVER is not re-runnable without the
-- teardown: it disables/reactivates dc-target and moves the class to
-- dc-replace, and reactivation deliberately does NOT hand it back.
--
-- Load (from repo root):
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-coach-disable.sql

\set ON_ERROR_STOP on

CREATE TEMP TABLE dc AS
WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS today)
SELECT
  today,
  (today - 7) AS override_date,
  (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  )[EXTRACT(DOW FROM today)::int + 1]::day_of_week AS class_dow
FROM t;

-- ── The two coaches ─────────────────────────────────────────────────────────
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  ('00000000-0000-0000-0000-000000000000','dcaa0000-0000-0000-0000-000000000001',
   'authenticated','authenticated','dc-target@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"DisableCov Target","role":"coach","tenant_id":"70000000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','dcaa0000-0000-0000-0000-000000000002',
   'authenticated','authenticated','dc-replace@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"DisableCov Replacement","role":"coach","tenant_id":"70000000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Rates for both — generate_coach_payouts skips a coach with none, and a
-- fixture whose coaches are unpayable quietly misleads whoever reaches for it.
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from, role)
SELECT c.id, v.amt, 60, '2026-01-01', 'main'::coach_rate_role
  FROM (VALUES ('dcaa0000-0000-0000-0000-000000000001'::uuid, 50.00),
               ('dcaa0000-0000-0000-0000-000000000002'::uuid, 45.00))
         AS v(pid, amt)
  JOIN coaches c ON c.profile_id = v.pid
 WHERE NOT EXISTS (
   SELECT 1 FROM coach_rates r
    WHERE r.coach_id = c.id AND r.role = 'main');

-- ── The classes: target's (to be handed over) and the replacement's ─────────
INSERT INTO classes (
  id, coach_id, title, day_of_week, start_time, end_time,
  location_name, price_per_lesson, category_id, tenant_id, is_active
)
SELECT v.id, co.id, v.title, dc.class_dow, v.st::time, v.et::time,
       'DisableCov Pool', 40.00,
       '7c000000-0000-0000-0000-000000000002',
       '70000000-0000-0000-0000-000000000001', TRUE
  FROM dc,
       (VALUES ('dcaa0000-0000-0000-0000-0000000000aa'::uuid,'DisableCov Lane',
                'dcaa0000-0000-0000-0000-000000000001'::uuid,'14:00','15:00'),
               ('dcaa0000-0000-0000-0000-0000000000ab'::uuid,'DisableCov Other',
                'dcaa0000-0000-0000-0000-000000000002'::uuid,'15:15','16:15')
       ) AS v(id, title, coach_pid, st, et)
  JOIN coaches co ON co.profile_id = v.coach_pid
ON CONFLICT (id) DO NOTHING;

-- ── The children ────────────────────────────────────────────────────────────
INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id)
VALUES
  ('dcaa0000-0000-0000-0000-0000000000e1','DisableCov Kid', 'assigned', TRUE,'70000000-0000-0000-0000-000000000001'),
  ('dcaa0000-0000-0000-0000-0000000000e2','DisableCov Mate','assigned', TRUE,'70000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT v.sid, v.cid, (dc.override_date - 3)::timestamptz, TRUE
  FROM dc, (VALUES
    ('dcaa0000-0000-0000-0000-0000000000e1'::uuid,'dcaa0000-0000-0000-0000-0000000000aa'::uuid),
    ('dcaa0000-0000-0000-0000-0000000000e2'::uuid,'dcaa0000-0000-0000-0000-0000000000ab'::uuid)
  ) AS v(sid, cid)
 WHERE NOT EXISTS (
   SELECT 1 FROM student_class_enrolments e
    WHERE e.student_id = v.sid AND e.class_id = v.cid);

-- ── The ⚠ RISK 8 subject: an unmarked PAST lesson of the REPLACEMENT's class
-- ── on which the TARGET is the substitute ───────────────────────────────────
-- After the disable only an admin can mark it; the dialog must name it under
-- "marking these falls to you". Unmarked, deliberately — a marked lesson
-- leaves the list. (guard_session_date returns early for a superuser, which is
-- how a past-dated insert is permitted at all.)
INSERT INTO lesson_sessions (id, class_id, session_date, status)
SELECT 'dcaa0000-0000-0000-0000-0000000000d1','dcaa0000-0000-0000-0000-0000000000ab',
       dc.override_date, 'scheduled'
  FROM dc
ON CONFLICT (id) DO NOTHING;

INSERT INTO session_coaches (tenant_id, lesson_session_id, coach_id, assigned_by)
SELECT '70000000-0000-0000-0000-000000000001',
       'dcaa0000-0000-0000-0000-0000000000d1', c.id,
       'c0000000-0000-0000-0000-000000000001'
  FROM coaches c
 WHERE c.profile_id = 'dcaa0000-0000-0000-0000-000000000001'
   AND NOT EXISTS (
     SELECT 1 FROM session_coaches sc
      WHERE sc.lesson_session_id = 'dcaa0000-0000-0000-0000-0000000000d1');

-- ── Postconditions — fail at APPLY time, not twenty minutes later ───────────
DO $$
DECLARE
  v_coaches INT; v_admins INT; v_ovr INT;
BEGIN
  SELECT count(*) INTO v_coaches FROM coaches c
   WHERE c.profile_id IN ('dcaa0000-0000-0000-0000-000000000001',
                          'dcaa0000-0000-0000-0000-000000000002')
     AND c.disabled_at IS NULL;
  IF v_coaches <> 2 THEN
    RAISE EXCEPTION 'fixture: expected 2 ACTIVE coaches rows, found %. A prior '
                    'driver run may have left dc-target disabled — run the '
                    'teardown first.', v_coaches;
  END IF;

  SELECT count(*) INTO v_admins FROM profiles p
   WHERE p.id IN ('dcaa0000-0000-0000-0000-000000000001',
                  'dcaa0000-0000-0000-0000-000000000002')
     AND p.role = 'tenant_admin';
  IF v_admins <> 0 THEN
    RAISE EXCEPTION 'fixture: a fixture coach is ALSO a tenant admin (% rows) — '
                    'no coach-side narrowing is observable on such an account '
                    '(§7.131).', v_admins;
  END IF;

  SELECT count(*) INTO v_ovr FROM session_coaches
   WHERE lesson_session_id = 'dcaa0000-0000-0000-0000-0000000000d1';
  IF v_ovr <> 1 THEN
    RAISE EXCEPTION 'fixture: the ⚠ RISK 8 override row is missing — the '
                    'dialog''s marking-backlog list would be vacuously empty.';
  END IF;
END $$;

SELECT today, override_date, class_dow FROM dc;
