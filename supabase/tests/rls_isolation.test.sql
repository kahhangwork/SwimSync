-- pgTAP: Row Level Security isolation. Seeds two parents and asserts each can
-- read only their own billing data, while the superadmin sees everyone's.
-- Directly guards the "RLS returns nothing / returns too much" bug class.
-- Also covers PRD §11.3: a parent with children under DIFFERENT coaches sees all
-- of them, while each coach sees only the students enrolled in their own classes.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(10);

-- ── Seed two parents, each with a student + an invoice (as the superuser) ────
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','rls-parentA@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Parent A","role":"parent"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','rls-parentB@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Parent B","role":"parent"}', now(), now(), '', '', '', '');

INSERT INTO students (id, full_name, assignment_status) VALUES
  ('c0000000-0000-0000-0000-0000000000a1','Kid A','assigned'),
  ('c0000000-0000-0000-0000-0000000000b1','Kid B','assigned');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c0000000-0000-0000-0000-0000000000a1' FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000a1';
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c0000000-0000-0000-0000-0000000000b1' FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000b1';

INSERT INTO invoices (id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT 'e0000000-0000-0000-0000-0000000000a1', p.id, '2026-01', 30, 0, 30, 'outstanding' FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000a1';
INSERT INTO invoices (id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT 'e0000000-0000-0000-0000-0000000000b1', p.id, '2026-01', 30, 0, 30, 'outstanding' FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000b1';

-- ── 11.3 seed: one parent (C) with two children under two DIFFERENT coaches ──
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000c9',
   'authenticated','authenticated','rls-parentC@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Parent C","role":"parent"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000d8',
   'authenticated','authenticated','rls-coachX@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Coach X","role":"coach"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000d9',
   'authenticated','authenticated','rls-coachY@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Coach Y","role":"coach"}', now(), now(), '', '', '', '');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson)
SELECT 'b0000000-0000-0000-0000-0000000000d8', co.id, 'Coach X Class', 'saturday','10:00','11:00','Pool', 30
FROM coaches co WHERE co.profile_id='a0000000-0000-0000-0000-0000000000d8';
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson)
SELECT 'b0000000-0000-0000-0000-0000000000d9', co.id, 'Coach Y Class', 'sunday','10:00','11:00','Pool', 30
FROM coaches co WHERE co.profile_id='a0000000-0000-0000-0000-0000000000d9';

INSERT INTO students (id, full_name, assignment_status) VALUES
  ('c0000000-0000-0000-0000-0000000000c9','Kid C1','assigned'),
  ('c0000000-0000-0000-0000-0000000000ca','Kid C2','assigned');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c0000000-0000-0000-0000-0000000000c9' FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000c9';
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c0000000-0000-0000-0000-0000000000ca' FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000c9';

INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
  ('c0000000-0000-0000-0000-0000000000c9','b0000000-0000-0000-0000-0000000000d8', TRUE),
  ('c0000000-0000-0000-0000-0000000000ca','b0000000-0000-0000-0000-0000000000d9', TRUE);

-- ── As Parent A (authenticated) ─────────────────────────────────────────────
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM invoices WHERE id='e0000000-0000-0000-0000-0000000000a1'),
  1, 'Parent A can see their own invoice');
SELECT is((SELECT count(*)::int FROM invoices WHERE id='e0000000-0000-0000-0000-0000000000b1'),
  0, 'Parent A cannot see Parent B''s invoice');
SELECT is((SELECT count(*)::int FROM students WHERE id='c0000000-0000-0000-0000-0000000000b1'),
  0, 'Parent A cannot see Parent B''s child');

-- ── As Parent B ─────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM invoices WHERE id='e0000000-0000-0000-0000-0000000000a1'),
  0, 'Parent B cannot see Parent A''s invoice');

-- ── As the superadmin (from seed.sql) ───────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM invoices
           WHERE id IN ('e0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-0000000000b1')),
  2, 'Superadmin sees both parents'' invoices');

-- ── 11.3  Parent sees ALL their children; each coach only sees their own ─────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000c9","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM students
           WHERE id IN ('c0000000-0000-0000-0000-0000000000c9','c0000000-0000-0000-0000-0000000000ca')),
  2, '11.3: a parent sees ALL their children, even under different coaches');

SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000d8","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM students WHERE id='c0000000-0000-0000-0000-0000000000c9'),
  1, '11.3: coach X sees the child enrolled in their class');
SELECT is((SELECT count(*)::int FROM students WHERE id='c0000000-0000-0000-0000-0000000000ca'),
  0, '11.3: coach X does NOT see the other coach''s child');

SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000d9","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM students WHERE id='c0000000-0000-0000-0000-0000000000ca'),
  1, '11.3: coach Y sees their own child');
SELECT is((SELECT count(*)::int FROM students WHERE id='c0000000-0000-0000-0000-0000000000c9'),
  0, '11.3: coach Y does NOT see coach X''s child');

SELECT * FROM finish();
ROLLBACK;
