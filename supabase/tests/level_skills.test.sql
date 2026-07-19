-- pgTAP: the skills taught at a level.
--
-- Reference material describing the LEVEL, not any child's progress against it
-- — that line is the whole scope decision and is worth a test of its own.
--
-- Also pins the fix to the level-name constraint: 20260719001800's comment
-- claimed the uniqueness was trimmed + lowercased and the code shipped a plain
-- UNIQUE, so 'Seahorse' and '  seahorse  ' both inserted. That test FAILS on
-- the pre-fix schema, which is the only thing that makes it worth having.
--
-- Its own tenants, so nothing here depends on another fixture's state.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(11);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'tenant_level_skills' AND relnamespace = 'public'::regnamespace),
  'tenant_level_skills has ROW LEVEL SECURITY enabled, not merely policies written');

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('8f000000-0000-0000-0000-000000000001','skl-a','Skills Swim A','SWIM-SKLA'),
  ('8f000000-0000-0000-0000-000000000002','skl-b','Skills Swim B','SWIM-SKLB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','7b000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','skl-admin-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Skl Admin A","role":"tenant_admin","tenant_id":"8f000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','7b000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','skl-admin-b@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Skl Admin B","role":"tenant_admin","tenant_id":"8f000000-0000-0000-0000-000000000002"}',
   now(), now(), '','','','');

INSERT INTO tenant_levels (id, tenant_id, label, sort_order, note) VALUES
  ('9f000000-0000-0000-0000-000000000001','8f000000-0000-0000-0000-000000000001','Toddler 1', 1, NULL),
  ('9f000000-0000-0000-0000-000000000002','8f000000-0000-0000-0000-000000000001','Toddler 4', 4,
   'Progress to B3 upon completing T4'),
  ('9f000000-0000-0000-0000-000000000003','8f000000-0000-0000-0000-000000000002','Guppy', 1, NULL);

-- A progression rule is not a skill, and needs somewhere to live that is not a
-- fake skill row.
SELECT is(
  (SELECT note FROM tenant_levels WHERE id='9f000000-0000-0000-0000-000000000002'),
  'Progress to B3 upon completing T4',
  'a level carries a note for things that are not skills');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"7b000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT lives_ok($$
  INSERT INTO tenant_level_skills (level_id, label, sort_order) VALUES
    ('9f000000-0000-0000-0000-000000000001','Aeroplane Kick', 1),
    ('9f000000-0000-0000-0000-000000000001','Basic bubbles', 2),
    ('9f000000-0000-0000-0000-000000000001','Rules of the pool', 3)
$$, 'an admin can add skills to their own level');

-- ORDER IS THE POINT, exactly as it is for the ladder itself. A curriculum
-- rendered alphabetically teaches "Rules of the pool" before "Aeroplane Kick".
SELECT is(
  (SELECT string_agg(label, ' | ' ORDER BY sort_order)
     FROM tenant_level_skills WHERE level_id='9f000000-0000-0000-0000-000000000001'),
  'Aeroplane Kick | Basic bubbles | Rules of the pool',
  'skills come back in the order the admin set, not alphabetically');

-- Same skill twice in one level is a slip; the same skill at two levels is
-- normal ("Back Float" appears at several rungs of a real curriculum).
SELECT throws_ok($$
  INSERT INTO tenant_level_skills (level_id, label)
  VALUES ('9f000000-0000-0000-0000-000000000001','  aeroplane KICK  ')
$$, '23505', NULL,
  'the same skill twice in one level is refused, ignoring case and whitespace');

SELECT lives_ok($$
  INSERT INTO tenant_level_skills (level_id, label)
  VALUES ('9f000000-0000-0000-0000-000000000002','Aeroplane Kick')
$$, 'the same skill at a DIFFERENT level is fine');

-- ── The tenant boundary ────────────────────────────────────────────────────
SELECT throws_ok($$
  INSERT INTO tenant_level_skills (level_id, label)
  VALUES ('9f000000-0000-0000-0000-000000000003','Sneaky Skill')
$$, '42501', NULL,
  'an admin cannot add skills to ANOTHER business''s level');

SELECT is(
  (SELECT count(*)::int FROM tenant_level_skills
    WHERE level_id = '9f000000-0000-0000-0000-000000000003'),
  0, 'an admin cannot even see another business''s skills');

-- ── Retiring a level takes its skills, but never its students ─────────────
RESET ROLE;
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, level_id)
VALUES ('5b000000-0000-0000-0000-0000000000c1','Skill Kid','2019-01-01','assigned',
        '8f000000-0000-0000-0000-000000000001','9f000000-0000-0000-0000-000000000001');

DELETE FROM tenant_levels WHERE id = '9f000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM tenant_level_skills
    WHERE level_id = '9f000000-0000-0000-0000-000000000001'),
  0, 'deleting a level CASCADEs its skills — a skill has no meaning without one');

SELECT is(
  (SELECT count(*)::int FROM students WHERE id='5b000000-0000-0000-0000-0000000000c1'),
  1, 'but the student survives, merely unlevelled (SET NULL, not CASCADE)');

-- ── The constraint fix (FAILS on the pre-fix schema) ───────────────────────
-- 20260719001800's comment promised trimmed + lowercased and shipped a plain
-- UNIQUE, so this pair both inserted.
SELECT throws_ok($$
  INSERT INTO tenant_levels (tenant_id, label)
  VALUES ('8f000000-0000-0000-0000-000000000001','  toddler 4  ')
$$, '23505', NULL,
  'level names now really are unique ignoring case and whitespace');

SELECT * FROM finish();
ROLLBACK;
