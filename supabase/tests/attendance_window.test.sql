-- pgTAP: THE ATTENDANCE WINDOW AS A RULE.
-- guard_session_date(), guard_attendance_date(), schedule_extra_lesson().
--
-- WHY THE UPSERT ASSERTIONS (13-17) ARE THE MOST IMPORTANT IN THIS FILE.
-- The coach's save is
--   .upsert(rows, { onConflict: "lesson_session_id,student_id" })
-- which PostgREST emits as INSERT … ON CONFLICT DO UPDATE — and Postgres runs
-- BEFORE INSERT triggers for EVERY candidate row, before the conflict is
-- detected. Confirmed empirically, not reasoned about. So a guard written as
-- "INSERT only" silently governs UPDATES too, and would refuse every
-- correction to an already-invoiced lesson: the credit-note flow (PRD §7.8),
-- which is the exact feature the INSERT/UPDATE split exists to protect.
-- Worse, the save sends every student in ONE statement, so a single refused
-- row fails the whole class's save. Test 16 is the one that catches that: a
-- refusal that half-wrote is not a refusal.
--
-- WHY THE DATES ARE COMPUTED, NOT HARDCODED. The rule under test IS relative
-- to now(), so a fixed date would mean something different next month — the
-- disease §7.33 describes. Every date here derives from ONE anchor (`d_in`,
-- three days ago) so the four cases stay in a known relationship whatever day
-- this runs. The anchor is computed with the SGT expression written out in
-- full rather than by calling today_sg(), so a bug in that function cannot
-- move the fixture to match itself; test 1 pins the function separately.
--
-- METHOD (gotcha §7.16): every probe runs inside this explicit transaction
-- with SET LOCAL ROLE. Outside one, SET LOCAL ROLE is a no-op, the session
-- stays superuser, RLS is bypassed and every assertion "passes" — including
-- the ones that must fail. Each refusal also asserts NOTHING WAS WRITTEN: a
-- gate that raises after writing is not a gate.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(31);

-- ── The four dates, from one anchor ─────────────────────────────────────────
--   d_in       three days ago            in window, on the class's weekday
--   d_old      20 weeks before that      SAME weekday, far below the floor
--   d_future   a week after the anchor   SAME weekday, ahead of today
--   d_wrongday two days ago              in window, DIFFERENT weekday
--
-- d_old is 140 days back because the floor can be as much as ~62 days back
-- (the 1st of last month, evaluated on the last day of this one). Keeping it a
-- whole number of weeks holds the weekday constant, so tests 3 and 4 isolate
-- the window rule from the weekday rule instead of tripping both at once.
CREATE TEMP TABLE w AS
SELECT
  ((now() AT TIME ZONE 'Asia/Singapore')::date - 3)       AS d_in,
  ((now() AT TIME ZONE 'Asia/Singapore')::date - 3 - 140) AS d_old,
  ((now() AT TIME ZONE 'Asia/Singapore')::date - 3 + 7)   AS d_future,
  ((now() AT TIME ZONE 'Asia/Singapore')::date - 2)       AS d_wrongday,
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '1 month')::date                          AS d_floor;
GRANT SELECT ON w TO PUBLIC;

-- ── Two businesses, so the tenant boundary can be probed ────────────────────
INSERT INTO tenants (id, slug, display_name, kind, join_code) VALUES
  ('77777777-0000-0000-0000-000000000001','win-a','WINDOW Business A','school','SWIM-WINA'),
  ('77777777-0000-0000-0000-000000000002','win-b','WINDOW Business B','school','SWIM-WINB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','77100000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','win-admin-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"WINDOW Admin A","role":"tenant_admin","tenant_id":"77777777-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','77100000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','win-admin-b@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"WINDOW Admin B","role":"tenant_admin","tenant_id":"77777777-0000-0000-0000-000000000002"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','77100000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','win-coach-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"WINDOW Coach A","role":"coach","tenant_id":"77777777-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','77100000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','win-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"WINDOW Parent","role":"parent"}', now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM class_categories c
    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

-- The class runs on d_in's weekday, so d_in is a real lesson date and
-- d_wrongday is not.
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                     end_time, location_name, price_per_lesson, category_id)
SELECT
  '77777777-1111-0000-0000-000000000001','77777777-0000-0000-0000-000000000001',
  (SELECT id FROM coaches WHERE profile_id='77100000-0000-0000-0000-0000000000c1'),
  'WINDOW Class A',
  (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    )[EXTRACT(DOW FROM w.d_in)::int + 1]::day_of_week,
  '10:00','11:00','Pool A', 30,
  (SELECT id FROM class_categories
    WHERE tenant_id='77777777-0000-0000-0000-000000000001'
      AND lower(trim(name))='default group')
FROM w;

INSERT INTO students (id, full_name, assignment_status, tenant_id) VALUES
  ('77500000-0000-0000-0000-000000000001','Window Kid','assigned','77777777-0000-0000-0000-000000000001'),
  ('77500000-0000-0000-0000-000000000002','Window Kid Two','assigned','77777777-0000-0000-0000-000000000001');
INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
  ('77500000-0000-0000-0000-000000000001','77777777-1111-0000-0000-000000000001', TRUE),
  ('77500000-0000-0000-0000-000000000002','77777777-1111-0000-0000-000000000001', TRUE);

-- An ALREADY-INVOICED lesson, far outside the window, with ONE student marked.
-- Written here as postgres — which is the point of the seam: a fixture builds
-- the past that the rule is about. Student One has a row; Student Two does not.
INSERT INTO lesson_sessions (id, class_id, session_date)
SELECT '77400000-0000-0000-0000-00000000000a','77777777-1111-0000-0000-000000000001', w.d_old FROM w;
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('77400000-0000-0000-0000-00000000000a','77500000-0000-0000-0000-000000000001',
   'present','77100000-0000-0000-0000-0000000000c1');

-- SCOPED TO THIS CLASS ON PURPOSE. A bare COUNT(*) here would be taken as
-- postgres, which sees every row, and compared later under SET LOCAL ROLE,
-- where RLS shows the coach only their own classes' sessions — so the two
-- numbers would be counting different things and the assertion would fail
-- whatever the guard did. Scope both sides to the same rows.
CREATE TEMP TABLE win_baseline AS
  SELECT (SELECT COUNT(*)::INT FROM lesson_sessions
           WHERE class_id = '77777777-1111-0000-0000-000000000001') AS sessions;
-- Read back under SET LOCAL ROLE, so it needs its own grant like `w` above.
GRANT SELECT ON win_baseline TO PUBLIC;


-- ══ 1-2. The clock, pinned independently of the fixture ═════════════════════

SELECT is(
  (SELECT session_window_start()),
  (SELECT d_floor FROM w),
  'session_window_start() is the 1st of last month in Singapore time');

SELECT ok(
  (SELECT session_window_start() < today_sg()),
  'the floor is strictly before today — a window that has collapsed would let nothing through');


-- ══ 3-7. lesson_sessions: the coach may only create a real lesson ═══════════

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"77100000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- 3. Wrong weekday, comfortably inside the window. This is the phantom lesson:
--    a session on a day the class does not run, billed like any other.
SELECT throws_ok(
  $$ INSERT INTO lesson_sessions (class_id, session_date)
     SELECT '77777777-1111-0000-0000-000000000001', d_wrongday FROM w $$,
  'P0001',
  NULL,
  'a coach cannot create a session on a day the class does not run');

-- 4. Right weekday, below the floor. That lesson sits behind an invoice
--    already sent, so a late mark would record something that can never bill.
SELECT throws_ok(
  $$ INSERT INTO lesson_sessions (class_id, session_date)
     SELECT '77777777-1111-0000-0000-000000000001', d_old FROM w $$,
  'P0001',
  NULL,
  'a coach cannot create a session below the window floor');

-- 5. Right weekday, in the future.
SELECT throws_ok(
  $$ INSERT INTO lesson_sessions (class_id, session_date)
     SELECT '77777777-1111-0000-0000-000000000001', d_future FROM w $$,
  'P0001',
  NULL,
  'a coach cannot create a session for a lesson that has not happened yet');

-- 6. Nothing was written by any of the three. A gate that raises after writing
--    is not a gate.
SELECT is(
  (SELECT COUNT(*)::INT FROM lesson_sessions
    WHERE class_id = '77777777-1111-0000-0000-000000000001'),
  (SELECT sessions FROM win_baseline),
  'lesson_sessions did not grow across the three refusals');

-- 7. The legitimate case still works, or the guard has simply broken marking.
SELECT lives_ok(
  $$ INSERT INTO lesson_sessions (id, class_id, session_date)
     SELECT '77400000-0000-0000-0000-00000000000b','77777777-1111-0000-0000-000000000001', d_in FROM w $$,
  'a coach CAN create a session on a real lesson date inside the window');


-- ══ 8-10. off_schedule_reason is the admin's authorisation, not the coach's ══

SELECT throws_ok(
  $$ INSERT INTO lesson_sessions (class_id, session_date, off_schedule_reason)
     SELECT '77777777-1111-0000-0000-000000000001', d_wrongday, 'I say so' FROM w $$,
  'P0001',
  NULL,
  'a coach cannot self-authorise an off-schedule lesson by supplying a reason');

SELECT throws_ok(
  $$ UPDATE lesson_sessions SET off_schedule_reason = 'retrofitted'
      WHERE id = '77400000-0000-0000-0000-00000000000b' $$,
  'P0001',
  NULL,
  'a coach cannot add a reason to an existing session');

SELECT is(
  (SELECT off_schedule_reason FROM lesson_sessions WHERE id='77400000-0000-0000-0000-00000000000b'),
  NULL,
  'and the column is still NULL — the refusal did not half-write');


-- ══ 11-12. The seam: a fixture and the engine are not clients ═══════════════

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$ INSERT INTO lesson_sessions (id, class_id, session_date)
     SELECT '77400000-0000-0000-0000-00000000000c','77777777-1111-0000-0000-000000000001', d_old - 7 FROM w $$,
  'service_role is exempt — the billing engine and fixtures construct the past the rule is about');

RESET ROLE;
SELECT lives_ok(
  $$ INSERT INTO lesson_sessions (id, class_id, session_date)
     SELECT '77400000-0000-0000-0000-00000000000d','77777777-1111-0000-0000-000000000001', d_old - 14 FROM w $$,
  'postgres is exempt — otherwise every pgTAP fixture would have to date itself against the wall clock (§7.33)');


-- ══ 13-17. THE UPSERT ASSERTIONS — see the header ═══════════════════════════

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"77100000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- 13. A NEW charge on an out-of-window lesson. This is the Aisha case: a child
--     who joined later being marked onto a lesson they were never at, in a
--     month that has already been billed — so the row would never bill and
--     nothing would flag it.
SELECT throws_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     VALUES ('77400000-0000-0000-0000-00000000000a','77500000-0000-0000-0000-000000000002',
             'present','77100000-0000-0000-0000-0000000000c1') $$,
  'P0001',
  NULL,
  'a NEW attendance row on an out-of-window lesson is refused');

-- 14. A plain UPDATE of an existing row on that same lesson. This is the
--     credit-note path and it MUST still work.
SELECT lives_ok(
  $$ UPDATE attendance SET status = 'absent'
      WHERE lesson_session_id = '77400000-0000-0000-0000-00000000000a'
        AND student_id = '77500000-0000-0000-0000-000000000001' $$,
  'an UPDATE of an existing row on an out-of-window lesson still works (credit-note flow)');

-- 15. The same correction as the app actually sends it: ON CONFLICT DO UPDATE.
--     A guard that only understood plain UPDATE would refuse this and break
--     every correction made through the real screen.
SELECT lives_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     VALUES ('77400000-0000-0000-0000-00000000000a','77500000-0000-0000-0000-000000000001',
             'present','77100000-0000-0000-0000-0000000000c1')
     ON CONFLICT (lesson_session_id, student_id)
     DO UPDATE SET status = EXCLUDED.status $$,
  'an ON CONFLICT DO UPDATE over an existing row is a correction, not a new charge');

-- 16. The real shape of the coach's save: every student in ONE statement, one
--     of them already marked and one not. The statement must fail as a whole.
SELECT throws_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     VALUES ('77400000-0000-0000-0000-00000000000a','77500000-0000-0000-0000-000000000001',
             'absent','77100000-0000-0000-0000-0000000000c1'),
            ('77400000-0000-0000-0000-00000000000a','77500000-0000-0000-0000-000000000002',
             'present','77100000-0000-0000-0000-0000000000c1')
     ON CONFLICT (lesson_session_id, student_id)
     DO UPDATE SET status = EXCLUDED.status $$,
  'P0001',
  NULL,
  'a mixed upsert (one existing, one new) on an out-of-window lesson is refused');

-- 17. …and the existing row still holds the value test 15 left. Without this
--     the previous test passes on a guard that let the first row through.
SELECT is(
  (SELECT status::TEXT FROM attendance
    WHERE lesson_session_id='77400000-0000-0000-0000-00000000000a'
      AND student_id='77500000-0000-0000-0000-000000000001'),
  'present',
  'and the existing row is UNCHANGED — the refusal rolled the whole statement back');


-- ══ 18-19. Marking inside the window is untouched ═══════════════════════════

SELECT lives_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     VALUES ('77400000-0000-0000-0000-00000000000b','77500000-0000-0000-0000-000000000001',
             'present','77100000-0000-0000-0000-0000000000c1') $$,
  'a coach CAN mark a lesson inside the window');

SELECT is(
  (SELECT COUNT(*)::INT FROM attendance
    WHERE lesson_session_id='77400000-0000-0000-0000-00000000000a'),
  1,
  'the out-of-window lesson still has exactly the one row it started with');


-- ══ 20-27. schedule_extra_lesson: the admin arranges, the coach observes ════

-- 20. A parent cannot.
SET LOCAL "request.jwt.claims" TO '{"sub":"77100000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT schedule_extra_lesson('77777777-1111-0000-0000-000000000001',
       (SELECT d_wrongday FROM w), 'parent says so') $$,
  'only this business''s admin may schedule an extra lesson',
  'a PARENT cannot schedule an extra lesson');

-- 21. Nor can the COACH — this is the decision the user drew explicitly:
--     marking is the coach's, arranging is the admin's.
SET LOCAL "request.jwt.claims" TO '{"sub":"77100000-0000-0000-0000-0000000000c1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT schedule_extra_lesson('77777777-1111-0000-0000-000000000001',
       (SELECT d_wrongday FROM w), 'coach says so') $$,
  'only this business''s admin may schedule an extra lesson',
  'a COACH cannot schedule an extra lesson — arranging is the admin''s job');

-- 22. Nor the admin of ANOTHER business, holding a real class id. The RPC is
--     SECURITY DEFINER, so this check is the whole boundary (§7.42).
SET LOCAL "request.jwt.claims" TO '{"sub":"77100000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT schedule_extra_lesson('77777777-1111-0000-0000-000000000001',
       (SELECT d_wrongday FROM w), 'other business') $$,
  'only this business''s admin may schedule an extra lesson',
  'the admin of ANOTHER business cannot schedule into this one''s class');

SELECT is(
  (SELECT COUNT(*)::INT FROM lesson_sessions
    WHERE class_id='77777777-1111-0000-0000-000000000001'
      AND session_date = (SELECT d_wrongday FROM w)),
  0,
  'and none of those three refusals created a session');

-- 24-27. The admin can, and the rules that still bind them.
SET LOCAL "request.jwt.claims" TO '{"sub":"77100000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT schedule_extra_lesson('77777777-1111-0000-0000-000000000001',
       (SELECT d_wrongday FROM w), '   ') $$,
  'a reason is required — it is what tells the coach why this lesson exists',
  'a blank reason is refused — an unexplained lesson on the roster is a puzzle for the coach');

SELECT throws_ok(
  $$ SELECT schedule_extra_lesson('77777777-1111-0000-0000-000000000001',
       (SELECT d_old FROM w), 'too late') $$,
  'P0001',
  NULL,
  'the admin cannot add a lesson into a month that has already been billed');

SELECT lives_ok(
  $$ SELECT schedule_extra_lesson('77777777-1111-0000-0000-000000000001',
       (SELECT d_wrongday FROM w), 'Makeup for the public holiday') $$,
  'the admin CAN schedule a lesson on a day the class does not normally run');

SELECT lives_ok(
  $$ SELECT schedule_extra_lesson('77777777-1111-0000-0000-000000000001',
       (SELECT d_future FROM w), 'Makeup, arranged ahead') $$,
  'the admin CAN schedule a FUTURE lesson — a makeup is arranged, like a trial booking');


-- ══ 28-29. Idempotency: a duplicate (class, date) double-bills a class ══════

SELECT lives_ok(
  $$ SELECT schedule_extra_lesson('77777777-1111-0000-0000-000000000001',
       (SELECT d_wrongday FROM w), 'Makeup for the public holiday') $$,
  'scheduling the same extra lesson twice is a no-op, not an error');

SELECT is(
  (SELECT COUNT(*)::INT FROM lesson_sessions
    WHERE class_id='77777777-1111-0000-0000-000000000001'
      AND session_date = (SELECT d_wrongday FROM w)),
  1,
  'and there is exactly ONE session for that date — a duplicate would double-bill the whole class (§7.7)');


-- ══ 30-31. The point of the whole feature: the coach can mark it ════════════

SELECT is(
  (SELECT off_schedule_reason FROM lesson_sessions
    WHERE class_id='77777777-1111-0000-0000-000000000001'
      AND session_date = (SELECT d_wrongday FROM w)),
  'Makeup for the public holiday',
  'the reason is recorded on the session, so the coach is told why it exists');

SET LOCAL "request.jwt.claims" TO '{"sub":"77100000-0000-0000-0000-0000000000c1","role":"authenticated"}';
SELECT lives_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     SELECT ls.id, '77500000-0000-0000-0000-000000000001','present','77100000-0000-0000-0000-0000000000c1'
       FROM lesson_sessions ls, w
      WHERE ls.class_id='77777777-1111-0000-0000-000000000001'
        AND ls.session_date = w.d_wrongday $$,
  'the COACH can mark the admin''s off-schedule lesson — the weekday rule does not bind attendance');

SELECT * FROM finish();
ROLLBACK;
