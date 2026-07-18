-- pgTAP: CROSS-TENANT ISOLATION.
--
-- The test that has to exist BEFORE a second business is onboarded, not after.
-- Seeds two complete tenants — each with its own admin, coach, class, parent,
-- student, invoice and credit note — and asserts that neither can see any part
-- of the other, while the platform admin sees both.
--
-- Also pins the three cross-tenant leaks closed by 20260718000900, each of which
-- was live in production and harmless only because there was one business:
--   • coaches_select  was USING (TRUE)
--   • classes_select  was USING (TRUE)
--   • profiles_select exposed every coach's name/email/phone platform-wide
--
-- NOTE ON METHOD (gotcha §7.16): every role probe runs inside this explicit
-- transaction. `SET LOCAL ROLE` outside a transaction is a no-op and the session
-- stays superuser, which BYPASSES RLS — every assertion then "passes", including
-- the ones that must fail. The negative assertions below are what make a
-- silently-superuser run visible.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(24);

-- ── Two tenants ─────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, kind, join_code) VALUES
  ('11111111-0000-0000-0000-000000000001','tenant-a','Tenant A School','school','SWIM-AAAA'),
  ('11111111-0000-0000-0000-000000000002','tenant-b','Tenant B Private','private','SWIM-BBBB');

-- ── Users: one admin + one coach per tenant, one parent per tenant, and the
--    platform admin. Roles/tenant travel in user_metadata; the auth trigger
--    creates profiles/coaches/parents. ────────────────────────────────────────
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','ten-adminA@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Admin A","role":"tenant_admin","tenant_id":"11111111-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','ten-adminB@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Admin B","role":"tenant_admin","tenant_id":"11111111-0000-0000-0000-000000000002"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','ten-coachA@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Coach A","role":"coach","tenant_id":"11111111-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-0000000000b2',
   'authenticated','authenticated','ten-coachB@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Coach B","role":"coach","tenant_id":"11111111-0000-0000-0000-000000000002"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-0000000000a3',
   'authenticated','authenticated','ten-parentA@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Parent A","role":"parent"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-0000000000b3',
   'authenticated','authenticated','ten-parentB@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Parent B","role":"parent"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-0000000000f1',
   'authenticated','authenticated','ten-platform@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Platform Owner","role":"platform_admin"}', now(), now(), '', '', '', '');

-- ── A class per tenant (tenant_id filled by the class_tenant_fill trigger) ──
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson)
SELECT '30000000-0000-0000-0000-0000000000a1', c.id, 'Class A', 'saturday','10:00','11:00','Pool A', 25
  FROM coaches c WHERE c.profile_id = '20000000-0000-0000-0000-0000000000a2';
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson)
SELECT '30000000-0000-0000-0000-0000000000b1', c.id, 'Class B', 'sunday','10:00','11:00','Pool B', 40
  FROM coaches c WHERE c.profile_id = '20000000-0000-0000-0000-0000000000b2';

-- ── A student per tenant, linked to that tenant's parent and class ──────────
INSERT INTO students (id, full_name, assignment_status, tenant_id) VALUES
  ('40000000-0000-0000-0000-0000000000a1','Kid A','assigned','11111111-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-0000000000b1','Kid B','assigned','11111111-0000-0000-0000-000000000002');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '40000000-0000-0000-0000-0000000000a1' FROM parents p WHERE p.profile_id='20000000-0000-0000-0000-0000000000a3';
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '40000000-0000-0000-0000-0000000000b1' FROM parents p WHERE p.profile_id='20000000-0000-0000-0000-0000000000b3';

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '11111111-0000-0000-0000-000000000001' FROM parents p WHERE p.profile_id='20000000-0000-0000-0000-0000000000a3';
INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '11111111-0000-0000-0000-000000000002' FROM parents p WHERE p.profile_id='20000000-0000-0000-0000-0000000000b3';

INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
  ('40000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-0000000000a1', TRUE),
  ('40000000-0000-0000-0000-0000000000b1','30000000-0000-0000-0000-0000000000b1', TRUE);

-- ── An invoice per tenant ───────────────────────────────────────────────────
INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount, net_amount)
SELECT '50000000-0000-0000-0000-0000000000a1', p.id, '11111111-0000-0000-0000-000000000001','2026-05', 25, 25
  FROM parents p WHERE p.profile_id='20000000-0000-0000-0000-0000000000a3';
INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount, net_amount)
SELECT '50000000-0000-0000-0000-0000000000b1', p.id, '11111111-0000-0000-0000-000000000002','2026-05', 40, 40
  FROM parents p WHERE p.profile_id='20000000-0000-0000-0000-0000000000b3';

-- ============================================================
-- Tenant A's ADMIN sees only tenant A
-- ============================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT is((SELECT COUNT(*) FROM classes)::int, 1, 'admin A sees exactly one class (leak #2: classes_select was USING (TRUE))');
SELECT is((SELECT title FROM classes), 'Class A', 'admin A sees THEIR class, not tenant B''s');
SELECT is((SELECT COUNT(*) FROM coaches)::int, 1, 'admin A sees exactly one coach (leak #1: coaches_select was USING (TRUE))');
SELECT is((SELECT COUNT(*) FROM students)::int, 1, 'admin A sees only their own tenant''s student');
SELECT is((SELECT COUNT(*) FROM invoices)::int, 1, 'admin A sees only their own tenant''s invoice');
SELECT is((SELECT COUNT(*) FROM invoices WHERE tenant_id='11111111-0000-0000-0000-000000000002')::int, 0,
          'admin A CANNOT see tenant B''s invoice');
-- Scoped to this test's own tenants: the local seed creates one too, and a
-- count of ALL rows would drift with the fixture rather than measure the policy.
SELECT is((SELECT COUNT(*) FROM tenants WHERE id IN
            ('11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002'))::int,
          1, 'admin A cannot enumerate other tenants (join codes are the only way in)');

-- Leak #3: every coach profile was readable platform-wide (name, email, phone).
SELECT is((SELECT COUNT(*) FROM profiles WHERE email = 'ten-coachB@test.local')::int, 0,
          'admin A CANNOT read tenant B''s coach profile (leak #3: contact details were global)');

-- ============================================================
-- Tenant B's ADMIN sees only tenant B — the mirror, so a policy that
-- accidentally hardcodes one tenant cannot pass.
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

SELECT is((SELECT title FROM classes), 'Class B', 'admin B sees THEIR class');
SELECT is((SELECT COUNT(*) FROM students WHERE id='40000000-0000-0000-0000-0000000000a1')::int, 0,
          'admin B CANNOT see tenant A''s student');
SELECT is((SELECT COUNT(*) FROM invoices)::int, 1, 'admin B sees only their own invoice');

-- ============================================================
-- A COACH sees only their own classes — not a colleague's, and never
-- another tenant's.
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

SELECT is((SELECT COUNT(*) FROM classes)::int, 1, 'coach A sees exactly their own class');
SELECT is((SELECT COUNT(*) FROM students WHERE id='40000000-0000-0000-0000-0000000000b1')::int, 0,
          'coach A CANNOT see tenant B''s student');

-- ============================================================
-- A PARENT sees their own child and invoice, and nothing of the other tenant.
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-0000000000a3","role":"authenticated"}';

SELECT is((SELECT COUNT(*) FROM students)::int, 1, 'parent A sees their own child');
SELECT is((SELECT COUNT(*) FROM invoices)::int, 1, 'parent A sees their own invoice');
SELECT is((SELECT COUNT(*) FROM invoices WHERE tenant_id='11111111-0000-0000-0000-000000000002')::int, 0,
          'parent A CANNOT see tenant B''s invoice');

-- ============================================================
-- The PLATFORM admin sees everything — the "super-super admin".
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

SELECT is((SELECT COUNT(*) FROM tenants WHERE id IN
            ('11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002'))::int,
          2, 'platform admin sees both tenants');
SELECT is((SELECT COUNT(*) FROM invoices)::int, 2, 'platform admin sees both tenants'' invoices');

-- ============================================================
-- JOIN CODES (phase 3). A parent joins a business they cannot see, and the
-- redemption path must not become a way to enumerate tenants.
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-0000000000a3","role":"authenticated"}';

-- Parent A already belongs to tenant A and cannot see tenant B at all.
SELECT is((SELECT COUNT(*) FROM tenants WHERE id='11111111-0000-0000-0000-000000000002')::int, 0,
          'a parent cannot see a tenant they have not joined');

-- Redeeming tenant B's code joins them, and returns which business it was.
SELECT is((SELECT display_name FROM join_tenant_by_code('SWIM-BBBB')), 'Tenant B Private',
          'a valid join code links the parent and names the business');

SELECT is((SELECT COUNT(*) FROM parent_tenants pt
             WHERE pt.tenant_id='11111111-0000-0000-0000-000000000002'
               AND pt.parent_id = current_parent_id())::int, 1,
          'the link row is created for the CALLING parent');

-- Idempotent: a parent who taps twice must not see an error.
SELECT lives_ok(
  $$ SELECT join_tenant_by_code('swim-bbbb') $$,
  'redeeming the same code again is a no-op, and the code is case/space tolerant'
);

-- A wrong code must not reveal whether it exists.
SELECT throws_ok(
  $$ SELECT join_tenant_by_code('SWIM-ZZZZ') $$,
  'that join code was not recognised',
  'an unknown code is refused without disclosing anything'
);

-- Only the owning admin may rotate a code — not another tenant's admin.
SET LOCAL "request.jwt.claims" TO '{"sub":"20000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT regenerate_join_code('11111111-0000-0000-0000-000000000002') $$,
  'not permitted to change this business''s join code',
  'admin A cannot rotate tenant B''s join code'
);

SELECT * FROM finish();
ROLLBACK;
