-- pgTAP: mark_day_holiday / unmark_day_holiday (20260818000900).
-- The admin voids a whole public-holiday day: every expected student (enrolled +
-- guest) gets a 'holiday' row, covering packages extend, and unmark reverses it.
-- Plus the calendar-holiday bound and the admin-only authz. Rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);

INSERT INTO tenants (id, slug, display_name, join_code, holiday_extension_days) VALUES
  ('da000000-0000-0000-0000-0000000000b1','hr','Holiday RPC','SWIM-HRP', 7);

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','db000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','hr-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"HR Admin","role":"tenant_admin","is_coach":true,"tenant_id":"da000000-0000-0000-0000-0000000000b1"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','dc000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','hr-parent@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"HR Parent","role":"parent"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','dc000000-0000-0000-0000-0000000000b2',
   'authenticated','authenticated','hr-stranger@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"HR Stranger","role":"parent"}',
   now(), now(), '','','','');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'da000000-0000-0000-0000-0000000000b1'
FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='hr-parent@test.local';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('de000000-0000-0000-0000-0000000000b1','da000000-0000-0000-0000-0000000000b1','G');

-- Monday class; the holiday is 2026-03-02 (Mon), inside the package window.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id)
SELECT 'df000000-0000-0000-0000-0000000000b1', co.id, 'Mon', 'monday',
       '10:00','11:00','Pool', 50.00, 'de000000-0000-0000-0000-0000000000b1'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id WHERE pr.email='hr-admin@test.local';

INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by) VALUES
  ('55000000-0000-0000-0000-0000000000b1','HR Kid','2018-05-05','assigned',
   'da000000-0000-0000-0000-0000000000b1','db000000-0000-0000-0000-0000000000b1'),
  ('55000000-0000-0000-0000-0000000000b2','HR Guest','2019-06-06','assigned',
   'da000000-0000-0000-0000-0000000000b1','db000000-0000-0000-0000-0000000000b1');
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '55000000-0000-0000-0000-0000000000b1'
FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='hr-parent@test.local';
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
VALUES ('55000000-0000-0000-0000-0000000000b1','df000000-0000-0000-0000-0000000000b1', true, '2026-03-01');

-- A trial GUEST booked into the same class on the holiday date (RISK 6 parity).
INSERT INTO trial_bookings (tenant_id, student_id, class_id, session_date, category_id, booked_by)
VALUES ('da000000-0000-0000-0000-0000000000b1','55000000-0000-0000-0000-0000000000b2',
        'df000000-0000-0000-0000-0000000000b1','2026-03-02','de000000-0000-0000-0000-0000000000b1',
        'db000000-0000-0000-0000-0000000000b1');

INSERT INTO package_products (id, tenant_id, name, lesson_count, rate_per_lesson, validity_weeks)
VALUES ('d0000000-0000-0000-0000-0000000000b1','da000000-0000-0000-0000-0000000000b1','20 lessons',20,30.00,10);
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, start_date)
SELECT 'd1000000-0000-0000-0000-0000000000b1','da000000-0000-0000-0000-0000000000b1',
       p.id,'d0000000-0000-0000-0000-0000000000b1','active','2026-03-01'
FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='hr-parent@test.local';

INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
VALUES ('da000000-0000-0000-0000-0000000000b1','2026-03-02','Holiday Mon');

-- ── Authz: a non-admin cannot void ──────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"dc000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
SELECT throws_ok($$ SELECT mark_day_holiday('da000000-0000-0000-0000-0000000000b1','2026-03-02') $$,
  '42501', NULL, 'a non-admin cannot void a day');

-- ── The admin voids the holiday ─────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"db000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- Bound: a date that is not on the calendar is refused.
SELECT throws_ok($$ SELECT mark_day_holiday('da000000-0000-0000-0000-0000000000b1','2026-03-09') $$,
  '23514', NULL, 'voiding a non-calendar date is refused');

SELECT is((SELECT mark_day_holiday('da000000-0000-0000-0000-0000000000b1','2026-03-02')),
  2, 'voided 2 lessons (the enrolled kid + the trial guest)');
RESET ROLE;

-- Both the enrolled kid and the guest carry a holiday row.
SELECT is((SELECT count(*)::int FROM attendance a
             JOIN lesson_sessions ls ON ls.id=a.lesson_session_id
            WHERE ls.session_date='2026-03-02' AND a.status='holiday'),
  2, 'enrolled + guest both marked holiday (expected-set parity)');

-- The covering package extended by 7 (the guest has no package — no effect there).
SELECT is((SELECT holiday_extension_days FROM parent_packages WHERE id='d1000000-0000-0000-0000-0000000000b1'),
  7, 'the covering package extended by 7 days');
SELECT is((SELECT expires_on FROM parent_packages WHERE id='d1000000-0000-0000-0000-0000000000b1'),
  DATE '2026-05-17', 'expiry pushed 7 days');

-- Idempotent: a second void changes nothing.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"db000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT mark_day_holiday('da000000-0000-0000-0000-0000000000b1','2026-03-02');
SELECT is((SELECT holiday_extension_days FROM parent_packages WHERE id='d1000000-0000-0000-0000-0000000000b1'),
  7, 're-voiding is idempotent (still 7)');

-- ── Unmark reverses everything, and removes the now-empty session ───────────
SELECT unmark_day_holiday('da000000-0000-0000-0000-0000000000b1','2026-03-02');
RESET ROLE;
SELECT is(
  (SELECT holiday_extension_days FROM parent_packages WHERE id='d1000000-0000-0000-0000-0000000000b1')::text
  || '/' ||
  (SELECT count(*)::text FROM lesson_sessions ls JOIN classes c ON c.id=ls.class_id
    WHERE c.tenant_id='da000000-0000-0000-0000-0000000000b1' AND ls.session_date='2026-03-02'),
  '0/0', 'unmark retracts the extension AND deletes the emptied session');

SELECT * FROM finish();
ROLLBACK;
