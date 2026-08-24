-- pgTAP: ADVANCE-CANCEL A LESSON — cancel_lesson / restore_lesson and every
-- guard 20260821000700 touches (plan UPCOMING_LESSONS_COMPLETE_PLAN.md §B1).
--
-- THE THREE LOAD-BEARING PINS (plan pre-commit gate — a month's revenue rides on each):
--   RISK 2  cancel refuses today/past and a marked session; restore refuses a
--           month sealed in billing_periods.
--   RISK 3  cancel refuses, NAMING them, while live guests sit on the date;
--           book_trial / schedule_extra_lesson refuse a cancelled date.
--   RISK 4  a RAW attendance INSERT on a cancelled session is refused by
--           guard_attendance_date() — including a PAST cancelled session, the
--           stale-coach-screen case that the old trigger body would have let
--           through (that assertion is the red-first proof of this file).
-- Plus: the two SQL copies of "owed a mark" skip a cancelled session, the
-- holiday void leaves one alone, the client cannot write the cancel columns,
-- and the grants are exactly authenticated-only.
--
-- DATES ARE RELATIVE TO today_sg() (§7.7, §7.33): d_fut = today+7, d_fut2 =
-- today+14 (both the SAME weekday as today), d_past = today-7 — always inside
-- a never-sealed tenant's markable_floor (the 1st of last month, ≥ 28 days
-- back). Class A runs on TODAY's weekday; Class B on tomorrow's, so "a day
-- the class does not meet" is expressible without a fixed calendar.
--
-- METHOD (§7.16): every role probe runs inside this transaction with SET LOCAL
-- ROLE — outside one it is a no-op and every refusal "passes". Each refusal
-- also asserts nothing was written. Rolls back.
--
-- MEASURED (§7.25): against the schema at 20260821000600 this file dies at the
-- first cancel_lesson() call (no such function). With the NEW RPCs present but
-- the OLD guard_attendance_date() body, assertion "RISK 4 (past)" goes red: the
-- raw INSERT on the past cancelled session SUCCEEDS. With the old
-- class_unmarked_lesson_dates / tenant_unmarked_lesson_count / mark_day_holiday
-- / unmark_day_holiday bodies, their assertions go red on the counts named.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(37);

-- ── Fixture ─────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('ac000000-0000-0000-0000-000000000001','acl','Advance Cancel','SWIM-ACL1');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','ac100000-0000-0000-0000-000000000001',
   'authenticated','authenticated','acl-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"ACL Admin","role":"tenant_admin","is_coach":true,"tenant_id":"ac000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ac200000-0000-0000-0000-000000000002',
   'authenticated','authenticated','acl-stranger@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"ACL Stranger","role":"parent"}',
   now(), now(), '','','','');

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('ac300000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001','G');

-- Class A runs on TODAY's weekday (so today±7, +14 are lesson days); its times
-- are 00:00–00:01 so today's lesson always counts as ENDED for the badge count.
-- Class B runs on TOMORROW's weekday and never meets on d_fut.
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
SELECT x.id, co.id, x.title, x.dow::day_of_week, '00:00', '00:01', (SELECT l.id FROM locations l WHERE l.tenant_id = co.tenant_id AND lower(trim(l.name)) = 'default location'), 50.00,
       'ac300000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
CROSS JOIN (VALUES
  ('ac400000-0000-0000-0000-000000000001'::uuid, 'Class A',
   (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[EXTRACT(DOW FROM today_sg())::int + 1]),
  ('ac400000-0000-0000-0000-000000000002'::uuid, 'Class B',
   (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[EXTRACT(DOW FROM today_sg() + 1)::int + 1])
) AS x(id, title, dow)
WHERE pr.email = 'acl-admin@test.local';

INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by) VALUES
  ('ac500000-0000-0000-0000-000000000001','ACL Kid','2018-05-05','assigned',
   'ac000000-0000-0000-0000-000000000001','ac100000-0000-0000-0000-000000000001'),
  ('ac500000-0000-0000-0000-000000000002','ACL Guest','2019-06-06','unassigned',
   'ac000000-0000-0000-0000-000000000001','ac100000-0000-0000-0000-000000000001');

-- The kid's enrolment OPENS on d_past, so the only pattern dates they are
-- expected at inside the window are d_past and today.
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
VALUES ('ac500000-0000-0000-0000-000000000001','ac400000-0000-0000-0000-000000000001', true, today_sg() - 7);

-- A live TRIAL guest on Class A at d_fut — the RISK 3 fixture.
INSERT INTO trial_bookings (id, tenant_id, student_id, class_id, session_date, category_id, booked_by)
VALUES ('ac600000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000001',
        'ac500000-0000-0000-0000-000000000002','ac400000-0000-0000-0000-000000000001',
        today_sg() + 7, 'ac300000-0000-0000-0000-000000000001','ac100000-0000-0000-0000-000000000001');

-- ── 1. Authz: a non-admin cannot cancel ──────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ac200000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT throws_like(
  $$ SELECT cancel_lesson('ac400000-0000-0000-0000-000000000001', today_sg() + 7, 'rain') $$,
  '%admin may cancel%', '1. a stranger cannot cancel a lesson');

-- ── 2-5. The admin's refusals (RISK 2, and nothing-to-cancel) ───────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"ac100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_like(
  $$ SELECT cancel_lesson('ac400000-0000-0000-0000-000000000001', today_sg() - 7, 'rain') $$,
  '%has not happened yet%', '2. RISK 2: a PAST lesson cannot be advance-cancelled');
SELECT throws_like(
  $$ SELECT cancel_lesson('ac400000-0000-0000-0000-000000000001', today_sg(), 'rain') $$,
  '%has not happened yet%', '3. RISK 2: TODAY cannot be advance-cancelled (the coach''s mark is that path)');
SELECT throws_like(
  $$ SELECT cancel_lesson('ac400000-0000-0000-0000-000000000001', today_sg() + 7, '  ') $$,
  '%reason is required%', '4. a reason is required');
SELECT throws_like(
  $$ SELECT cancel_lesson('ac400000-0000-0000-0000-000000000002', today_sg() + 7, 'rain') $$,
  '%runs on%', '5. a day the class does not meet has nothing to cancel');

-- ── 6. RISK 3: live guests are NAMED and refused ─────────────────────────────
SELECT throws_like(
  $$ SELECT cancel_lesson('ac400000-0000-0000-0000-000000000001', today_sg() + 7, 'rain') $$,
  '%guests booked: ACL Guest (trial)%', '6. RISK 3: a date holding a live trial guest is refused, naming the child');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM lesson_sessions WHERE class_id = 'ac400000-0000-0000-0000-000000000001'),
  0, '7. …and every refusal above wrote NO session row');

-- Admin moves the guest (cancels the booking), then cancels the lesson.
UPDATE trial_bookings SET cancelled_at = now(), cancelled_by = 'ac100000-0000-0000-0000-000000000001'
 WHERE id = 'ac600000-0000-0000-0000-000000000001';

-- ── 8-10. The cancel lands; idempotent ───────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ac100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT isnt(cancel_lesson('ac400000-0000-0000-0000-000000000001', today_sg() + 7, ' rain forecast '),
  NULL, '8. the admin cancels a future lesson');
SELECT is(
  (SELECT cancel_lesson('ac400000-0000-0000-0000-000000000001', today_sg() + 7, 'again')),
  (SELECT id FROM lesson_sessions WHERE class_id = 'ac400000-0000-0000-0000-000000000001' AND session_date = today_sg() + 7),
  '9. cancelling twice is idempotent — same session id, no error');
RESET ROLE;
SELECT is(
  (SELECT status::text || ':' || (cancelled_at IS NOT NULL)::text || ':' || cancellation_reason || ':'
          || (cancelled_by = 'ac100000-0000-0000-0000-000000000001')::text
     FROM lesson_sessions WHERE class_id = 'ac400000-0000-0000-0000-000000000001' AND session_date = today_sg() + 7),
  'cancelled:true:rain forecast:true',
  '10. the row carries status=cancelled, cancelled_at, the trimmed reason (first call''s) and the actor');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'lesson_cancelled'
             AND entity_id = (SELECT id FROM lesson_sessions WHERE class_id = 'ac400000-0000-0000-0000-000000000001' AND session_date = today_sg() + 7)),
  1, '11. exactly one lesson_cancelled audit row (the idempotent repeat wrote none)');

-- ── 12-13. RISK 3 symmetric: nothing books INTO a cancelled date ─────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ac100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_like(
  $$ SELECT book_trial('ac400000-0000-0000-0000-000000000001', today_sg() + 7, 'ac500000-0000-0000-0000-000000000002') $$,
  '%has been cancelled%', '12. RISK 3: book_trial refuses a cancelled (class, date)');
SELECT throws_like(
  $$ SELECT schedule_extra_lesson('ac400000-0000-0000-0000-000000000001', today_sg() + 7, 'cover') $$,
  '%was cancelled%', '13. RISK 3: schedule_extra_lesson refuses to schedule over a cancellation');

-- ── 14-15. RISK 4 (future): a raw attendance INSERT is refused by the trigger ─
SELECT throws_like(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     SELECT id, 'ac500000-0000-0000-0000-000000000001', 'present', 'ac100000-0000-0000-0000-000000000001'
       FROM lesson_sessions WHERE class_id = 'ac400000-0000-0000-0000-000000000001' AND session_date = today_sg() + 7 $$,
  '%cancelled by your business%', '14. RISK 4: a raw INSERT on a cancelled session is refused, and the message says WHY (not "not happened yet")');

-- ── 16. The client cannot clear the flag (guard_session_date) ────────────────
SELECT throws_like(
  $$ UPDATE lesson_sessions SET cancelled_at = NULL, cancelled_by = NULL, cancellation_reason = NULL, status = 'scheduled'
      WHERE class_id = 'ac400000-0000-0000-0000-000000000001' AND session_date = today_sg() + 7 $$,
  '%cancelled or restored by your business%', '15. a client (even the admin, raw) cannot clear the cancel columns');
SELECT throws_like(
  $$ INSERT INTO lesson_sessions (class_id, session_date, status, cancelled_at, cancellation_reason)
     VALUES ('ac400000-0000-0000-0000-000000000001', today_sg() + 21, 'cancelled', now(), 'self-service') $$,
  '%cancelled or restored by your business%', '16. a client cannot self-authorise a cancellation on INSERT');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM attendance a JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
            WHERE ls.class_id = 'ac400000-0000-0000-0000-000000000001'),
  0, '17. …and none of those refusals wrote an attendance row');

-- ── 18. The CHECK keeps status and cancelled_at coherent, even for a superuser ─
SELECT throws_ok(
  $$ UPDATE lesson_sessions SET status = 'scheduled'
      WHERE class_id = 'ac400000-0000-0000-0000-000000000001' AND session_date = today_sg() + 7 $$,
  '23514', NULL, '18. status cannot drift from cancelled_at — the CHECK refuses even a superuser');
UPDATE lesson_sessions SET session_date = today_sg() - 7
 WHERE class_id = 'ac400000-0000-0000-0000-000000000001' AND session_date = today_sg() + 7;
-- ^ the cancelled session is now IN THE PAST — the stale-coach-screen shape.
--   Moved as the superuser (guard_session_date exempts postgres); cancel_lesson
--   itself can never create this, which is the point: the engine and the
--   triggers must not depend on it being unreachable.

-- ── 19. RISK 4 (PAST) — the red-first assertion of this file ────────────────
-- On the pre-20260821000700 guard body this INSERT SUCCEEDS: the date is past,
-- above the floor, and the old trigger knew nothing about cancellation.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ac100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_like(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     SELECT id, 'ac500000-0000-0000-0000-000000000001', 'present', 'ac100000-0000-0000-0000-000000000001'
       FROM lesson_sessions WHERE class_id = 'ac400000-0000-0000-0000-000000000001' AND session_date = today_sg() - 7 $$,
  '%cancelled by your business%', '19. RISK 4: a PAST cancelled session (stale screen / deep link / raw POST) still refuses a new mark');

-- ── 20-21. The two SQL copies of "owed a mark" skip the cancelled date ───────
-- Expected WITHOUT the change: d_past AND today (both unmarked pattern dates the
-- kid is enrolled for). With it: today only — the cancelled d_past expects nobody.
-- As the superuser: class_unmarked_lesson_dates is EXECUTE-able by nobody
-- (reached only through SECURITY DEFINER callers). The admin JWT claim stays
-- set, which is what tenant_unmarked_lesson_count's can_admin_tenant gate reads.
RESET ROLE;
SELECT is(class_unmarked_lesson_dates('ac400000-0000-0000-0000-000000000001'),
  ARRAY[today_sg()]::date[], '20. class_unmarked_lesson_dates skips the cancelled date (today remains)');
SELECT is(tenant_unmarked_lesson_count('ac000000-0000-0000-0000-000000000001'),
  1, '21. tenant_unmarked_lesson_count skips the cancelled date (today remains — class ends 00:01)');

-- ── 22-24. restore_lesson refusals ───────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ac200000-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT throws_like(
  $$ SELECT restore_lesson('ac400000-0000-0000-0000-000000000001', today_sg() - 7) $$,
  '%admin may restore%', '22. a stranger cannot restore a lesson');
SET LOCAL "request.jwt.claims" TO '{"sub":"ac100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_like(
  $$ SELECT restore_lesson('ac400000-0000-0000-0000-000000000001', today_sg() + 7) $$,
  '%no cancelled lesson%', '23. restoring a date that is not cancelled is refused');
RESET ROLE;
-- Seal the month the cancelled lesson sits in.
INSERT INTO billing_periods (tenant_id, billing_month, invoices_issued)
VALUES ('ac000000-0000-0000-0000-000000000001', to_char(today_sg() - 7, 'YYYY-MM'), 0);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ac100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_like(
  $$ SELECT restore_lesson('ac400000-0000-0000-0000-000000000001', today_sg() - 7) $$,
  '%already been billed%', '24. RISK 2: restoring INTO a sealed month is refused (§11.6)');
RESET ROLE;
DELETE FROM billing_periods WHERE tenant_id = 'ac000000-0000-0000-0000-000000000001';

-- ── 25-28. restore lands, and the lesson is a lesson again ───────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ac100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT isnt(restore_lesson('ac400000-0000-0000-0000-000000000001', today_sg() - 7),
  NULL, '25. the admin restores the cancelled lesson');
RESET ROLE;
SELECT is(class_unmarked_lesson_dates('ac400000-0000-0000-0000-000000000001'),
  ARRAY[today_sg() - 7, today_sg()]::date[], '26. …and it is owed a mark again');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     SELECT id, 'ac500000-0000-0000-0000-000000000001', 'present', 'ac100000-0000-0000-0000-000000000001'
       FROM lesson_sessions WHERE class_id = 'ac400000-0000-0000-0000-000000000001' AND session_date = today_sg() - 7 $$,
  '27. …and can be marked again (the trigger no longer refuses)');
RESET ROLE;
SELECT is(
  (SELECT status::text || ':' || (cancelled_at IS NULL)::text || ':' || (cancellation_reason IS NULL)::text || ':' || (cancelled_by IS NULL)::text
     FROM lesson_sessions WHERE class_id = 'ac400000-0000-0000-0000-000000000001' AND session_date = today_sg() - 7),
  'scheduled:true:true:true', '28. the restored row is a plain scheduled session');
SELECT is((SELECT count(*)::int FROM audit_log WHERE action = 'lesson_restored'), 1, '29. one lesson_restored audit row');

-- ── 30. A MARKED session cannot be cancelled (RISK 2) ────────────────────────
-- The restored d_past session now has a 'present' row. Give it a future date as
-- the superuser so only the attendance refusal can fire.
UPDATE lesson_sessions SET session_date = today_sg() + 7
 WHERE class_id = 'ac400000-0000-0000-0000-000000000001' AND session_date = today_sg() - 7;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ac100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_like(
  $$ SELECT cancel_lesson('ac400000-0000-0000-0000-000000000001', today_sg() + 7, 'rain') $$,
  '%already been recorded%', '30. RISK 2: a session with attendance rows (a lesson that RAN) cannot be cancelled');
RESET ROLE;

-- ── 31-33. The holiday void leaves a cancelled lesson alone ──────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ac100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT isnt(cancel_lesson('ac400000-0000-0000-0000-000000000001', today_sg() + 14, 'pool closed'),
  NULL, '31. a second future lesson is cancelled');
RESET ROLE;
INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
VALUES ('ac000000-0000-0000-0000-000000000001', today_sg() + 14, 'ACL Holiday');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ac100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(mark_day_holiday('ac000000-0000-0000-0000-000000000001', today_sg() + 14),
  0, '32. mark_day_holiday voids nothing on a cancelled lesson (old body: 1 — the kid)');
SELECT is(unmark_day_holiday('ac000000-0000-0000-0000-000000000001', today_sg() + 14),
  0, '33-pre. unmark removes no holiday rows');
RESET ROLE;
SELECT is(
  (SELECT (cancelled_at IS NOT NULL)::text FROM lesson_sessions
     WHERE class_id = 'ac400000-0000-0000-0000-000000000001' AND session_date = today_sg() + 14),
  'true', '33. …and unmark_day_holiday did NOT delete the cancelled session (old body deleted it)');

-- ── 35. A lesson of a RETIRED class cannot be restored ──────────────────────
-- Class B (no students) is cancelled on its own next lesson day, then retired
-- with a plain superuser UPDATE (the retirement guard passes: no roster, no
-- guests, nothing owed). Restore must refuse — the class is invisible (§7.109).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ac100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT isnt(cancel_lesson('ac400000-0000-0000-0000-000000000002', today_sg() + 8, 'rain'),
  NULL, '35-pre. Class B''s next lesson is cancelled');
RESET ROLE;
UPDATE classes SET is_active = false, deactivated_at = now() WHERE id = 'ac400000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ac100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_like(
  $$ SELECT restore_lesson('ac400000-0000-0000-0000-000000000002', today_sg() + 8) $$,
  '%no longer running%', '35. restoring a lesson of a RETIRED class is refused (reactivate the class first)');
RESET ROLE;

-- ── 34. Grants: authenticated only ───────────────────────────────────────────
SELECT ok(
  has_function_privilege('authenticated', 'public.cancel_lesson(uuid,date,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.restore_lesson(uuid,date)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.cancel_lesson(uuid,date,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.restore_lesson(uuid,date)', 'EXECUTE'),
  '34. both RPCs: EXECUTE for authenticated, none for anon (§7.87, plan RISK 7)');

SELECT * FROM finish();
ROLLBACK;
