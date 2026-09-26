-- Fixture for verify-coach-marking.mjs — the coach marking screen's credit-note
-- email request, its first-save session row, and its read-only title
-- (BACKLOG → Foundations; docs/plans/DRIVER_BACKLOG_PLAN.md U10). Promotes the
-- old docs/refactor coach-attendance hand-check, whose SQL wrote into the SEED
-- tenant as the seed coach (who is also its admin, §7.131) and billed a month
-- that depended on the day of the month — this owns everything.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-coach-marking.sql
--
-- ITS OWN BUSINESS ("CoachMark Swim", prefix d7000000-), never billed: no
-- billing_periods row, so the invoice below is UNSEALED and the attendance on
-- it may be corrected. Its own PLAIN coach (role 'coach', not an admin) and its
-- own SHADOW coach.
--
-- THE LESSON DATE D = 5 days before the 1st of THIS month (SGT) — always inside
-- LAST month (§7.226: a billable lesson must sit in a month that has ENDED, and
-- inside markable_floor = the 1st of last month). All three classes run on D's
-- weekday, re-asserted on every load because D moves monthly.
--
-- The shapes:
--   CoachMark Billed    lesson D EXISTS, Billedkid + Otherkid both 'present';
--                       Billedkid's lesson is on invoice INV-CM-0001 (last
--                       month, outstanding). Present → Absent issues a credit
--                       note (handle_attendance_update) and the screen must
--                       send ONE credit-note-emails request.
--   CoachMark Fresh     lesson D has NO lesson_sessions row — the first save
--                       creates exactly one, plus one attendance_saved audit row.
--   CoachMark Shadowed  CoachMark Shadow is its ACTIVE class shadow — the
--                       screen is read-only for them ("Lesson Attendance").
--
-- IDEMPOTENT AND RESETTING: re-loading deletes what the driver wrote (the credit
-- note, the balance it credited, the counter it bumped, the Fresh session and
-- its attendance, the audit rows) and puts Billedkid back to 'present', so a
-- re-run without `supabase db reset` starts from the same state.
-- Teardown: fixtures-coach-marking-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

-- ── The business and its people ─────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('d7000000-0000-0000-0000-000000000001','coach-marking','CoachMark Swim','SWIM-CMRK')
ON CONFLICT (id) DO NOTHING;

-- handle_new_user builds profiles + coaches / parents from raw_user_meta_data.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
 ('00000000-0000-0000-0000-000000000000','d7000000-0000-0000-0000-0000000000a1',
  'authenticated','authenticated','coach-marking-coach@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"CoachMark Coach","role":"coach","tenant_id":"d7000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','d7000000-0000-0000-0000-0000000000a2',
  'authenticated','authenticated','coach-marking-shadow@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"CoachMark Shadow","role":"coach","tenant_id":"d7000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','d7000000-0000-0000-0000-0000000000f1',
  'authenticated','authenticated','coach-marking-parent@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"CoachMark Parent","role":"parent"}',
  now(), now(), '','','','')
ON CONFLICT (id) DO NOTHING;

INSERT INTO class_categories (id, tenant_id, name)
VALUES ('d7000000-0000-0000-0000-00000000cc01','d7000000-0000-0000-0000-000000000001','CoachMark Group')
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, tenant_id, name)
VALUES ('d7000000-0000-0000-0000-0000000010c1','d7000000-0000-0000-0000-000000000001','CoachMark Pool')
ON CONFLICT (id) DO NOTHING;

-- ── Reset the driver's side effects FIRST ───────────────────────────────────
-- The credit note the correction issued, and the balance it credited (both
-- keyed on this tenant). The note before the attendance reset, so putting
-- Billedkid back to 'present' below meets no note to un-correct.
DELETE FROM credit_notes           WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';
DELETE FROM parent_tenant_balances WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';
UPDATE tenants SET credit_note_counter = 0 WHERE id = 'd7000000-0000-0000-0000-000000000001';
-- attendance_saved rows, BY ENTITY ID (the fixture's sessions), and by tenant.
DELETE FROM audit_log
 WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001'
    OR entity_id IN (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'd7000000-%');
-- Every attendance row on the fixture's classes, and every session the driver
-- created (all but the Billed lesson, which the fixture owns by id).
DELETE FROM attendance
 WHERE lesson_session_id IN (SELECT id FROM lesson_sessions WHERE class_id::text LIKE 'd7000000-%');
DELETE FROM lesson_sessions
 WHERE class_id::text LIKE 'd7000000-%'
   AND id <> 'd7000000-0000-0000-0000-0000000000e1';

-- ── Everything keyed on a random coaches.id / parents.id, or on D ───────────
DO $$
DECLARE
  t      CONSTANT uuid := 'd7000000-0000-0000-0000-000000000001';
  v_co   uuid;
  v_sh   uuid;
  v_par  uuid;
  v_sg   date := today_sg();
  v_d    date;
  v_dow  day_of_week;
BEGIN
  SELECT id INTO v_co  FROM coaches WHERE profile_id = 'd7000000-0000-0000-0000-0000000000a1';
  SELECT id INTO v_sh  FROM coaches WHERE profile_id = 'd7000000-0000-0000-0000-0000000000a2';
  SELECT id INTO v_par FROM parents WHERE profile_id = 'd7000000-0000-0000-0000-0000000000f1';
  IF v_co IS NULL OR v_sh IS NULL OR v_par IS NULL THEN
    RAISE EXCEPTION 'fixture: coach/shadow/parent rows were not created by the auth trigger';
  END IF;
  v_d   := (date_trunc('month', v_sg) - interval '5 days')::date;
  v_dow := lower(trim(to_char(v_d, 'FMDay')))::day_of_week;

  INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                       end_time, location_id, price_per_lesson, category_id, is_active)
  SELECT v.id, t, v_co, v.title, v_dow, v.st, v.et,
         'd7000000-0000-0000-0000-0000000010c1', 30.00,
         'd7000000-0000-0000-0000-00000000cc01', TRUE
    FROM (VALUES
      ('d7000000-0000-0000-0000-0000000000c1'::uuid,'CoachMark Billed',  '07:00'::time,'07:45'::time),
      ('d7000000-0000-0000-0000-0000000000c2'::uuid,'CoachMark Fresh',   '08:00'::time,'08:45'::time),
      ('d7000000-0000-0000-0000-0000000000c3'::uuid,'CoachMark Shadowed','09:00'::time,'09:45'::time)
    ) AS v(id, title, st, et)
  ON CONFLICT (id) DO UPDATE SET day_of_week = EXCLUDED.day_of_week, coach_id = EXCLUDED.coach_id,
                                 is_active = TRUE, deactivated_at = NULL;

  INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active)
  VALUES ('d7000000-0000-0000-0000-0000000000d1','CoachMark Billedkid', t,'assigned',TRUE),
         ('d7000000-0000-0000-0000-0000000000d2','CoachMark Otherkid',  t,'assigned',TRUE),
         ('d7000000-0000-0000-0000-0000000000d3','CoachMark Freshkid',  t,'assigned',TRUE),
         ('d7000000-0000-0000-0000-0000000000d4','CoachMark Shadowkid', t,'assigned',TRUE)
  ON CONFLICT (id) DO UPDATE SET is_active = TRUE, assignment_status = 'assigned';

  INSERT INTO parent_tenants (parent_id, tenant_id)
  VALUES (v_par, t)
  ON CONFLICT (parent_id, tenant_id) DO UPDATE SET is_active = TRUE;
  INSERT INTO parent_students (parent_id, student_id)
  SELECT v_par, 'd7000000-0000-0000-0000-0000000000d1'
   WHERE NOT EXISTS (SELECT 1 FROM parent_students
                      WHERE parent_id = v_par AND student_id = 'd7000000-0000-0000-0000-0000000000d1');

  -- Enrolled just before D (§7.226: a back-dated enrolment drags extra lessons in).
  DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'd7000000-%';
  INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
  VALUES ('d7000000-0000-0000-0000-0000000000d1','d7000000-0000-0000-0000-0000000000c1', TRUE, v_d - 10),
         ('d7000000-0000-0000-0000-0000000000d2','d7000000-0000-0000-0000-0000000000c1', TRUE, v_d - 10),
         ('d7000000-0000-0000-0000-0000000000d3','d7000000-0000-0000-0000-0000000000c2', TRUE, v_d - 10),
         ('d7000000-0000-0000-0000-0000000000d4','d7000000-0000-0000-0000-0000000000c3', TRUE, v_d - 10);

  -- The Billed lesson on D, both children present (as the coach marked it).
  INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time, status)
  VALUES ('d7000000-0000-0000-0000-0000000000e1','d7000000-0000-0000-0000-0000000000c1',
          v_d, '07:00', '07:45', 'completed')
  ON CONFLICT (id) DO UPDATE SET session_date = EXCLUDED.session_date;

  INSERT INTO attendance (id, lesson_session_id, student_id, status, marked_by)
  VALUES ('d7000000-0000-0000-0000-0000000000f5','d7000000-0000-0000-0000-0000000000e1',
          'd7000000-0000-0000-0000-0000000000d1','present','d7000000-0000-0000-0000-0000000000a1'),
         ('d7000000-0000-0000-0000-0000000000f6','d7000000-0000-0000-0000-0000000000e1',
          'd7000000-0000-0000-0000-0000000000d2','present','d7000000-0000-0000-0000-0000000000a1');

  -- Billedkid's lesson is INVOICED (last month, outstanding, unsealed).
  INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount,
                        credit_applied, net_amount, status, reference_number)
  VALUES ('d7000000-0000-0000-0000-0000000000b1', v_par, t, to_char(v_d, 'YYYY-MM'),
          30.00, 0, 30.00, 'outstanding', 'INV-CM-0001')
  ON CONFLICT (id) DO UPDATE SET billing_month = EXCLUDED.billing_month,
                                 gross_amount = 30.00, credit_applied = 0, net_amount = 30.00,
                                 status = 'outstanding', paid_at = NULL, paid_marked_by = NULL,
                                 paid_claimed_at = NULL;

  INSERT INTO invoice_items (id, invoice_id, student_id, lesson_session_id,
                             attendance_status, amount, class_title, session_date, student_name)
  VALUES ('d7000000-0000-0000-0000-0000000001b1','d7000000-0000-0000-0000-0000000000b1',
          'd7000000-0000-0000-0000-0000000000d1','d7000000-0000-0000-0000-0000000000e1',
          'present', 30.00, 'CoachMark Billed', v_d, 'CoachMark Billedkid')
  ON CONFLICT (id) DO UPDATE SET session_date = EXCLUDED.session_date, attendance_status = 'present';

  -- The shadow: ACTIVE on the Shadowed class from well before D, open-ended.
  INSERT INTO class_shadow_coaches (id, tenant_id, class_id, coach_id, effective_from,
                                    effective_to, assigned_by)
  VALUES ('d7000000-0000-0000-0000-0000000005a1', t, 'd7000000-0000-0000-0000-0000000000c3',
          v_sh, v_d - 30, NULL, NULL)
  ON CONFLICT (id) DO UPDATE SET effective_from = EXCLUDED.effective_from,
                                 effective_to = NULL, ended_by = NULL, ended_at = NULL;
END $$;

-- ── Postconditions — fail at load time, not ten checks later ──────────────
DO $$
DECLARE
  v_d date; v_admins int; v_present int; v_notes int; v_fresh int; v_sealed int;
  v_shadow int; v_floor date; v_dow_ok int;
BEGIN
  SELECT session_date INTO v_d FROM lesson_sessions WHERE id = 'd7000000-0000-0000-0000-0000000000e1';
  -- §7.131: both logins must authorise as coaches, never through an admin branch.
  SELECT count(*) INTO v_admins FROM profiles
   WHERE id IN ('d7000000-0000-0000-0000-0000000000a1','d7000000-0000-0000-0000-0000000000a2')
     AND role <> 'coach';
  SELECT count(*) INTO v_present FROM attendance
   WHERE lesson_session_id = 'd7000000-0000-0000-0000-0000000000e1' AND status = 'present';
  SELECT count(*) INTO v_notes FROM credit_notes
   WHERE invoice_item_id = 'd7000000-0000-0000-0000-0000000001b1';
  SELECT count(*) INTO v_fresh FROM lesson_sessions
   WHERE class_id = 'd7000000-0000-0000-0000-0000000000c2';
  SELECT count(*) INTO v_sealed FROM billing_periods
   WHERE tenant_id = 'd7000000-0000-0000-0000-000000000001';
  SELECT count(*) INTO v_shadow FROM class_shadow_coaches s JOIN coaches c ON c.id = s.coach_id
   WHERE s.class_id = 'd7000000-0000-0000-0000-0000000000c3'
     AND c.profile_id = 'd7000000-0000-0000-0000-0000000000a2'
     AND s.effective_from <= today_sg() AND s.effective_to IS NULL;
  SELECT count(*) INTO v_dow_ok FROM classes
   WHERE id::text LIKE 'd7000000-%'
     AND day_of_week = lower(trim(to_char(v_d, 'FMDay')))::day_of_week;
  v_floor := markable_floor('d7000000-0000-0000-0000-000000000001');
  IF v_admins <> 0 OR v_present <> 2 OR v_notes <> 0 OR v_fresh <> 0 OR v_sealed <> 0
     OR v_shadow <> 1 OR v_dow_ok <> 3
     OR v_d >= date_trunc('month', today_sg())::date OR v_d < v_floor THEN
    RAISE EXCEPTION 'fixture: expected admins 0 / present 2 / notes 0 / fresh sessions 0 / seals 0 / shadow 1 / classes on D''s weekday 3 / D (%) in last month and >= floor (%), got % / % / % / % / % / % / %',
      v_d, v_floor, v_admins, v_present, v_notes, v_fresh, v_sealed, v_shadow, v_dow_ok;
  END IF;
END $$;

COMMIT;
