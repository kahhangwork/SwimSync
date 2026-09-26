-- Fixture for verify-coach-remove-student.mjs — the coach roster's Remove and
-- the level curriculum's Hide (BACKLOG → Foundations; docs/plans/
-- DRIVER_BACKLOG_PLAN.md U3). Promotes the old docs/refactor hand-check, whose
-- bare DO block UPDATEd the SEED child "Maya Tan" — this owns everything.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-coach-remove-student.sql
--
-- ITS OWN BUSINESS ("CoachRm Swim", prefix b4000000-) and its own PLAIN coach
-- (coach-remove-coach@, role 'coach' — NOT a tenant admin). The seed coach is
-- also the seed tenant's admin, so close_student_enrolment() would authorise
-- through is_tenant_admin() and the coach branch — coach_owns_class(<THIS
-- class>) — would go untested (§7.131). The postcondition block re-proves it.
--
-- The shapes:
--   CoachRm Leaver   active in BOTH classes (Monday + Wednesday). Removed from
--                    Monday by the driver; Wednesday must stay open and the
--                    child must stay active.
--   CoachRm Stayer   Monday only, on "CoachRm Level" (a note + two skills,
--                    inserted OUT of sort order) — the curriculum expand/Hide.
--
-- IDEMPOTENT AND RESETTING: re-loading re-opens the enrolment the driver
-- closed (every enrolment of the two children is deleted and re-inserted), so
-- a re-run without `supabase db reset` starts from the same state.
-- Teardown: fixtures-coach-remove-student-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

-- ── The business, its coach, category, pool ─────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('b4000000-0000-0000-0000-000000000001','coach-remove','CoachRm Swim','SWIM-CRMV')
ON CONFLICT (id) DO NOTHING;

-- handle_new_user builds the profiles + coaches rows from raw_user_meta_data:
-- role 'coach' + a tenant_id is a coach OF that business and nothing more.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('00000000-0000-0000-0000-000000000000','b4000000-0000-0000-0000-0000000000a1',
  'authenticated','authenticated','coach-remove-coach@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"CoachRm Coach","role":"coach","tenant_id":"b4000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','','')
ON CONFLICT (id) DO NOTHING;

INSERT INTO class_categories (id, tenant_id, name)
VALUES ('b4000000-0000-0000-0000-00000000cc01','b4000000-0000-0000-0000-000000000001','CoachRm Group')
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, tenant_id, name)
VALUES ('b4000000-0000-0000-0000-0000000010c1','b4000000-0000-0000-0000-000000000001','CoachRm Pool')
ON CONFLICT (id) DO NOTHING;

-- ── Two classes of the coach's, different weekdays (enforce_enrolment_schedule).
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                     end_time, location_id, price_per_lesson, category_id, is_active)
SELECT v.id, 'b4000000-0000-0000-0000-000000000001', co.id, v.title,
       v.dow::day_of_week, '09:00'::time, '10:00'::time,
       'b4000000-0000-0000-0000-0000000010c1', 30.00,
       'b4000000-0000-0000-0000-00000000cc01', TRUE
  FROM (VALUES
    ('b4000000-0000-0000-0000-0000000000c1'::uuid,'CoachRm Monday','monday'),
    ('b4000000-0000-0000-0000-0000000000c2'::uuid,'CoachRm Wednesday','wednesday')
  ) AS v(id, title, dow)
  JOIN coaches co ON co.profile_id = 'b4000000-0000-0000-0000-0000000000a1'
ON CONFLICT (id) DO NOTHING;

-- ── The level: a note and two skills, stored OUT of sort order so the roster
-- must order them itself. Reset on every load.
INSERT INTO tenant_levels (id, tenant_id, label, sort_order, note)
VALUES ('b4000000-0000-0000-0000-0000000001e1','b4000000-0000-0000-0000-000000000001',
        'CoachRm Level',1,'CoachRm water confidence')
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order,
                               note = EXCLUDED.note;

INSERT INTO tenant_level_skills (id, level_id, label, sort_order)
VALUES
  ('b4000000-0000-0000-0000-0000000005a2','b4000000-0000-0000-0000-0000000001e1','CoachRm Float',2),
  ('b4000000-0000-0000-0000-0000000005a1','b4000000-0000-0000-0000-0000000001e1','CoachRm Blow bubbles',1)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- ── The children ────────────────────────────────────────────────────────────
INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active, level_id)
VALUES
  ('b4000000-0000-0000-0000-0000000000d1','CoachRm Leaver','b4000000-0000-0000-0000-000000000001','assigned',TRUE,NULL),
  ('b4000000-0000-0000-0000-0000000000d2','CoachRm Stayer','b4000000-0000-0000-0000-000000000001','assigned',TRUE,'b4000000-0000-0000-0000-0000000001e1')
ON CONFLICT (id) DO UPDATE SET assignment_status = EXCLUDED.assignment_status,
                               is_active = EXCLUDED.is_active,
                               level_id = EXCLUDED.level_id;

-- Reset the driver's side effect: every enrolment of the two children, closed
-- ones included, is replaced by the three open ones below.
DELETE FROM student_class_enrolments
 WHERE student_id IN ('b4000000-0000-0000-0000-0000000000d1','b4000000-0000-0000-0000-0000000000d2');
-- …and the removal's audit row, or the driver's "one audit row" check would be
-- satisfied by the PREVIOUS run's (measured: it hid mutation 1's audit red).
DELETE FROM audit_log
 WHERE tenant_id = 'b4000000-0000-0000-0000-000000000001'
   AND entity_id IN ('b4000000-0000-0000-0000-0000000000d1','b4000000-0000-0000-0000-0000000000d2');

INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES
  ('b4000000-0000-0000-0000-0000000000d1','b4000000-0000-0000-0000-0000000000c1',TRUE),
  ('b4000000-0000-0000-0000-0000000000d1','b4000000-0000-0000-0000-0000000000c2',TRUE),
  ('b4000000-0000-0000-0000-0000000000d2','b4000000-0000-0000-0000-0000000000c1',TRUE);

-- ── Postconditions — fail at load time, not ten checks later ──────────────
DO $$
DECLARE v_coach int; v_admin int; v_leaver int; v_monday int;
BEGIN
  SELECT count(*) INTO v_coach FROM coaches
   WHERE profile_id = 'b4000000-0000-0000-0000-0000000000a1';
  -- §7.131: a coach who is also an admin authorises through the admin branch.
  SELECT count(*) INTO v_admin FROM profiles
   WHERE id = 'b4000000-0000-0000-0000-0000000000a1' AND role <> 'coach';
  SELECT count(*) INTO v_leaver FROM student_class_enrolments
   WHERE student_id = 'b4000000-0000-0000-0000-0000000000d1' AND is_active;
  SELECT count(*) INTO v_monday FROM student_class_enrolments
   WHERE class_id = 'b4000000-0000-0000-0000-0000000000c1' AND is_active;
  IF v_coach <> 1 OR v_admin <> 0 OR v_leaver <> 2 OR v_monday <> 2 THEN
    RAISE EXCEPTION 'fixture: expected coach 1 / non-coach role 0 / Leaver enrolments 2 / Monday roster 2, got % / % / % / %',
      v_coach, v_admin, v_leaver, v_monday;
  END IF;
END $$;

COMMIT;
