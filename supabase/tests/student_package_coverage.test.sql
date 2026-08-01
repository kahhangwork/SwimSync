-- pgTAP: student_package_coverage() — the per-child payment-method verdict.
--
-- What is pinned here, in order of blast radius:
--   • The DISCRIMINATING case the old Students-page chip got wrong: a family
--     holding only a Private-scoped package must read ad_hoc for a child
--     enrolled only in a Group class.
--   • Coverage is category + date ONLY — an exhausted (0-left) active package
--     still verdicts 'package'. The engine's affordability rule must never
--     decide a label.
--   • RLS PARITY: a parent-role call returns the identical verdict + count as
--     the tenant-admin-role call for the same child. This is the assertion
--     that catches a join table being less visible under parent RLS — which
--     would silently mislabel a covered child "Ad-hoc" in the parent app.
--   • Date-expired active packages are excluded SERVER-side (the old chip
--     also counted them).
--   • A coach caller gets only ad_hoc verdicts (zero package rows under coach
--     RLS) — the "coaches don't handle family money" invariant, pinned.
--
-- METHOD (§7.16): every probe runs inside this explicit transaction with
-- SET LOCAL ROLE. Outside one, SET LOCAL ROLE is a no-op, the session stays
-- superuser, RLS is bypassed and every assertion "passes" — including the
-- ones that must fail.
--
-- Runs on its own tenants; self-contained; rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(20);

-- ── Fixtures ────────────────────────────────────────────────────────────────

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('ba000000-0000-0000-0000-000000000001','cov-a','Coverage Swim A','SWIM-CVGA'),
  ('ba000000-0000-0000-0000-000000000002','cov-b','Coverage Swim B','SWIM-CVGB');

-- Admin A is the private-coach shape (tenant_admin AND coach) so tenant A can
-- own classes. Coach C1 is a plain staff coach in tenant A.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','bd000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','cov-admin-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Cov Admin A","role":"tenant_admin","is_coach":true,"tenant_id":"ba000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','bd000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','cov-coach@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Cov Coach","role":"coach","tenant_id":"ba000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','bb000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','cov-parent-1@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Cov Parent One","role":"parent"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','bb000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','cov-parent-2@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Cov Parent Two","role":"parent"}',
   now(), now(), '','','','');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'ba000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email IN ('cov-parent-1@test.local','cov-parent-2@test.local');

-- Two categories in tenant A. The package will be scoped to Private only.
INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('bc000000-0000-0000-0000-000000000001','ba000000-0000-0000-0000-000000000001','Cov Group'),
  ('bc000000-0000-0000-0000-000000000002','ba000000-0000-0000-0000-000000000002','Cov B Group'),
  ('bc000000-0000-0000-0000-000000000003','ba000000-0000-0000-0000-000000000001','Cov Private');

-- Products: a Private-scoped one, an all-classes (NULL category) one, and one
-- in tenant B (for the cross-tenant fallback probe).
INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count,
                              rate_per_lesson, validity_months) VALUES
  ('be000000-0000-0000-0000-000000000001','ba000000-0000-0000-0000-000000000001',
   '10 Private Lessons','bc000000-0000-0000-0000-000000000003',10,60.00,12),
  ('be000000-0000-0000-0000-000000000002','ba000000-0000-0000-0000-000000000001',
   '8 Any-Class Lessons',NULL,8,45.00,12),
  ('be000000-0000-0000-0000-000000000003','ba000000-0000-0000-0000-000000000002',
   'B 10 Lessons','bc000000-0000-0000-0000-000000000002',10,30.00,12);

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id)
SELECT 'bf000000-0000-0000-0000-000000000001', co.id, 'Cov Group Sat', 'saturday',
       '10:00','11:00','Test Pool', 50.00, 'bc000000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'cov-admin-a@test.local';

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id)
SELECT 'bf000000-0000-0000-0000-000000000002', co.id, 'Cov Private Sun', 'sunday',
       '10:00','11:00','Test Pool', 70.00, 'bc000000-0000-0000-0000-000000000003'
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'cov-admin-a@test.local';

-- Parent 1's children, tenant A:
--   Kid G — Group class only  (the discriminating child)
--   Kid P — Private class only
--   Kid M — ACTIVE in Group, INACTIVE in Private (the is_active discriminator;
--           one_active_enrolment_per_student forbids two active — see below)
--   Kid U — no enrolments     (the fallback child)
-- Parent 2's child, tenant A:
--   Kid N — Group class only, family holds NO package (pure ad_hoc control)
-- And one UNCLAIMED child (no parent_students row).
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by) VALUES
  ('b5000000-0000-0000-0000-000000000001','Cov Kid G','2018-01-01','assigned',
   'ba000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001'),
  ('b5000000-0000-0000-0000-000000000002','Cov Kid P','2018-02-02','assigned',
   'ba000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001'),
  ('b5000000-0000-0000-0000-000000000003','Cov Kid M','2018-03-03','assigned',
   'ba000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001'),
  ('b5000000-0000-0000-0000-000000000004','Cov Kid U','2018-04-04','unassigned',
   'ba000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001'),
  ('b5000000-0000-0000-0000-000000000005','Cov Kid N','2018-05-05','assigned',
   'ba000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000002'),
  ('b5000000-0000-0000-0000-000000000006','Cov Kid Unclaimed','2018-06-06','unassigned',
   'ba000000-0000-0000-0000-000000000001','bd000000-0000-0000-0000-000000000001');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.sid FROM (VALUES
  ('b5000000-0000-0000-0000-000000000001'::uuid),
  ('b5000000-0000-0000-0000-000000000002'::uuid),
  ('b5000000-0000-0000-0000-000000000003'::uuid),
  ('b5000000-0000-0000-0000-000000000004'::uuid)) AS s(sid),
  parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'cov-parent-1@test.local';

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'b5000000-0000-0000-0000-000000000005'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'cov-parent-2@test.local';

INSERT INTO student_class_enrolments (student_id, class_id) VALUES
  ('b5000000-0000-0000-0000-000000000001','bf000000-0000-0000-0000-000000000001'),
  ('b5000000-0000-0000-0000-000000000002','bf000000-0000-0000-0000-000000000002'),
  ('b5000000-0000-0000-0000-000000000003','bf000000-0000-0000-0000-000000000001'),
  ('b5000000-0000-0000-0000-000000000005','bf000000-0000-0000-0000-000000000001');
-- Kid M USED to be in the covered Private class, and left. If the is_active
-- filter is ever dropped, this row makes Kid M read "package" — wrongly.
INSERT INTO student_class_enrolments (student_id, class_id, is_active, unenrolled_at) VALUES
  ('b5000000-0000-0000-0000-000000000003','bf000000-0000-0000-0000-000000000002', FALSE, now());

-- Parent 1 requests the Private-scoped package; admin confirms (the lifecycle
-- trigger snapshots terms and sets expiry — the only path to 'active').
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id)
SELECT 'b7000000-0000-0000-0000-000000000001',
       'ba000000-0000-0000-0000-000000000001', p.id,
       'be000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'cov-parent-1@test.local';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bd000000-0000-0000-0000-000000000001","role":"authenticated"}';
UPDATE parent_packages SET status = 'active'
 WHERE id = 'b7000000-0000-0000-0000-000000000001';
RESET ROLE;

-- ── 1-5. The verdicts, as the business's admin ─────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bd000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ⚠ THE DISCRIMINATING CASE. The old Students-page chip summed the family's
-- lessons BY PARENT, ignoring category — it said "10 left" next to this child,
-- whose only class the Private package can never pay for.
SELECT is(
  (SELECT c.coverage FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000001'),
  'ad_hoc',
  '⚠ a Group-only child of a Private-package family is AD HOC, not "10 left"');

SELECT is(
  (SELECT c.coverage || ':' || c.lessons_remaining::text FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000002'),
  'package:10',
  'the Private-class child is covered, 10 lessons left');

SELECT is(
  (SELECT c.coverage FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000003'),
  'ad_hoc',
  'an INACTIVE enrolment in a covered class does not cover — only the class '
  'the child attends NOW counts');

-- WHY THERE IS NO 'mixed' ASSERTION: one_active_enrolment_per_student means a
-- child has at most ONE active class, so at most one category — the function's
-- 'mixed' arm (some categories covered, some not) is structurally unreachable
-- today. It stays in the SQL as fail-visible behaviour for the day the
-- constraint is lifted; this pin makes that day loud instead of silent.
SELECT is(
  (SELECT count(*)::int FROM pg_indexes
    WHERE indexname = 'one_active_enrolment_per_student'),
  1, 'the one-active-enrolment index still stands — ''mixed'' stays unreachable');

SELECT is(
  (SELECT c.coverage || ':' || c.lessons_remaining::text FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000004'),
  'package:10',
  'a child with NO enrolments falls back to "family holds a package here"');

SELECT is(
  (SELECT c.coverage FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000005'),
  'ad_hoc',
  'a family with no package at all is ad hoc (lessons_remaining NULL)');

SELECT is(
  (SELECT c.lessons_remaining FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000005'),
  NULL,
  'ad hoc carries NULL, not 0 — "no pool" is not "an empty pool"');

-- ── 7. The unclaimed child has no row ──────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000006'),
  0, 'an unclaimed child returns NO row — no family, no payment method');

-- ── 8. A NULL-category package covers everything ───────────────────────────
-- Parent 2 buys the any-class package: their Group-only child flips to
-- covered, proving NULL scope means "every class of this business".
RESET ROLE;
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id)
SELECT 'b7000000-0000-0000-0000-000000000002',
       'ba000000-0000-0000-0000-000000000001', p.id,
       'be000000-0000-0000-0000-000000000002'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email = 'cov-parent-2@test.local';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bd000000-0000-0000-0000-000000000001","role":"authenticated"}';
UPDATE parent_packages SET status = 'active'
 WHERE id = 'b7000000-0000-0000-0000-000000000002';

SELECT is(
  (SELECT c.coverage || ':' || c.lessons_remaining::text FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000005'),
  'package:8',
  'a NULL-category package covers every class — the control child flips to package:8');

-- ── 10. ⚠ Exhausted ≠ ad hoc (the label rule) ──────────────────────────────
RESET ROLE;
UPDATE parent_packages SET value_remaining = 0
 WHERE id = 'b7000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bd000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(
  (SELECT c.coverage || ':' || c.lessons_remaining::text FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000005'),
  'package:0',
  '⚠ an EXHAUSTED active package is "Package · 0 left", never "Ad-hoc" — '
  'coverage is category + date, not the engine''s affordability rule');

-- ── 11. Date-expired active packages are excluded server-side ──────────────
RESET ROLE;
UPDATE parent_packages
   SET expires_on = (now() AT TIME ZONE 'Asia/Singapore')::date - 1
 WHERE id = 'b7000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bd000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(
  (SELECT c.coverage FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000005'),
  'ad_hoc',
  'a date-expired package (status still active) does NOT cover — filtered in SQL, '
  'not left to each caller');

-- ── 12-15. Sibling sharing, and RLS PARITY (the silent-mislabel catcher) ───
SELECT is(
  (SELECT c.lessons_remaining FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000002'),
  (SELECT c.lessons_remaining FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000004'),
  'siblings read the SAME family pool — the count is shared, not per child');

-- ⚠ RLS PARITY. The parent app calls this under parent RLS. If any joined
-- table (enrolments, classes, packages) is less visible to a parent than to
-- the admin, a covered child silently degrades to ad_hoc with no error
-- anywhere. Identical verdict + count under both roles is the whole test.
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(
  (SELECT c.coverage || ':' || c.lessons_remaining::text FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000002'),
  'package:10',
  '⚠ RLS PARITY: the parent-role verdict for their covered child matches the admin''s');

SELECT is(
  (SELECT c.coverage FROM student_package_coverage() c
    WHERE c.student_id = 'b5000000-0000-0000-0000-000000000001'),
  'ad_hoc',
  '⚠ RLS PARITY: the parent-role verdict for the Group-only child matches too');

SELECT is(
  (SELECT count(*)::int FROM student_package_coverage() c),
  4, 'a parent sees exactly their own four children — nobody else''s');

-- ── 16. The other parent's view is equally scoped ──────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM student_package_coverage() c),
  1, 'parent 2 sees exactly one child');

-- ── 17-18. A coach learns nothing about family money ───────────────────────
-- Coach RLS returns zero package rows, so every child the coach can see
-- verdicts ad_hoc — the function is USELESS to a coach by construction, which
-- is why no coach screen calls it. Pinned so a future RLS widening shows up.
SET LOCAL "request.jwt.claims" TO '{"sub":"bd000000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM student_package_coverage() c
    WHERE c.coverage <> 'ad_hoc'),
  0, '⚠ a coach caller gets NO package verdict — family money stays invisible');

SELECT is(
  (SELECT count(*)::int FROM student_package_coverage() c
    WHERE c.lessons_remaining IS NOT NULL),
  0, '…and no lesson counts either');

-- ── 19. anon is refused outright ───────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT * FROM student_package_coverage() $$,
  '42501', NULL, 'anon has no EXECUTE on student_package_coverage (§7.39)');
RESET ROLE;

-- ── 20. The label rule is structural: no affordability check in the source ──
-- The engine skips a package that cannot fully fund a lesson; the DISPLAY
-- predicate must not. If someone "fixes" the function by adding the engine's
-- rule, the exhausted-package assertion above breaks — and so does this one,
-- which greps the definition itself for the forbidden comparison.
SELECT is(
  (SELECT count(*)::int FROM pg_proc
    WHERE proname = 'student_package_coverage'
      AND prosrc ~* 'live_value_remaining\s*>=\s*rate_per_lesson'),
  0, 'the coverage predicate contains NO affordability comparison');

SELECT * FROM finish();
ROLLBACK;
