-- pgTAP: a coach can read the name of a child they TAUGHT — Wave 8 Bug-ledger row #2
-- (20261006000600_coach_sees_past_pupils).
--
-- The bug: enrolments_select shows a coach every enrolment of a class they own, but
-- students_select showed the child only through an ACTIVE enrolment. A removed
-- child's past-lesson enrolment embedded "students": null and the coach marking
-- screen crashed on it (enrolledOn → e.students.id).
--
-- What is pinned, in order of blast radius:
--   1. the owning coach sees a REMOVED child (the fix);
--   2. a substitute rostered on the class sees them too (the same screen);
--   3. a coach of ANOTHER class does not (the widening stays narrow);
--   4. set_students_active() still REFUSES the owning coach for that child — the new
--      arm is read-only; write authority stays coach_serves_student (active only).
--
-- METHOD (§7.16): every probe runs inside this transaction with SET LOCAL ROLE.
-- PROVEN RED (§7.25): run before the migration is applied, assertions 1 and 2 fail
-- (count 0, expected 1); 3 and 4 pass either way — they guard the scope.
--
-- Runs on its own tenant; self-contained; rolls back.

BEGIN;
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(5);
SELECT is(app_today(), '2026-09-15'::date, 'clock pinned');

-- ── Fixtures ────────────────────────────────────────────────────────────────

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('e8000000-0000-0000-0000-00000000000a','pp-a','Past Pupils Swim','SWIM-PPAA');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','e8d00000-0000-0000-0000-000000000001',
   'authenticated','authenticated','pp-admin@test.local', crypt('x', gen_salt('bf')), app_now(),
   '{"provider":"email"}',
   '{"full_name":"PP Admin","role":"tenant_admin","tenant_id":"e8000000-0000-0000-0000-00000000000a"}',
   app_now(), app_now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','e8d00000-0000-0000-0000-000000000002',
   'authenticated','authenticated','pp-coach-own@test.local', crypt('x', gen_salt('bf')), app_now(),
   '{"provider":"email"}',
   '{"full_name":"PP Coach Own","role":"coach","tenant_id":"e8000000-0000-0000-0000-00000000000a"}',
   app_now(), app_now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','e8d00000-0000-0000-0000-000000000003',
   'authenticated','authenticated','pp-coach-other@test.local', crypt('x', gen_salt('bf')), app_now(),
   '{"provider":"email"}',
   '{"full_name":"PP Coach Other","role":"coach","tenant_id":"e8000000-0000-0000-0000-00000000000a"}',
   app_now(), app_now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','e8d00000-0000-0000-0000-000000000004',
   'authenticated','authenticated','pp-coach-sub@test.local', crypt('x', gen_salt('bf')), app_now(),
   '{"provider":"email"}',
   '{"full_name":"PP Coach Sub","role":"coach","tenant_id":"e8000000-0000-0000-0000-00000000000a"}',
   app_now(), app_now(), '','','','');

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('e8c00000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-00000000000a','PP Group');

INSERT INTO locations (tenant_id, name)
SELECT t.id, 'Default location' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM locations l
    WHERE l.tenant_id = t.id AND lower(trim(l.name)) = 'default location');

-- PP Own (coach own) is the class the child was removed from; PP Other belongs to a
-- different coach of the same business.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_id, price_per_lesson, category_id, is_active)
SELECT v.id, co.id, v.title, v.dow, '10:00','11:00',
       (SELECT l.id FROM locations l WHERE l.tenant_id = co.tenant_id AND lower(trim(l.name)) = 'default location'),
       40.00, 'e8c00000-0000-0000-0000-000000000001', TRUE
  FROM (VALUES
    ('e8f00000-0000-0000-0000-000000000001'::uuid, 'PP Own', 'saturday'::day_of_week, 'pp-coach-own@test.local'),
    ('e8f00000-0000-0000-0000-000000000002'::uuid, 'PP Other', 'sunday'::day_of_week, 'pp-coach-other@test.local')
  ) v(id, title, dow, email)
  JOIN profiles pr ON pr.email = v.email
  JOIN coaches co ON co.profile_id = pr.id;

INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by) VALUES
  ('e8500000-0000-0000-0000-000000000001','PP Removed Kid','2016-01-01','unassigned',
   'e8000000-0000-0000-0000-00000000000a','e8d00000-0000-0000-0000-000000000001');

-- Enrolled in PP Own from 1 Aug, removed on 5 Sep — a CLOSED enrolment, nothing active.
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at, unenrolled_at) VALUES
  ('e8500000-0000-0000-0000-000000000001','e8f00000-0000-0000-0000-000000000001', FALSE,
   '2026-08-01 00:00+08', '2026-09-05 00:00+08');

-- The substitute is rostered onto one PP Own lesson.
INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('e8a00000-0000-0000-0000-000000000001','e8f00000-0000-0000-0000-000000000001','2026-08-15','scheduled');
INSERT INTO session_coaches (lesson_session_id, coach_id)
SELECT 'e8a00000-0000-0000-0000-000000000001', co.id
  FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
 WHERE pr.email = 'pp-coach-sub@test.local';

-- ════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e8d00000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM students WHERE id = 'e8500000-0000-0000-0000-000000000001'), 1,
  '1. the owning coach sees a child REMOVED from their class (a closed enrolment)');
SELECT throws_ok($$
  SELECT set_students_active(ARRAY['e8500000-0000-0000-0000-000000000001']::uuid[], TRUE)
$$, NULL, NULL,
  '4. set_students_active() still refuses the owning coach for that child — the new arm is read-only');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e8d00000-0000-0000-0000-000000000004","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM students WHERE id = 'e8500000-0000-0000-0000-000000000001'), 1,
  '2. a substitute rostered on that class sees the removed child too');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e8d00000-0000-0000-0000-000000000003","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM students WHERE id = 'e8500000-0000-0000-0000-000000000001'), 0,
  '3. a coach of ANOTHER class in the same business does not');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
