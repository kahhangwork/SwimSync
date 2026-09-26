-- Teardown for fixtures-lesson-detail-guests.sql — removes the LGuest business and
-- everything in it, including what the DRIVER wrote (trial / make-up bookings,
-- a lesson session with its attendance, the RPCs' audit trail).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-lesson-detail-guests-teardown.sql
--
-- Scoped by the tenant id and the full 'b3000000-' block, never a 2-char
-- prefix (§7.280). Order is FK order: marks and substitutes before sessions,
-- bookings before classes and children, coaches before profiles.

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM session_coaches   WHERE lesson_session_id IN
  (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'b3000000-%');
DELETE FROM session_coach_absences WHERE lesson_session_id IN
  (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'b3000000-%');
DELETE FROM attendance        WHERE lesson_session_id IN
  (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'b3000000-%');
-- The admin's save audits against the (random-id) session; the booking RPCs
-- audit against the child. Both are this business's rows.
DELETE FROM audit_log         WHERE entity_id IN
  (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'b3000000-%');
DELETE FROM audit_log         WHERE entity_id::text LIKE 'b3000000-%';
DELETE FROM audit_log         WHERE tenant_id = 'b3000000-0000-0000-0000-000000000001';
DELETE FROM lesson_sessions   WHERE class_id::text LIKE 'b3000000-%';
DELETE FROM trial_bookings    WHERE tenant_id = 'b3000000-0000-0000-0000-000000000001';
DELETE FROM makeup_bookings   WHERE tenant_id = 'b3000000-0000-0000-0000-000000000001';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'b3000000-%';
DELETE FROM students          WHERE tenant_id = 'b3000000-0000-0000-0000-000000000001';
DELETE FROM class_rates       WHERE class_id::text LIKE 'b3000000-%';
DELETE FROM classes           WHERE tenant_id = 'b3000000-0000-0000-0000-000000000001';
DELETE FROM locations         WHERE tenant_id = 'b3000000-0000-0000-0000-000000000001';
DELETE FROM class_categories  WHERE tenant_id = 'b3000000-0000-0000-0000-000000000001';
UPDATE tenants SET owner_profile_id = NULL WHERE id = 'b3000000-0000-0000-0000-000000000001';
DELETE FROM coaches           WHERE profile_id IN
  ('b3000000-0000-0000-0000-0000000000a1','b3000000-0000-0000-0000-0000000000a2');
DELETE FROM profiles          WHERE id IN
  ('b3000000-0000-0000-0000-0000000000a1','b3000000-0000-0000-0000-0000000000a2');
DELETE FROM auth.users        WHERE id IN
  ('b3000000-0000-0000-0000-0000000000a1','b3000000-0000-0000-0000-0000000000a2');
DELETE FROM tenants           WHERE id = 'b3000000-0000-0000-0000-000000000001';

COMMIT;

-- Expect 0, 0, 0.
SELECT (SELECT count(*) FROM tenants  WHERE id = 'b3000000-0000-0000-0000-000000000001') AS tenant,
       (SELECT count(*) FROM students WHERE id::text LIKE 'b3000000-%')                   AS students,
       (SELECT count(*) FROM auth.users WHERE id::text LIKE 'b3000000-%')                 AS users;
