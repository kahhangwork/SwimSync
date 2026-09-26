-- Teardown for fixtures-coach-marking.sql — removes the CoachMark business and
-- everything in it, including what the DRIVER wrote: the credit note the
-- correction issued, the parent balance it credited, the lesson_sessions row
-- the first save created, its attendance, and the attendance_saved audit rows.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-coach-marking-teardown.sql
--
-- Scoped by the tenant id, exact ids and the full 'd7000000-' block, never a
-- 2-char prefix (§7.280). Audit rows go BY ENTITY ID (the fixture's sessions)
-- and by tenant — never by a seed actor (plan U10). FK order: audit_log
-- (actor_id → profile) before the profiles (§7.50); credit_notes before
-- invoice_items / lesson_sessions; attendance before sessions.

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM audit_log
 WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001'
    OR entity_id IN (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'd7000000-%')
    OR actor_id IN ('d7000000-0000-0000-0000-0000000000a1','d7000000-0000-0000-0000-0000000000a2',
                    'd7000000-0000-0000-0000-0000000000f1');
DELETE FROM credit_notes            WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';
DELETE FROM parent_tenant_balances  WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';
DELETE FROM invoices                WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';  -- items cascade
DELETE FROM attendance
 WHERE lesson_session_id IN (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'd7000000-%');
DELETE FROM session_coach_absences  WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';
DELETE FROM lesson_sessions         WHERE class_id::text LIKE 'd7000000-%';
DELETE FROM class_shadow_coaches    WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'd7000000-%';
DELETE FROM parent_students         WHERE student_id::text LIKE 'd7000000-%';
DELETE FROM parent_tenants          WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';
DELETE FROM students                WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';
DELETE FROM classes                 WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';
DELETE FROM locations               WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';
DELETE FROM class_categories        WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';
DELETE FROM skill_grade_levels      WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';
DELETE FROM coaches  WHERE profile_id IN ('d7000000-0000-0000-0000-0000000000a1','d7000000-0000-0000-0000-0000000000a2');
DELETE FROM parents  WHERE profile_id = 'd7000000-0000-0000-0000-0000000000f1';
DELETE FROM profiles WHERE id IN ('d7000000-0000-0000-0000-0000000000a1','d7000000-0000-0000-0000-0000000000a2',
                                  'd7000000-0000-0000-0000-0000000000f1');
DELETE FROM auth.users WHERE id IN ('d7000000-0000-0000-0000-0000000000a1','d7000000-0000-0000-0000-0000000000a2',
                                    'd7000000-0000-0000-0000-0000000000f1');
DELETE FROM tenants  WHERE id = 'd7000000-0000-0000-0000-000000000001';

COMMIT;

-- Expect 0, 0, 0, 0, 0, then 1 (the seed tenant survived).
SELECT (SELECT count(*) FROM tenants WHERE id = 'd7000000-0000-0000-0000-000000000001')           AS tenant,
       (SELECT count(*) FROM students WHERE id::text LIKE 'd7000000-%')                          AS students,
       (SELECT count(*) FROM lesson_sessions WHERE class_id::text LIKE 'd7000000-%')             AS sessions,
       (SELECT count(*) FROM credit_notes WHERE invoice_item_id = 'd7000000-0000-0000-0000-0000000001b1') AS notes,
       (SELECT count(*) FROM auth.users WHERE id::text LIKE 'd7000000-%')                        AS users,
       (SELECT count(*) FROM tenants WHERE id = '70000000-0000-0000-0000-000000000001')           AS seed_tenant;
