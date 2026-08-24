-- pgTAP: a TENANT ADMIN can mark attendance through the SAME path as the coach
-- app — lesson_sessions insert → attendance upsert → audit_log row — under RLS,
-- with every guard a coach meets still applied (ADMIN_CALENDAR_PLAN A.3).
--
-- The load-bearing proof behind "no new RPC for admin marking": if this file
-- cannot go green, the admin lesson page (Slice C) needs a SECURITY DEFINER
-- writer instead. The admin here is a PURE admin — no coaches row, no
-- current_coach_id() — because that is the account coach_owns_session() refuses
-- and the 20260819000100 audit policy arm exists for.
--
-- Refusals are throws_ok with the DB's own SQLSTATE, never a lives_ok of the
-- happy path alone. Dates derive from today_sg() (see attendance_window.test.sql
-- for the four-date shape). Rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(22);

CREATE TEMP TABLE w AS
SELECT
  ((now() AT TIME ZONE 'Asia/Singapore')::date - 3)       AS d_in,
  ((now() AT TIME ZONE 'Asia/Singapore')::date - 3 - 140) AS d_old,
  ((now() AT TIME ZONE 'Asia/Singapore')::date - 3 + 7)   AS d_future,
  ((now() AT TIME ZONE 'Asia/Singapore')::date - 2)       AS d_wrongday;
GRANT SELECT ON w TO PUBLIC;

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('aa000000-0000-0000-0000-0000000000a1','ama-a','Admin Marks A','SWIM-AMA1'),
  ('aa000000-0000-0000-0000-0000000000a2','ama-b','Admin Marks B','SWIM-AMA2');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  -- PURE admin of A (no is_coach → no coaches row)
  ('00000000-0000-0000-0000-000000000000','ab000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','ama-admin-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"AMA Admin A","role":"tenant_admin","tenant_id":"aa000000-0000-0000-0000-0000000000a1"}',
   now(), now(), '','','',''),
  -- the coach who owns the class
  ('00000000-0000-0000-0000-000000000000','ab000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','ama-coach-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"AMA Coach A","role":"coach","tenant_id":"aa000000-0000-0000-0000-0000000000a1"}',
   now(), now(), '','','',''),
  -- admin of ANOTHER business
  ('00000000-0000-0000-0000-000000000000','ab000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','ama-admin-b@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"AMA Admin B","role":"tenant_admin","tenant_id":"aa000000-0000-0000-0000-0000000000a2"}',
   now(), now(), '','','',''),
  -- a parent, for the billed-lesson fixture
  ('00000000-0000-0000-0000-000000000000','ab000000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','ama-parent@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"AMA Parent","role":"parent"}',
   now(), now(), '','','','');

SELECT is((SELECT count(*)::int FROM coaches co JOIN profiles p ON p.id = co.profile_id
            WHERE p.email = 'ama-admin-a@test.local'),
  0, '1: the admin under test has NO coaches row (a pure admin)');

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('ae000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000a1','Group');

-- The class runs on d_in's weekday.
-- classes.location_id is NOT NULL since the location contract migration
-- (20260824000200). Give every tenant one location to hang classes off,
-- tenant-agnostic and idempotent (mirrors the Default Group category block).
INSERT INTO locations (tenant_id, name)
SELECT t.id, 'Default location' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM locations l
    WHERE l.tenant_id = t.id AND lower(trim(l.name)) = 'default location');

INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time,
                     location_id, price_per_lesson, category_id)
SELECT 'af000000-0000-0000-0000-0000000000a1','aa000000-0000-0000-0000-0000000000a1',
       (SELECT id FROM coaches WHERE profile_id='ab000000-0000-0000-0000-0000000000c1'),
       'AMA Class',
       (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
         )[EXTRACT(DOW FROM w.d_in)::int + 1]::day_of_week,
       '10:00','11:00',(SELECT l.id FROM locations l WHERE l.tenant_id = 'aa000000-0000-0000-0000-0000000000a1' AND lower(trim(l.name)) = 'default location'), 30.00, 'ae000000-0000-0000-0000-0000000000a1'
FROM w;

INSERT INTO students (id, full_name, assignment_status, tenant_id) VALUES
  ('a5000000-0000-0000-0000-0000000000a1','AMA Kid','assigned','aa000000-0000-0000-0000-0000000000a1');
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'a5000000-0000-0000-0000-0000000000a1'
FROM parents p WHERE p.profile_id = 'ab000000-0000-0000-0000-0000000000d1';
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
VALUES ('a5000000-0000-0000-0000-0000000000a1','af000000-0000-0000-0000-0000000000a1', TRUE, now() - INTERVAL '200 days');

-- A BILLED lesson far in the past (fixture as postgres): present, invoiced.
INSERT INTO lesson_sessions (id, class_id, session_date, status)
SELECT 'a4000000-0000-0000-0000-00000000000b','af000000-0000-0000-0000-0000000000a1', w.d_old, 'completed' FROM w;
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('a4000000-0000-0000-0000-00000000000b','a5000000-0000-0000-0000-0000000000a1','present','ab000000-0000-0000-0000-0000000000c1');
INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT 'aa000000-0000-0000-0000-0000000000a1','a6000000-0000-0000-0000-0000000000a1', p.id,
       to_char((SELECT d_old FROM w), 'YYYY-MM'), 30.00, 0.00, 30.00, 'outstanding'
FROM parents p WHERE p.profile_id = 'ab000000-0000-0000-0000-0000000000d1';
INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
SELECT 'a6000000-0000-0000-0000-0000000000a1','a5000000-0000-0000-0000-0000000000a1',
       'a4000000-0000-0000-0000-00000000000b','present', 30.00, 'AMA Class', w.d_old FROM w;

-- ════ As the PURE ADMIN of A ═══════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ab000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 2-3. Creates the session row for an in-window lesson on the class's weekday
SELECT lives_ok($$
  INSERT INTO lesson_sessions (id, class_id, session_date, status)
  SELECT 'a4000000-0000-0000-0000-00000000000a','af000000-0000-0000-0000-0000000000a1', d_in, 'scheduled' FROM w $$,
  '2: admin INSERTs the lesson_sessions row (the coach app''s step 1)');
SELECT is((SELECT count(*)::int FROM lesson_sessions WHERE id='a4000000-0000-0000-0000-00000000000a'),
  1, '3: the admin can read the row back');

-- 4-6. Upserts attendance, including the admin-only holiday status
SELECT lives_ok($$
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by, last_edited_by)
  VALUES ('a4000000-0000-0000-0000-00000000000a','a5000000-0000-0000-0000-0000000000a1','present',
          'ab000000-0000-0000-0000-0000000000a1','ab000000-0000-0000-0000-0000000000a1')
  ON CONFLICT (lesson_session_id, student_id) DO UPDATE SET status = EXCLUDED.status $$,
  '4: admin upserts a present mark (the coach app''s step 2)');
SELECT lives_ok($$
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by, last_edited_by)
  VALUES ('a4000000-0000-0000-0000-00000000000a','a5000000-0000-0000-0000-0000000000a1','holiday',
          'ab000000-0000-0000-0000-0000000000a1','ab000000-0000-0000-0000-0000000000a1')
  ON CONFLICT (lesson_session_id, student_id) DO UPDATE SET status = EXCLUDED.status $$,
  '5: the same upsert with ''holiday'' is admitted for an admin (per-lesson void)');
SELECT is((SELECT status::text FROM attendance WHERE lesson_session_id='a4000000-0000-0000-0000-00000000000a'),
  'holiday', '6: the row is holiday');

-- 7. The admin''s audit row (20260819000100 — refused before this migration)
SELECT lives_ok($$
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES ('ab000000-0000-0000-0000-0000000000a1','attendance_saved','lesson_session',
          'a4000000-0000-0000-0000-00000000000a','{"by":"admin"}') $$,
  '7: a pure tenant admin can write the attendance_saved audit row for their business''s session');

-- 8-9. The window: a NEW charge below the floor is refused, and nothing is written
SELECT throws_ok($$
  INSERT INTO lesson_sessions (class_id, session_date)
  SELECT 'af000000-0000-0000-0000-0000000000a1', d_old - 7 FROM w $$,
  'P0001', NULL, '8: admin cannot create a session below the markable floor');
SELECT is((SELECT count(*)::int FROM lesson_sessions
            WHERE class_id='af000000-0000-0000-0000-0000000000a1'
              AND session_date = (SELECT d_old - 7 FROM w)),
  0, '9: …and no row was written');

-- 10. The weekday rule: a date the class does not run on is refused
SELECT throws_ok($$
  INSERT INTO lesson_sessions (class_id, session_date)
  SELECT 'af000000-0000-0000-0000-0000000000a1', d_wrongday FROM w $$,
  'P0001', NULL, '10: admin cannot create a session on a weekday the class does not run');

-- 11. The future: ahead of today is refused
SELECT throws_ok($$
  INSERT INTO lesson_sessions (class_id, session_date)
  SELECT 'af000000-0000-0000-0000-0000000000a1', d_future FROM w $$,
  'P0001', NULL, '11: admin cannot create a session ahead of today');

-- ── RISK 2: the admin as a second writer of the credit-note trigger ─────────
-- 12-14. Billed present → absent mints ONE credit note for the line's amount
SELECT lives_ok($$
  UPDATE attendance SET status='absent', last_edited_by='ab000000-0000-0000-0000-0000000000a1',
         edit_reason='admin correction'
   WHERE lesson_session_id='a4000000-0000-0000-0000-00000000000b'
     AND student_id='a5000000-0000-0000-0000-0000000000a1' $$,
  '12: admin corrects a BILLED present → absent (a correction is always allowed)');
SELECT is((SELECT count(*)::int FROM credit_notes WHERE lesson_session_id='a4000000-0000-0000-0000-00000000000b'),
  1, '13: exactly one credit note was issued');
SELECT is((SELECT amount FROM credit_notes WHERE lesson_session_id='a4000000-0000-0000-0000-00000000000b'),
  30.00, '14: for the invoice line''s amount');

-- 15-16. Flip back and forth: still ONE row per invoice_item_id (20260818000100)
UPDATE attendance SET status='present' WHERE lesson_session_id='a4000000-0000-0000-0000-00000000000b';
UPDATE attendance SET status='absent'  WHERE lesson_session_id='a4000000-0000-0000-0000-00000000000b';
SELECT is((SELECT count(*)::int FROM credit_notes WHERE lesson_session_id='a4000000-0000-0000-0000-00000000000b'),
  1, '15: a flip-flop by the admin never doubles the note');
SELECT is((SELECT status FROM credit_notes WHERE lesson_session_id='a4000000-0000-0000-0000-00000000000b'),
  'available', '16: …and it is available again');
RESET ROLE;

-- 17. Draw it down (what billing does), then the admin''s un-correction is refused CN001
INSERT INTO credit_applications (credit_note_id, invoice_id, amount)
SELECT id, 'a6000000-0000-0000-0000-0000000000a1', 30.00
FROM credit_notes WHERE lesson_session_id='a4000000-0000-0000-0000-00000000000b';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ab000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT throws_ok($$
  UPDATE attendance SET status='present'
   WHERE lesson_session_id='a4000000-0000-0000-0000-00000000000b' $$,
  'CN001', NULL, '17: un-correcting an already-drawn credit is refused for the admin too (CN001)');

-- ════ As the admin of ANOTHER business: everything is refused ══════════════
SET LOCAL "request.jwt.claims" TO '{"sub":"ab000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

SELECT throws_ok($$
  INSERT INTO lesson_sessions (class_id, session_date)
  SELECT 'af000000-0000-0000-0000-0000000000a1', d_in - 7 FROM w $$,
  '42501', NULL, '18: another business''s admin cannot create a session on this class');
SELECT throws_ok($$
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
  VALUES ('a4000000-0000-0000-0000-00000000000a','a5000000-0000-0000-0000-0000000000a1','present',
          'ab000000-0000-0000-0000-0000000000b1')
  ON CONFLICT (lesson_session_id, student_id) DO UPDATE SET status = EXCLUDED.status $$,
  '42501', NULL, '19: …nor upsert attendance on it');
SELECT throws_ok($$
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES ('ab000000-0000-0000-0000-0000000000b1','attendance_saved','lesson_session',
          'a4000000-0000-0000-0000-00000000000a','{}') $$,
  '42501', NULL, '20: …nor write an audit row against it');
SELECT throws_ok($$
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES ('ab000000-0000-0000-0000-0000000000a1','attendance_saved','lesson_session',
          'a4000000-0000-0000-0000-00000000000a','{}') $$,
  '42501', NULL, '21: …nor forge the audit row as somebody else (actor must be the caller)');

-- 22. The holiday status stays admin-gated for the class''s own coach
SET LOCAL "request.jwt.claims" TO '{"sub":"ab000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
SELECT throws_ok($$
  UPDATE attendance SET status='present'
   WHERE lesson_session_id='a4000000-0000-0000-0000-00000000000a' $$,
  '42501', NULL, '22: the coach still cannot clear the admin''s holiday mark');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
