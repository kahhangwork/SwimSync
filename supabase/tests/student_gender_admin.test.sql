-- pgTAP: an admin records a child's gender (20261016000100).
--
-- WHY. Every prod child without a gender (27 on 2026-10-16) was created by an admin through
-- add_unclaimed_student, which had no gender input; nothing could set one afterwards. This file pins:
--   • add_unclaimed_student stores p_gender — for an ongoing student AND a trial (both admin forms);
--   • the OLD call shape (no p_gender) still works — the migration is expand-only, so the deployed admin keeps
--     adding students until it is redeployed (§7.123);
--   • exactly ONE add_unclaimed_student exists (§7.124 — an overload makes PostgREST refuse every call);
--   • set_student_gender: admin of the row's tenant only (not another tenant's admin, a view-only role, a coach or
--     a parent), refuses NULL, and is audited.
--
-- METHOD (§7.16): every probe runs under SET LOCAL ROLE authenticated with an explicit jwt sub.
--
-- RED FIRST (§7.25): against the schema BEFORE 20261016000100 the file fails at 1b — the 11-argument
-- add_unclaimed_student and set_student_gender do not exist (run 2026-10-16). 1a and 4 are the expand-shape guards.
-- MUTATION PROOFS (each CREATE OR REPLACE inside this file's transaction, 2026-10-16):
--   1. `gender` dropped from add_unclaimed_student's INSERT       → RED 2, 3
--   2. set_student_gender's has_admin_area check → `IF false`     → RED 9, 10, 11, 12, 13

BEGIN;
SELECT set_config('swimsync.now', '2026-10-16 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(15);
SELECT is(app_today(), '2026-10-16'::date, 'clock pinned');

INSERT INTO tenants (id, slug, display_name, join_code, created_at) VALUES
  ('6e000000-0000-0000-0000-0000000000a0','sg-t','SG T','SWIM-SGTT', app_now() - INTERVAL '200 days'),
  ('6e000000-0000-0000-0000-0000000000b0','sg-t2','SG T2','SWIM-SGT2', app_now() - INTERVAL '200 days');

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;

SELECT pg_temp.mkuser('6e100000-0000-0000-0000-0000000000a1','sg-owner@test.local',
  '{"full_name":"SG Owner","role":"tenant_admin","tenant_id":"6e000000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('6e100000-0000-0000-0000-0000000000b1','sg-owner2@test.local',
  '{"full_name":"SG Owner2","role":"tenant_admin","tenant_id":"6e000000-0000-0000-0000-0000000000b0"}');
SELECT pg_temp.mkuser('6e100000-0000-0000-0000-0000000000c1','sg-coach@test.local',
  '{"full_name":"SG Coach","role":"coach","tenant_id":"6e000000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('6e100000-0000-0000-0000-0000000000d1','sg-parent@test.local',
  '{"full_name":"SG Parent","role":"parent"}');
-- A custom role with operations at VIEW only.
INSERT INTO tenant_roles (id, tenant_id, name)
VALUES ('6e200000-0000-0000-0000-000000000001','6e000000-0000-0000-0000-0000000000a0','SG Viewer');
INSERT INTO tenant_role_permissions (role_id, area, level)
SELECT '6e200000-0000-0000-0000-000000000001', a, 'view'::admin_level FROM unnest(enum_range(NULL::admin_area)) a;
SELECT pg_temp.mkuser('6e100000-0000-0000-0000-0000000000e1','sg-viewer@test.local',
  '{"full_name":"SG Viewer","role":"tenant_admin","tenant_id":"6e000000-0000-0000-0000-0000000000a0","admin_role_id":"6e200000-0000-0000-0000-000000000001"}');
UPDATE tenants SET owner_profile_id = '6e100000-0000-0000-0000-0000000000a1' WHERE id = '6e000000-0000-0000-0000-0000000000a0';
UPDATE tenants SET owner_profile_id = '6e100000-0000-0000-0000-0000000000b1' WHERE id = '6e000000-0000-0000-0000-0000000000b0';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('6e400000-0000-0000-0000-000000000001','6e000000-0000-0000-0000-0000000000a0','SG Group');
INSERT INTO locations (id, tenant_id, name) VALUES
  ('6e800000-0000-0000-0000-000000000001','6e000000-0000-0000-0000-0000000000a0','SG Pool');
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT '6e500000-0000-0000-0000-000000000001','6e000000-0000-0000-0000-0000000000a0', c.id, 'SG Dolphins',
       'saturday', '09:00', '10:00', '6e800000-0000-0000-0000-000000000001', 30.00, '6e400000-0000-0000-0000-000000000001'
  FROM coaches c WHERE c.profile_id = '6e100000-0000-0000-0000-0000000000c1';

-- A parent-linked child at T, for the set_student_gender probes.
INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id) VALUES
  ('6e300000-0000-0000-0000-000000000001','SG Kid', 'assigned', TRUE, '6e000000-0000-0000-0000-0000000000a0');
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '6e300000-0000-0000-0000-000000000001' FROM parents p WHERE p.profile_id = '6e100000-0000-0000-0000-0000000000d1';

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(TEXT) TO authenticated;
CREATE TEMP TABLE made (k TEXT PRIMARY KEY, v UUID);
GRANT ALL ON made TO PUBLIC;

-- ══ 1. Catalogue ═══════════════════════════════════════════════════════════════════════════════════════════════
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'add_unclaimed_student' AND pronamespace = 'public'::regnamespace),
  1, '1a: exactly one add_unclaimed_student (no overload, §7.124)');
SELECT is((SELECT COALESCE(string_agg(sig, ', ' ORDER BY sig), '') FROM unnest(ARRAY[
    'public.add_unclaimed_student(uuid,text,unclaimed_student_kind,date,attendance_status,date,text,text,text,date,gender_type)',
    'public.set_student_gender(uuid,gender_type)']) sig
   WHERE has_function_privilege('anon', sig, 'EXECUTE') OR NOT has_function_privilege('authenticated', sig, 'EXECUTE')),
  '', '1b: both callable by authenticated, neither by anon');

-- ══ 2. add_unclaimed_student stores the gender ═════════════════════════════════════════════════════════════════
SELECT pg_temp.as_user('6e100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
INSERT INTO made SELECT 'ongoing', add_unclaimed_student(p_class_id => '6e500000-0000-0000-0000-000000000001',
  p_full_name => 'SG Ongoing', p_kind => 'ongoing', p_gender => 'female');
INSERT INTO made SELECT 'trial', add_unclaimed_student(p_class_id => '6e500000-0000-0000-0000-000000000001',
  p_full_name => 'SG Trial', p_kind => 'trial', p_session_date => '2026-10-17', p_gender => 'male');
-- The deployed admin's call shape: no p_gender.
INSERT INTO made SELECT 'legacy', add_unclaimed_student(p_class_id => '6e500000-0000-0000-0000-000000000001',
  p_full_name => 'SG Legacy', p_kind => 'ongoing');
RESET ROLE;
SELECT is((SELECT gender::text FROM students WHERE id = (SELECT v FROM made WHERE k = 'ongoing')), 'female',
  '2: an ongoing student added by the admin keeps the gender given');
SELECT is((SELECT gender::text FROM students WHERE id = (SELECT v FROM made WHERE k = 'trial')), 'male',
  '3: a trial booked for a new child keeps the gender given');
SELECT ok((SELECT gender IS NULL FROM students WHERE id = (SELECT v FROM made WHERE k = 'legacy')),
  '4: the old call shape (no p_gender) still adds the student — expand-only');

-- ══ 3. set_student_gender ══════════════════════════════════════════════════════════════════════════════════════
SELECT pg_temp.as_user('6e100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT set_student_gender('6e300000-0000-0000-0000-000000000001', 'female') $$,
  '5: the admin of the child''s business sets it');
RESET ROLE;
SELECT is((SELECT gender::text FROM students WHERE id = '6e300000-0000-0000-0000-000000000001'), 'female',
  '6: the gender is stored');
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE entity_id = '6e300000-0000-0000-0000-000000000001'
                    AND actor_id = '6e100000-0000-0000-0000-0000000000a1'
                    AND new_value->>'gender' = 'female'),
  '7: the change is in the audit log, against the admin');

SELECT pg_temp.as_user('6e100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT set_student_gender('6e300000-0000-0000-0000-000000000001', NULL) $$,
  '23514', 'a gender is required', '8: NULL is refused — gender is set, never cleared');
SELECT pg_temp.as_user('6e100000-0000-0000-0000-0000000000b1');
SELECT throws_ok($$ SELECT set_student_gender('6e300000-0000-0000-0000-000000000001', 'male') $$,
  'only this business''s admin may set a child''s gender', '9: another business''s admin is refused');
SELECT pg_temp.as_user('6e100000-0000-0000-0000-0000000000e1');
SELECT throws_ok($$ SELECT set_student_gender('6e300000-0000-0000-0000-000000000001', 'male') $$,
  'only this business''s admin may set a child''s gender', '10: a view-only admin role is refused');
SELECT pg_temp.as_user('6e100000-0000-0000-0000-0000000000c1');
SELECT throws_ok($$ SELECT set_student_gender('6e300000-0000-0000-0000-000000000001', 'male') $$,
  'only this business''s admin may set a child''s gender', '11: the coach is refused');
SELECT pg_temp.as_user('6e100000-0000-0000-0000-0000000000d1');
SELECT throws_ok($$ SELECT set_student_gender('6e300000-0000-0000-0000-000000000001', 'male') $$,
  'only this business''s admin may set a child''s gender', '12: the parent is refused (they use Edit Child)');
RESET ROLE;
SELECT is((SELECT gender::text FROM students WHERE id = '6e300000-0000-0000-0000-000000000001'), 'female',
  '13: no refused call changed it');

SELECT * FROM finish();
ROLLBACK;
