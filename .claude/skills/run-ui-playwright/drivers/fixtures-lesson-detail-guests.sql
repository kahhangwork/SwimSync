-- Fixture for verify-lesson-detail-guests.mjs — the lesson page's actions no other
-- driver presses (BACKLOG → Foundations; docs/plans/DRIVER_BACKLOG_PLAN.md U2).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-lesson-detail-guests.sql
--
-- ITS OWN BUSINESS ("LGuest Swim", prefix b3000000-). The driver books and
-- cancels guests, writes a whole lesson's attendance through Set all, and opens
-- the cancel-lesson modal. On the seed tenant those would land on classes the
-- calendar / lesson-detail / cancel-lesson drivers read (plan rule 12).
--
-- WEEKDAY-INDEPENDENT: every class runs on TODAY's weekday (SGT), so "last week"
-- (today-7) is a markable past lesson and "next week" (today+7) a bookable
-- future one on any day of the week. Hour-independent: nothing reads the time.
--
-- The shapes, each for one check:
--   LGuest Host      (10:00) the lesson guests are booked INTO, capacity 6.
--                    Amy + Ben enrolled (back-dated 30 days). Last week it has
--                    a TRIAL guest (Pasttrial) — the row whose Paid/Free toggle
--                    the driver presses — and no session row yet.
--   LGuest Early/Late (07:00 / 13:00) same category: Twohome's TWO homes, so a
--                    make-up asks "which class does this make-up replace?".
--   LGuest Full      (15:00) capacity 1, one child: FULL, for the Book modal's
--                    full-notice, and a future lesson for "Keep the lesson".
--   LGuest Parked    (17:00) holds the two trial children's CLOSED enrolments,
--                    which make them visible to the admin under RLS (an
--                    enrolment-less child reads "(0)" in the picker — BACKLOG).
--                    Closed, and in a class of its own, so they are neither
--                    "already enrolled" to book_trial nor on Host's roster.
--   LGuest Sub       a second coach, the only substitute the picker offers.
--
-- IDEMPOTENT AND RESETTING: re-loading undoes every write the driver makes
-- (bookings, marks, the session row, an assigned substitute), so a re-run
-- without `supabase db reset` starts from the same state.
-- Teardown: fixtures-lesson-detail-guests-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

-- ── The business, its admin (who also coaches), a second coach ──────────────
INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('b3000000-0000-0000-0000-000000000001','lesson-guests','LGuest Swim','SWIM-LGST')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
 ('00000000-0000-0000-0000-000000000000','b3000000-0000-0000-0000-0000000000a1',
  'authenticated','authenticated','lesson-guests-owner@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"LGuest Owner","role":"tenant_admin","is_coach":true,"tenant_id":"b3000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','b3000000-0000-0000-0000-0000000000a2',
  'authenticated','authenticated','lesson-guests-sub@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"LGuest Sub","role":"coach","tenant_id":"b3000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','','')
ON CONFLICT (id) DO NOTHING;

UPDATE tenants SET owner_profile_id = 'b3000000-0000-0000-0000-0000000000a1'
 WHERE id = 'b3000000-0000-0000-0000-000000000001'
   AND owner_profile_id IS DISTINCT FROM 'b3000000-0000-0000-0000-0000000000a1';

INSERT INTO class_categories (id, tenant_id, name)
VALUES ('b3000000-0000-0000-0000-00000000cc01','b3000000-0000-0000-0000-000000000001','LGuest Group')
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, tenant_id, name)
VALUES ('b3000000-0000-0000-0000-0000000010c1','b3000000-0000-0000-0000-000000000001','LGuest Pool')
ON CONFLICT (id) DO NOTHING;

-- ── Reset the driver's side effects FIRST ───────────────────────────────────
-- Before the classes upsert: a re-load on a later day moves every class to the
-- new weekday, and no session, mark or booking may be left on the old one.
DELETE FROM session_coaches  WHERE lesson_session_id IN
  (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'b3000000-%');
DELETE FROM attendance       WHERE lesson_session_id IN
  (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'b3000000-%');
DELETE FROM lesson_sessions  WHERE class_id::text LIKE 'b3000000-%';
DELETE FROM trial_bookings   WHERE tenant_id = 'b3000000-0000-0000-0000-000000000001';
DELETE FROM makeup_bookings  WHERE tenant_id = 'b3000000-0000-0000-0000-000000000001';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'b3000000-%';

-- ── Five classes, all on TODAY's weekday (SGT), none overlapping ────────────
-- DO UPDATE re-asserts weekday + capacity: a fixture loaded yesterday and
-- re-loaded today must move the classes to today's weekday.
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                     end_time, location_id, price_per_lesson, category_id, capacity, is_active)
SELECT v.id, 'b3000000-0000-0000-0000-000000000001', co.id, v.title,
       lower(trim(to_char((now() AT TIME ZONE 'Asia/Singapore')::date, 'FMDay')))::day_of_week,
       v.st::time, v.et::time, 'b3000000-0000-0000-0000-0000000010c1', 30.00,
       'b3000000-0000-0000-0000-00000000cc01', v.cap, TRUE
  FROM (VALUES
    ('b3000000-0000-0000-0000-0000000000c1'::uuid,'LGuest Host', '10:00','11:00',6),
    ('b3000000-0000-0000-0000-0000000000c2'::uuid,'LGuest Early','07:00','08:00',NULL),
    ('b3000000-0000-0000-0000-0000000000c3'::uuid,'LGuest Late', '13:00','14:00',NULL),
    ('b3000000-0000-0000-0000-0000000000c4'::uuid,'LGuest Full', '15:00','16:00',1),
    ('b3000000-0000-0000-0000-0000000000c5'::uuid,'LGuest Parked','17:00','18:00',NULL)
  ) AS v(id, title, st, et, cap)
  JOIN coaches co ON co.profile_id = 'b3000000-0000-0000-0000-0000000000a1'
ON CONFLICT (id) DO UPDATE SET day_of_week = EXCLUDED.day_of_week,
                               capacity = EXCLUDED.capacity, is_active = TRUE;

-- ── The children ────────────────────────────────────────────────────────────
INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active)
VALUES
  ('b3000000-0000-0000-0000-0000000000d1','LGuest Trialkid','b3000000-0000-0000-0000-000000000001','unassigned',TRUE),
  ('b3000000-0000-0000-0000-0000000000d2','LGuest Pasttrial','b3000000-0000-0000-0000-000000000001','unassigned',TRUE),
  ('b3000000-0000-0000-0000-0000000000d3','LGuest Twohome','b3000000-0000-0000-0000-000000000001','assigned',TRUE),
  ('b3000000-0000-0000-0000-0000000000d4','LGuest Amy','b3000000-0000-0000-0000-000000000001','assigned',TRUE),
  ('b3000000-0000-0000-0000-0000000000d5','LGuest Ben','b3000000-0000-0000-0000-000000000001','assigned',TRUE),
  ('b3000000-0000-0000-0000-0000000000d6','LGuest Fullkid','b3000000-0000-0000-0000-000000000001','assigned',TRUE)
ON CONFLICT (id) DO UPDATE SET is_active = TRUE, assignment_status = EXCLUDED.assignment_status;

-- Active enrolments, back-dated 30 days so last week's lesson expects them.
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
SELECT v.sid, v.cid, TRUE, now() - interval '30 days'
  FROM (VALUES
    ('b3000000-0000-0000-0000-0000000000d3'::uuid,'b3000000-0000-0000-0000-0000000000c2'::uuid),
    ('b3000000-0000-0000-0000-0000000000d3'::uuid,'b3000000-0000-0000-0000-0000000000c3'::uuid),
    ('b3000000-0000-0000-0000-0000000000d4'::uuid,'b3000000-0000-0000-0000-0000000000c1'::uuid),
    ('b3000000-0000-0000-0000-0000000000d5'::uuid,'b3000000-0000-0000-0000-0000000000c1'::uuid),
    ('b3000000-0000-0000-0000-0000000000d6'::uuid,'b3000000-0000-0000-0000-0000000000c4'::uuid)
  ) AS v(sid, cid);

-- CLOSED enrolments for the two trial children (RLS visibility only).
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at, unenrolled_at)
SELECT v.sid, 'b3000000-0000-0000-0000-0000000000c5'::uuid, FALSE,
       now() - interval '90 days', now() - interval '80 days'
  FROM (VALUES
    ('b3000000-0000-0000-0000-0000000000d1'::uuid),
    ('b3000000-0000-0000-0000-0000000000d2'::uuid)
  ) AS v(sid);

-- ── Last week's Host lesson has a TRIAL guest (Pasttrial) ──────────────────
INSERT INTO trial_bookings (tenant_id, student_id, class_id, session_date, category_id, booked_by)
VALUES ('b3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-0000000000d2',
        'b3000000-0000-0000-0000-0000000000c1', (now() AT TIME ZONE 'Asia/Singapore')::date - 7,
        'b3000000-0000-0000-0000-00000000cc01', 'b3000000-0000-0000-0000-0000000000a1');

-- ── Postconditions — fail at load time, not twenty checks later ────────────
DO $$
DECLARE v_classes int; v_active int; v_trials int; v_homes int; v_coaches int; v_rates int;
BEGIN
  SELECT count(*) INTO v_classes FROM classes
   WHERE tenant_id = 'b3000000-0000-0000-0000-000000000001'
     AND day_of_week::text = lower(trim(to_char((now() AT TIME ZONE 'Asia/Singapore')::date, 'FMDay')));
  SELECT count(*) INTO v_active FROM student_class_enrolments
   WHERE student_id::text LIKE 'b3000000-%' AND is_active;
  SELECT count(*) INTO v_trials FROM trial_bookings
   WHERE tenant_id = 'b3000000-0000-0000-0000-000000000001' AND cancelled_at IS NULL;
  SELECT count(*) INTO v_homes FROM student_class_enrolments
   WHERE student_id = 'b3000000-0000-0000-0000-0000000000d3' AND is_active;
  SELECT count(*) INTO v_coaches FROM coaches
   WHERE profile_id IN ('b3000000-0000-0000-0000-0000000000a1','b3000000-0000-0000-0000-0000000000a2');
  -- The substitute picker excludes the coach the class RATE pays; that must be
  -- the owner, or "LGuest Sub" is not offered.
  SELECT count(*) INTO v_rates FROM class_rates r JOIN coaches co ON co.id = r.paid_coach_id
   WHERE r.class_id = 'b3000000-0000-0000-0000-0000000000c1'
     AND co.profile_id = 'b3000000-0000-0000-0000-0000000000a1';
  IF v_classes <> 5 OR v_active <> 5 OR v_trials <> 1 OR v_homes <> 2 OR v_coaches <> 2 OR v_rates < 1 THEN
    RAISE EXCEPTION 'fixture: expected classes-on-today 5 / active enrolments 5 / live trials 1 / Twohome homes 2 / coaches 2 / owner-paid Host rate >=1, got % / % / % / % / % / %',
      v_classes, v_active, v_trials, v_homes, v_coaches, v_rates;
  END IF;
END $$;

COMMIT;
