-- pgTAP: package payment references — PKG-YYYY-NNNN (migration
-- 20260809000100, docs/plans/WAVE_1_PLAN.md Chunk 2 Step 2.1).
--
-- WHAT THIS FILE EXISTS TO CATCH, in order of blast radius:
--
--   1. TRIGGER ORDER (plan RISK 4). The reference trigger must fire AFTER
--      trg_parent_package_lifecycle, which is what sets NEW.tenant_id from the
--      product. Postgres orders same-timing row triggers ALPHABETICALLY BY
--      TRIGGER NAME, so this is decided by a string nobody thinks about at
--      review time. If it inverts, EVERY parent package request fails at the
--      insert — a total outage of the buy-a-package path.
--      Assertion 1 is written the way the app actually inserts: AS THE PARENT
--      ROLE, supplying NO tenant_id. A test that inserts as admin (or supplies
--      tenant_id) PASSES against the broken trigger name and proves nothing.
--      PROVEN RED (§7.25): renaming the trigger to trg_a_package_reference and
--      re-running turned assertions 1-3 red with
--      'cannot number a package for unknown tenant <NULL>'.
--      Assertion 10 pins the ordering from the catalog directly, so a rename
--      fails here even if some future change makes the runtime path forgiving.
--
--   2. THE YEAR SOURCE (plan RISK 6). The year is this ROW's requested_at in
--      SGT — not today_sg(), not CURRENT_DATE/NOW() (the SESSION's zone, UTC
--      here — §7.94). Assertion 6 is the discriminating case: 00:30 SGT on
--      1 Jan is still 31 Dec in UTC, so a UTC-derived year reads 2025 where
--      the correct answer is 2026. Tested AT the boundary, because §7.94's
--      14-test file missed a live bug by sitting far from it.
--
--   3. LPAD TRUNCATION (§7.77). lpad('10000',4,'0') = '1000' — the third
--      counter to inherit this if the GREATEST() guard were dropped.
--
--   4. THE PIN, BOTH WAYS. The reference is what a bank transfer is matched
--      by, and parent_packages lets the owning PARENT both INSERT and UPDATE
--      their own row — so a client must be able to neither supply one nor
--      rewrite one.
--
-- Runs on its own tenants; self-contained; rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

-- ── Fixtures ────────────────────────────────────────────────────────────────

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('a9000000-0000-0000-0000-000000000001','pkgref-a','PkgRef Swim A','SWIM-PRFA'),
  ('a9000000-0000-0000-0000-000000000002','pkgref-b','PkgRef Swim B','SWIM-PRFB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','a8000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','pkgref-admin-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"PkgRef Admin A","role":"tenant_admin","tenant_id":"a9000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','a8000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','pkgref-admin-b@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"PkgRef Admin B","role":"tenant_admin","tenant_id":"a9000000-0000-0000-0000-000000000002"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','a7000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','pkgref-parent@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"PkgRef Parent","role":"parent"}',
   now(), now(), '','','','');

-- The parent has joined tenant A — parent_packages_insert requires it.
INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'a9000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'pkgref-parent@test.local';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('c9000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000001','Group'),
  ('c9000000-0000-0000-0000-000000000002','a9000000-0000-0000-0000-000000000002','Group');

INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count,
                              rate_per_lesson, validity_months) VALUES
  ('d9000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000001',
   '10 Group Lessons','c9000000-0000-0000-0000-000000000001',10,40.00,12),
  ('d9000000-0000-0000-0000-000000000002','a9000000-0000-0000-0000-000000000002',
   'B''s Package','c9000000-0000-0000-0000-000000000002',10,35.00,12);

-- ── 1-3. THE APP'S OWN INSERT: as the PARENT, with no tenant_id ─────────────
-- SwimSyncApp/app/(parent)/billing/index.tsx sends { parent_id, product_id }
-- and nothing else. This is the shape that breaks if the trigger name sorts
-- before trg_parent_package_lifecycle.

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT lives_ok($$
  INSERT INTO parent_packages (id, parent_id, product_id)
  SELECT 'f9000000-0000-0000-0000-000000000001', p.id,
         'd9000000-0000-0000-0000-000000000001'
  FROM parents p JOIN profiles pr ON pr.id = p.profile_id
  WHERE pr.email = 'pkgref-parent@test.local'
$$, 'a parent requests a package supplying NO tenant_id — the reference trigger must run AFTER the lifecycle trigger (RISK 4)');

SELECT is(
  (SELECT tenant_id FROM parent_packages WHERE id='f9000000-0000-0000-0000-000000000001'),
  'a9000000-0000-0000-0000-000000000001'::uuid,
  'the product decided the business, as it always did');

SELECT is(
  (SELECT reference_number FROM parent_packages WHERE id='f9000000-0000-0000-0000-000000000001'),
  'PKG-' || to_char(now() AT TIME ZONE 'Asia/Singapore', 'YYYY') || '-0001',
  'the first package in a tenant reads PKG-<SGT year>-0001');

-- ── 4. A CLIENT-SUPPLIED REFERENCE IS DISCARDED ────────────────────────────
-- This is a DoS assertion, not a tidiness one. The counter is only advanced by
-- next_package_ref, so a parent who could keep a hand-picked reference would
-- leave the counter behind it — and the next genuine request in that tenant
-- would draw the squatted number and die on the unique constraint, breaking
-- the buy-a-package path for the whole business.
--
-- WRITTEN THE OTHER WAY FIRST AND IT PASSED VACUOUSLY. The first version of
-- the trigger refused a supplied value with `current_user = 'authenticated'`,
-- the seam pin_invoice_public_fields uses. Inside a SECURITY DEFINER function
-- current_user is the OWNER, so the check never fired and the insert kept the
-- client's string. Overwriting unconditionally needs no role test.

SELECT lives_ok($$
  INSERT INTO parent_packages (id, parent_id, product_id, reference_number)
  SELECT 'f9000000-0000-0000-0000-0000000000ff', p.id,
         'd9000000-0000-0000-0000-000000000001', 'PKG-2026-9999'
  FROM parents p JOIN profiles pr ON pr.id = p.profile_id
  WHERE pr.email = 'pkgref-parent@test.local'
$$, 'a client may name a reference_number on insert without erroring');

SELECT is(
  (SELECT reference_number FROM parent_packages WHERE id='f9000000-0000-0000-0000-0000000000ff'),
  'PKG-' || to_char(now() AT TIME ZONE 'Asia/Singapore', 'YYYY') || '-0002',
  'and it is DISCARDED — the row takes the next counter draw, so no client can squat a number');

-- ── 5. THE PIN: not rewritable either ──────────────────────────────────────

SELECT throws_ok($$
  UPDATE parent_packages SET reference_number = 'PKG-2026-0002'
   WHERE id='f9000000-0000-0000-0000-000000000001'
$$, '23514', NULL,
  'reference_number is pinned against client writes (the owning parent can UPDATE this row)');

RESET ROLE;

-- ── 6-8. THE YEAR IS THE ROW'S, IN SGT — AND NUMBERING IS PER TENANT ───────
-- Tenant B starts again at 0001 even though tenant A already has one.
-- 23:30 on 31 Dec SGT is the plan's named case; 00:30 on 1 Jan SGT is the one
-- that DISCRIMINATES — it is still 2025 in UTC, so a UTC-derived year is wrong
-- there and right in the first case.

-- Inserted WITHOUT a role switch on purpose. Assertions 1-3 already prove the
-- realistic parent path; these two are about the YEAR, and running them as
-- postgres keeps them independent of whether tenant B's admin can see a parent
-- who has only joined tenant A.

INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, requested_at)
SELECT 'f9000000-0000-0000-0000-000000000002',
       'a9000000-0000-0000-0000-000000000002', p.id,
       'd9000000-0000-0000-0000-000000000002',
       TIMESTAMPTZ '2025-12-31 23:30:00+08'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'pkgref-parent@test.local';

INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, requested_at)
SELECT 'f9000000-0000-0000-0000-000000000003',
       'a9000000-0000-0000-0000-000000000002', p.id,
       'd9000000-0000-0000-0000-000000000002',
       TIMESTAMPTZ '2026-01-01 00:30:00+08'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'pkgref-parent@test.local';

SELECT is(
  (SELECT reference_number FROM parent_packages WHERE id='f9000000-0000-0000-0000-000000000002'),
  'PKG-2025-0001',
  'a request at 23:30 SGT on 31 Dec is numbered in 2025, and tenant B restarts at 0001');

SELECT is(
  (SELECT reference_number FROM parent_packages WHERE id='f9000000-0000-0000-0000-000000000003'),
  'PKG-2026-0002',
  'a request at 00:30 SGT on 1 Jan is 2026 — it is still 2025 in UTC, and the counter does NOT reset per year');

SELECT is(
  (SELECT package_counter FROM tenants WHERE id='a9000000-0000-0000-0000-000000000001'),
  2,
  'tenant A''s counter counts only tenant A''s two packages — B''s two did not touch it');

-- ── 9. PAST 9999 THE REFERENCE GROWS (§7.77) ───────────────────────────────
-- lpad('10000',4,'0') = '1000': without GREATEST() the 10,000th package
-- reuses reference 1000 and then violates UNIQUE (tenant_id, reference_number).

UPDATE tenants SET package_counter = 9999
 WHERE id = 'a9000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}';

INSERT INTO parent_packages (id, parent_id, product_id, requested_at)
SELECT 'f9000000-0000-0000-0000-000000000004', p.id,
       'd9000000-0000-0000-0000-000000000001',
       TIMESTAMPTZ '2026-06-01 10:00:00+08'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'pkgref-parent@test.local';

RESET ROLE;

SELECT is(
  (SELECT reference_number FROM parent_packages WHERE id='f9000000-0000-0000-0000-000000000004'),
  'PKG-2026-10000',
  'the 10,000th package reads 10000, not a truncated 1000');

-- ── 10. THE ORDERING ITSELF, FROM THE CATALOG ──────────────────────────────
-- Runtime assertion 1 proves the current wiring works. This proves WHY, and
-- fails on a rename even if nothing else does. Postgres fires same-timing row
-- triggers in alphabetical order by tgname.

SELECT ok(
  (SELECT tgname FROM pg_trigger
    WHERE tgrelid = 'parent_packages'::regclass
      AND NOT tgisinternal
      AND tgname IN ('trg_parent_package_lifecycle','trg_parent_package_reference')
    ORDER BY tgname LIMIT 1) = 'trg_parent_package_lifecycle',
  'trg_parent_package_lifecycle sorts FIRST — it is what sets tenant_id, and same-timing triggers fire alphabetically');

-- ── 11. THE COUNTER FUNCTION IS CALLABLE BY NOBODY ─────────────────────────
-- §7.82: the identical SECURITY DEFINER "increment a tenant counter" shape
-- shipped once with no ACL at all and was reachable unauthenticated. Also
-- asserted generically in function_grants.test.sql; named here so a
-- regression is readable. §7.78: if this ever errors in the product, the bug
-- is a flattened DEFINER hop — do not fix it with a GRANT.

SELECT ok(
  NOT has_function_privilege('anon', 'public.next_package_ref(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.next_package_ref(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.next_package_ref(uuid,text)', 'EXECUTE'),
  'next_package_ref is callable by NOBODY, including service_role');

SELECT * FROM finish();
ROLLBACK;
