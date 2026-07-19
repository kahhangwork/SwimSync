-- pgTAP: the platform admin's overview RPCs.
--
-- These two functions are SECURITY DEFINER, which means they run as the owner
-- and BYPASS RLS ENTIRELY. Their own gate is therefore the whole boundary —
-- there is no policy behind them to catch a mistake. Without it, any
-- authenticated user (a PARENT) could read every business's counts, billing
-- state and JOIN CODE, and possession of a join code is the only proof a family
-- deals with a business (PRD §5.1).
--
-- So the authorization assertions below are the point of this file, and they
-- cover FOUR caller shapes rather than "a non-admin": parent, coach, tenant
-- admin, and the platform admin. Three of those four reach this function
-- through an ordinary session.
--
-- METHOD (gotcha §7.16): every probe runs inside this explicit transaction with
-- SET LOCAL ROLE. Outside one, SET LOCAL ROLE is a no-op, the session stays
-- superuser, and every assertion "passes" — including the ones that must fail.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(20);

-- ── Two tenants, so a count that leaked across the boundary is visible ──────
INSERT INTO tenants (id, slug, display_name, kind, join_code) VALUES
  ('44444444-0000-0000-0000-000000000001','pov-a','POV A School','school','SWIM-POVA'),
  ('44444444-0000-0000-0000-000000000002','pov-b','POV B Private','private','SWIM-POVB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','44000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','pov-adminA@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"POV Admin A","role":"tenant_admin","tenant_id":"44444444-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','44000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','pov-coachA@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"POV Coach A","role":"coach","tenant_id":"44444444-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','44000000-0000-0000-0000-0000000000b2',
   'authenticated','authenticated','pov-coachB@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"POV Coach B","role":"coach","tenant_id":"44444444-0000-0000-0000-000000000002"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','44000000-0000-0000-0000-0000000000a3',
   'authenticated','authenticated','pov-parentA@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"POV Parent A","role":"parent"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','44000000-0000-0000-0000-0000000000d9',
   'authenticated','authenticated','pov-stranded@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"POV Stranded","role":"parent"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','44000000-0000-0000-0000-0000000000f1',
   'authenticated','authenticated','pov-platform@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"POV Platform","role":"platform_admin"}', now(), now(), '', '', '', '');

-- Tenant A: a class, one student, one attendance-marked session.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson)
SELECT '44000000-0000-0000-0000-00000000a5c1', c.id, 'POV Class A', 'saturday','10:00','11:00','Pool A', 25
FROM coaches c WHERE c.profile_id = '44000000-0000-0000-0000-0000000000a2';

-- Tenant B: a class and a coach, but NOTHING ever marked — the "never" case.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson)
SELECT '44000000-0000-0000-0000-00000000a5c2', c.id, 'POV Class B', 'sunday','10:00','11:00','Pool B', 30
FROM coaches c WHERE c.profile_id = '44000000-0000-0000-0000-0000000000b2';

INSERT INTO students (id, tenant_id, full_name, date_of_birth, gender, created_by)
VALUES ('44000000-0000-0000-0000-00000000a5a1','44444444-0000-0000-0000-000000000001',
        'POV Kid A','2018-05-05','male','44000000-0000-0000-0000-0000000000a3');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '44000000-0000-0000-0000-00000000a5a1' FROM parents p
WHERE p.profile_id = '44000000-0000-0000-0000-0000000000a3';

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '44444444-0000-0000-0000-000000000001' FROM parents p
WHERE p.profile_id = '44000000-0000-0000-0000-0000000000a3';

INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
VALUES ('44000000-0000-0000-0000-00000000a5a1','44000000-0000-0000-0000-00000000a5c1', TRUE, now() - INTERVAL '60 days');

-- A session THIS month, fully marked (one active enrolment, one attendance row).
INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('44000000-0000-0000-0000-00000000a5e1','44000000-0000-0000-0000-00000000a5c1',
        date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))::date, 'completed');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('44000000-0000-0000-0000-00000000a5e1','44000000-0000-0000-0000-00000000a5a1',
        'present','44000000-0000-0000-0000-0000000000a2');

-- A rate for A's coach, none for B's → coaches_without_rate distinguishes them.
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from)
SELECT c.id, 30, 60, '2000-01-01' FROM coaches c
WHERE c.profile_id = '44000000-0000-0000-0000-0000000000a2';

-- ══ AUTHORIZATION — the reason this file exists ═════════════════════════════
SET LOCAL ROLE authenticated;

-- 1. A PARENT gets nothing.
SET LOCAL "request.jwt.claims" TO '{"sub":"44000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
SELECT is((SELECT COUNT(*)::INT FROM platform_tenant_overview()), 0,
  'a parent gets ZERO rows from platform_tenant_overview');
SELECT is((SELECT COUNT(*)::INT FROM platform_stranded_parents()), 0,
  'a parent gets ZERO rows from platform_stranded_parents');

-- 2. A COACH gets nothing.
SET LOCAL "request.jwt.claims" TO '{"sub":"44000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT is((SELECT COUNT(*)::INT FROM platform_tenant_overview()), 0,
  'a coach gets ZERO rows');

-- 3. A TENANT ADMIN gets nothing — not even their OWN row. This function is a
--    platform tool; their own business is what every other page already shows.
SET LOCAL "request.jwt.claims" TO '{"sub":"44000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is((SELECT COUNT(*)::INT FROM platform_tenant_overview()), 0,
  'a TENANT ADMIN gets zero rows — including their own tenant');
SELECT is((SELECT COUNT(*)::INT FROM platform_stranded_parents()), 0,
  'a tenant admin gets zero stranded parents');

-- 4. The PLATFORM ADMIN sees every tenant.
SET LOCAL "request.jwt.claims" TO '{"sub":"44000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
SELECT ok((SELECT COUNT(*) FROM platform_tenant_overview()) >= 2,
  'the platform admin sees at least both seeded tenants');

-- ══ THE NUMBERS ARE PER TENANT, NOT SUMMED ═════════════════════════════════
-- The whole point of the page: a count that leaked across the boundary would
-- show B's students on A's row.
SELECT is(
  (SELECT active_students FROM platform_tenant_overview()
     WHERE tenant_id = '44444444-0000-0000-0000-000000000001'), 1,
  'tenant A reports its own single student');
SELECT is(
  (SELECT active_students FROM platform_tenant_overview()
     WHERE tenant_id = '44444444-0000-0000-0000-000000000002'), 0,
  'tenant B reports ZERO students — not A''s');
SELECT is(
  (SELECT active_classes FROM platform_tenant_overview()
     WHERE tenant_id = '44444444-0000-0000-0000-000000000002'), 1,
  'tenant B reports its own class');
SELECT is(
  (SELECT coaches FROM platform_tenant_overview()
     WHERE tenant_id = '44444444-0000-0000-0000-000000000001'), 1,
  'tenant A reports one coach, not both tenants'' coaches');

-- ══ "NEVER" MUST BE NULL, NOT A DATE AND NOT ZERO ══════════════════════════
-- The cell that would have shown production has never had a lesson marked. If
-- this ever returns 1970-01-01 or a zero, the UI renders a fact that is false.
SELECT is(
  (SELECT last_attendance_date FROM platform_tenant_overview()
     WHERE tenant_id = '44444444-0000-0000-0000-000000000002'), NULL::date,
  'a tenant that has never marked attendance reports NULL, not a date');
SELECT isnt(
  (SELECT last_attendance_date FROM platform_tenant_overview()
     WHERE tenant_id = '44444444-0000-0000-0000-000000000001'), NULL::date,
  'a tenant WITH attendance reports a real date (so the NULL above means something)');

-- ══ SESSION COUNTS ARE FACTS ABOUT ROWS THAT EXIST ═════════════════════════
SELECT is(
  (SELECT sessions_this_month FROM platform_tenant_overview()
     WHERE tenant_id = '44444444-0000-0000-0000-000000000001'), 1,
  'tenant A reports its one session this month');
SELECT is(
  (SELECT sessions_fully_marked FROM platform_tenant_overview()
     WHERE tenant_id = '44444444-0000-0000-0000-000000000001'), 1,
  'that session counts as fully marked — its only active enrolment has a row');
SELECT is(
  (SELECT sessions_this_month FROM platform_tenant_overview()
     WHERE tenant_id = '44444444-0000-0000-0000-000000000002'), 0,
  'tenant B reports no sessions — its lessons were never recorded');

-- ══ COACHES WITHOUT A RATE ═════════════════════════════════════════════════
SELECT is(
  (SELECT coaches_without_rate FROM platform_tenant_overview()
     WHERE tenant_id = '44444444-0000-0000-0000-000000000001'), 0,
  'tenant A''s coach has a rate');
SELECT is(
  (SELECT coaches_without_rate FROM platform_tenant_overview()
     WHERE tenant_id = '44444444-0000-0000-0000-000000000002'), 1,
  'tenant B''s coach has none — payroll would silently compute nothing');

-- ══ BILLING STATE distinguishes "never run" from "open" ════════════════════
SELECT is(
  (SELECT last_month_billing FROM platform_tenant_overview()
     WHERE tenant_id = '44444444-0000-0000-0000-000000000001'), 'never run',
  'a month never generated reads "never run", not "open"');

-- ══ STRANDED PARENTS ═══════════════════════════════════════════════════════
-- Registered, never entered a join code: invisible to every business today.
SELECT ok(
  EXISTS (SELECT 1 FROM platform_stranded_parents()
            WHERE email = 'pov-stranded@test.local'),
  'a parent with no business at all is surfaced');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM platform_stranded_parents()
                WHERE email = 'pov-parentA@test.local'),
  'a parent who HAS joined a business is not listed as stranded');

SELECT * FROM finish();
ROLLBACK;
