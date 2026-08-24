-- pgTAP: only a tenant admin may set / clear / delete a 'holiday' mark
-- (20260818000800). The coach app never offers it; this proves the DB boundary,
-- not the hidden button. Dates derive from today_sg() so the attendance window
-- guard (§8.15) is always satisfied and THIS guard is the only gate. Rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(6);

-- Today, SGT, and its weekday as the class day_of_week enum.
CREATE TEMP TABLE _t AS SELECT
  (now() AT TIME ZONE 'Asia/Singapore')::date AS d,
  lower(trim(to_char((now() AT TIME ZONE 'Asia/Singapore')::date, 'FMDay')))::day_of_week AS dow;

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('da000000-0000-0000-0000-0000000000a1','hg','Holiday Guard','SWIM-HGD');

-- An ADMIN (also a coach — private-coach shape) and a SEPARATE non-admin coach.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','db000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','hg-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"HG Admin","role":"tenant_admin","is_coach":true,"tenant_id":"da000000-0000-0000-0000-0000000000a1"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','db000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','hg-coach@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"HG Coach","role":"coach","is_coach":true,"tenant_id":"da000000-0000-0000-0000-0000000000a1"}',
   now(), now(), '','','','');

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('de000000-0000-0000-0000-0000000000a1','da000000-0000-0000-0000-0000000000a1','G');

-- The class is OWNED BY THE NON-ADMIN COACH, so RLS lets that coach write its
-- attendance — the only thing that may stop them is this guard.
-- classes.location_id is NOT NULL since the location contract migration
-- (20260824000200). Give every tenant one location to hang classes off,
-- tenant-agnostic and idempotent (mirrors the Default Group category block).
INSERT INTO locations (tenant_id, name)
SELECT t.id, 'Default location' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM locations l
    WHERE l.tenant_id = t.id AND lower(trim(l.name)) = 'default location');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_id, price_per_lesson, category_id)
SELECT 'df000000-0000-0000-0000-0000000000a1', co.id, 'C', (SELECT dow FROM _t),
       '10:00','11:00',(SELECT l.id FROM locations l WHERE l.tenant_id = co.tenant_id AND lower(trim(l.name)) = 'default location'), 50.00, 'de000000-0000-0000-0000-0000000000a1'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='hg-coach@test.local';

INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by)
VALUES ('55000000-0000-0000-0000-0000000000a1','HG Kid','2018-05-05','assigned',
        'da000000-0000-0000-0000-0000000000a1','db000000-0000-0000-0000-0000000000a1');
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
SELECT '55000000-0000-0000-0000-0000000000a1','df000000-0000-0000-0000-0000000000a1', true, (SELECT d FROM _t);

INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time)
SELECT '12000000-0000-0000-0000-0000000000a1','df000000-0000-0000-0000-0000000000a1',(SELECT d FROM _t),'10:00','11:00';

-- A present row (to flip) and, seeded as postgres (guard-exempt), a holiday row to clear/delete.
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('12000000-0000-0000-0000-0000000000a1','55000000-0000-0000-0000-0000000000a1','present',
        'db000000-0000-0000-0000-0000000000a2');

-- ── The non-admin COACH is refused all three ────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"db000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

SELECT throws_ok($$
  UPDATE attendance SET status='holiday'
  WHERE lesson_session_id='12000000-0000-0000-0000-0000000000a1'
    AND student_id='55000000-0000-0000-0000-0000000000a1' $$,
  '42501', NULL, 'a coach cannot SET a holiday');

-- ── The ADMIN may set it ────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"db000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT lives_ok($$
  UPDATE attendance SET status='holiday'
  WHERE lesson_session_id='12000000-0000-0000-0000-0000000000a1'
    AND student_id='55000000-0000-0000-0000-0000000000a1' $$,
  'a tenant admin CAN set a holiday');

SELECT is((SELECT status::text FROM attendance
            WHERE lesson_session_id='12000000-0000-0000-0000-0000000000a1'
              AND student_id='55000000-0000-0000-0000-0000000000a1'),
  'holiday', 'the row is now holiday');

-- ── Back to the coach: cannot CLEAR or DELETE the holiday row ────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"db000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok($$
  UPDATE attendance SET status='present'
  WHERE lesson_session_id='12000000-0000-0000-0000-0000000000a1'
    AND student_id='55000000-0000-0000-0000-0000000000a1' $$,
  '42501', NULL, 'a coach cannot CLEAR a holiday (would re-bill the class)');
SELECT throws_ok($$
  DELETE FROM attendance
  WHERE lesson_session_id='12000000-0000-0000-0000-0000000000a1'
    AND student_id='55000000-0000-0000-0000-0000000000a1' $$,
  '42501', NULL, 'a coach cannot DELETE a holiday row');

-- ── The admin may clear it ──────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"db000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT lives_ok($$
  UPDATE attendance SET status='present'
  WHERE lesson_session_id='12000000-0000-0000-0000-0000000000a1'
    AND student_id='55000000-0000-0000-0000-0000000000a1' $$,
  'a tenant admin CAN clear a holiday');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
