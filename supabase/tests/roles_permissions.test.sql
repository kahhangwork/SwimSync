-- pgTAP: roles & permissions, migration A (20260927000300).
--
-- Covers: seeding (every business, new businesses, existing co-admins on
-- "Co-admin (as before)"); how a new admin gets a role; the has_admin_area
-- truth table (owner, role levels, platform admin, deactivated, suspended);
-- my_admin_permissions; the grid validator (partial / unknown / invalid /
-- the operations >= view invariant); owner-only role CRUD; delete refused
-- while held (P3); the escalation guard on assign_admin_role (§5.4); the
-- admin_role_id pin, shape trigger and commit-time presence check; P6 on an
-- owner transfer; audit rows (P10); RLS on the new tables; grants. Rolled back.

BEGIN;
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(55);
SELECT is(app_today(), '2026-09-15'::date, 'clock pinned');

-- ── Fixture ─────────────────────────────────────────────────────────────────
-- T1: owner O (first admin → owner), co-admin C (no role in metadata →
-- fallback), co-admin D (front desk by trusted metadata), coach K, parent Q.
-- T2: owner O2. P: platform admin.
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('99999999-0000-0000-0000-0000000000f1', 'tap-roles1', 'TAP Roles 1', 'SWIM-RL01'),
  ('99999999-0000-0000-0000-0000000000f2', 'tap-roles2', 'TAP Roles 2', 'SWIM-RL02');

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;

SELECT pg_temp.mkuser('f0000000-0000-0000-0000-0000000000a1', 'tap-rl-owner@test.local',
  '{"full_name":"RL Owner","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000f1"}');
SELECT pg_temp.mkuser('f0000000-0000-0000-0000-0000000000c1', 'tap-rl-co@test.local',
  '{"full_name":"RL Co","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000f1"}');
SELECT pg_temp.mkuser('f0000000-0000-0000-0000-0000000000d1', 'tap-rl-desk@test.local',
  jsonb_build_object('full_name','RL Desk','role','tenant_admin','tenant_id','99999999-0000-0000-0000-0000000000f1',
    'admin_role_id', (SELECT id FROM tenant_roles WHERE tenant_id = '99999999-0000-0000-0000-0000000000f1' AND standard_key = 'front_desk')));
SELECT pg_temp.mkuser('f0000000-0000-0000-0000-0000000000e1', 'tap-rl-coach@test.local',
  '{"full_name":"RL Coach","role":"coach","tenant_id":"99999999-0000-0000-0000-0000000000f1"}');
SELECT pg_temp.mkuser('f0000000-0000-0000-0000-0000000000b1', 'tap-rl-parent@test.local',
  '{"full_name":"RL Parent","role":"parent"}');
SELECT pg_temp.mkuser('f0000000-0000-0000-0000-0000000000a2', 'tap-rl-owner2@test.local',
  '{"full_name":"RL Owner 2","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000f2"}');
SELECT pg_temp.mkuser('f0000000-0000-0000-0000-0000000000ff', 'tap-rl-platform@test.local',
  '{"full_name":"RL Platform","role":"platform_admin"}');

CREATE OR REPLACE FUNCTION pg_temp.role_of(p_tenant UUID, p_key TEXT) RETURNS UUID AS $$
  SELECT id FROM tenant_roles WHERE tenant_id = p_tenant AND standard_key = p_key $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.held(p_profile UUID) RETURNS UUID AS $$
  SELECT admin_role_id FROM profiles WHERE id = p_profile $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.can(p_uid TEXT, p_area admin_area, p_level admin_level) RETURNS BOOLEAN AS $$
  SELECT pg_temp.as_user(p_uid);
  SELECT has_admin_area('99999999-0000-0000-0000-0000000000f1', p_area, p_level) $$ LANGUAGE sql;
-- pg_temp functions are created with no PUBLIC grant here (the 20260804
-- default-privilege regime); the probes below run as authenticated.
GRANT EXECUTE ON FUNCTION pg_temp.role_of(UUID, TEXT), pg_temp.held(UUID), pg_temp.as_user(TEXT),
  pg_temp.can(TEXT, admin_area, admin_level) TO authenticated;

-- ── 1. Seeding ──────────────────────────────────────────────────────────────
SELECT is((SELECT count(*)::int FROM tenant_roles WHERE tenant_id = '99999999-0000-0000-0000-0000000000f1'),
  4, 'a new business is seeded with the four standard roles');
SELECT is((SELECT count(*)::int FROM tenant_role_permissions p JOIN tenant_roles r ON r.id = p.role_id
            WHERE r.tenant_id = '99999999-0000-0000-0000-0000000000f1'),
  32, 'every seeded role has all 8 area rows');
SELECT is((SELECT count(*)::int FROM tenants t
            WHERE NOT EXISTS (SELECT 1 FROM tenant_roles r WHERE r.tenant_id = t.id AND r.standard_key = 'co_admin_as_before')),
  0, 'every business in the database has the standard roles');
SELECT is((SELECT jsonb_object_agg(area, level) FROM tenant_role_permissions
            WHERE role_id = pg_temp.role_of('99999999-0000-0000-0000-0000000000f1', 'co_admin_as_before')),
  '{"operations":"edit","profile":"edit","admins":"none","pricing":"edit","billing":"edit","packages":"edit","wages":"edit","accounting":"none"}'::jsonb,
  '"Co-admin (as before)" is exactly today''s co-admin authority (P1)');

-- ── 2. How a new admin gets a role ──────────────────────────────────────────
SELECT is(pg_temp.held('f0000000-0000-0000-0000-0000000000a1'), NULL, 'the first admin becomes owner and holds no role');
SELECT is(pg_temp.held('f0000000-0000-0000-0000-0000000000c1'),
  pg_temp.role_of('99999999-0000-0000-0000-0000000000f1', 'co_admin_as_before'),
  'a co-admin created without a role lands on "Co-admin (as before)"');
SELECT is(pg_temp.held('f0000000-0000-0000-0000-0000000000d1'),
  pg_temp.role_of('99999999-0000-0000-0000-0000000000f1', 'front_desk'),
  'a co-admin created with a role holds that role');
SELECT is(pg_temp.held('f0000000-0000-0000-0000-0000000000e1'), NULL, 'a coach holds no admin role');
SELECT throws_ok(
  $$ SELECT pg_temp.mkuser('f0000000-0000-0000-0000-0000000000c9', 'tap-rl-x@test.local',
       jsonb_build_object('role','tenant_admin','tenant_id','99999999-0000-0000-0000-0000000000f1',
         'admin_role_id', (SELECT id FROM tenant_roles WHERE tenant_id = '99999999-0000-0000-0000-0000000000f2' AND standard_key = 'full_admin'))) $$,
  '23514', NULL, 'a role from another business is refused');

-- ── 3. has_admin_area truth table ───────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT ok(pg_temp.can('f0000000-0000-0000-0000-0000000000a1', 'accounting', 'edit'), 'owner: accounting edit (D1)');
SELECT ok(pg_temp.can('f0000000-0000-0000-0000-0000000000a1', 'admins', 'edit'), 'owner: admins edit (D1)');
SELECT ok(pg_temp.can('f0000000-0000-0000-0000-0000000000c1', 'billing', 'edit'), 'as-before co-admin: billing edit');
SELECT ok(NOT pg_temp.can('f0000000-0000-0000-0000-0000000000c1', 'accounting', 'view'), 'as-before co-admin: no accounting');
SELECT ok(NOT pg_temp.can('f0000000-0000-0000-0000-0000000000c1', 'admins', 'view'), 'as-before co-admin: no admin management');
SELECT ok(pg_temp.can('f0000000-0000-0000-0000-0000000000d1', 'operations', 'edit'), 'front desk: operations edit');
SELECT ok(pg_temp.can('f0000000-0000-0000-0000-0000000000d1', 'operations', 'view'), 'edit implies view');
SELECT ok(NOT pg_temp.can('f0000000-0000-0000-0000-0000000000d1', 'profile', 'view'), 'front desk: no business profile');
SELECT ok(NOT pg_temp.can('f0000000-0000-0000-0000-0000000000d1', 'billing', 'view'), 'front desk: no billing');
SELECT ok(NOT pg_temp.can('f0000000-0000-0000-0000-0000000000e1', 'operations', 'view'), 'a coach passes no admin area');
SELECT ok(NOT pg_temp.can('f0000000-0000-0000-0000-0000000000ff', 'operations', 'view'), 'a platform admin passes no admin area (P7)');
SELECT ok(NOT pg_temp.can('f0000000-0000-0000-0000-0000000000a2', 'operations', 'view'), 'another business''s owner passes nothing here');
SELECT pg_temp.as_user('f0000000-0000-0000-0000-0000000000a1');
SELECT is((SELECT count(*)::int FROM my_admin_permissions('99999999-0000-0000-0000-0000000000f1') WHERE level = 'edit'),
  8, 'my_admin_permissions: the owner gets all 8 areas at edit');
SELECT pg_temp.as_user('f0000000-0000-0000-0000-0000000000c1');
SELECT is((SELECT jsonb_object_agg(area, level) FROM my_admin_permissions('99999999-0000-0000-0000-0000000000f1'))->>'accounting',
  'none', 'my_admin_permissions: a co-admin gets their role''s grid');
SELECT pg_temp.as_user('f0000000-0000-0000-0000-0000000000e1');
SELECT is((SELECT count(*)::int FROM my_admin_permissions('99999999-0000-0000-0000-0000000000f1')),
  0, 'my_admin_permissions: a coach gets nothing');
RESET ROLE;

UPDATE profiles SET admin_disabled_at = app_now() WHERE id = 'f0000000-0000-0000-0000-0000000000c1';
SET LOCAL ROLE authenticated;
SELECT ok(NOT pg_temp.can('f0000000-0000-0000-0000-0000000000c1', 'billing', 'view'), 'a deactivated co-admin passes nothing');
RESET ROLE;
UPDATE profiles SET admin_disabled_at = NULL WHERE id = 'f0000000-0000-0000-0000-0000000000c1';
UPDATE tenants SET suspended_at = app_now() WHERE id = '99999999-0000-0000-0000-0000000000f1';
SET LOCAL ROLE authenticated;
SELECT ok(NOT pg_temp.can('f0000000-0000-0000-0000-0000000000a1', 'operations', 'view'), 'a suspended business: even the owner passes nothing');
RESET ROLE;
UPDATE tenants SET suspended_at = NULL WHERE id = '99999999-0000-0000-0000-0000000000f1';

-- ── 4. Grid validation + owner-only CRUD ────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('f0000000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT create_role('Partial', '{"operations":"edit"}') $$,
  '23514', NULL, 'a grid missing areas is refused');
SELECT throws_ok($$ SELECT create_role('Bogus', '{"operations":"edit","profile":"none","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none","refunds":"edit"}') $$,
  '23514', NULL, 'an unknown area is refused');
SELECT throws_ok($$ SELECT create_role('Bad level', '{"operations":"all","profile":"none","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}') $$,
  '23514', NULL, 'an invalid level is refused');
SELECT throws_ok($$ SELECT create_role('Money only', '{"operations":"none","profile":"none","admins":"none","pricing":"none","billing":"edit","packages":"none","wages":"none","accounting":"none"}') $$,
  '23514', NULL, 'any access with Operations at none is refused (every page shows names)');
SELECT lives_ok($$ SELECT create_role('Manager', '{"operations":"edit","profile":"view","admins":"edit","pricing":"none","billing":"view","packages":"none","wages":"none","accounting":"none"}') $$,
  'the owner creates a valid role');
SELECT lives_ok($$ SELECT create_role('Nobody', '{"operations":"none","profile":"none","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}') $$,
  'an all-none role is valid');
SELECT throws_ok($$ SELECT create_role(' manager ', '{"operations":"view","profile":"none","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}') $$,
  '23505', NULL, 'role names are unique per business, ignoring case and spaces');
SELECT throws_ok($$ SELECT rename_role((SELECT id FROM tenant_roles WHERE name = 'Nobody'), 'MANAGER') $$,
  '23505', NULL, 'a rename cannot collide either');
SELECT throws_ok($$ SELECT delete_role(pg_temp.role_of('99999999-0000-0000-0000-0000000000f1', 'front_desk')) $$,
  '23503', NULL, 'a role that someone holds cannot be deleted (P3)');
SELECT lives_ok($$ SELECT delete_role((SELECT id FROM tenant_roles WHERE name = 'Nobody')) $$,
  'an unheld role can be deleted');
SELECT pg_temp.as_user('f0000000-0000-0000-0000-0000000000c1');
SELECT throws_ok($$ SELECT create_role('Mine', '{"operations":"view","profile":"none","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}') $$,
  '42501', NULL, 'a co-admin cannot create roles (D9)');
SELECT throws_ok($$ SELECT update_role_permissions(pg_temp.role_of('99999999-0000-0000-0000-0000000000f1', 'front_desk'),
    '{"operations":"edit","profile":"edit","admins":"edit","pricing":"edit","billing":"edit","packages":"edit","wages":"edit","accounting":"edit"}') $$,
  '42501', NULL, 'a co-admin cannot edit roles (D9)');
RESET ROLE;

-- ── 5. assign_admin_role — the escalation guard ─────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('f0000000-0000-0000-0000-0000000000c1');
SELECT throws_ok($$ SELECT assign_admin_role('f0000000-0000-0000-0000-0000000000d1',
    pg_temp.role_of('99999999-0000-0000-0000-0000000000f1', 'full_admin')) $$,
  '42501', NULL, 'a co-admin without admins:edit cannot assign roles');
SELECT pg_temp.as_user('f0000000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ SELECT assign_admin_role('f0000000-0000-0000-0000-0000000000c1', (SELECT id FROM tenant_roles WHERE name = 'Manager')) $$,
  'the owner assigns any role');
SELECT throws_ok($$ SELECT assign_admin_role('f0000000-0000-0000-0000-0000000000a1', (SELECT id FROM tenant_roles WHERE name = 'Manager')) $$,
  '23514', NULL, 'nobody assigns a role to the owner');
SELECT pg_temp.as_user('f0000000-0000-0000-0000-0000000000c1');
SELECT lives_ok($$ SELECT assign_admin_role('f0000000-0000-0000-0000-0000000000d1',
    pg_temp.role_of('99999999-0000-0000-0000-0000000000f1', 'front_desk')) $$,
  'a Manager (admins:edit) assigns a role within their own');
SELECT throws_ok($$ SELECT assign_admin_role('f0000000-0000-0000-0000-0000000000d1',
    pg_temp.role_of('99999999-0000-0000-0000-0000000000f1', 'full_admin')) $$,
  '42501', NULL, 'a Manager cannot assign a stronger role to someone else');
SELECT throws_ok($$ SELECT assign_admin_role('f0000000-0000-0000-0000-0000000000c1',
    pg_temp.role_of('99999999-0000-0000-0000-0000000000f1', 'full_admin')) $$,
  '42501', NULL, 'a Manager cannot promote themselves');
SELECT throws_ok($$ SELECT assign_admin_role('f0000000-0000-0000-0000-0000000000d1',
    pg_temp.role_of('99999999-0000-0000-0000-0000000000f2', 'front_desk')) $$,
  'P0002', NULL, 'a role from another business cannot be assigned');
SELECT throws_ok($$ UPDATE profiles SET admin_role_id = pg_temp.role_of('99999999-0000-0000-0000-0000000000f1', 'full_admin')
                    WHERE id = 'f0000000-0000-0000-0000-0000000000c1' $$,
  'P0001', NULL, 'admin_role_id is not client-writable');
SELECT is((SELECT count(*)::int FROM tenant_roles), 5, 'RLS: a co-admin reads their business''s roles only');
SELECT pg_temp.as_user('f0000000-0000-0000-0000-0000000000b1');
SELECT is((SELECT count(*)::int FROM tenant_role_permissions), 0, 'RLS: a parent reads no role grids');
RESET ROLE;

SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE action = 'admin_role_assigned'
                   AND entity_id = 'f0000000-0000-0000-0000-0000000000c1'
                   AND tenant_id = '99999999-0000-0000-0000-0000000000f1'),
  'an assignment writes an audit row (P10)');

-- ── 6. Shape, commit-time presence, owner transfer ──────────────────────────
UPDATE profiles SET role = 'coach' WHERE id = 'f0000000-0000-0000-0000-0000000000d1';
SELECT is(pg_temp.held('f0000000-0000-0000-0000-0000000000d1'), NULL, 'a demoted admin loses their role');
UPDATE profiles SET role = 'tenant_admin', admin_role_id = pg_temp.role_of('99999999-0000-0000-0000-0000000000f1', 'front_desk')
 WHERE id = 'f0000000-0000-0000-0000-0000000000d1';

SET CONSTRAINTS trg_profiles_admin_role_present IMMEDIATE;
SELECT throws_ok($$ UPDATE profiles SET admin_role_id = NULL WHERE id = 'f0000000-0000-0000-0000-0000000000c1' $$,
  '23514', NULL, 'a co-admin without a role is refused at commit');
SET CONSTRAINTS trg_profiles_admin_role_present DEFERRED;

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('f0000000-0000-0000-0000-0000000000ff');
SELECT lives_ok($$ SELECT platform_reassign_owner('99999999-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-0000000000d1') $$,
  'the platform admin transfers ownership');
RESET ROLE;
SELECT is(pg_temp.held('f0000000-0000-0000-0000-0000000000a1'),
  pg_temp.role_of('99999999-0000-0000-0000-0000000000f1', 'full_admin'),
  'the outgoing owner becomes a co-admin on Full admin (P6)');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT lives_ok($$ SELECT 1 $$, 'the transfer satisfies the commit-time role check');

SELECT * FROM finish();
ROLLBACK;
