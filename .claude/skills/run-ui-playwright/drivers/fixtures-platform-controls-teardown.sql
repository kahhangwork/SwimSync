-- Teardown for fixtures-platform-controls.sql — removes both PlatCtl businesses
-- and everything in them, including what the DRIVER wrote (owner transfers, the
-- moved child's new memberships at Bravo, the audit trail of both) and what the
-- tenant INSERT triggers seeded (trg_seed_skill_grade_levels).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-platform-controls-teardown.sql
--
-- Scoped by the two tenant ids and the full 'd5000000-' block, never a 2-char
-- prefix (§7.280). audit_log goes by ENTITY / TENANT id, never by actor: the
-- actor is the SEED platform admin, whose other rows are not ours (§7.50).

\set ON_ERROR_STOP on
BEGIN;

DELETE FROM audit_log
 WHERE entity_id::text LIKE 'd5000000-%'
    OR tenant_id IN ('d5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000002');

DELETE FROM parent_tenant_balances b USING parents p
 WHERE b.parent_id = p.id AND p.profile_id::text LIKE 'd5000000-%';
DELETE FROM parent_tenant_balances
 WHERE tenant_id IN ('d5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000002');
DELETE FROM parent_tenants pt USING parents p
 WHERE pt.parent_id = p.id AND p.profile_id::text LIKE 'd5000000-%';
DELETE FROM parent_tenants
 WHERE tenant_id IN ('d5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000002');
DELETE FROM parent_students       WHERE student_id::text LIKE 'd5000000-%';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'd5000000-%';
DELETE FROM students              WHERE id::text LIKE 'd5000000-%';
DELETE FROM coach_rates           WHERE id = 'd5000000-0000-0000-0000-0000000007a4';
DELETE FROM skill_grade_levels
 WHERE tenant_id IN ('d5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000002');
UPDATE tenants SET owner_profile_id = NULL
 WHERE id IN ('d5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000002');
DELETE FROM coaches               WHERE profile_id::text LIKE 'd5000000-%';
DELETE FROM parents               WHERE profile_id::text LIKE 'd5000000-%';
DELETE FROM profiles              WHERE id::text LIKE 'd5000000-%';
DELETE FROM auth.users            WHERE id::text LIKE 'd5000000-%';
DELETE FROM tenants
 WHERE id IN ('d5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000002');

COMMIT;

-- Expect 0, 0, 0, 0; and 1 — the seed platform admin survived.
SELECT (SELECT count(*) FROM tenants  WHERE id::text LIKE 'd5000000-%')   AS tenants,
       (SELECT count(*) FROM students WHERE id::text LIKE 'd5000000-%')   AS students,
       (SELECT count(*) FROM profiles WHERE id::text LIKE 'd5000000-%')   AS profiles,
       (SELECT count(*) FROM auth.users WHERE id::text LIKE 'd5000000-%') AS users,
       (SELECT count(*) FROM profiles WHERE email = 'superadmin@swimsync.test') AS seed_platform_admin;
