-- pgTAP: THE MARKING FLOOR FOLLOWS billing_periods, NOT THE CALENDAR.
-- markable_floor(), and the five callers that now ask it (20260806000200).
--
-- WHAT THIS FILE EXISTS TO PROTECT. 20260727000100 floored the marking window
-- at the 1st of last month and enforced it in the database. Its own §10.1
-- recorded the cost: bill AUGUST on 5 OCTOBER with one unmarked lesson and the
-- gate names a lesson NOBODY can record any more — no coach, no admin, no
-- override by design — so the month can never bill. Assertion 9 is that case,
-- end to end: a coach marking a lesson that the calendar rule would refuse.
--
-- ⚠ ASSERTION 8 IS THE MOST IMPORTANT IN THIS FILE, AND IT IS NOT AN EXAMPLE.
-- The whole safety argument for this change is that the floor can only ever
-- move EARLIER than the calendar rule, never later — so no date markable before
-- the migration became unmarkable after it. Assertion 8 checks that as a
-- PROPERTY over every tenant this fixture builds, rather than case by case. A
-- GREATEST typo, a reordered COALESCE, or a future term added in the wrong
-- place fails it even when all seven named examples still pass. If you edit
-- markable_floor(), that is the assertion to watch.
--
-- WHY THE DATES ARE COMPUTED, NOT HARDCODED. The rule under test is relative to
-- now(), so a fixed date would mean something different next month — the
-- disease §7.33 describes, which already cost this repo a day of red suite.
-- Every date here derives from ONE anchor so the relationships hold whatever
-- day it runs. The anchor is written out in full rather than calling today_sg(),
-- so a bug in that function cannot move the fixture to match itself.
--
-- WHY d_below IS 70 DAYS BEFORE d_reopen, not an arbitrary older date: 70 is a
-- whole number of weeks, so both fall on the class's own weekday. Otherwise the
-- refusals below would pass because of the WEEKDAY rule while the floor rule was
-- broken, and this file would be green against a floor that does nothing.
--
-- METHOD (§7.16): every client probe runs inside this explicit transaction with
-- SET LOCAL ROLE. Outside one, SET LOCAL ROLE is a no-op, the session stays
-- superuser, RLS is bypassed and every assertion "passes" — including the ones
-- that must fail. The refusals also assert NOTHING WAS WRITTEN: a gate that
-- raises after writing is not a gate.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(18);

-- ── The dates, from one anchor ──────────────────────────────────────────────
--   d_cal        1st of last month              the CALENDAR floor, today's rule
--   m_seal_a     3 months back, 'YYYY-MM'       what business A has sealed
--   d_floor_a    1st of 2 months back           so A's floor is the month AFTER it
--   d_reopen     15th of 2 months back          BELOW d_cal, ABOVE d_floor_a —
--                                               markable only because of this change
--   d_extra      d_reopen + 1                   a second reopened date, any weekday
--   d_below      d_reopen - 70 days             same weekday, below A's floor too
--   m_seal_d     last month, 'YYYY-MM'          business D: seal that changes nothing
--   d_created_b  6 months back                  business B: the created_at fallback
CREATE TEMP TABLE f AS
SELECT
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '1 month')::date                                   AS d_cal,
  to_char((now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '3 months',
          'YYYY-MM')                                               AS m_seal_a,
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '2 months')::date                                  AS d_floor_a,
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '2 months' + INTERVAL '14 days')::date             AS d_reopen,
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '2 months' + INTERVAL '15 days')::date             AS d_extra,
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '2 months' + INTERVAL '14 days' - INTERVAL '70 days')::date
                                                                   AS d_below,
  to_char((now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '1 month',
          'YYYY-MM')                                               AS m_seal_d,
  ((now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '6 months')::date
                                                                   AS d_created_b;
GRANT SELECT ON f TO PUBLIC;


-- ── Four businesses, one per state markable_floor() can be in ───────────────
--   A  sealed 3 months back      → floor is the month after that seal
--   B  never sealed, old         → floor is created_at
--   C  never sealed, brand new   → floor is the calendar rule (LEAST wins)
--   D  sealed last month         → floor is the calendar rule (LEAST wins)
INSERT INTO tenants (id, slug, display_name, join_code, created_at) VALUES
  ('78777777-0000-0000-0000-00000000000a','floor-a','FLOOR Business A','SWIM-FLRA', now()),
  ('78777777-0000-0000-0000-00000000000b','floor-b','FLOOR Business B','SWIM-FLRB',
     (SELECT d_created_b FROM f)),
  ('78777777-0000-0000-0000-00000000000c','floor-c','FLOOR Business C','SWIM-FLRC', now()),
  ('78777777-0000-0000-0000-00000000000d','floor-d','FLOOR Business D','SWIM-FLRD', now());

INSERT INTO billing_periods (tenant_id, billing_month)
SELECT '78777777-0000-0000-0000-00000000000a', m_seal_a FROM f;
INSERT INTO billing_periods (tenant_id, billing_month)
SELECT '78777777-0000-0000-0000-00000000000d', m_seal_d FROM f;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','78100000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','floor-admin-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"FLOOR Admin A","role":"tenant_admin","tenant_id":"78777777-0000-0000-0000-00000000000a"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','78100000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','floor-coach-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"FLOOR Coach A","role":"coach","tenant_id":"78777777-0000-0000-0000-00000000000a"}', now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE t.id = '78777777-0000-0000-0000-00000000000a'
   AND NOT EXISTS (
     SELECT 1 FROM class_categories c
      WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

-- Both classes run on d_reopen's weekday, so d_reopen AND d_below are real
-- lesson dates and only the FLOOR can refuse them. Two classes because a
-- make-up needs a host that is not the child's own class.
-- classes.location_id is NOT NULL since the location contract migration
-- (20260824000200). Give every tenant one location to hang classes off,
-- tenant-agnostic and idempotent (mirrors the Default Group category block).
INSERT INTO locations (tenant_id, name)
SELECT t.id, 'Default location' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM locations l
    WHERE l.tenant_id = t.id AND lower(trim(l.name)) = 'default location');

INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                     end_time, location_id, price_per_lesson, category_id)
SELECT
  ids.id, '78777777-0000-0000-0000-00000000000a',
  (SELECT id FROM coaches WHERE profile_id='78100000-0000-0000-0000-0000000000c1'),
  ids.title,
  (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    )[EXTRACT(DOW FROM f.d_reopen)::int + 1]::day_of_week,
  '10:00','11:00',(SELECT l.id FROM locations l WHERE l.tenant_id = '78777777-0000-0000-0000-00000000000a' AND lower(trim(l.name)) = 'default location'), 30,
  (SELECT id FROM class_categories
    WHERE tenant_id='78777777-0000-0000-0000-00000000000a'
      AND lower(trim(name))='default group')
FROM f, (VALUES
  ('78777777-1111-0000-0000-00000000000a'::UUID,'FLOOR Home Class'),
  ('78777777-1111-0000-0000-00000000000b'::UUID,'FLOOR Host Class')
) AS ids(id, title);

INSERT INTO students (id, full_name, assignment_status, tenant_id) VALUES
  ('78500000-0000-0000-0000-000000000001','Floor Kid','assigned','78777777-0000-0000-0000-00000000000a'),
  ('78500000-0000-0000-0000-000000000002','Floor Makeup Kid','assigned','78777777-0000-0000-0000-00000000000a'),
  -- Deliberately NOT enrolled: book_trial refuses a child who already is.
  ('78500000-0000-0000-0000-000000000003','Floor Trial Kid','unassigned','78777777-0000-0000-0000-00000000000a');

INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
  ('78500000-0000-0000-0000-000000000001','78777777-1111-0000-0000-00000000000a', TRUE),
  ('78500000-0000-0000-0000-000000000002','78777777-1111-0000-0000-00000000000a', TRUE);

-- Scoped to these classes on purpose: a bare COUNT(*) taken as postgres and
-- compared under SET LOCAL ROLE would be counting different rows (§ the same
-- trap attendance_window.test.sql documents), so both sides read the same set.
CREATE TEMP TABLE f_baseline AS
  SELECT (SELECT COUNT(*)::INT FROM lesson_sessions
           WHERE class_id IN ('78777777-1111-0000-0000-00000000000a',
                              '78777777-1111-0000-0000-00000000000b')) AS sessions;
GRANT SELECT ON f_baseline TO PUBLIC;


-- ══ 1-2. A sealed month moves the floor, and moves it EARLIER ═══════════════

SELECT is(
  (SELECT markable_floor('78777777-0000-0000-0000-00000000000a')),
  (SELECT d_floor_a FROM f),
  'a business that sealed 3 months ago may mark back to the month AFTER that seal');

SELECT ok(
  (SELECT markable_floor('78777777-0000-0000-0000-00000000000a') < session_window_start()),
  'and that floor is EARLIER than the calendar rule — this is the deadlock fix');


-- ══ 3-6. The other three states ═════════════════════════════════════════════

SELECT is(
  (SELECT markable_floor('78777777-0000-0000-0000-00000000000b')),
  (SELECT d_created_b FROM f),
  'a business that has NEVER billed may mark back to the day it was created');

SELECT is(
  (SELECT markable_floor('78777777-0000-0000-0000-00000000000c')),
  (SELECT session_window_start()),
  'a business created today keeps the calendar floor — LEAST, not the fallback');

-- If the MAX(billing_month) subquery ever lost its tenant_id filter, C would
-- inherit A's seal and read d_floor_a. Sealing is per (tenant, month) since
-- 20260718001100 precisely so one business finishing a month cannot close it
-- for everyone else.
SELECT isnt(
  (SELECT markable_floor('78777777-0000-0000-0000-00000000000c')),
  (SELECT d_floor_a FROM f),
  'one business''s seal does not move another business''s floor');

SELECT is(
  (SELECT markable_floor('78777777-0000-0000-0000-00000000000d')),
  (SELECT session_window_start()),
  'a seal for LAST month leaves the floor exactly where it was — no behaviour change');


-- ══ 7. An unresolvable tenant degrades to the old rule, never to an error ═══
-- Both guard triggers pass their lookup straight through, so this is what
-- happens when a class resolves to no tenant. Returning NULL or raising here
-- would turn a data oddity into "no coach can mark anything".

SELECT is(
  (SELECT markable_floor(NULL)),
  (SELECT session_window_start()),
  'markable_floor(NULL) is the calendar floor — fails open, not closed');


-- ══ 8. ⚠ THE SAFETY PROPERTY, over every tenant, not one example ════════════
-- Read the file header before touching this one.

SELECT is(
  (SELECT COUNT(*)::INT FROM tenants t
    WHERE markable_floor(t.id) > session_window_start()),
  0,
  'NO tenant gets a floor later than the calendar rule — the window can only ever widen');


-- ══ 9-12. The coach, on a date the calendar rule would have refused ═════════

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"78100000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- 9. THE CASE THIS WHOLE CHANGE EXISTS FOR. d_reopen is below the calendar
--    floor, so before 20260806000200 this raised and the month it belongs to
--    could never be billed.
SELECT lives_ok(
  $$ INSERT INTO lesson_sessions (id, class_id, session_date)
     SELECT '78400000-0000-0000-0000-00000000000a','78777777-1111-0000-0000-00000000000a', d_reopen FROM f $$,
  'a coach CAN create a session below the calendar floor when the month is not sealed');

-- 10. …and mark it, which is the half that actually unblocks billing.
SELECT lives_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     VALUES ('78400000-0000-0000-0000-00000000000a','78500000-0000-0000-0000-000000000001',
             'present','78100000-0000-0000-0000-0000000000c1') $$,
  'a coach CAN mark attendance on that reopened lesson');

-- 11. The floor still exists. Same weekday as d_reopen, so only the floor can
--     be doing the refusing.
SELECT throws_ok(
  $$ INSERT INTO lesson_sessions (class_id, session_date)
     SELECT '78777777-1111-0000-0000-00000000000a', d_below FROM f $$,
  'P0001',
  NULL,
  'a coach still cannot create a session below the business''s own floor');

-- 12. A gate that raises after writing is not a gate.
SELECT is(
  (SELECT COUNT(*)::INT FROM lesson_sessions
    WHERE class_id IN ('78777777-1111-0000-0000-00000000000a',
                       '78777777-1111-0000-0000-00000000000b')),
  (SELECT sessions + 1 FROM f_baseline),
  'exactly the one accepted session was written — the refusal wrote nothing');


-- ══ 13-18. The three admin RPCs ask the same floor ══════════════════════════
-- Arranging is the admin's, observing is the coach's — so these run as the
-- admin. All three used to read session_window_start() directly, except
-- book_trial, which had NO floor at all until 20260806000200.

SET LOCAL "request.jwt.claims" TO '{"sub":"78100000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 13-14. book_trial — the ONE refusal in this migration that did not exist
--        before it. Both directions, because a floor that refuses everything
--        would satisfy 13 alone.
SELECT throws_ok(
  $$ SELECT book_trial('78777777-1111-0000-0000-00000000000a',
                       (SELECT d_below FROM f),
                       '78500000-0000-0000-0000-000000000003') $$,
  'P0001',
  NULL,
  'book_trial now refuses a booking below the floor — it had no floor at all before');

SELECT lives_ok(
  $$ SELECT book_trial('78777777-1111-0000-0000-00000000000a',
                       (SELECT d_reopen FROM f),
                       '78500000-0000-0000-0000-000000000003') $$,
  'book_trial still accepts a booking above the floor');

-- 15-16. schedule_extra_lesson. No weekday rule here by design, so d_extra can
--        be any day; only the floor is under test.
SELECT throws_ok(
  $$ SELECT schedule_extra_lesson('78777777-1111-0000-0000-00000000000a',
                                  (SELECT d_below FROM f), 'pool closed') $$,
  'P0001',
  NULL,
  'schedule_extra_lesson refuses a date below the floor');

SELECT lives_ok(
  $$ SELECT schedule_extra_lesson('78777777-1111-0000-0000-00000000000a',
                                  (SELECT d_extra FROM f), 'pool closed') $$,
  'schedule_extra_lesson accepts a reopened date the calendar rule would have refused');

-- 17-18. book_makeup — an enrolled child guesting into the host class.
SELECT throws_ok(
  $$ SELECT book_makeup('78777777-1111-0000-0000-00000000000b',
                        (SELECT d_below FROM f),
                        '78500000-0000-0000-0000-000000000002') $$,
  'P0001',
  NULL,
  'book_makeup refuses a booking below the floor');

SELECT lives_ok(
  $$ SELECT book_makeup('78777777-1111-0000-0000-00000000000b',
                        (SELECT d_reopen FROM f),
                        '78500000-0000-0000-0000-000000000002') $$,
  'book_makeup accepts a reopened date the calendar rule would have refused');


SELECT * FROM finish();
ROLLBACK;
