-- pgTAP: provisioning a new business (tenant) — provision_tenant().
--
-- WHY THIS FILE IS MOSTLY AUTHORIZATION ASSERTIONS. provision_tenant() is the
-- ONLY INSERT path into `tenants`: the table grants SELECT/UPDATE and nothing
-- else, and there is no tenants_insert policy. A tenant is the top of the
-- isolation hierarchy, so a caller who can mint one has the largest blast
-- radius available in this schema. The function is SECURITY DEFINER, so it
-- bypasses RLS and its own is_platform_admin() gate is the ENTIRE boundary —
-- there is no policy behind it to catch a mistake.
--
-- So the refusals below cover FOUR caller shapes rather than "a non-admin":
-- parent, coach, TENANT admin (who runs a business but may not create another),
-- and anon. And each refusal asserts two things — that it raised, AND that
-- `tenants` did not grow. A gate that raises after writing is not a gate.
--
-- METHOD (gotcha §7.16): every probe runs inside this explicit transaction with
-- SET LOCAL ROLE. Outside one, SET LOCAL ROLE is a no-op, the session stays
-- superuser, RLS is bypassed and every assertion "passes" — including the ones
-- that must fail.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(19);

-- ── Callers: one of each shape that can reach an RPC ────────────────────────
INSERT INTO tenants (id, slug, display_name, kind, join_code)
VALUES ('55555555-0000-0000-0000-000000000001','prov-a','PROV Existing','school','SWIM-PRVA');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','55000000-0000-0000-0000-0000000000f1',
   'authenticated','authenticated','prov-platform@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"PROV Platform","role":"platform_admin"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','55000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','prov-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"PROV Admin","role":"tenant_admin","tenant_id":"55555555-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','55000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','prov-coach@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"PROV Coach","role":"coach","tenant_id":"55555555-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','55000000-0000-0000-0000-0000000000a3',
   'authenticated','authenticated','prov-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"PROV Parent","role":"parent"}', now(), now(), '', '', '', '');

-- The count every refusal is measured against.
CREATE TEMP TABLE prov_baseline AS SELECT COUNT(*)::INT AS n FROM tenants;

-- ══ REFUSALS — the reason this file exists ══════════════════════════════════
SET LOCAL ROLE authenticated;

-- 1. A PARENT cannot create a business.
SET LOCAL "request.jwt.claims" TO '{"sub":"55000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM provision_tenant('Parent Made This', 'school') $$,
  'only the platform admin may create a business',
  'a PARENT cannot provision a tenant');

-- 2. A COACH cannot.
SET LOCAL "request.jwt.claims" TO '{"sub":"55000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM provision_tenant('Coach Made This', 'private') $$,
  'only the platform admin may create a business',
  'a COACH cannot provision a tenant');

-- 3. A TENANT ADMIN cannot — they run ONE business. Creating another is a
--    platform act, and can_admin_tenant() has no meaning for a tenant that does
--    not exist yet, so there is nothing to scope such a permission to.
SET LOCAL "request.jwt.claims" TO '{"sub":"55000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM provision_tenant('Admin Made This', 'school') $$,
  'only the platform admin may create a business',
  'a TENANT ADMIN cannot provision a tenant — not even a second one of their own');

-- 4. ANON cannot. (Belt and braces: the EXECUTE grant excludes anon, so this
--    fails on permission rather than on the body's gate. Both are the point —
--    CREATE FUNCTION grants EXECUTE to PUBLIC by default, which INCLUDES anon,
--    and the migration revokes it explicitly.)
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT * FROM provision_tenant('Anon Made This', 'private') $$,
  NULL,
  'ANON cannot provision a tenant');
RESET ROLE;

-- 5. THE LOAD-BEARING ONE: none of the four refusals wrote a row.
SELECT is(
  (SELECT COUNT(*)::INT FROM tenants),
  (SELECT n FROM prov_baseline),
  'after FOUR refusals, tenants has not grown — the gate refuses BEFORE writing');

-- ══ THE HAPPY PATH ═════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"55000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

CREATE TEMP TABLE prov_result AS
  SELECT * FROM provision_tenant('Dolphin Swim Academy', 'school');

SELECT is((SELECT COUNT(*)::INT FROM prov_result), 1,
  'the platform admin gets exactly one row back');

SELECT ok((SELECT tenant_id FROM prov_result) IS NOT NULL,
  'it returns the new tenant id');

SELECT is((SELECT slug FROM prov_result), 'dolphin-swim-academy',
  'the slug is derived from the display name');

SELECT ok((SELECT join_code FROM prov_result) ~ '^SWIM-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$',
  'the join code matches the SWIM-XXXX shape, using the unambiguous alphabet');

SELECT is(
  (SELECT display_name FROM tenants WHERE id = (SELECT tenant_id FROM prov_result)),
  'Dolphin Swim Academy',
  'the tenant row exists with the given name');

SELECT is(
  (SELECT kind::TEXT FROM tenants WHERE id = (SELECT tenant_id FROM prov_result)),
  'school',
  'kind is stored as passed');

-- A brand-new business has NO admin yet — the auth user is created separately,
-- afterwards, by the API route. This is the intermediate state the route must
-- compensate for, and the state the overview flags.
SELECT is(
  (SELECT admin_status FROM platform_tenant_overview()
     WHERE tenant_id = (SELECT tenant_id FROM prov_result)),
  'none',
  'a freshly provisioned tenant reports admin_status = none — it is joinable but unmanned');

-- ══ NAME AND SLUG EDGE CASES ═══════════════════════════════════════════════

-- Two businesses may legitimately share a name.
CREATE TEMP TABLE prov_dupe AS
  SELECT * FROM provision_tenant('Dolphin Swim Academy', 'school');
SELECT is((SELECT slug FROM prov_dupe), 'dolphin-swim-academy-2',
  'a duplicate name gets a suffixed slug rather than failing on UNIQUE');

-- The one that would otherwise take provisioning down entirely: a business
-- named in non-Latin script reduces to the empty string, which is NOT NULL.
-- Wholly plausible in Singapore.
CREATE TEMP TABLE prov_cjk AS
  SELECT * FROM provision_tenant('游泳學校', 'school');
SELECT ok((SELECT slug FROM prov_cjk) <> '',
  'a non-ASCII business name still yields a non-empty slug');
SELECT ok((SELECT slug FROM prov_cjk) LIKE 'tenant-%',
  'it falls back to a generated slug rather than violating NOT NULL');
SELECT is(
  (SELECT display_name FROM tenants WHERE id = (SELECT tenant_id FROM prov_cjk)),
  '游泳學校',
  'the DISPLAY name keeps its original script — only the inert slug is anglicised');

-- Punctuation and spacing collapse rather than producing a run of hyphens.
SELECT is(
  (SELECT slug FROM provision_tenant('  Marcus''s  Swim & Splash!!  ', 'private')),
  'marcus-s-swim-splash',
  'punctuation and repeated spaces collapse to single hyphens, trimmed at both ends');

-- An unnamed business is refused rather than silently slugged.
SELECT throws_ok(
  $$ SELECT * FROM provision_tenant('   ', 'private') $$,
  'a business needs a name',
  'a blank name is refused');

-- ══ JOIN CODES ARE UNIQUE ══════════════════════════════════════════════════
-- Possession of the code is the only proof a family deals with a business
-- (PRD §5.1), so a collision would let one business's parents join another.
SELECT is(
  (SELECT COUNT(DISTINCT join_code)::INT FROM tenants),
  (SELECT COUNT(*)::INT FROM tenants),
  'every tenant has a distinct join code');

SELECT * FROM finish();
ROLLBACK;
