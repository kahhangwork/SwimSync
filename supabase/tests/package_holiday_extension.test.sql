-- pgTAP: event-driven public-holiday validity extension (20260818000700).
-- Marking a lesson 'holiday' extends the covering package by the tenant's
-- holiday_extension_days, deduped per (package, date), reversible. Replaces the
-- retired calendar-scan recompute (20260815000200).
--
-- Window: package start 2026-03-01 (Sun), 10 weeks => nominal end 2026-05-10.
-- Mon class; holiday Mondays in window: 2026-03-02, 03-09, 03-16, 03-23; tail
-- (after nominal end): 2026-05-11. Self-contained; own tenant; rolls back.
-- Runs as postgres, so the attendance window guard (20260727000100) and the
-- admin-only holiday guard (20260818000800) both exempt it at the current_user seam.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(14);

INSERT INTO tenants (id, slug, display_name, join_code, holiday_extension_days) VALUES
  ('da000000-0000-0000-0000-000000000001','hx','Holiday Ext','SWIM-HXT', 7);

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
   now(), now(), '','','','');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'da000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id WHERE pr.email='hx-parent@test.local';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('de000000-0000-0000-0000-000000000001','da000000-0000-0000-0000-000000000001','Group');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id)
SELECT 'df000000-0000-0000-0000-000000000001', co.id, 'Mon', 'monday',
       '10:00','11:00','Pool', 50.00, 'de000000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='hx-admin@test.local';

-- Two siblings, ONE parent (the dedup case): both enrolled in the Mon class.
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by) VALUES
  ('55000000-0000-0000-0000-0000000000d1','HX Kid1','2018-05-05','assigned',
   'da000000-0000-0000-0000-000000000001','dc000000-0000-0000-0000-000000000001'),
  ('55000000-0000-0000-0000-0000000000d2','HX Kid2','2019-06-06','assigned',
   'da000000-0000-0000-0000-000000000001','dc000000-0000-0000-0000-000000000001');
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.id
FROM parents p JOIN profiles pr ON pr.id=p.profile_id AND pr.email='hx-parent@test.local'
CROSS JOIN (VALUES ('55000000-0000-0000-0000-0000000000d1'::uuid),
                   ('55000000-0000-0000-0000-0000000000d2'::uuid)) s(id);
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at) VALUES
  ('55000000-0000-0000-0000-0000000000d1','df000000-0000-0000-0000-000000000001', true, '2026-03-01'),
  ('55000000-0000-0000-0000-0000000000d2','df000000-0000-0000-0000-000000000001', true, '2026-03-01');

-- All-classes product (category NULL), 10 weeks; active package for the parent,
-- start 2026-03-01. The lifecycle trigger sets expires_on = nominal end.
INSERT INTO package_products (id, tenant_id, name, lesson_count, rate_per_lesson, validity_weeks)
VALUES ('d0000000-0000-0000-0000-000000000001','da000000-0000-0000-0000-000000000001',
        '20 lessons', 20, 30.00, 10);
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, start_date)
SELECT 'd1000000-0000-0000-0000-000000000001','da000000-0000-0000-0000-000000000001',
       p.id,'d0000000-0000-0000-0000-000000000001','active','2026-03-01'
FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='hx-parent@test.local';

-- Lesson sessions, one per Monday we test.
INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time) VALUES
  ('12000000-0000-0000-0000-000000000302','df000000-0000-0000-0000-000000000001','2026-03-02','10:00','11:00'),
  ('12000000-0000-0000-0000-000000000309','df000000-0000-0000-0000-000000000001','2026-03-09','10:00','11:00'),
  ('12000000-0000-0000-0000-000000000316','df000000-0000-0000-0000-000000000001','2026-03-16','10:00','11:00'),
  ('12000000-0000-0000-0000-000000000323','df000000-0000-0000-0000-000000000001','2026-03-23','10:00','11:00'),
  ('12000000-0000-0000-0000-000000000511','df000000-0000-0000-0000-000000000001','2026-05-11','10:00','11:00');

-- Helper: mark/unmark a student 'holiday' on a session.
-- (inline INSERT/DELETE below; marked_by = the admin profile.)

-- ── 1. Baseline: no holidays ⇒ expiry is the nominal end ─────────────────────
SELECT is((SELECT expires_on FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  DATE '2026-05-10', 'baseline expiry is the nominal end');

-- ── 2-4. Mark kid1 holiday on 2026-03-02 ⇒ +7 days, one state row ────────────
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('12000000-0000-0000-0000-000000000302','55000000-0000-0000-0000-0000000000d1','holiday',
        'db000000-0000-0000-0000-000000000001');
SELECT is((SELECT holiday_extension_days FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  7, 'one holiday ⇒ +7 days accumulator');
SELECT is((SELECT expires_on FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  DATE '2026-05-17', 'expiry pushed 7 days (2026-05-10 + 7)');
SELECT is((SELECT count(*)::int FROM package_holiday_extensions
            WHERE parent_package_id='d1000000-0000-0000-0000-000000000001'),
  1, 'exactly one state row');

-- ── 5-6. SIBLING dedup: kid2 holiday, SAME date ⇒ still +7, still one row ─────
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('12000000-0000-0000-0000-000000000302','55000000-0000-0000-0000-0000000000d2','holiday',
        'db000000-0000-0000-0000-000000000001');
SELECT is((SELECT holiday_extension_days FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  7, 'two siblings sharing one package, same holiday ⇒ +7 ONCE (dedup per package,date)');
SELECT is((SELECT count(*)::int FROM package_holiday_extensions
            WHERE parent_package_id='d1000000-0000-0000-0000-000000000001'),
  1, 'still exactly one state row for that date');

-- ── 7-8. A DIFFERENT date accumulates (+7 more = 14) ─────────────────────────
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('12000000-0000-0000-0000-000000000309','55000000-0000-0000-0000-0000000000d1','holiday',
        'db000000-0000-0000-0000-000000000001');
SELECT is((SELECT holiday_extension_days FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  14, 'a second distinct holiday date ⇒ +7 more (per-date)');
SELECT is((SELECT expires_on FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  DATE '2026-05-24', 'expiry now +14');

-- ── 9. NO CASCADE: a holiday in the extended tail is outside the nominal window ─
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('12000000-0000-0000-0000-000000000511','55000000-0000-0000-0000-0000000000d1','holiday',
        'db000000-0000-0000-0000-000000000001');
SELECT is((SELECT holiday_extension_days FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  14, 'a holiday after the nominal end never extends (no cascade)');

-- ── 10-11. REVERSAL is exact: un-mark the 2026-03-09 holiday ⇒ back to 7 ──────
DELETE FROM attendance
WHERE lesson_session_id='12000000-0000-0000-0000-000000000309'
  AND student_id='55000000-0000-0000-0000-0000000000d1';
SELECT is((SELECT holiday_extension_days FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  7, 'un-marking a holiday retracts exactly its days');
SELECT is((SELECT expires_on FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  DATE '2026-05-17', 'expiry back to +7');

-- ── 12. CONFIGURABLE days: raise to 10, a NEW holiday adds 10 ────────────────
UPDATE tenants SET holiday_extension_days = 10 WHERE id='da000000-0000-0000-0000-000000000001';
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('12000000-0000-0000-0000-000000000316','55000000-0000-0000-0000-0000000000d1','holiday',
        'db000000-0000-0000-0000-000000000001');
SELECT is((SELECT holiday_extension_days FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  17, 'a new holiday uses the CURRENT setting (7 already applied + 10 new = 17)');

-- ── 13. RISK 3 — reversal reads applied_days from state, not the live setting ─
-- The 2026-03-02 rows were applied at 7. Set the tenant to 0, then un-mark BOTH
-- siblings on that date: the retraction removes exactly 7 (the stored value),
-- never the current 0 and never a re-derivation.
UPDATE tenants SET holiday_extension_days = 0 WHERE id='da000000-0000-0000-0000-000000000001';
DELETE FROM attendance WHERE lesson_session_id='12000000-0000-0000-0000-000000000302';
SELECT is((SELECT holiday_extension_days FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001'),
  10, 'un-marking a holiday applied at 7 removes 7 even after the setting changed to 0');

-- ── 14. CONFIG 0 writes no state row ────────────────────────────────────────
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('12000000-0000-0000-0000-000000000323','55000000-0000-0000-0000-0000000000d1','holiday',
        'db000000-0000-0000-0000-000000000001');
SELECT is((SELECT holiday_extension_days FROM parent_packages WHERE id='d1000000-0000-0000-0000-000000000001')
          || '/' ||
          (SELECT count(*)::text FROM package_holiday_extensions
            WHERE parent_package_id='d1000000-0000-0000-0000-000000000001' AND holiday_date='2026-03-23'),
  '10/0', 'a holiday under a 0-day setting extends nothing and writes no state row');

SELECT * FROM finish();
ROLLBACK;
