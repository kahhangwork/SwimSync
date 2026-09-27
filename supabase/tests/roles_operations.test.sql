-- pgTAP: migration B (20260927000400) — the operations and profile areas are
-- enforced by the co-admin's role.
--
-- One business; the owner; four co-admins whose roles differ ONLY where this
-- file looks: NONE (every area none), VIEW (operations view), EDIT (operations
-- edit), PROF (operations view + profile edit). Representative reads and
-- writes per area: a SELECT policy, a write policy, a mutating RPC, a
-- read-only RPC; reference data stays readable (D6); deactivation still wins.
--
-- PROVEN RED: with 20260927000400_…_DOWN.sql applied, every "refused" row
-- below fails (is_tenant_admin admits any active admin). Rolled back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(24);

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('99999999-0000-0000-0000-0000000000b0', 'tap-rops', 'TAP Roles Ops', 'SWIM-RO01');

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', p_meta,
    now(), now(), '', '', '', '') $$ LANGUAGE sql;

-- Owner first (becomes owner), then a coach.
SELECT pg_temp.mkuser('b0000000-0000-0000-0000-0000000000a1', 'tap-ro-owner@test.local',
  '{"full_name":"RO Owner","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000b0"}');
SELECT pg_temp.mkuser('b0000000-0000-0000-0000-0000000000c1', 'tap-ro-coach@test.local',
  '{"full_name":"RO Coach","role":"coach","tenant_id":"99999999-0000-0000-0000-0000000000b0"}');

-- The four roles, created as the owner would.
SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT create_role('T None',  '{"operations":"none","profile":"none","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}');
SELECT create_role('T View',  '{"operations":"view","profile":"none","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}');
SELECT create_role('T Edit',  '{"operations":"edit","profile":"none","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}');
SELECT create_role('T Prof',  '{"operations":"view","profile":"edit","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}');

CREATE OR REPLACE FUNCTION pg_temp.rid(p_name TEXT) RETURNS UUID AS $$
  SELECT id FROM tenant_roles WHERE tenant_id = '99999999-0000-0000-0000-0000000000b0' AND name = p_name $$ LANGUAGE sql;

SELECT pg_temp.mkuser('b0000000-0000-0000-0000-0000000000d0', 'tap-ro-none@test.local',
  jsonb_build_object('role','tenant_admin','tenant_id','99999999-0000-0000-0000-0000000000b0','admin_role_id',pg_temp.rid('T None')));
SELECT pg_temp.mkuser('b0000000-0000-0000-0000-0000000000d1', 'tap-ro-view@test.local',
  jsonb_build_object('role','tenant_admin','tenant_id','99999999-0000-0000-0000-0000000000b0','admin_role_id',pg_temp.rid('T View')));
SELECT pg_temp.mkuser('b0000000-0000-0000-0000-0000000000d2', 'tap-ro-edit@test.local',
  jsonb_build_object('role','tenant_admin','tenant_id','99999999-0000-0000-0000-0000000000b0','admin_role_id',pg_temp.rid('T Edit')));
SELECT pg_temp.mkuser('b0000000-0000-0000-0000-0000000000d3', 'tap-ro-prof@test.local',
  jsonb_build_object('role','tenant_admin','tenant_id','99999999-0000-0000-0000-0000000000b0','admin_role_id',pg_temp.rid('T Prof')));

-- Operations data: a class, a student, an enrolment, a lesson.
INSERT INTO class_categories (tenant_id, name)
SELECT '99999999-0000-0000-0000-0000000000b0', 'Default Group'
 WHERE NOT EXISTS (SELECT 1 FROM class_categories WHERE tenant_id = '99999999-0000-0000-0000-0000000000b0' AND lower(trim(name)) = 'default group');
INSERT INTO locations (tenant_id, name)
SELECT '99999999-0000-0000-0000-0000000000b0', 'Default location'
 WHERE NOT EXISTS (SELECT 1 FROM locations WHERE tenant_id = '99999999-0000-0000-0000-0000000000b0' AND lower(trim(name)) = 'default location');
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT 'b0100000-0000-0000-0000-000000000001', co.id, 'RO Class', 'saturday', '10:00', '11:00',
       (SELECT id FROM locations WHERE tenant_id = co.tenant_id AND lower(trim(name)) = 'default location'), 30.00,
       (SELECT id FROM class_categories WHERE tenant_id = co.tenant_id AND lower(trim(name)) = 'default group')
  FROM coaches co WHERE co.profile_id = 'b0000000-0000-0000-0000-0000000000c1';
-- A second class with nobody enrolled: deactivating it can fail ONLY on permission.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT 'b0100000-0000-0000-0000-000000000002', coach_id, 'RO Empty', 'sunday', '10:00', '11:00', location_id, 30.00, category_id
  FROM classes WHERE id = 'b0100000-0000-0000-0000-000000000001';
INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id)
VALUES ('b0200000-0000-0000-0000-000000000001', 'RO Kid', 'assigned', TRUE, '99999999-0000-0000-0000-0000000000b0');
INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('b0200000-0000-0000-0000-000000000001', 'b0100000-0000-0000-0000-000000000001', TRUE);
INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('b0300000-0000-0000-0000-000000000001', 'b0100000-0000-0000-0000-000000000001', '2026-02-07', 'completed');

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.rename(p_name TEXT) RETURNS INT AS $$
  WITH u AS (UPDATE students SET full_name = p_name WHERE id = 'b0200000-0000-0000-0000-000000000001' RETURNING 1)
  SELECT count(*)::int FROM u $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(TEXT), pg_temp.rename(TEXT) TO authenticated;

SET LOCAL ROLE authenticated;

-- ── NONE: page hidden AND data refused; reference data still readable ───────
SELECT pg_temp.as_user('b0000000-0000-0000-0000-0000000000d0');
SELECT is((SELECT count(*)::int FROM students), 0, 'NONE: reads no students');
SELECT is((SELECT count(*)::int FROM classes WHERE tenant_id = '99999999-0000-0000-0000-0000000000b0'), 0, 'NONE: reads no classes');
SELECT is((SELECT count(*)::int FROM lesson_sessions), 0, 'NONE: reads no lessons');
SELECT ok((SELECT count(*) FROM locations) > 0, 'NONE: still reads reference data — locations (D6)');
SELECT throws_ok($$ SELECT tenant_unmarked_lesson_count('99999999-0000-0000-0000-0000000000b0') $$,
  NULL, NULL, 'NONE: a read-only operations RPC is refused');

-- ── VIEW: reads, cannot write ───────────────────────────────────────────────
SELECT pg_temp.as_user('b0000000-0000-0000-0000-0000000000d1');
SELECT is((SELECT count(*)::int FROM students), 1, 'VIEW: reads the student');
SELECT is((SELECT count(*)::int FROM student_class_enrolments), 1, 'VIEW: reads the enrolment');
SELECT is((SELECT count(*)::int FROM lesson_sessions), 1, 'VIEW: reads the lesson');
SELECT lives_ok($$ SELECT tenant_unmarked_lesson_count('99999999-0000-0000-0000-0000000000b0') $$,
  'VIEW: a read-only operations RPC runs');
SELECT is(pg_temp.rename('Renamed by view'), 0, 'VIEW: a direct write changes nothing');
SELECT throws_ok($$ SELECT deactivate_class('b0100000-0000-0000-0000-000000000002') $$,
  NULL, NULL, 'VIEW: a mutating operations RPC is refused');
SELECT throws_ok($$ SELECT regenerate_join_code('99999999-0000-0000-0000-0000000000b0') $$,
  NULL, NULL, 'VIEW: no business-profile edit');

-- ── EDIT: reads and writes operations; still no profile ─────────────────────
SELECT pg_temp.as_user('b0000000-0000-0000-0000-0000000000d2');
SELECT is(pg_temp.rename('Renamed by edit'), 1, 'EDIT: a direct write lands');
SELECT lives_ok($$ SELECT deactivate_class('b0100000-0000-0000-0000-000000000002') $$,
  'EDIT: a mutating operations RPC runs');
SELECT lives_ok($$ SELECT reactivate_class('b0100000-0000-0000-0000-000000000002') $$,
  'EDIT: and its inverse');
SELECT throws_ok($$ SELECT regenerate_join_code('99999999-0000-0000-0000-0000000000b0') $$,
  NULL, NULL, 'EDIT (operations only): no business-profile edit');

-- ── PROF: profile edit, operations view ─────────────────────────────────────
SELECT pg_temp.as_user('b0000000-0000-0000-0000-0000000000d3');
SELECT lives_ok($$ SELECT regenerate_join_code('99999999-0000-0000-0000-0000000000b0') $$,
  'PROF: regenerates the join code (profile:edit)');
SELECT is(pg_temp.rename('Renamed by prof'), 0, 'PROF: operations view does not write');

-- ── OWNER: everything, without a role (D1) ──────────────────────────────────
SELECT pg_temp.as_user('b0000000-0000-0000-0000-0000000000a1');
SELECT is(pg_temp.rename('Renamed by owner'), 1, 'OWNER: writes operations');
SELECT lives_ok($$ SELECT regenerate_join_code('99999999-0000-0000-0000-0000000000b0') $$,
  'OWNER: edits the business profile');

-- ── The coach arm is untouched (P8) ─────────────────────────────────────────
SELECT pg_temp.as_user('b0000000-0000-0000-0000-0000000000c1');
SELECT is((SELECT count(*)::int FROM lesson_sessions), 1, 'the class''s coach still reads its lessons');
RESET ROLE;

-- ── Deactivation and suspension still win over any role ─────────────────────
UPDATE profiles SET admin_disabled_at = now() WHERE id = 'b0000000-0000-0000-0000-0000000000d2';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b0000000-0000-0000-0000-0000000000d2');
SELECT is((SELECT count(*)::int FROM students), 0, 'a deactivated EDIT co-admin reads nothing');
RESET ROLE;
UPDATE tenants SET suspended_at = now() WHERE id = '99999999-0000-0000-0000-0000000000b0';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('b0000000-0000-0000-0000-0000000000a1');
SELECT is((SELECT count(*)::int FROM lesson_sessions), 0, 'a suspended business: the owner reads no lessons');
RESET ROLE;

SELECT is((SELECT full_name FROM students WHERE id = 'b0200000-0000-0000-0000-000000000001'),
  'Renamed by owner', 'only the EDIT and OWNER writes landed');

SELECT * FROM finish();
ROLLBACK;
