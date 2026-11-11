-- pgTAP: the server REFUSES a child with no gender (20261111000100 — the contract step of 20261016000100).
--
-- WHY. Gender is required (user, 2026-10-16), but only the forms enforced it; a caller that omitted p_gender still
-- created a child with none — how the 27 blank prod children happened. This file pins:
--   • add_unclaimed_student (admin): NULL refused, for an ongoing student AND a trial, and the refusal adds nothing;
--   • the refusal comes AFTER the permission gates — a caller who may not add a child is told THAT, not "gender";
--   • add_child_or_claim (parent): NULL and blank refused in every mode (create / check / claim), adding nothing;
--   • a gender given still works on both (the happy path did not move);
--   • the column stays NULLABLE — blank legacy rows are filled via set_student_gender, not forced by a constraint.
--
-- METHOD (§7.16): every probe runs under SET LOCAL ROLE authenticated with an explicit jwt sub.
--
-- RED FIRST (§7.25): against the bodies BEFORE 20261111000100 (supabase/rollback/…_DOWN.sql applied inside this
-- transaction) the refusal probes 2–8 fail — the old functions create the child (run 2026-11-11).
-- MUTATION PROOF (2026-11-11): add_unclaimed_student's gender IF moved ABOVE the permission gates → RED 10 only.

BEGIN;
SELECT set_config('swimsync.now', '2026-11-11 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(13);
SELECT is(app_today(), '2026-11-11'::date, 'clock pinned');

INSERT INTO tenants (id, slug, display_name, join_code, created_at) VALUES
  ('6f000000-0000-0000-0000-0000000000a0','gr-t','GR T','SWIM-GRTT', app_now() - INTERVAL '200 days');

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;

SELECT pg_temp.mkuser('6f100000-0000-0000-0000-0000000000a1','gr-owner@test.local',
  '{"full_name":"GR Owner","role":"tenant_admin","tenant_id":"6f000000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('6f100000-0000-0000-0000-0000000000c1','gr-coach@test.local',
  '{"full_name":"GR Coach","role":"coach","tenant_id":"6f000000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('6f100000-0000-0000-0000-0000000000d1','gr-parent@test.local',
  '{"full_name":"GR Parent","role":"parent"}');
UPDATE tenants SET owner_profile_id = '6f100000-0000-0000-0000-0000000000a1' WHERE id = '6f000000-0000-0000-0000-0000000000a0';
INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '6f000000-0000-0000-0000-0000000000a0' FROM parents p WHERE p.profile_id = '6f100000-0000-0000-0000-0000000000d1';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('6f400000-0000-0000-0000-000000000001','6f000000-0000-0000-0000-0000000000a0','GR Group');
INSERT INTO locations (id, tenant_id, name) VALUES
  ('6f800000-0000-0000-0000-000000000001','6f000000-0000-0000-0000-0000000000a0','GR Pool');
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT '6f500000-0000-0000-0000-000000000001','6f000000-0000-0000-0000-0000000000a0', c.id, 'GR Dolphins',
       'saturday', '09:00', '10:00', '6f800000-0000-0000-0000-000000000001', 30.00, '6f400000-0000-0000-0000-000000000001'
  FROM coaches c WHERE c.profile_id = '6f100000-0000-0000-0000-0000000000c1';

-- An unclaimed child the parent could claim (same name, no dob) — for the claim-mode probe.
INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id) VALUES
  ('6f300000-0000-0000-0000-000000000001','GR Claimable', 'assigned', TRUE, '6f000000-0000-0000-0000-0000000000a0');

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(TEXT) TO authenticated;

-- ══ 1. add_unclaimed_student (admin) ═══════════════════════════════════════════════════════════════════════════
SELECT pg_temp.as_user('6f100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT add_unclaimed_student(p_class_id => '6f500000-0000-0000-0000-000000000001',
  p_full_name => 'GR NoGender Ongoing', p_kind => 'ongoing') $$,
  '23514', 'a gender is required', '2: admin, ongoing, no gender → refused');
SELECT throws_ok($$ SELECT add_unclaimed_student(p_class_id => '6f500000-0000-0000-0000-000000000001',
  p_full_name => 'GR NoGender Trial', p_kind => 'trial', p_session_date => '2026-11-14') $$,
  '23514', 'a gender is required', '3: admin, trial for a new child, no gender → refused');
SELECT lives_ok($$ SELECT add_unclaimed_student(p_class_id => '6f500000-0000-0000-0000-000000000001',
  p_full_name => 'GR WithGender', p_kind => 'ongoing', p_gender => 'male') $$,
  '9: admin, with a gender → still added');
RESET ROLE;

-- The permission gate speaks first: the coach (no admin area) is told they may not, not that gender is missing.
SELECT pg_temp.as_user('6f100000-0000-0000-0000-0000000000c1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT add_unclaimed_student(p_class_id => '6f500000-0000-0000-0000-000000000001',
  p_full_name => 'GR Coach Try', p_kind => 'ongoing') $$,
  'not permitted to add a student to this class', '10: no permission AND no gender → the permission refusal, first');
RESET ROLE;

-- ══ 2. add_child_or_claim (parent) ═════════════════════════════════════════════════════════════════════════════
SELECT pg_temp.as_user('6f100000-0000-0000-0000-0000000000d1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT * FROM add_child_or_claim('6f000000-0000-0000-0000-0000000000a0',
  'Wilhelmina Ostrowski', '2020-01-01', NULL, NULL, 'create_anyway', NULL) $$,
  '23514', 'a gender is required', '4: parent, create, NULL gender → refused');
SELECT throws_ok($$ SELECT * FROM add_child_or_claim('6f000000-0000-0000-0000-0000000000a0',
  'Wilhelmina Ostrowski', '2020-01-01', '  ', NULL, 'check', NULL) $$,
  '23514', 'a gender is required', '5: parent, check, BLANK gender → refused (blank is missing)');
SELECT throws_ok($$ SELECT * FROM add_child_or_claim('6f000000-0000-0000-0000-0000000000a0',
  'GR Claimable', NULL, NULL, NULL, 'claim_confirmed', '6f300000-0000-0000-0000-000000000001') $$,
  '23514', 'a gender is required', '6: parent, claim, NULL gender → refused (a claim carries claimed_gender)');
SELECT is((SELECT outcome FROM add_child_or_claim('6f000000-0000-0000-0000-0000000000a0',
  'Bartholomew Quince', '2020-01-01', 'female', NULL, 'check', NULL)),
  'created', '11: parent, with a gender → still created');
RESET ROLE;

-- ══ 3. Refusals add nothing; the column stays nullable ═════════════════════════════════════════════════════════
SELECT is((SELECT count(*)::int FROM students WHERE tenant_id = '6f000000-0000-0000-0000-0000000000a0'
            AND full_name IN ('GR NoGender Ongoing','GR NoGender Trial','GR Coach Try','Wilhelmina Ostrowski')), 0,
  '7: no refused call (admin or parent) left a student row');
SELECT is((SELECT count(*)::int FROM student_claims WHERE tenant_id = '6f000000-0000-0000-0000-0000000000a0'), 0,
  '8: the refused claim filed nothing');
SELECT is((SELECT gender::text FROM students WHERE full_name = 'Bartholomew Quince'), 'female',
  '12: the parent''s child keeps the gender given');
SELECT is((SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'gender'), 'YES',
  '13: students.gender stays nullable — blank legacy rows are filled, not forbidden');

SELECT * FROM finish();
ROLLBACK;
