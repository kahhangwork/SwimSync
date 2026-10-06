-- pgTAP: migration D (20260927000600) — admin management by the "Admins &
-- roles" area; the owner protected from every management RPC; the escalation
-- guard on reactivate and in the route checks; P12's profiles_update split.
--
-- Cast: owner O; MGR (operations edit + admins edit, nothing else); FULL
-- (Full admin — stronger than MGR); DESK (Front desk — within MGR); ASB
-- ("Co-admin (as before)" — no admins area); a coach K.
-- PROVEN RED with the DOWN applied (owner-only gates, no owner-target rule,
-- the old profiles_update). Rolled back.

BEGIN;
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(27);
SELECT is(app_today(), '2026-09-15'::date, 'clock pinned');

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('99999999-0000-0000-0000-0000000000e0', 'tap-radm', 'TAP Roles Admins', 'SWIM-RA01');

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.std(p_key TEXT) RETURNS UUID AS $$
  SELECT id FROM tenant_roles WHERE tenant_id = '99999999-0000-0000-0000-0000000000e0' AND standard_key = p_key $$ LANGUAGE sql;

SELECT pg_temp.mkuser('e0000000-0000-0000-0000-0000000000a1', 'tap-ra-owner@test.local',
  '{"full_name":"RA Owner","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000e0"}');
SELECT pg_temp.mkuser('e0000000-0000-0000-0000-0000000000c1', 'tap-ra-coach@test.local',
  '{"full_name":"RA Coach","role":"coach","tenant_id":"99999999-0000-0000-0000-0000000000e0"}');

SELECT set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT create_role('Manager', '{"operations":"edit","profile":"none","admins":"edit","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}');

SELECT pg_temp.mkuser('e0000000-0000-0000-0000-0000000000d1', 'tap-ra-mgr@test.local',
  jsonb_build_object('role','tenant_admin','tenant_id','99999999-0000-0000-0000-0000000000e0',
    'admin_role_id', (SELECT id FROM tenant_roles WHERE tenant_id = '99999999-0000-0000-0000-0000000000e0' AND name = 'Manager')));
SELECT pg_temp.mkuser('e0000000-0000-0000-0000-0000000000d2', 'tap-ra-full@test.local',
  jsonb_build_object('role','tenant_admin','tenant_id','99999999-0000-0000-0000-0000000000e0','admin_role_id',pg_temp.std('full_admin')));
SELECT pg_temp.mkuser('e0000000-0000-0000-0000-0000000000d3', 'tap-ra-desk@test.local',
  jsonb_build_object('role','tenant_admin','tenant_id','99999999-0000-0000-0000-0000000000e0','admin_role_id',pg_temp.std('front_desk')));
SELECT pg_temp.mkuser('e0000000-0000-0000-0000-0000000000d4', 'tap-ra-asb@test.local',
  '{"full_name":"RA As Before","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000e0"}');

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.phone(p_target UUID, p_phone TEXT) RETURNS INT AS $$
  WITH u AS (UPDATE profiles SET phone = p_phone WHERE id = p_target RETURNING 1) SELECT count(*)::int FROM u $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(TEXT), pg_temp.phone(UUID, TEXT), pg_temp.std(TEXT) TO authenticated;

SET LOCAL ROLE authenticated;

-- ── A co-admin without the admins area stays refused (as today) ─────────────
SELECT pg_temp.as_user('e0000000-0000-0000-0000-0000000000d4');
SELECT throws_ok($$ SELECT deactivate_admin('e0000000-0000-0000-0000-0000000000d3') $$,
  'P0001', 'only the business owner may manage admin accounts', 'as-before co-admin: cannot deactivate');
SELECT ok(NOT can_assign_role(pg_temp.std('front_desk')), 'as-before co-admin: can_assign_role is false');

-- ── admins:edit manages co-admins (D9) ──────────────────────────────────────
SELECT pg_temp.as_user('e0000000-0000-0000-0000-0000000000d1');
SELECT lives_ok($$ SELECT deactivate_admin('e0000000-0000-0000-0000-0000000000d3') $$, 'MGR deactivates a Front desk co-admin');
SELECT lives_ok($$ SELECT reactivate_admin('e0000000-0000-0000-0000-0000000000d3') $$, 'MGR reactivates them (role within MGR''s)');
SELECT lives_ok($$ SELECT deactivate_admin('e0000000-0000-0000-0000-0000000000d2') $$, 'MGR may deactivate even a STRONGER co-admin (D9)');
SELECT throws_ok($$ SELECT reactivate_admin('e0000000-0000-0000-0000-0000000000d2') $$,
  '42501', NULL, 'MGR cannot reactivate a stronger co-admin — no escalation by deactivate-then-reactivate');

-- ── The owner is protected from every management RPC (§5.4) ─────────────────
SELECT throws_ok($$ SELECT deactivate_admin('e0000000-0000-0000-0000-0000000000a1') $$,
  '42501', NULL, 'MGR cannot deactivate the owner');
SELECT throws_ok($$ SELECT prepare_admin_delete('e0000000-0000-0000-0000-0000000000a1') $$,
  '42501', NULL, 'MGR cannot delete the owner');
SELECT throws_ok($$ SELECT remove_admin_role('e0000000-0000-0000-0000-0000000000a1') $$,
  '42501', NULL, 'MGR cannot demote the owner');
SELECT throws_ok($$ SELECT reactivate_admin('e0000000-0000-0000-0000-0000000000a1') $$,
  '42501', NULL, 'MGR cannot act on the owner via reactivate either');
SELECT throws_ok($$ SELECT assign_admin_role('e0000000-0000-0000-0000-0000000000a1', pg_temp.std('front_desk')) $$,
  '23514', NULL, 'MGR cannot give the owner a role');

-- ── The route checks ────────────────────────────────────────────────────────
SELECT ok(can_assign_role(pg_temp.std('front_desk')), 'can_assign_role: MGR may invite as Front desk');
SELECT ok(NOT can_assign_role(pg_temp.std('full_admin')), 'can_assign_role: MGR may not invite as Full admin');
SELECT ok(can_restore_admin('e0000000-0000-0000-0000-0000000000d3'), 'can_restore_admin: MGR may resend a Front desk invite');
SELECT ok(NOT can_restore_admin('e0000000-0000-0000-0000-0000000000d2'), 'can_restore_admin: not a Full admin''s');
SELECT ok(NOT can_restore_admin('e0000000-0000-0000-0000-0000000000a1'), 'can_restore_admin: never the owner');

-- ── P12: profiles_update splits by the target's role ────────────────────────
SELECT is(pg_temp.phone('e0000000-0000-0000-0000-0000000000d3', '81110001'), 1, 'MGR edits a co-admin''s profile (admins:edit)');
SELECT is(pg_temp.phone('e0000000-0000-0000-0000-0000000000a1', '81110002'), 0, 'MGR cannot edit the OWNER''s profile');
SELECT is(pg_temp.phone('e0000000-0000-0000-0000-0000000000c1', '81110003'), 1, 'MGR edits a coach''s profile (operations:edit)');
SELECT pg_temp.as_user('e0000000-0000-0000-0000-0000000000d4');
SELECT is(pg_temp.phone('e0000000-0000-0000-0000-0000000000d3', '81110004'), 0, 'as-before co-admin cannot edit another admin''s profile (P12)');
SELECT is(pg_temp.phone('e0000000-0000-0000-0000-0000000000c1', '81110005'), 1, 'as-before co-admin still edits a coach (operations:edit)');
SELECT is(pg_temp.phone('e0000000-0000-0000-0000-0000000000d4', '81110006'), 1, 'everyone edits their own profile');

-- ── The owner is unchanged ──────────────────────────────────────────────────
SELECT pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
SELECT ok(can_assign_role(pg_temp.std('full_admin')), 'OWNER: may assign any role');
SELECT lives_ok($$ SELECT reactivate_admin('e0000000-0000-0000-0000-0000000000d2') $$, 'OWNER reactivates the Full admin');
SELECT lives_ok($$ SELECT deactivate_admin('e0000000-0000-0000-0000-0000000000d1') $$, 'OWNER deactivates the manager');
SELECT is(pg_temp.phone('e0000000-0000-0000-0000-0000000000d2', '81110007'), 1, 'OWNER edits any co-admin''s profile');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
