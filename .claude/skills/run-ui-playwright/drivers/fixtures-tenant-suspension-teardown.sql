-- Teardown for fixtures-tenant-suspension.sql + verify-tenant-suspension.mjs.
--
-- ⚠ RISK 9 FIRST: unsuspend the fixture tenant before anything else, so even
-- a teardown interrupted halfway cannot leave a suspended tenant behind. The
-- driver's finally-block does this too — twice is cheap, once-missed is a
-- broken sibling suite.
--
-- Run (from repo root):
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-tenant-suspension-teardown.sql

\set ON_ERROR_STOP on

UPDATE tenants SET suspended_at = NULL
 WHERE id = 'e6aa0000-0000-0000-0000-000000000001';

-- ── Everything hanging off the two fixture classes ──────────────────────────
CREATE TEMP TABLE tsx_sessions AS
SELECT ls.id FROM lesson_sessions ls
 WHERE ls.class_id IN ('e6aa0000-0000-0000-0000-0000000000aa',
                       'e6aa0000-0000-0000-0000-0000000000ab');

DELETE FROM attendance             WHERE lesson_session_id IN (SELECT id FROM tsx_sessions);
DELETE FROM session_coach_absences WHERE lesson_session_id IN (SELECT id FROM tsx_sessions);
DELETE FROM session_coaches        WHERE lesson_session_id IN (SELECT id FROM tsx_sessions);
DELETE FROM lesson_sessions        WHERE id IN (SELECT id FROM tsx_sessions);

DELETE FROM class_shadow_coaches
 WHERE class_id IN ('e6aa0000-0000-0000-0000-0000000000aa',
                    'e6aa0000-0000-0000-0000-0000000000ab');
DELETE FROM trial_bookings  WHERE class_id IN ('e6aa0000-0000-0000-0000-0000000000aa',
                                               'e6aa0000-0000-0000-0000-0000000000ab');
DELETE FROM makeup_bookings WHERE class_id IN ('e6aa0000-0000-0000-0000-0000000000aa',
                                               'e6aa0000-0000-0000-0000-0000000000ab');
DELETE FROM student_class_enrolments
 WHERE class_id IN ('e6aa0000-0000-0000-0000-0000000000aa',
                    'e6aa0000-0000-0000-0000-0000000000ab');

-- ── Audit rows BEFORE the entities they cite ────────────────────────────────
-- suspend/unsuspend write 'Tenant' rows (entity = the fixture tenant); the
-- actor is the seed platform admin, who survives.
DELETE FROM audit_log
 WHERE entity_id IN ('e6aa0000-0000-0000-0000-000000000001',
                     'e6aa0000-0000-0000-0000-0000000000aa',
                     'e6aa0000-0000-0000-0000-0000000000ab',
                     'e6aa0000-0000-0000-0000-0000000000e1',
                     'e6aa0000-0000-0000-0000-0000000000e2')
    OR entity_id IN (SELECT id FROM coaches
                      WHERE profile_id = 'e6aa0000-0000-0000-0000-000000000002')
    OR actor_id  IN ('e6aa0000-0000-0000-0000-000000000001',
                     'e6aa0000-0000-0000-0000-000000000002',
                     'e6aa0000-0000-0000-0000-000000000003')
    OR tenant_id = 'e6aa0000-0000-0000-0000-000000000001';

DELETE FROM parent_students WHERE student_id IN ('e6aa0000-0000-0000-0000-0000000000e1',
                                                 'e6aa0000-0000-0000-0000-0000000000e2');
DELETE FROM students WHERE id IN ('e6aa0000-0000-0000-0000-0000000000e1',
                                  'e6aa0000-0000-0000-0000-0000000000e2');

DELETE FROM classes WHERE id IN ('e6aa0000-0000-0000-0000-0000000000aa',
                                 'e6aa0000-0000-0000-0000-0000000000ab');

-- Both locations the classes referenced (FK is ON DELETE RESTRICT — after classes).
DELETE FROM locations WHERE id IN ('e6aa0000-0000-0000-0000-0000000010c1',
                                   'e6aa0000-0000-0000-0000-0000000010c2');

-- ── The people, then the tenant ─────────────────────────────────────────────
DELETE FROM parent_tenants WHERE parent_id IN (
  SELECT id FROM parents WHERE profile_id = 'e6aa0000-0000-0000-0000-000000000003');
DELETE FROM parent_tenant_balances WHERE parent_id IN (
  SELECT id FROM parents WHERE profile_id = 'e6aa0000-0000-0000-0000-000000000003');
DELETE FROM coach_rates WHERE coach_id IN (
  SELECT id FROM coaches WHERE profile_id = 'e6aa0000-0000-0000-0000-000000000002');
DELETE FROM coaches WHERE profile_id = 'e6aa0000-0000-0000-0000-000000000002';
DELETE FROM parents WHERE profile_id = 'e6aa0000-0000-0000-0000-000000000003';
DELETE FROM auth.users WHERE id IN ('e6aa0000-0000-0000-0000-000000000001',
                                    'e6aa0000-0000-0000-0000-000000000002',
                                    'e6aa0000-0000-0000-0000-000000000003');
DELETE FROM profiles WHERE id IN ('e6aa0000-0000-0000-0000-000000000001',
                                  'e6aa0000-0000-0000-0000-000000000002',
                                  'e6aa0000-0000-0000-0000-000000000003');

DELETE FROM class_categories WHERE id = 'e6aa0000-0000-0000-0000-00000000cc01';
DELETE FROM tenants WHERE id = 'e6aa0000-0000-0000-0000-000000000001';

-- ── The proof: 0 removed-rows left, seed identities SURVIVED and UNSUSPENDED ─
SELECT
  (SELECT count(*) FROM tenants
    WHERE id = 'e6aa0000-0000-0000-0000-000000000001')             AS tenant_left,
  (SELECT count(*) FROM auth.users
    WHERE id::text LIKE 'e6aa0000-%')                              AS users_left,
  (SELECT count(*) FROM students
    WHERE id::text LIKE 'e6aa0000-%')                              AS students_left,
  (SELECT count(*) FROM classes
    WHERE id::text LIKE 'e6aa0000-%')                              AS classes_left,
  (SELECT count(*) FROM tenants
    WHERE id = '70000000-0000-0000-0000-000000000001'
      AND suspended_at IS NULL)                                    AS seed_tenant_operating,
  (SELECT count(*) FROM profiles
    WHERE id = 'a0000000-0000-0000-0000-000000000001')             AS platform_admin_survived;
