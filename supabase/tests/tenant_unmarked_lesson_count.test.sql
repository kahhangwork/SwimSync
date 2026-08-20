-- pgTAP: tenant_unmarked_lesson_count (20260820000300, plan Phase C).
-- The scalar copy of /lessons?mode=needs. Built up one class at a time so each
-- assertion pins ONE behaviour of the predicate, plus the authz gate.
--
-- Fixtures inserted as the superuser; the function is called as an admin (its
-- gate reads auth.uid()) inside this transaction with SET LOCAL ROLE (§7.16 —
-- outside a transaction that is a no-op). Each closed enrolment's span covers
-- exactly ONE date (enrolled_at = unenrolled_at), so a weekly class contributes
-- at most one lesson. Window is markable_floor..today_sg() = 2026-07-01..today.
-- Rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(13);

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('ba000000-0000-0000-0000-000000000001','ulc','Unmarked LC','SWIM-ULC1'),
  ('ba000000-0000-0000-0000-000000000002','ulc2','Unmarked LC 2','SWIM-ULC2');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','bb000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','ulc-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"ULC Admin","role":"tenant_admin","is_coach":true,"tenant_id":"ba000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','bb000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','ulc-coach@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"ULC Coach","role":"coach","tenant_id":"ba000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','bb000000-0000-0000-0000-000000000003',
   'authenticated','authenticated','ulc-plat@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"ULC Plat","role":"platform_admin"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','bb000000-0000-0000-0000-000000000004',
   'authenticated','authenticated','ulc-stranger@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"ULC Stranger","role":"parent"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','bb000000-0000-0000-0000-000000000005',
   'authenticated','authenticated','ulc-admin2@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"ULC Admin2","role":"tenant_admin","tenant_id":"ba000000-0000-0000-0000-000000000002"}',
   now(), now(), '','','','');

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('be000000-0000-0000-0000-000000000001','ba000000-0000-0000-0000-000000000001','G');

-- 33 students, one per role in the classes below (ids 55b0…01 upward).
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by)
SELECT ('55b00000-0000-0000-0000-0000000000'||n)::uuid, 'ULC '||n, '2016-01-01','assigned',
       'ba000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001'
FROM (VALUES ('01'),('02'),('03'),('04'),('05'),('06'),('07'),('08'),('09'),('10')) s(n);

-- Helper values reused below: the Monday class shell (coach = ULC coach).
-- Each class is created just before the assertion that needs it.

-- ── 1: a past lesson nobody touched (1 expected, 0 rows) counts ──────────────
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'bf000000-0000-0000-0000-000000000001', co.id,'C1','monday','10:00','11:00','P',50.00,'be000000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='ulc-coach@test.local';
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at, unenrolled_at)
VALUES ('55b00000-0000-0000-0000-000000000001','bf000000-0000-0000-0000-000000000001', false, '2026-07-06','2026-07-06');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(tenant_unmarked_lesson_count('ba000000-0000-0000-0000-000000000001'), 1,
  '1: a past lesson nobody touched counts (unmarked)');
RESET ROLE;

-- ── 2: a PARTIAL lesson (2 expected, 1 marked) counts ───────────────────────
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'bf000000-0000-0000-0000-000000000002', co.id,'C2','monday','10:00','11:00','P',50.00,'be000000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='ulc-coach@test.local';
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at, unenrolled_at) VALUES
  ('55b00000-0000-0000-0000-000000000002','bf000000-0000-0000-0000-000000000002', false, '2026-07-13','2026-07-13'),
  ('55b00000-0000-0000-0000-000000000003','bf000000-0000-0000-0000-000000000002', false, '2026-07-13','2026-07-13');
INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time)
VALUES ('e5b00000-0000-0000-0000-000000000002','bf000000-0000-0000-0000-000000000002','2026-07-13','10:00','11:00');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('e5b00000-0000-0000-0000-000000000002','55b00000-0000-0000-0000-000000000002','present','bb000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(tenant_unmarked_lesson_count('ba000000-0000-0000-0000-000000000001'), 2,
  '2: a partial lesson (1 of 2 marked) counts');
RESET ROLE;

-- ── 3: a FULLY-MARKED lesson does NOT count ─────────────────────────────────
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'bf000000-0000-0000-0000-000000000003', co.id,'C3','monday','10:00','11:00','P',50.00,'be000000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='ulc-coach@test.local';
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at, unenrolled_at)
VALUES ('55b00000-0000-0000-0000-000000000004','bf000000-0000-0000-0000-000000000003', false, '2026-07-20','2026-07-20');
INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time)
VALUES ('e5b00000-0000-0000-0000-000000000003','bf000000-0000-0000-0000-000000000003','2026-07-20','10:00','11:00');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('e5b00000-0000-0000-0000-000000000003','55b00000-0000-0000-0000-000000000004','present','bb000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(tenant_unmarked_lesson_count('ba000000-0000-0000-0000-000000000001'), 2,
  '3: a fully-marked lesson does not count');
RESET ROLE;

-- ── 4: a fully-HOLIDAY lesson does NOT count ────────────────────────────────
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'bf000000-0000-0000-0000-000000000004', co.id,'C4','monday','10:00','11:00','P',50.00,'be000000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='ulc-coach@test.local';
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at, unenrolled_at)
VALUES ('55b00000-0000-0000-0000-000000000005','bf000000-0000-0000-0000-000000000004', false, '2026-07-27','2026-07-27');
INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time)
VALUES ('e5b00000-0000-0000-0000-000000000004','bf000000-0000-0000-0000-000000000004','2026-07-27','10:00','11:00');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('e5b00000-0000-0000-0000-000000000004','55b00000-0000-0000-0000-000000000005','holiday','bb000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(tenant_unmarked_lesson_count('ba000000-0000-0000-0000-000000000001'), 2,
  '4: a fully-voided (holiday) lesson does not count');
RESET ROLE;

-- ── 5: a GUEST-ONLY lesson (trial, no enrolments) counts ────────────────────
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'bf000000-0000-0000-0000-000000000005', co.id,'C5','monday','10:00','11:00','P',50.00,'be000000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='ulc-coach@test.local';
INSERT INTO trial_bookings (tenant_id, student_id, class_id, session_date, category_id, booked_by)
VALUES ('ba000000-0000-0000-0000-000000000001','55b00000-0000-0000-0000-000000000006','bf000000-0000-0000-0000-000000000005','2026-08-03','be000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(tenant_unmarked_lesson_count('ba000000-0000-0000-0000-000000000001'), 3,
  '5: a guest-only lesson (trial, no enrolments) counts');
RESET ROLE;

-- ── 6: TODAY's lesson is not yet ended (end 23:59) — does NOT count ─────────
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'bf000000-0000-0000-0000-000000000006', co.id,'C6',
       (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[EXTRACT(DOW FROM today_sg())::int+1]::day_of_week,
       '10:00','23:59','P',50.00,'be000000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='ulc-coach@test.local';
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at, unenrolled_at)
VALUES ('55b00000-0000-0000-0000-000000000007','bf000000-0000-0000-0000-000000000006', true, today_sg(), today_sg());
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(tenant_unmarked_lesson_count('ba000000-0000-0000-0000-000000000001'), 3,
  '6: today''s lesson (end 23:59, not ended) is upcoming, not counted');
RESET ROLE;

-- ── 7: a date BEFORE the markable floor does NOT count ──────────────────────
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'bf000000-0000-0000-0000-000000000007', co.id,'C7','monday','10:00','11:00','P',50.00,'be000000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='ulc-coach@test.local';
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at, unenrolled_at)
VALUES ('55b00000-0000-0000-0000-000000000008','bf000000-0000-0000-0000-000000000007', false, '2026-06-01','2026-06-01');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(tenant_unmarked_lesson_count('ba000000-0000-0000-0000-000000000001'), 3,
  '7: a lesson before the markable floor does not count');
RESET ROLE;

-- ── 8: a RETIRED class — a pattern date AFTER the SGT retirement, no session ─
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'bf000000-0000-0000-0000-000000000008', co.id,'C8','monday','10:00','11:00','P',50.00,'be000000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='ulc-coach@test.local';
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at, unenrolled_at)
VALUES ('55b00000-0000-0000-0000-000000000009','bf000000-0000-0000-0000-000000000008', false, '2026-07-13','2026-07-13');
UPDATE classes SET is_active=false, deactivated_at=TIMESTAMPTZ '2026-07-10 12:00:00+08'
  WHERE id='bf000000-0000-0000-0000-000000000008';  -- cutoff 2026-07-10 (SGT)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(tenant_unmarked_lesson_count('ba000000-0000-0000-0000-000000000001'), 3,
  '8: a retired class''s pattern date after retirement (no session) is skipped');
RESET ROLE;

-- ── 9: the SAME date but WITH a session row counts ──────────────────────────
INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time)
VALUES ('e5b00000-0000-0000-0000-000000000008','bf000000-0000-0000-0000-000000000008','2026-07-13','10:00','11:00');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(tenant_unmarked_lesson_count('ba000000-0000-0000-0000-000000000001'), 4,
  '9: a retired class''s post-retirement date WITH a session row counts');
RESET ROLE;

-- ── 10–13: the authz gate ───────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000004","role":"authenticated"}';  -- stranger
SELECT throws_ok($$ SELECT tenant_unmarked_lesson_count('ba000000-0000-0000-0000-000000000001') $$,
  '42501', NULL, '10: a stranger is refused');
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000005","role":"authenticated"}';  -- other tenant's admin
SELECT throws_ok($$ SELECT tenant_unmarked_lesson_count('ba000000-0000-0000-0000-000000000001') $$,
  '42501', NULL, '11: another tenant''s admin is refused');
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000002","role":"authenticated"}';  -- coach (not admin)
SELECT throws_ok($$ SELECT tenant_unmarked_lesson_count('ba000000-0000-0000-0000-000000000001') $$,
  '42501', NULL, '12: a coach (not tenant admin) is refused');
SET LOCAL "request.jwt.claims" TO '{"sub":"bb000000-0000-0000-0000-000000000003","role":"authenticated"}';  -- platform admin
SELECT is(tenant_unmarked_lesson_count('ba000000-0000-0000-0000-000000000001'), 4,
  '13: a platform admin is allowed and sees the same count');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
