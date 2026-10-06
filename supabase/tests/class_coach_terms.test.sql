-- pgTAP: WHO TAUGHT, WITHOUT THE PRICE (20261005000200).
--
-- WHAT THIS FILE PROTECTS. A Front-desk co-admin (operations edit, pricing none) must see the teaching coach of
-- every lesson; before this migration they read ZERO class_rates rows and every who-taught surface was blank
-- (confirmed 2026-10-05 by verify-front-desk-role). And the fix must not leak money:
--   (1) operations:view / the owner → the class's terms;
--   (2) operations:none + pricing:none, another business, a coach, anon → nothing;
--   (3) the result has NO price column; class_rates itself is still closed to the Front-desk role.
--
-- RED-FIRST PROOF (§7.25, 2026-10-05): operations arm removed → the 4 Front-desk / operations:view cases red;
-- whole gate removed → the none / other-business / coach cases red. Before the migration, verify-front-desk-role
-- checks 2, 3a, 3b were red on the live readers (lane 2).

BEGIN;
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);
SELECT is(app_today(), '2026-09-15'::date, 'clock pinned');

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('cc700000-0000-0000-0000-0000000000a0','cct-a','CCT A','SWIM-CCTA'),
  ('cc700000-0000-0000-0000-0000000000b0','cct-b','CCT B','SWIM-CCTB');

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;

SELECT pg_temp.mkuser('cc710000-0000-0000-0000-0000000000a1','cct-owner-a@test.local',
  '{"full_name":"CCT Owner A","role":"tenant_admin","tenant_id":"cc700000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('cc710000-0000-0000-0000-0000000000b1','cct-owner-b@test.local',
  '{"full_name":"CCT Owner B","role":"tenant_admin","tenant_id":"cc700000-0000-0000-0000-0000000000b0"}');
SELECT pg_temp.mkuser('cc710000-0000-0000-0000-0000000000c1','cct-coach-a@test.local',
  '{"full_name":"CCT Coach A","role":"coach","tenant_id":"cc700000-0000-0000-0000-0000000000a0"}');

SELECT set_config('request.jwt.claims', '{"sub":"cc710000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT create_role('CCT None',  '{"operations":"none","profile":"none","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}');
SELECT create_role('CCT OpView','{"operations":"view","profile":"none","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}');
SELECT set_config('request.jwt.claims', '', true);

CREATE OR REPLACE FUNCTION pg_temp.rid(p_name TEXT) RETURNS UUID AS $$
  SELECT id FROM tenant_roles WHERE tenant_id = 'cc700000-0000-0000-0000-0000000000a0' AND name = p_name $$ LANGUAGE sql;
SELECT pg_temp.mkuser('cc710000-0000-0000-0000-0000000000f1','cct-frontdesk@test.local',
  jsonb_build_object('role','tenant_admin','tenant_id','cc700000-0000-0000-0000-0000000000a0','admin_role_id',
    (SELECT id FROM tenant_roles WHERE tenant_id='cc700000-0000-0000-0000-0000000000a0' AND standard_key='front_desk')));
SELECT pg_temp.mkuser('cc710000-0000-0000-0000-0000000000d0','cct-none@test.local',
  jsonb_build_object('role','tenant_admin','tenant_id','cc700000-0000-0000-0000-0000000000a0','admin_role_id',pg_temp.rid('CCT None')));
SELECT pg_temp.mkuser('cc710000-0000-0000-0000-0000000000d1','cct-opview@test.local',
  jsonb_build_object('role','tenant_admin','tenant_id','cc700000-0000-0000-0000-0000000000a0','admin_role_id',pg_temp.rid('CCT OpView')));

INSERT INTO class_categories (tenant_id, name)
SELECT 'cc700000-0000-0000-0000-0000000000a0', 'Default Group'
 WHERE NOT EXISTS (SELECT 1 FROM class_categories WHERE tenant_id = 'cc700000-0000-0000-0000-0000000000a0' AND lower(trim(name)) = 'default group');
INSERT INTO locations (tenant_id, name)
SELECT 'cc700000-0000-0000-0000-0000000000a0', 'Default location'
 WHERE NOT EXISTS (SELECT 1 FROM locations WHERE tenant_id = 'cc700000-0000-0000-0000-0000000000a0' AND lower(trim(name)) = 'default location');
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT 'cc720000-0000-0000-0000-000000000001', co.id, 'CCT Class', 'saturday', '10:00', '11:00',
       (SELECT id FROM locations WHERE tenant_id = co.tenant_id AND lower(trim(name)) = 'default location'), 30.00,
       (SELECT id FROM class_categories WHERE tenant_id = co.tenant_id AND lower(trim(name)) = 'default group')
  FROM coaches co WHERE co.profile_id = 'cc710000-0000-0000-0000-0000000000c1';
-- A second term row so ordering and "all rows" are both visible.
INSERT INTO class_rates (class_id, price_per_lesson, paid_coach_id, effective_from)
SELECT 'cc720000-0000-0000-0000-000000000001', 45.00, co.id, '2026-01-01'
  FROM coaches co WHERE co.profile_id = 'cc710000-0000-0000-0000-0000000000c1';

CREATE TEMP TABLE expect AS
SELECT count(*)::int AS n,
       (SELECT id FROM coaches WHERE profile_id = 'cc710000-0000-0000-0000-0000000000c1') AS coach
  FROM class_rates WHERE class_id = 'cc720000-0000-0000-0000-000000000001';
GRANT SELECT ON expect TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.n() RETURNS INT AS $$
  SELECT count(*)::int FROM class_coach_terms(ARRAY['cc720000-0000-0000-0000-000000000001']::uuid[]) $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(TEXT), pg_temp.n() TO authenticated;

SET LOCAL ROLE authenticated;

SELECT pg_temp.as_user('cc710000-0000-0000-0000-0000000000f1');
SELECT ok((SELECT n FROM expect) >= 2 AND pg_temp.n() = (SELECT n FROM expect),
  'Front desk (operations edit, pricing none) sees every term row of the class');
SELECT is((SELECT count(*)::int FROM class_coach_terms(ARRAY['cc720000-0000-0000-0000-000000000001']::uuid[])
            WHERE paid_coach_id = (SELECT coach FROM expect)),
  (SELECT n FROM expect), 'Front desk: the paid coach is named on every row');
SELECT is((SELECT count(*)::int FROM class_rates WHERE class_id = 'cc720000-0000-0000-0000-000000000001'), 0,
  'Front desk: class_rates itself is STILL closed — prices stay behind pricing:view');
SELECT ok((SELECT count(*) FROM class_coach_terms(NULL)) >= (SELECT n FROM expect),
  'Front desk: NULL means every visible class');

SELECT pg_temp.as_user('cc710000-0000-0000-0000-0000000000d1');
SELECT is(pg_temp.n(), (SELECT n FROM expect), 'operations:view sees the terms');
SELECT pg_temp.as_user('cc710000-0000-0000-0000-0000000000a1');
SELECT is(pg_temp.n(), (SELECT n FROM expect), 'the owner sees the terms (a pricing-only role cannot exist — roles need operations ≥ view)');

SELECT pg_temp.as_user('cc710000-0000-0000-0000-0000000000d0');
SELECT is(pg_temp.n(), 0, 'operations none + pricing none sees nothing');
SELECT pg_temp.as_user('cc710000-0000-0000-0000-0000000000b1');
SELECT is(pg_temp.n(), 0, 'another business''s owner sees nothing');
SELECT pg_temp.as_user('cc710000-0000-0000-0000-0000000000c1');
SELECT is(pg_temp.n(), 0, 'a coach sees nothing through this function');

RESET ROLE;
SELECT ok(NOT has_function_privilege('anon','public.class_coach_terms(uuid[])','EXECUTE'),
  'anon cannot execute it');
SELECT is((SELECT string_agg(a, ',' ORDER BY a) FROM unnest(
            (SELECT proargnames FROM pg_proc WHERE proname = 'class_coach_terms')) a),
  'class_id,effective_from,p_class_ids,paid_coach_id',
  'the result carries no price column');

SELECT * FROM finish();
ROLLBACK;
