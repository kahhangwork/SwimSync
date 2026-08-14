-- pgTAP: live public-holiday validity extension + acknowledge (20260815000200).
-- Plan ⚠ RISK 4/5. Window: start 2026-03-01 (Sun), 10 weeks ⇒ nominal_end
-- 2026-05-10 (Sun). Class weekdays: Mon + Wed. Holidays chosen against the
-- verified calendar: 2026-03-02 Mon (wk A), 2026-03-04 Wed (wk A too),
-- 2026-03-09 Mon (wk B), 2026-05-11 Mon (in the extended TAIL), 2026-03-03 Tue
-- (no class). Self-contained; own tenant; rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(20);

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('da000000-0000-0000-0000-000000000001','hx','Holiday Ext','SWIM-HXT'),
  ('da000000-0000-0000-0000-000000000002','hx2','Other Biz','SWIM-HXT2');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','db000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','hx-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"HX Admin","role":"tenant_admin","is_coach":true,"tenant_id":"da000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','dc000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','hx-parent@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"HX Parent","role":"parent"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','dc000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','hx-parent2@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"HX Parent2","role":"parent"}',
   now(), now(), '','','','');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'da000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id WHERE pr.email='hx-parent@test.local';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('de000000-0000-0000-0000-000000000001','da000000-0000-0000-0000-000000000001','Group');

-- Mon + Wed classes (coach = admin).
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id)
SELECT 'df000000-0000-0000-0000-000000000001', co.id, 'Mon', 'monday',
       '10:00','11:00','Pool', 50.00, 'de000000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='hx-admin@test.local';
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id)
SELECT 'df000000-0000-0000-0000-000000000002', co.id, 'Wed', 'wednesday',
       '10:00','11:00','Pool', 50.00, 'de000000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='hx-admin@test.local';

INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by)
VALUES ('55000000-0000-0000-0000-0000000000d1','HX Kid','2018-05-05','assigned',
        'da000000-0000-0000-0000-000000000001','dc000000-0000-0000-0000-000000000001');
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '55000000-0000-0000-0000-0000000000d1'
FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='hx-parent@test.local';

-- Enrol the kid in the Mon class only (Wed added mid-test).
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
VALUES ('55000000-0000-0000-0000-0000000000d1','df000000-0000-0000-0000-000000000001', true, '2026-03-01');

-- All-classes product (category NULL), 10 weeks. Active package, start 2026-03-01.
INSERT INTO package_products (id, tenant_id, name, lesson_count, rate_per_lesson, validity_weeks)
VALUES ('d0000000-0000-0000-0000-000000000001','da000000-0000-0000-0000-000000000001',
        '20 lessons', 20, 30.00, 10);
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, start_date)
SELECT 'd1000000-0000-0000-0000-000000000001','da000000-0000-0000-0000-000000000001',
       p.id,'d0000000-0000-0000-0000-000000000001','active','2026-03-01'
FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='hx-parent@test.local';

-- ── 1. Baseline: no holidays ⇒ no extension, expiry = nominal end ────────────
SELECT is((SELECT recompute_package_extensions('da000000-0000-0000-0000-000000000001')), 0,
  'no holidays ⇒ nothing changes');
SELECT is((SELECT expires_on FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  DATE '2026-05-10', 'expiry is the nominal end');

-- ── 2. A holiday on the Mon class weekday, in window ⇒ +1 week ───────────────
INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
VALUES ('da000000-0000-0000-0000-000000000001','2026-03-02','Holiday Mon A');
SELECT is((SELECT recompute_package_extensions('da000000-0000-0000-0000-000000000001')), 1,
  'one package extended');
SELECT is((SELECT ph_extension_weeks FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  1, 'ph_extension_weeks = 1');
SELECT is((SELECT expires_on FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  DATE '2026-05-17', 'expiry pushed one week (2026-05-10 + 7)');

-- ── 3. Idempotent: re-run writes nothing and logs no second event ───────────
SELECT is((SELECT recompute_package_extensions('da000000-0000-0000-0000-000000000001')), 0,
  'a second recompute changes nothing (idempotent)');
SELECT is((SELECT count(*)::int FROM package_extension_events
            WHERE parent_package_id='d1000000-0000-0000-0000-000000000001'),
  1, 'exactly one audit event so far');

-- ── 4. No cascade: a holiday in the extended TAIL is not counted ────────────
INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
VALUES ('da000000-0000-0000-0000-000000000001','2026-05-11','Tail Mon');
SELECT is((SELECT recompute_package_extensions('da000000-0000-0000-0000-000000000001')), 0,
  'a holiday after the nominal end never extends (no cascade)');

-- ── 5. A holiday in a DIFFERENT week ⇒ +2 total ─────────────────────────────
INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
VALUES ('da000000-0000-0000-0000-000000000001','2026-03-09','Holiday Mon B');
SELECT recompute_package_extensions('da000000-0000-0000-0000-000000000001');
SELECT is((SELECT ph_extension_weeks FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  2, 'two distinct affected weeks ⇒ +2');

-- ── 6. THE EDGE CASE: two classes both hit in the SAME week ⇒ still +2 ───────
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
VALUES ('55000000-0000-0000-0000-0000000000d1','df000000-0000-0000-0000-000000000002', true, '2026-03-01');
INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
VALUES ('da000000-0000-0000-0000-000000000001','2026-03-04','Holiday Wed same week');
SELECT recompute_package_extensions('da000000-0000-0000-0000-000000000001');
SELECT is((SELECT ph_extension_weeks FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  2, 'a second holiday in an already-counted week adds NOTHING (per-week, not per-lesson)');

-- ── 7. A holiday on a weekday with no enrolled class is ignored ─────────────
INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
VALUES ('da000000-0000-0000-0000-000000000001','2026-03-03','Tue, no class');
SELECT recompute_package_extensions('da000000-0000-0000-0000-000000000001');
SELECT is((SELECT ph_extension_weeks FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  2, 'a holiday matching no scheduled lesson does not extend');

-- ── 8-9. Acknowledge (admin), then SHRINK clamps the ack ────────────────────
CREATE TEMP TABLE hx_ids AS SELECT
  (SELECT p.id FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='hx-parent@test.local') AS parent1,
  (SELECT p.id FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='hx-parent2@test.local') AS parent2;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"db000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT lives_ok($$ SELECT acknowledge_package_extension('d1000000-0000-0000-0000-000000000001') $$,
  'admin acknowledges the extension');
SELECT is((SELECT ph_ack_weeks_admin FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  2, 'admin ack high-water = current extension (2) ⇒ not loud');
RESET ROLE;

-- Remove a holiday ⇒ shrink to 1; the ack clamps to 1 (LEAST), so the badge
-- is quiet — but a later re-bump will exceed it and go loud again.
DELETE FROM tenant_public_holidays WHERE holiday_date='2026-03-09'
  AND tenant_id='da000000-0000-0000-0000-000000000001';
SELECT recompute_package_extensions('da000000-0000-0000-0000-000000000001');
SELECT is((SELECT ph_extension_weeks || '/' || ph_ack_weeks_admin
            FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  '1/1', 'shrink lowers the extension AND clamps the ack down to it');

-- Re-add ⇒ +2 again, ack still 1 ⇒ LOUD for the admin (2 > 1).
INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
VALUES ('da000000-0000-0000-0000-000000000001','2026-03-09','Holiday Mon B again');
SELECT recompute_package_extensions('da000000-0000-0000-0000-000000000001');
SELECT ok(
  (SELECT ph_extension_weeks > ph_ack_weeks_admin
     FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  'a re-bump after a shrink goes loud again');

-- ── 10. Authorization: a parent cannot recompute another business ──────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"dc000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_ok($$ SELECT recompute_package_extensions('da000000-0000-0000-0000-000000000002') $$,
  '42501', NULL, 'a parent cannot recompute a tenant they are not in');

-- ── 11. A parent cannot acknowledge a package they do not own ───────────────
-- parent2 (in no tenant, not the owner) tries to ack parent1's package.
SET LOCAL "request.jwt.claims" TO '{"sub":"dc000000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT throws_ok($$
  SELECT acknowledge_package_extension('d1000000-0000-0000-0000-000000000001','parent') $$,
  '42501', NULL, 'a non-owning parent cannot acknowledge as parent');
RESET ROLE;

-- ── 12-13. acknowledge_all_extensions: admin-only, tenant-scoped ─────────────
-- A DIFFERENT-tenant admin clears nothing here.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('00000000-0000-0000-0000-000000000000','db000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','hx-admin2@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"HX Admin2","role":"tenant_admin","tenant_id":"da000000-0000-0000-0000-000000000002"}',
   now(), now(), '','','','');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"db000000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT throws_ok($$
  SELECT acknowledge_all_extensions('da000000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'an admin of another tenant cannot acknowledge tenant A''s packages');
-- The rightful admin clears the one loud package.
SET LOCAL "request.jwt.claims" TO '{"sub":"db000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(
  (SELECT acknowledge_all_extensions('da000000-0000-0000-0000-000000000001')),
  1, 'the business''s admin acknowledges all its loud packages');
RESET ROLE;
SELECT ok(
  (SELECT ph_ack_weeks_admin = ph_extension_weeks
     FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  'after acknowledge-all the admin badge is quiet');

SELECT * FROM finish();
ROLLBACK;
