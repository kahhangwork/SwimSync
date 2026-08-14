-- pgTAP: the per-business public-holiday calendar (20260815000100).
-- ⚠ RISK 5 — RLS scopes reads/writes to the owning tenant; grants follow
-- policies. Self-contained; own tenants; rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('ca000000-0000-0000-0000-000000000001','hol-a','Holiday A','SWIM-HOLA'),
  ('ca000000-0000-0000-0000-000000000002','hol-b','Holiday B','SWIM-HOLB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','cd000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','hol-admin-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Hol Admin A","role":"tenant_admin","tenant_id":"ca000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','cd000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','hol-admin-b@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Hol Admin B","role":"tenant_admin","tenant_id":"ca000000-0000-0000-0000-000000000002"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ce000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','hol-parent-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Hol Parent A","role":"parent"}',
   now(), now(), '','','','');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'ca000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'hol-parent-a@test.local';

-- ── 1. RLS is ON ────────────────────────────────────────────────────────────
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname='tenant_public_holidays'),
  true, 'RLS is enabled on tenant_public_holidays');

-- ── 2. authenticated holds the four verbs (grant follows policy) ────────────
SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
    WHERE table_name='tenant_public_holidays' AND grantee='authenticated'
      AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')),
  4, 'authenticated has SELECT/INSERT/UPDATE/DELETE');

-- ── 3-4. Admin A writes into tenant A; a duplicate date is refused ──────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"cd000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT lives_ok($$
  INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
  VALUES ('ca000000-0000-0000-0000-000000000001','2026-02-17','Chinese New Year')
$$, 'admin A adds a holiday to their own business');

SELECT throws_ok($$
  INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
  VALUES ('ca000000-0000-0000-0000-000000000001','2026-02-17','CNY dup')
$$, '23505', NULL, 'a second holiday on the same date is refused');

-- ── 5. Admin A cannot write into tenant B (RLS WITH CHECK) ──────────────────
SELECT throws_ok($$
  INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
  VALUES ('ca000000-0000-0000-0000-000000000002','2026-05-01','Labour Day')
$$, '42501', NULL, 'admin A cannot add a holiday to another business');

-- ── 6. Parent in tenant A can READ tenant A's holiday ───────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"ce000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM tenant_public_holidays
    WHERE tenant_id='ca000000-0000-0000-0000-000000000001'),
  1, 'a parent of the business sees its holidays');

-- ── 7. Admin B sees NONE of tenant A's holidays ─────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"cd000000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM tenant_public_holidays
    WHERE tenant_id='ca000000-0000-0000-0000-000000000001'),
  0, 'another business''s admin sees none of tenant A''s holidays');

-- ── 8. Admin B's delete of tenant A's holiday affects nothing (RLS) ─────────
-- The statement runs (RLS filters the rows out) but removes zero; the holiday
-- survives, checked with a privileged read after RESET ROLE.
DELETE FROM tenant_public_holidays WHERE tenant_id='ca000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM tenant_public_holidays
    WHERE tenant_id='ca000000-0000-0000-0000-000000000001'),
  1, 'another business''s admin deletes none of tenant A''s holidays');

SELECT * FROM finish();
ROLLBACK;
