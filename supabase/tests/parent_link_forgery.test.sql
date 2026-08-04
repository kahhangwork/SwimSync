-- pgTAP: A SIGNED-IN STRANGER CANNOT FORGE THE LINKS THAT DEFINE A FAMILY.
--
-- Pins 20260804000500. All three of these were REPRODUCED against the local
-- stack on 2026-08-04 with a real anon-key session — HTTP 201, 201 and 200 —
-- before the migration existed:
--   • POST parent_tenants  with any tenant_id  → joined a business, no join code
--   • POST parent_students with any student_id → attached to someone else's child
--   • PATCH students                            → renamed and deactivated that child
--
-- WHY THE STRANGER IS THE RIGHT PERSONA. Signup is open — a join code is asked
-- for after registration, never at it — so "any signed-in user" means anyone
-- with an email address, not "a customer of this business". Every other
-- isolation file in this suite probes tenant A against tenant B; this one
-- probes someone who belongs to nothing, which is what an attacker actually is.
--
-- NOTE ON METHOD (§7.16). Every probe runs inside this transaction after
-- `SET LOCAL ROLE authenticated`. Outside a transaction that is a no-op, the
-- session stays superuser, RLS is bypassed and every assertion "passes" —
-- including the ones that must fail. Assertion 1's positive control exists to
-- make a silently-superuser run visible.
--
-- PROVEN RED. Against the schema immediately before 20260804000500 this file
-- was 6 of 9 failing (§7.25): 2 and 4 because both forged INSERTs returned no
-- exception, then 3, 5, 6 and 8 as the consequences — the business row and its
-- join_code visible, a family link that should not exist, and the victim child
-- readable and writable. 1, 7 and 9 passed then and must pass now: they are the
-- control and the two legitimate paths, and they are the half of this file that
-- proves the fix did not simply break onboarding.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

-- ── One business, one real family, one stranger ─────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('1f000000-0000-0000-0000-000000000001','forgery-school','Forgery Test School','SWIM-FORG');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','2f000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','forg-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Forgery Admin","role":"tenant_admin","tenant_id":"1f000000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','2f000000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','forg-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Real Parent","role":"parent"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','2f000000-0000-0000-0000-0000000000e1',
   'authenticated','authenticated','forg-stranger@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Mallory Stranger","role":"parent"}', now(), now(), '', '', '', '');

-- The real family: a child, linked to the real parent, at the business.
INSERT INTO students (id, full_name, date_of_birth, tenant_id) VALUES
  ('4f000000-0000-0000-0000-000000000001','Victim Child','2018-05-05','1f000000-0000-0000-0000-000000000001');
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '4f000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = '2f000000-0000-0000-0000-0000000000d1';
INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '1f000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = '2f000000-0000-0000-0000-0000000000d1';

-- The stranger deliberately gets NOTHING: no parent_tenants row, no child.

-- ============================================================
-- THE STRANGER
-- ============================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"2f000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- 1. POSITIVE CONTROL, and the guard against a vacuous run. The stranger IS a
--    parent and the fixture DOES hold a child — so every "sees nothing" below
--    is a real denial, not an empty database or a failed role switch.
SELECT ok(
  current_parent_id() IS NOT NULL
  AND (SELECT COUNT(*) FROM public.students) = 0,
  'control: the stranger is a real parent session, and sees no child');

-- 2. THE FIRST FORGERY. Was HTTP 201.
SELECT throws_ok(
  $$ INSERT INTO parent_tenants (parent_id, tenant_id)
     VALUES (current_parent_id(), '1f000000-0000-0000-0000-000000000001') $$,
  '42501', NULL,
  'a parent cannot insert their own membership of an arbitrary business');

-- 3. …and the business is still not theirs.
SELECT is(
  (SELECT COUNT(*) FROM tenants WHERE id='1f000000-0000-0000-0000-000000000001')::int,
  0,
  'the business — and its join_code — stays invisible to a non-member');

-- 4. THE SECOND FORGERY, the one that reaches a child. Was HTTP 201.
SELECT throws_ok(
  $$ INSERT INTO parent_students (parent_id, student_id)
     VALUES (current_parent_id(), '4f000000-0000-0000-0000-000000000001') $$,
  '42501', NULL,
  'a parent cannot attach themselves to a child that is not theirs');

-- 5. The claim flow is the only route to someone else's child, and it needs the
--    business admin to approve (PRD §7.18). Nothing here may shortcut it.
SELECT is(
  (SELECT COUNT(*) FROM parent_students WHERE parent_id = current_parent_id())::int,
  0,
  'no family link exists for the stranger by any route');

-- 6. THE THIRD, which (4) is what actually closes: with ownership unforgeable,
--    students_update's `parent_owns_student(id)` branch can never match.
--    A denied UPDATE is 0 rows, not an error — assert the row is untouched.
WITH attempted AS (
  UPDATE students SET full_name = 'TAMPERED BY STRANGER', is_active = FALSE
   WHERE id = '4f000000-0000-0000-0000-000000000001'
  RETURNING 1
)
SELECT is((SELECT COUNT(*) FROM attempted)::int, 0,
          'the stranger cannot modify a child they do not own');

-- ============================================================
-- THE LEGITIMATE PATHS MUST STILL WORK — this migration must not trade a
-- security hole for an onboarding outage. The join code is the ONLY route a
-- new family has in, and the re-entry route for one marked inactive.
-- ============================================================

-- 7. The definer RPC still links the caller, though the direct INSERT cannot.
SELECT is(
  (SELECT display_name FROM join_tenant_by_code('SWIM-FORG')),
  'Forgery Test School',
  'the join code still links a parent and names the business');

-- 8. Membership is not child access. Having joined properly, the stranger still
--    has no business seeing the other family's child.
SELECT is(
  (SELECT COUNT(*) FROM students)::int, 0,
  'joining the business does not expose another family''s child');

-- 9. Adding a child of their own still works through the definer RPC — the
--    path that replaced the direct parent_students INSERT.
SELECT lives_ok(
  $$ SELECT add_child_or_claim(
       '1f000000-0000-0000-0000-000000000001'::uuid,
       'Mallory Junior', '2019-07-07'::date, NULL, NULL,
       'create_anyway'::add_child_mode, NULL) $$,
  'a parent can still add their own child');

SELECT * FROM finish();
ROLLBACK;
