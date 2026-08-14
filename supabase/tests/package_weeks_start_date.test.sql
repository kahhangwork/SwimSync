-- pgTAP: packages phase A — weeks validity, explicit start_date, the R1 pins.
-- Migrations 20260814000400 (schema/trigger/effective-end) + 20260814000500
-- (suggest_package_start). Plan: docs/plans/PACKAGE_WEEKS_HOLIDAYS_PLAN.md.
--
-- Blast-radius order:
--   • ⚠ RISK 1 — the new parent_packages columns (start_date once active, the
--     two extension columns, the two ack columns, the validity_weeks snapshot)
--     are NOT client-editable, and each guard is proven to fail here.
--   • The end date is weeks-based: expires_on = start_date + validity_weeks*7.
--   • The months⇆weeks derive trigger keeps both product columns populated so
--     neither the legacy fixtures nor the new UI has to supply both.
--   • suggest_package_start defaults to (coverage end + 1 day).
--
-- Self-contained; own tenants; rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(17);

-- ── Fixtures ────────────────────────────────────────────────────────────────

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('bb000000-0000-0000-0000-000000000001','pkgw','Weeks Swim','SWIM-WEEK');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','bd000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','pkgw-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Weeks Admin","role":"tenant_admin","is_coach":true,"tenant_id":"bb000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','be000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','pkgw-parent@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Weeks Parent","role":"parent"}',
   now(), now(), '','','','');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'bb000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'pkgw-parent@test.local';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('bc000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001','Group');

-- Product supplied in WEEKS only (the new UI shape): derive fills months.
INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count,
                              rate_per_lesson, validity_weeks) VALUES
  ('bd100000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001',
   '10 Group (weeks)','bc000000-0000-0000-0000-000000000001',10,40.00,10);

-- Product supplied in MONTHS only (a legacy fixture): derive fills weeks.
INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count,
                              rate_per_lesson, validity_months) VALUES
  ('bd100000-0000-0000-0000-000000000002','bb000000-0000-0000-0000-000000000001',
   '10 Group (months)','bc000000-0000-0000-0000-000000000001',10,40.00,3);

-- ── 1-2. The derive trigger fills whichever column an insert omits ───────────
SELECT is(
  (SELECT validity_months FROM package_products WHERE id='bd100000-0000-0000-0000-000000000001'),
  2, 'weeks-only product: validity_months derived (round(10*12/52)=2)');
SELECT is(
  (SELECT validity_weeks FROM package_products WHERE id='bd100000-0000-0000-0000-000000000002'),
  13, 'months-only product: validity_weeks derived (round(3*52/12)=13)');

-- ── 3-5. Active sale: weeks-based expiry, snapshot, and start_date honoured ──
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, start_date)
SELECT 'bf000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001',
       p.id,'bd100000-0000-0000-0000-000000000001','active','2026-09-01'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'pkgw-parent@test.local';

SELECT is(
  (SELECT start_date FROM parent_packages WHERE id='bf000000-0000-0000-0000-000000000001'),
  DATE '2026-09-01', 'active sale keeps the supplied start_date');
SELECT is(
  (SELECT validity_weeks FROM parent_packages WHERE id='bf000000-0000-0000-0000-000000000001'),
  10, 'validity_weeks snapshotted from the product');
SELECT is(
  (SELECT expires_on FROM parent_packages WHERE id='bf000000-0000-0000-0000-000000000001'),
  DATE '2026-11-10', 'expires_on = start_date + validity_weeks*7 (2026-09-01 + 70d)');

-- ── 6. suggest_package_start: coverage end + 1 day (no enrolments ⇒ by expiry)
SELECT is(
  suggest_package_start(
    (SELECT p.id FROM parents p JOIN profiles pr ON pr.id=p.profile_id
      WHERE pr.email='pkgw-parent@test.local'),
    'bd100000-0000-0000-0000-000000000001'),
  DATE '2026-11-11', 'suggested start = current coverage expiry + 1 day');

-- A pending package (admin-recorded) to prove pending start_date is editable.
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, start_date)
SELECT 'bf000000-0000-0000-0000-000000000002','bb000000-0000-0000-0000-000000000001',
       p.id,'bd100000-0000-0000-0000-000000000001','pending','2026-12-01'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'pkgw-parent@test.local';

-- Capture ids for use across SET ROLE (RLS would hide them from a subquery).
CREATE TEMP TABLE pkgw_ids AS
SELECT (SELECT p.id FROM parents p JOIN profiles pr ON pr.id=p.profile_id
         WHERE pr.email='pkgw-parent@test.local') AS parent1;

-- ── 7. product terms are immutable — validity_weeks joins the pinned set ─────
SELECT throws_ok($$
  UPDATE package_products SET validity_weeks = 20
   WHERE id='bd100000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'a product''s validity_weeks cannot be edited');

-- ── 8. active-row CHECK: an active package cannot lose its start_date ────────
SELECT throws_ok($$
  UPDATE parent_packages SET start_date = NULL
   WHERE id='bf000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'an active package with NULL start_date is impossible');

-- ── 9-13. ⚠ RISK 1: the new columns are not parent-editable ─────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"be000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT throws_ok($$
  UPDATE parent_packages SET manual_extension_days = 365
   WHERE id='bf000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'parent cannot set manual_extension_days');
SELECT throws_ok($$
  UPDATE parent_packages SET ph_extension_weeks = 9
   WHERE id='bf000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'parent cannot set ph_extension_weeks');
SELECT throws_ok($$
  UPDATE parent_packages SET ph_ack_weeks_parent = 9
   WHERE id='bf000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'parent cannot pre-acknowledge (ph_ack_weeks_parent)');
SELECT throws_ok($$
  UPDATE parent_packages SET validity_weeks = 99
   WHERE id='bf000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'parent cannot edit the validity_weeks snapshot');
SELECT throws_ok($$
  UPDATE parent_packages SET start_date = '2027-01-01'
   WHERE id='bf000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'parent cannot move start_date on an active package');

-- ⚠ #2: a parent cannot set a start date on their own PENDING request either —
-- otherwise the admin's confirm step would adopt the parked date.
SELECT throws_ok($$
  UPDATE parent_packages SET start_date = '2027-02-01'
   WHERE id='bf000000-0000-0000-0000-000000000002'
$$, '23514', NULL, 'parent cannot set start_date on a pending package');

RESET ROLE;

-- ── 14-16. Admin: start_date fixed once active, ack columns system-only,
--    but a PENDING start_date is still editable ───────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bd000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT throws_ok($$
  UPDATE parent_packages SET start_date = '2027-01-01'
   WHERE id='bf000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'admin cannot move start_date on an active package');
SELECT throws_ok($$
  UPDATE parent_packages SET ph_ack_weeks_admin = 9
   WHERE id='bf000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'admin cannot directly set ph_ack_weeks_admin (RPC only)');
SELECT lives_ok($$
  UPDATE parent_packages SET start_date = '2026-12-15'
   WHERE id='bf000000-0000-0000-0000-000000000002'
$$, 'admin may adjust start_date while the package is still pending');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
