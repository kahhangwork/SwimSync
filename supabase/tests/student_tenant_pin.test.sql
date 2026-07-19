-- pgTAP: a student never changes business except through the platform RPC.
--
-- These tests FAIL on the pre-fix schema — verified by dropping the trigger and
-- re-running, which is the only thing that makes "it passes" mean anything
-- (§7.25). Before migration 20260719001500 the first test moved 1 row.
--
-- The hole: students_update's WITH CHECK repeats its USING clause, and
-- parent_owns_student(id) stays true after tenant_id changes. RLS alone cannot
-- express this — a WITH CHECK cannot see the OLD row.
--
-- Its own tenants, so nothing here depends on another fixture's state.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(6);

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('8c000000-0000-0000-0000-000000000001','pin-home','Pin Home Swim','SWIM-PINH'),
  ('8c000000-0000-0000-0000-000000000002','pin-rival','Pin Rival Swim','SWIM-PINR');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','7c000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','pin-parent@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}', '{"full_name":"Pin Parent","role":"parent"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','7c000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','pin-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Pin Admin","role":"tenant_admin","tenant_id":"8c000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','7c000000-0000-0000-0000-000000000003',
   'authenticated','authenticated','pin-platform@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}', '{"full_name":"Pin Platform","role":"platform_admin"}',
   now(), now(), '','','','');

INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, is_active)
VALUES ('5c000000-0000-0000-0000-000000000001','Pinned Child','2018-05-05',
        'unassigned','8c000000-0000-0000-0000-000000000001', TRUE);

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '5c000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id='7c000000-0000-0000-0000-000000000001';

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '8c000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id='7c000000-0000-0000-0000-000000000001';

-- ── As the owning PARENT ───────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"7c000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- THE VULNERABILITY. Passed before the fix: the parent still owns the student
-- after the move, so WITH CHECK was satisfied and the row went to the rival.
SELECT throws_ok($$
  UPDATE students SET tenant_id = '8c000000-0000-0000-0000-000000000002'
   WHERE id = '5c000000-0000-0000-0000-000000000001'
$$, '23514', NULL,
  'a parent CANNOT move their own child into another business');

SELECT is(
  (SELECT tenant_id FROM students WHERE id='5c000000-0000-0000-0000-000000000001'),
  '8c000000-0000-0000-0000-000000000001'::uuid,
  'the child is still at their original business');

-- created_by is part of students_update''s own USING clause, so a client that
-- could rewrite it could grant itself permission on the row.
SELECT throws_ok($$
  UPDATE students SET created_by = '7c000000-0000-0000-0000-000000000001'
   WHERE id = '5c000000-0000-0000-0000-000000000001'
$$, '23514', NULL,
  'a parent cannot rewrite created_by, which feeds the row''s own access rule');

-- The pin must not break ordinary editing — that is the whole point of 1b.
SELECT lives_ok($$
  UPDATE students SET full_name = 'Pinned Child Renamed', notes = 'ok'
   WHERE id = '5c000000-0000-0000-0000-000000000001'
$$, 'a parent CAN still edit their child''s ordinary fields');

-- ── As the business's TENANT ADMIN ─────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"7c000000-0000-0000-0000-000000000002","role":"authenticated"}';

-- An admin is no more entitled to hand a child to another business than a
-- parent is. Moving between businesses is a platform-admin remedy for a
-- mistyped join code (PRD §4.4), not an everyday operation.
SELECT throws_ok($$
  UPDATE students SET tenant_id = '8c000000-0000-0000-0000-000000000002'
   WHERE id = '5c000000-0000-0000-0000-000000000001'
$$, '23514', NULL,
  'a tenant admin cannot push a child into another business either');

-- ── The sanctioned route still works ───────────────────────────────────────
-- reassign_student_tenant() is SECURITY DEFINER owned by postgres, so
-- current_user is not 'authenticated' inside it and the pin stands aside.
-- Without this the fix would be a regression, not a fix.
--
-- Still as `authenticated` — the RPC's own guard is is_platform_admin(), which
-- reads the JWT, so the caller must genuinely BE the platform admin. Only the
-- SECURITY DEFINER context changes, not the identity.
SET LOCAL "request.jwt.claims" TO '{"sub":"7c000000-0000-0000-0000-000000000003","role":"authenticated"}';
SELECT lives_ok($$
  SELECT reassign_student_tenant(
    '5c000000-0000-0000-0000-000000000001',
    '8c000000-0000-0000-0000-000000000002')
$$, 'the platform admin''s reassign RPC still moves a student');

SELECT * FROM finish();
ROLLBACK;
