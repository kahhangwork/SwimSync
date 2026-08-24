-- pgTAP: mark_day_holiday / unmark_day_holiday (20260818000900).
-- The admin voids a whole public-holiday day: every expected student (enrolled +
-- guest) gets a 'holiday' row, covering packages extend, and unmark reverses it.
-- Plus the calendar-holiday bound and the admin-only authz. Rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(11);

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
SELECT 'df000000-0000-0000-0000-0000000000b1', co.id, 'Mon', 'monday',
       '10:00','11:00',(SELECT l.id FROM locations l WHERE l.tenant_id = co.tenant_id AND lower(trim(l.name)) = 'default location'), 50.00, 'de000000-0000-0000-0000-0000000000b1'
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

-- ══ Retirement-boundary fixtures (cases 9–11, plan Phase A) ══════════════════
-- TUESDAY classes and a SEPARATE Tuesday holiday (2026-03-17), fully isolated
-- from the Monday cases above (v_dow differs, so the 2026-03-02 void never
-- touches them). Created ACTIVE here; retired below with a plain superuser
-- UPDATE — a state deactivate_class() would REFUSE (its refusals 1–3 clear
-- spans and require marked lessons). These pin the PREDICATE, not a product path.
INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
VALUES ('da000000-0000-0000-0000-0000000000b1','2026-03-17','Holiday Tue');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_id, price_per_lesson, category_id)
SELECT x.id, co.id, x.title, 'tuesday', '10:00','11:00',(SELECT l.id FROM locations l WHERE l.tenant_id = co.tenant_id AND lower(trim(l.name)) = 'default location'), 50.00,
       'de000000-0000-0000-0000-0000000000b1'
FROM coaches co JOIN profiles pr ON pr.id=co.profile_id
CROSS JOIN (VALUES
  ('df000000-0000-0000-0000-0000000000c1'::uuid,'R1 retired D+1'),
  ('df000000-0000-0000-0000-0000000000c2'::uuid,'R2 retired D'),
  ('df000000-0000-0000-0000-0000000000c3'::uuid,'R3 retired D-1')) AS x(id,title)
WHERE pr.email='hr-admin@test.local';

-- R1 has an enrolled kid (of hr-parent, covered by package d1), pre-marked
-- 'present' on 2026-03-17 in an existing session — the REACHABLE state (a retired
-- class's past lessons are already marked). R2 and R3 have no students.
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by)
VALUES ('55000000-0000-0000-0000-0000000000c1','R1 Kid','2017-04-04','assigned',
        'da000000-0000-0000-0000-0000000000b1','db000000-0000-0000-0000-0000000000b1');
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '55000000-0000-0000-0000-0000000000c1'
FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='hr-parent@test.local';
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
VALUES ('55000000-0000-0000-0000-0000000000c1','df000000-0000-0000-0000-0000000000c1', true, '2026-03-01');
INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time)
VALUES ('e5000000-0000-0000-0000-0000000000c1','df000000-0000-0000-0000-0000000000c1',
        '2026-03-17','10:00','11:00');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('e5000000-0000-0000-0000-0000000000c1','55000000-0000-0000-0000-0000000000c1',
        'present','db000000-0000-0000-0000-0000000000b1');

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

-- ══ Cases 9–11: the retirement-boundary predicate (plan Phase A) ═════════════
-- Retire R1/R2/R3 now (raw superuser UPDATE), then void the Tuesday holiday.
-- Clearing request.jwt.claims makes auth.uid() null (RESET ROLE alone leaves the
-- LOCAL claim set), so trg_class_retirement_guard (20260821000300) is exempt by
-- its trust boundary and these fixtures force the retired state freely.
SET LOCAL "request.jwt.claims" TO '';
UPDATE classes SET is_active=false, deactivated_at=TIMESTAMPTZ '2026-03-18 01:00:00+08'
  WHERE id='df000000-0000-0000-0000-0000000000c1';  -- D+1 01:00 SGT = D 17:00 UTC
UPDATE classes SET is_active=false, deactivated_at=TIMESTAMPTZ '2026-03-17 12:00:00+08'
  WHERE id='df000000-0000-0000-0000-0000000000c2';  -- ON the holiday, SGT
UPDATE classes SET is_active=false, deactivated_at=TIMESTAMPTZ '2026-03-16 23:00:00+08'
  WHERE id='df000000-0000-0000-0000-0000000000c3';  -- the day BEFORE, SGT

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"db000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT mark_day_holiday('da000000-0000-0000-0000-0000000000b1','2026-03-17');
RESET ROLE;

-- Case 9: R1 retired D+1 01:00 SGT. Its ::date (UTC) = p_date, so the OLD `> p_date`
-- EXCLUDES it — the kid stays 'present', the package unmoved ('present/0', red).
-- The SGT `>=` predicate reaches it: the row flips to 'holiday' and d1 extends by 7.
SELECT is(
  (SELECT a.status::text FROM attendance a JOIN lesson_sessions ls ON ls.id=a.lesson_session_id
    WHERE ls.class_id='df000000-0000-0000-0000-0000000000c1' AND ls.session_date='2026-03-17')
  || '/' ||
  (SELECT holiday_extension_days FROM parent_packages WHERE id='d1000000-0000-0000-0000-0000000000b1')::text,
  'holiday/7', 'case 9: a class retired the day AFTER (SGT) is voided — row flips, package extends');

-- Case 10: R2 retired ON the holiday (12:00 SGT). OLD excludes it (UTC ::date = p_date,
-- `>` false) so NO session materialises ('0/0', red). NEW `>=` includes it: an empty
-- session appears (nobody expected — harmless per core.ts:754-797).
SELECT is(
  (SELECT count(*)::int FROM lesson_sessions
    WHERE class_id='df000000-0000-0000-0000-0000000000c2' AND session_date='2026-03-17')::text
  || '/' ||
  (SELECT count(*)::int FROM attendance a JOIN lesson_sessions ls ON ls.id=a.lesson_session_id
    WHERE ls.class_id='df000000-0000-0000-0000-0000000000c2' AND ls.session_date='2026-03-17')::text,
  '1/0', 'case 10: a class retired ON the holiday materialises an empty session');

-- Case 11: R3 retired the day BEFORE (SGT) is excluded under both predicates
-- (boundary); and unmark clears R2's empty session (cleanup).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"db000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT unmark_day_holiday('da000000-0000-0000-0000-0000000000b1','2026-03-17');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM lesson_sessions
    WHERE class_id='df000000-0000-0000-0000-0000000000c3' AND session_date='2026-03-17')::text
  || '/' ||
  (SELECT count(*)::int FROM lesson_sessions
    WHERE class_id='df000000-0000-0000-0000-0000000000c2' AND session_date='2026-03-17')::text,
  '0/0', 'case 11: retired-day-before excluded; unmark clears the empty session');

SELECT * FROM finish();
ROLLBACK;
