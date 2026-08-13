-- Teardown for fixtures-coach-disable.sql + verify-coach-disable.mjs.
--
-- Session rows are deleted BY CLASS, not by id (§7.132's safe direction) —
-- the driver's admin could conceivably mark the override lesson, and the
-- disable itself writes class_rates rows (cascade with the class) and
-- audit_log rows (deleted here by entity, before the coaches go).
--
-- Run (from repo root):
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-coach-disable-teardown.sql

\set ON_ERROR_STOP on

-- ── Everything hanging off the two fixture classes ──────────────────────────
CREATE TEMP TABLE dc_sessions AS
SELECT ls.id
  FROM lesson_sessions ls
 WHERE ls.class_id IN ('dcaa0000-0000-0000-0000-0000000000aa',
                       'dcaa0000-0000-0000-0000-0000000000ab');

DELETE FROM attendance             WHERE lesson_session_id IN (SELECT id FROM dc_sessions);
DELETE FROM session_coach_absences WHERE lesson_session_id IN (SELECT id FROM dc_sessions);
DELETE FROM session_coaches        WHERE lesson_session_id IN (SELECT id FROM dc_sessions);
DELETE FROM lesson_sessions        WHERE id IN (SELECT id FROM dc_sessions);

DELETE FROM class_shadow_coaches
 WHERE class_id IN ('dcaa0000-0000-0000-0000-0000000000aa',
                    'dcaa0000-0000-0000-0000-0000000000ab');
DELETE FROM trial_bookings  WHERE class_id IN ('dcaa0000-0000-0000-0000-0000000000aa',
                                               'dcaa0000-0000-0000-0000-0000000000ab');
DELETE FROM makeup_bookings WHERE class_id IN ('dcaa0000-0000-0000-0000-0000000000aa',
                                               'dcaa0000-0000-0000-0000-0000000000ab');
DELETE FROM student_class_enrolments
 WHERE class_id IN ('dcaa0000-0000-0000-0000-0000000000aa',
                    'dcaa0000-0000-0000-0000-0000000000ab');

-- ── Audit rows BEFORE the entities they cite ────────────────────────────────
-- The disable writes 'Coach' rows (entity = the coach id) and set_class_terms
-- writes 'Class' rows; both actors are seed identities that survive, so only
-- the entity scoping matters here.
DELETE FROM audit_log
 WHERE entity_id IN ('dcaa0000-0000-0000-0000-0000000000aa',
                     'dcaa0000-0000-0000-0000-0000000000ab',
                     'dcaa0000-0000-0000-0000-0000000000e1',
                     'dcaa0000-0000-0000-0000-0000000000e2')
    OR entity_id IN (SELECT id FROM coaches
                      WHERE profile_id IN ('dcaa0000-0000-0000-0000-000000000001',
                                           'dcaa0000-0000-0000-0000-000000000002'))
    OR actor_id  IN ('dcaa0000-0000-0000-0000-000000000001',
                     'dcaa0000-0000-0000-0000-000000000002');

DELETE FROM parent_students WHERE student_id IN ('dcaa0000-0000-0000-0000-0000000000e1',
                                                 'dcaa0000-0000-0000-0000-0000000000e2');
DELETE FROM students WHERE id IN ('dcaa0000-0000-0000-0000-0000000000e1',
                                  'dcaa0000-0000-0000-0000-0000000000e2');

-- ── The classes (class_rates rows cascade with them) ────────────────────────
DELETE FROM classes WHERE id IN ('dcaa0000-0000-0000-0000-0000000000aa',
                                 'dcaa0000-0000-0000-0000-0000000000ab');

-- ── The two coaches, and their accounts ─────────────────────────────────────
DELETE FROM coach_payout_items WHERE payout_id IN (
  SELECT p.id FROM coach_payouts p JOIN coaches c ON c.id = p.coach_id
   WHERE c.profile_id IN ('dcaa0000-0000-0000-0000-000000000001',
                          'dcaa0000-0000-0000-0000-000000000002'));
DELETE FROM coach_payouts WHERE coach_id IN (
  SELECT id FROM coaches WHERE profile_id IN ('dcaa0000-0000-0000-0000-000000000001',
                                              'dcaa0000-0000-0000-0000-000000000002'));
DELETE FROM coach_rates WHERE coach_id IN (
  SELECT id FROM coaches WHERE profile_id IN ('dcaa0000-0000-0000-0000-000000000001',
                                              'dcaa0000-0000-0000-0000-000000000002'));
DELETE FROM coaches WHERE profile_id IN ('dcaa0000-0000-0000-0000-000000000001',
                                         'dcaa0000-0000-0000-0000-000000000002');
DELETE FROM auth.users WHERE id IN ('dcaa0000-0000-0000-0000-000000000001',
                                    'dcaa0000-0000-0000-0000-000000000002');
-- profiles is ON DELETE CASCADE from auth.users; belt and braces if that changes.
DELETE FROM profiles WHERE id IN ('dcaa0000-0000-0000-0000-000000000001',
                                  'dcaa0000-0000-0000-0000-000000000002');

-- ── The proof: 0 removed-rows left, and the seed identities SURVIVED ────────
SELECT
  (SELECT count(*) FROM classes
    WHERE id IN ('dcaa0000-0000-0000-0000-0000000000aa',
                 'dcaa0000-0000-0000-0000-0000000000ab'))          AS classes_left,
  (SELECT count(*) FROM lesson_sessions
    WHERE class_id IN ('dcaa0000-0000-0000-0000-0000000000aa',
                       'dcaa0000-0000-0000-0000-0000000000ab'))    AS sessions_left,
  (SELECT count(*) FROM students
    WHERE id::text LIKE 'dcaa0000-%')                              AS students_left,
  (SELECT count(*) FROM coaches
    WHERE profile_id::text LIKE 'dcaa0000-%')                      AS coaches_left,
  (SELECT count(*) FROM auth.users
    WHERE id::text LIKE 'dcaa0000-%')                              AS users_left,
  (SELECT count(*) FROM profiles
    WHERE id = 'c0000000-0000-0000-0000-000000000001')             AS seed_coach_survived;
