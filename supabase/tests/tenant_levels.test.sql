-- pgTAP: per-business swimming levels.
--
-- The properties worth pinning are the tenant ones. A level ladder is cheap to
-- get right and expensive to get wrong: it is the first table added since the
-- three that shipped with RLS silently OFF, and the first cross-table
-- reference on students since the tenant_id hole (20260719001500).
--
-- Its own tenants, so nothing here depends on another fixture's state.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

-- The check that would have caught three previously-shipped leaks.
SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'tenant_levels' AND relnamespace = 'public'::regnamespace),
  'tenant_levels has ROW LEVEL SECURITY enabled, not merely policies written');

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('8e000000-0000-0000-0000-000000000001','lvl-a','Levels Swim A','SWIM-LVLA'),
  ('8e000000-0000-0000-0000-000000000002','lvl-b','Levels Swim B','SWIM-LVLB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','7e000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','lvl-admin-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Lvl Admin A","role":"tenant_admin","tenant_id":"8e000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','7e000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','lvl-admin-b@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Lvl Admin B","role":"tenant_admin","tenant_id":"8e000000-0000-0000-0000-000000000002"}',
   now(), now(), '','','','');

INSERT INTO tenant_levels (id, tenant_id, label, sort_order) VALUES
  ('9e000000-0000-0000-0000-000000000001','8e000000-0000-0000-0000-000000000001','Seahorse', 1),
  ('9e000000-0000-0000-0000-000000000002','8e000000-0000-0000-0000-000000000001','Dolphin',  2),
  ('9e000000-0000-0000-0000-000000000003','8e000000-0000-0000-0000-000000000002','Guppy',    1);

INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id)
VALUES ('5f000000-0000-0000-0000-000000000001','Level Kid','2018-02-02',
        'assigned','8e000000-0000-0000-0000-000000000001');

-- ── Each business defines its own ladder, and sees only its own ────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"7e000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is((SELECT count(*)::int FROM tenant_levels), 2,
  'an admin sees only their own business''s levels');

SELECT lives_ok($$
  INSERT INTO tenant_levels (tenant_id, label, sort_order)
  VALUES ('8e000000-0000-0000-0000-000000000001','Shark', 3)
$$, 'an admin can add a level to their own business');

SELECT throws_ok($$
  INSERT INTO tenant_levels (tenant_id, label, sort_order)
  VALUES ('8e000000-0000-0000-0000-000000000002','Sneaky', 9)
$$, '42501', NULL,
  'an admin cannot add a level to ANOTHER business');

-- Two businesses may both call a level "Beginner"; one may not repeat it.
SELECT throws_ok($$
  INSERT INTO tenant_levels (tenant_id, label)
  VALUES ('8e000000-0000-0000-0000-000000000001','Seahorse')
$$, '23505', NULL,
  'a business cannot define the same level twice');

-- ── A level may only be applied within its own business ───────────────────
-- students_update checks the STUDENT's tenant; nothing checks the LEVEL's, so
-- without the trigger an admin could reference a rival's level id via the API.
SELECT lives_ok($$
  UPDATE students SET level_id = '9e000000-0000-0000-0000-000000000001'
   WHERE id = '5f000000-0000-0000-0000-000000000001'
$$, 'a student takes a level from their own business');

SELECT throws_ok($$
  UPDATE students SET level_id = '9e000000-0000-0000-0000-000000000003'
   WHERE id = '5f000000-0000-0000-0000-000000000001'
$$, '23514', NULL,
  'a student cannot be given ANOTHER business''s level');

-- ── Retiring a level does not retire the students on it ───────────────────
RESET ROLE;
DELETE FROM tenant_levels WHERE id = '9e000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM students WHERE id='5f000000-0000-0000-0000-000000000001'),
  1, 'deleting a level leaves the student in place');

SELECT is(
  (SELECT level_id FROM students WHERE id='5f000000-0000-0000-0000-000000000001'),
  NULL,
  'the student is simply unlevelled — recoverable, unlike being deleted');

SELECT * FROM finish();
ROLLBACK;
