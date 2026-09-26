-- Teardown for fixtures-coach-schedule-roles.sql — removes the CoachSched
-- business and everything in it. The driver's only write is the clamp step's
-- `UPDATE classes SET is_active=false` on the fixture's own Covered class
-- (restored in its `finally`); deleting the classes here covers a crash
-- between the two regardless.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-coach-schedule-roles-teardown.sql
--
-- Scoped by the tenant id, exact ids and the full 'd8000000-' block, never a
-- 2-char prefix (§7.280). FK order: audit_log (actor_id → profile) before the
-- profiles (§7.50); session_coaches / attendance before sessions.

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM audit_log
 WHERE tenant_id = 'd8000000-0000-0000-0000-000000000001'
    OR entity_id IN (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'd8000000-%')
    OR actor_id IN ('d8000000-0000-0000-0000-0000000000a1','d8000000-0000-0000-0000-0000000000a2',
                    'd8000000-0000-0000-0000-0000000000a3');
DELETE FROM session_coaches
 WHERE tenant_id = 'd8000000-0000-0000-0000-000000000001'
    OR lesson_session_id IN (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'd8000000-%');
DELETE FROM attendance
 WHERE lesson_session_id IN (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'd8000000-%');
DELETE FROM session_coach_absences  WHERE tenant_id = 'd8000000-0000-0000-0000-000000000001';
DELETE FROM lesson_sessions         WHERE class_id::text LIKE 'd8000000-%';
DELETE FROM class_shadow_coaches    WHERE tenant_id = 'd8000000-0000-0000-0000-000000000001';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'd8000000-%';
DELETE FROM students                WHERE tenant_id = 'd8000000-0000-0000-0000-000000000001';
DELETE FROM classes                 WHERE tenant_id = 'd8000000-0000-0000-0000-000000000001';
DELETE FROM locations               WHERE tenant_id = 'd8000000-0000-0000-0000-000000000001';
DELETE FROM class_categories        WHERE tenant_id = 'd8000000-0000-0000-0000-000000000001';
DELETE FROM skill_grade_levels      WHERE tenant_id = 'd8000000-0000-0000-0000-000000000001';
DELETE FROM coaches  WHERE profile_id IN ('d8000000-0000-0000-0000-0000000000a1','d8000000-0000-0000-0000-0000000000a2',
                                          'd8000000-0000-0000-0000-0000000000a3');
DELETE FROM profiles WHERE id IN ('d8000000-0000-0000-0000-0000000000a1','d8000000-0000-0000-0000-0000000000a2',
                                  'd8000000-0000-0000-0000-0000000000a3');
DELETE FROM auth.users WHERE id IN ('d8000000-0000-0000-0000-0000000000a1','d8000000-0000-0000-0000-0000000000a2',
                                    'd8000000-0000-0000-0000-0000000000a3');
DELETE FROM tenants  WHERE id = 'd8000000-0000-0000-0000-000000000001';

COMMIT;

-- Expect 0, 0, 0, 0, 0, then 1 (the seed tenant survived).
SELECT (SELECT count(*) FROM tenants WHERE id = 'd8000000-0000-0000-0000-000000000001')           AS tenant,
       (SELECT count(*) FROM classes WHERE id::text LIKE 'd8000000-%')                           AS classes,
       (SELECT count(*) FROM lesson_sessions WHERE class_id::text LIKE 'd8000000-%')             AS sessions,
       (SELECT count(*) FROM students WHERE id::text LIKE 'd8000000-%')                          AS students,
       (SELECT count(*) FROM auth.users WHERE id::text LIKE 'd8000000-%')                        AS users,
       (SELECT count(*) FROM tenants WHERE id = '70000000-0000-0000-0000-000000000001')           AS seed_tenant;
