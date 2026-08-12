-- Teardown for fixtures-coach-roster.sql + verify-coach-roster.mjs.
--
-- ⚠ THE LESSON ROWS ARE DELETED BY CLASS — EVERY MONTH OF IT — NOT BY ID (§7.132).
-- assign_session_coach() RESOLVES-OR-CREATES the lesson_sessions row when none
-- exists, so the driver creates rows this fixture never named. A teardown keyed
-- to the fixture's own fixed UUIDs left TWO orphan empty lesson rows behind the
-- first time this was done, found only by listing the roster BEFORE tearing down
-- rather than after. check-fixture-roundtrip.sh does NOT catch them: it diffs
-- the fixture, and the orphans come from the driver.
--
-- Class-scoped is deliberately WIDER than the "(class, month)" §7.132 asks for,
-- and wider is the safe direction: the fixture's lesson is `today - 7` and its
-- off-pattern row is a day either side of that, so a run near the 1st straddles
-- two months. Scoping to a month would leave the other one behind. These two
-- classes are the fixture's own and hold nothing else.
--
-- Everything else is deleted by EXACT id or by the fixture's own UUID prefix,
-- never by a name pattern: `LIKE '%RosterCov%'` works today and takes a real
-- family called Rostercovic later.
--
-- Run (from repo root):
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-coach-roster-teardown.sql

\set ON_ERROR_STOP on

-- ── Everything hanging off the two fixture classes, WHOLE MONTHS ──────────
CREATE TEMP TABLE rc_sessions AS
SELECT ls.id
  FROM lesson_sessions ls
 WHERE ls.class_id IN ('c7000000-0000-0000-0000-00000000000a',
                       'c7000000-0000-0000-0000-00000000000b');

DELETE FROM attendance             WHERE lesson_session_id IN (SELECT id FROM rc_sessions);
DELETE FROM session_coach_absences WHERE lesson_session_id IN (SELECT id FROM rc_sessions);
DELETE FROM session_coaches        WHERE lesson_session_id IN (SELECT id FROM rc_sessions);
DELETE FROM lesson_sessions        WHERE id IN (SELECT id FROM rc_sessions);

-- ⚠ CLASS-SCOPED, LIKE THE SESSIONS ABOVE AND FOR THE SAME REASON (§7.132).
-- A shadow assignment is keyed to the CLASS, not to a lesson, so it survives
-- every session delete above and the next run inherits it — the driver would
-- then start with a shadow it never created and its first check would be
-- measuring somebody else's fixture.
DELETE FROM class_shadow_coaches
 WHERE class_id IN ('c7000000-0000-0000-0000-00000000000a',
                    'c7000000-0000-0000-0000-00000000000b');

DELETE FROM trial_bookings  WHERE class_id IN ('c7000000-0000-0000-0000-00000000000a',
                                               'c7000000-0000-0000-0000-00000000000b');
DELETE FROM makeup_bookings WHERE class_id IN ('c7000000-0000-0000-0000-00000000000a',
                                               'c7000000-0000-0000-0000-00000000000b');
DELETE FROM student_class_enrolments
 WHERE class_id IN ('c7000000-0000-0000-0000-00000000000a',
                    'c7000000-0000-0000-0000-00000000000b');

-- ── The children ─────────────────────────────────────────────────────────
-- audit_log first: the student-edit trigger writes rows whose actor_id is NOT
-- NULL with NO ACTION, so a profile cannot be deleted while one survives (§7.50).
DELETE FROM audit_log
 WHERE entity_id IN ('c7000000-0000-0000-0000-00000000000e',
                     'c7000000-0000-0000-0000-00000000000f',
                     'c7000000-0000-0000-0000-000000000010')
    OR actor_id  IN ('c7000000-0000-0000-0000-000000000001',
                     'c7000000-0000-0000-0000-000000000002');
DELETE FROM parent_students WHERE student_id IN ('c7000000-0000-0000-0000-00000000000e',
                                                 'c7000000-0000-0000-0000-00000000000f',
                                                 'c7000000-0000-0000-0000-000000000010');
DELETE FROM students WHERE id IN ('c7000000-0000-0000-0000-00000000000e',
                                  'c7000000-0000-0000-0000-00000000000f',
                                  'c7000000-0000-0000-0000-000000000010');

-- ── The classes ──────────────────────────────────────────────────────────
DELETE FROM classes WHERE id IN ('c7000000-0000-0000-0000-00000000000a',
                                 'c7000000-0000-0000-0000-00000000000b');

-- ── The two coaches, and their accounts ──────────────────────────────────
DELETE FROM coach_payout_items WHERE payout_id IN (
  SELECT p.id FROM coach_payouts p JOIN coaches c ON c.id = p.coach_id
   WHERE c.profile_id IN ('c7000000-0000-0000-0000-000000000001',
                          'c7000000-0000-0000-0000-000000000002'));
DELETE FROM coach_payouts WHERE coach_id IN (
  SELECT id FROM coaches WHERE profile_id IN ('c7000000-0000-0000-0000-000000000001',
                                              'c7000000-0000-0000-0000-000000000002'));
DELETE FROM coach_rates WHERE coach_id IN (
  SELECT id FROM coaches WHERE profile_id IN ('c7000000-0000-0000-0000-000000000001',
                                              'c7000000-0000-0000-0000-000000000002'));
DELETE FROM coaches WHERE profile_id IN ('c7000000-0000-0000-0000-000000000001',
                                         'c7000000-0000-0000-0000-000000000002');
DELETE FROM auth.users WHERE id IN ('c7000000-0000-0000-0000-000000000001',
                                    'c7000000-0000-0000-0000-000000000002');
-- profiles is ON DELETE CASCADE from auth.users; belt and braces if that changes.
DELETE FROM profiles WHERE id IN ('c7000000-0000-0000-0000-000000000001',
                                  'c7000000-0000-0000-0000-000000000002');

-- ── The proof: 0 for everything removed, 1 for each seed identity that must ──
-- ── have SURVIVED. A teardown that took the seed coach with it is worse than ─
-- ── one that left rows behind. ───────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM classes
    WHERE id IN ('c7000000-0000-0000-0000-00000000000a',
                 'c7000000-0000-0000-0000-00000000000b'))                    AS classes_left,
  (SELECT count(*) FROM lesson_sessions
    WHERE class_id IN ('c7000000-0000-0000-0000-00000000000a',
                       'c7000000-0000-0000-0000-00000000000b'))              AS sessions_left,
  (SELECT count(*) FROM session_coaches sc
     JOIN lesson_sessions ls ON ls.id = sc.lesson_session_id
    WHERE ls.class_id IN ('c7000000-0000-0000-0000-00000000000a',
                          'c7000000-0000-0000-0000-00000000000b'))           AS roster_rows_left,
  (SELECT count(*) FROM class_shadow_coaches
    WHERE class_id IN ('c7000000-0000-0000-0000-00000000000a',
                       'c7000000-0000-0000-0000-00000000000b'))              AS shadow_rows_left,
  (SELECT count(*) FROM students
    WHERE id::text LIKE 'c7000000-%')                                        AS students_left,
  (SELECT count(*) FROM coaches
    WHERE profile_id::text LIKE 'c7000000-%')                                AS coaches_left,
  (SELECT count(*) FROM auth.users
    WHERE id::text LIKE 'c7000000-%')                                        AS users_left,
  (SELECT count(*) FROM profiles
    WHERE id = 'c0000000-0000-0000-0000-000000000001')                       AS seed_coach_survived;
