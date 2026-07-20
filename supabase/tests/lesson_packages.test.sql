-- pgTAP: prepaid lesson packages (PACKAGES_DESIGN.md, migration 20260720000100).
--
-- What is pinned here, in order of blast radius:
--   • RLS is ENABLED on all four new tables (§7.20 — three tables once shipped
--     with policies written but RLS off, world-readable).
--   • The DB refuses the money states that engine code merely avoids: $0-rate
--     products (§7.22's Number("") family), negative balances, over-restores.
--   • A parent's request cannot claim a price, a status, or another parent —
--     snapshots come from the product, via the lifecycle trigger.
--   • Only non-client roles can move value_remaining (the current_user seam).
--   • package_live_balances() — the ONLY derivation of pending draws — draws
--     locked-rate, respects scope, and leaves the stored balance untouched.
--
-- Runs on its own tenants; self-contained; rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(30);

-- ── Fixtures ────────────────────────────────────────────────────────────────

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('aa000000-0000-0000-0000-000000000001','pkg-a','Packages Swim A','SWIM-PKGA'),
  ('aa000000-0000-0000-0000-000000000002','pkg-b','Packages Swim B','SWIM-PKGB');

-- Admin A is the private-coach shape (tenant_admin AND coach) so tenant A can
-- own a class. Admin B is a plain tenant admin. The parent is global.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','ad000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','pkg-admin-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Pkg Admin A","role":"tenant_admin","is_coach":true,"tenant_id":"aa000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ad000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','pkg-admin-b@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Pkg Admin B","role":"tenant_admin","tenant_id":"aa000000-0000-0000-0000-000000000002"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ab000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','pkg-parent-1@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Pkg Parent One","role":"parent"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ab000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','pkg-parent-2@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Pkg Parent Two","role":"parent"}',
   now(), now(), '','','','');

-- Parent 1 has joined tenant A.
INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'aa000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'pkg-parent-1@test.local';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('cc000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001','Group'),
  ('cc000000-0000-0000-0000-000000000002','aa000000-0000-0000-0000-000000000002','Group');

-- Products: dd01 and dd03 are tenant A "10 Group lessons @ $40, 12 months";
-- dd02 belongs to tenant B.
INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count,
                              rate_per_lesson, validity_months) VALUES
  ('dd000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001',
   '10 Group Lessons','cc000000-0000-0000-0000-000000000001',10,40.00,12),
  ('dd000000-0000-0000-0000-000000000003','aa000000-0000-0000-0000-000000000001',
   '10 Group Lessons (batch 2)','cc000000-0000-0000-0000-000000000001',10,40.00,12),
  ('dd000000-0000-0000-0000-000000000002','aa000000-0000-0000-0000-000000000002',
   'B''s Package','cc000000-0000-0000-0000-000000000002',10,35.00,12);

-- A categorized class and an uncategorized one, both tenant A (coach = admin A).
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id)
SELECT 'ee000000-0000-0000-0000-000000000001', co.id, 'Group Sat', 'saturday',
       '10:00','11:00','Test Pool', 50.00, 'cc000000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'pkg-admin-a@test.local';
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id)
SELECT 'ee000000-0000-0000-0000-000000000002', co.id, 'Uncat Sun', 'sunday',
       '10:00','11:00','Test Pool', 50.00, NULL
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'pkg-admin-a@test.local';

-- A child of parent 1, in tenant A.
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by)
VALUES ('55000000-0000-0000-0000-000000000001','Pkg Kid','2018-05-05','assigned',
        'aa000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001');
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '55000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'pkg-parent-1@test.local';

-- ── 1. RLS is ON (the §7.20 audit, as a test) ───────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM pg_class
    WHERE relname IN ('class_categories','package_products','parent_packages','package_applications')
      AND relnamespace = 'public'::regnamespace AND NOT relrowsecurity),
  0, 'all four package tables have ROW LEVEL SECURITY enabled');

-- ── 2-5. Product money rules live in the DB ────────────────────────────────
SELECT throws_ok($$
  INSERT INTO package_products (tenant_id, name, lesson_count, rate_per_lesson, validity_months)
  VALUES ('aa000000-0000-0000-0000-000000000001','Free forever',10,0,12)
$$, '23514', NULL, 'a $0-rate product is refused by the DB (an infinite package)');

SELECT throws_ok($$
  INSERT INTO package_products (tenant_id, name, lesson_count, rate_per_lesson, validity_months)
  VALUES ('aa000000-0000-0000-0000-000000000001','Zero lessons',0,40,12)
$$, '23514', NULL, 'a 0-lesson product is refused');

SELECT throws_ok($$
  UPDATE package_products SET rate_per_lesson = 1.00
  WHERE id = 'dd000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'product money terms are immutable — a price change is a new product');

SELECT lives_ok($$
  UPDATE package_products SET name = '10 Group Lessons (renamed)'
  WHERE id = 'dd000000-0000-0000-0000-000000000001'
$$, 'product name stays editable');

-- ── 6. A class only takes its own business''s category ──────────────────────
SELECT throws_ok($$
  UPDATE classes SET category_id = 'cc000000-0000-0000-0000-000000000002'
  WHERE id = 'ee000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'a class cannot take ANOTHER business''s category');

-- ── 7-14. The parent request path ───────────────────────────────────────────

-- Parent ids, captured while still postgres: under RLS a parent cannot see
-- another parent's row, so a subquery for it silently yields ZERO rows and an
-- intended-to-fail insert "passes" by inserting nothing. A temp table keeps
-- the ids readable across SET ROLE.
CREATE TEMP TABLE pkg_test_ids AS
SELECT
  (SELECT p.id FROM parents p JOIN profiles pr ON pr.id = p.profile_id
    WHERE pr.email = 'pkg-parent-1@test.local') AS parent1,
  (SELECT p.id FROM parents p JOIN profiles pr ON pr.id = p.profile_id
    WHERE pr.email = 'pkg-parent-2@test.local') AS parent2;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ab000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- §7.1: insert().select() must pass the SELECT policy immediately — and the
-- client's claimed terms (a 1-cent active package) must be ignored wholesale.
SELECT lives_ok($$
  INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status,
                               rate_per_lesson, total_value, value_remaining)
  SELECT 'ff000000-0000-0000-0000-000000000001',
         'aa000000-0000-0000-0000-000000000001', p.id,
         'dd000000-0000-0000-0000-000000000001', 'active', 0.01, 0.01, 0.01
  FROM parents p JOIN profiles pr ON pr.id = p.profile_id
  WHERE pr.email = 'pkg-parent-1@test.local'
  RETURNING id
$$, 'a parent can request a package and read the row straight back (§7.1)');

SELECT is(
  (SELECT status FROM parent_packages WHERE id = 'ff000000-0000-0000-0000-000000000001'),
  'pending', 'the request is PENDING no matter what the insert claimed');

SELECT is(
  (SELECT value_remaining FROM parent_packages WHERE id = 'ff000000-0000-0000-0000-000000000001'),
  400.00::numeric, 'terms are snapshotted from the PRODUCT (10 × $40), not from the client');

SELECT throws_ok($$
  INSERT INTO parent_packages (tenant_id, parent_id, product_id)
  SELECT 'aa000000-0000-0000-0000-000000000001', parent2,
         'dd000000-0000-0000-0000-000000000001'
  FROM pkg_test_ids
$$, '42501', NULL, 'a parent cannot request a package FOR ANOTHER PARENT');

-- Second pending request, used for the cancel path.
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id)
SELECT 'ff000000-0000-0000-0000-000000000002',
       'aa000000-0000-0000-0000-000000000001', p.id,
       'dd000000-0000-0000-0000-000000000003'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'pkg-parent-1@test.local';

SELECT is((SELECT count(*)::int FROM parent_packages), 2,
  'a parent sees exactly their own packages');

SELECT throws_ok($$
  UPDATE parent_packages SET status = 'active'
  WHERE id = 'ff000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'a parent cannot CONFIRM their own request — that is the admin''s proof-of-payment step');

SELECT lives_ok($$
  UPDATE parent_packages SET status = 'cancelled'
  WHERE id = 'ff000000-0000-0000-0000-000000000002'
$$, 'a parent can withdraw their own pending request');

SELECT is(
  (SELECT status FROM parent_packages WHERE id = 'ff000000-0000-0000-0000-000000000002'),
  'cancelled', 'the withdrawn request is cancelled, not deleted — history survives');

-- ── 15. Tenant isolation on products ────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"ad000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM package_products
    WHERE tenant_id = 'aa000000-0000-0000-0000-000000000001'),
  0, 'tenant B''s admin sees NONE of tenant A''s products');

-- ── 16-19. Confirm, and what an admin may NOT do ───────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"ad000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT lives_ok($$
  UPDATE parent_packages SET status = 'active'
  WHERE id = 'ff000000-0000-0000-0000-000000000001'
$$, 'the business''s admin confirms the request');

SELECT is(
  (SELECT expires_on FROM parent_packages WHERE id = 'ff000000-0000-0000-0000-000000000001'),
  ((now() AT TIME ZONE 'Asia/Singapore')::date + make_interval(months => 12))::date,
  'expiry = SGT confirmation date + the product''s validity');

SELECT throws_ok($$
  UPDATE parent_packages SET value_remaining = 999.00
  WHERE id = 'ff000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'even the admin cannot edit a balance — billing moves money, people do not');

SELECT throws_ok($$
  UPDATE parent_packages SET status = 'pending'
  WHERE id = 'ff000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'active cannot go back to pending');

-- ── 20-21. Retiring a product strands nobody, and sells nothing new ────────
SELECT lives_ok($$
  UPDATE package_products SET is_active = FALSE
  WHERE id = 'dd000000-0000-0000-0000-000000000001'
$$, 'the admin retires the product');

SELECT throws_ok($$
  INSERT INTO parent_packages (tenant_id, parent_id, product_id)
  SELECT 'aa000000-0000-0000-0000-000000000001', pp.parent_id, 'dd000000-0000-0000-0000-000000000001'
  FROM parent_packages pp WHERE pp.id = 'ff000000-0000-0000-0000-000000000001'
$$, '23514', NULL, 'a retired product cannot be bought');

-- ── 22-23. Admin direct sale (offline purchase) ─────────────────────────────
SELECT lives_ok($$
  INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status)
  SELECT 'ff000000-0000-0000-0000-000000000003',
         'aa000000-0000-0000-0000-000000000001', pp.parent_id,
         'dd000000-0000-0000-0000-000000000003', 'active'
  FROM parent_packages pp WHERE pp.id = 'ff000000-0000-0000-0000-000000000001'
$$, 'the admin records a direct sale as active immediately');

SELECT is(
  (SELECT (status = 'active' AND expires_on IS NOT NULL AND confirmed_at IS NOT NULL)
     FROM parent_packages WHERE id = 'ff000000-0000-0000-0000-000000000003'),
  TRUE, 'a direct sale is confirmed and dated on creation');

-- ── 24-28. package_live_balances(): the one derivation of pending draws ─────
RESET ROLE;

-- One PRESENT lesson in the Group class (in scope), one in the uncategorized
-- class (out of scope). Neither is invoiced.
INSERT INTO lesson_sessions (id, class_id, session_date) VALUES
  ('66000000-0000-0000-0000-000000000001','ee000000-0000-0000-0000-000000000001', CURRENT_DATE),
  ('66000000-0000-0000-0000-000000000002','ee000000-0000-0000-0000-000000000002', CURRENT_DATE);
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('66000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001',
   'present','ad000000-0000-0000-0000-000000000001'),
  ('66000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000001',
   'present','ad000000-0000-0000-0000-000000000001');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ad000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT value_remaining FROM parent_packages
    WHERE id = 'ff000000-0000-0000-0000-000000000001'),
  400.00::numeric,
  'the STORED balance has not moved — money moves at invoice time only');

SELECT is(
  (SELECT live_value_remaining FROM package_live_balances()
    WHERE parent_package_id = 'ff000000-0000-0000-0000-000000000001'),
  360.00::numeric,
  'the LIVE balance is down one locked-rate draw ($40, not the class''s $50)');

SELECT is(
  (SELECT live_lessons_remaining FROM package_live_balances()
    WHERE parent_package_id = 'ff000000-0000-0000-0000-000000000001'),
  9, 'the derived counter reads 9 of 10');

SELECT is(
  (SELECT live_value_remaining FROM package_live_balances()
    WHERE parent_package_id = 'ff000000-0000-0000-0000-000000000003'),
  400.00::numeric,
  'FIFO: the second package is untouched while the first can pay, and the '
  'uncategorized class''s lesson drew from NEITHER (out of scope bills ad-hoc)');

SET LOCAL "request.jwt.claims" TO '{"sub":"ab000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM package_live_balances()), 2,
  'SECURITY INVOKER: a parent computes over exactly their own active packages');

-- ── 29-30. The balance CHECKs hold even for privileged writers ──────────────
RESET ROLE;

SELECT throws_ok($$
  UPDATE parent_packages SET value_remaining = -1
  WHERE id = 'ff000000-0000-0000-0000-000000000003'
$$, '23514', NULL, 'the floor at zero is a constraint, not engine etiquette');

SELECT throws_ok($$
  UPDATE parent_packages SET value_remaining = 999999
  WHERE id = 'ff000000-0000-0000-0000-000000000003'
$$, '23514', NULL, 'a restore cannot overfill past the package''s total value');

SELECT * FROM finish();
ROLLBACK;
