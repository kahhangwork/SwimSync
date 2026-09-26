-- Fixture for verify-grading-admin.mjs — the admin grading actions no other
-- driver presses (BACKLOG → Foundations; docs/plans/DRIVER_BACKLOG_PLAN.md U1).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-grading-admin.sql
--
-- ITS OWN BUSINESS ("GradAdm Swim", prefix c3000000-). The driver edits the
-- GRADING SCALE, which is per business and read by every grading surface — on
-- the seed tenant that would move "the top grade" under verify-assessment and
-- verify-level-skills (plan rule 12). Everything here is owned, so nothing a
-- sibling reads is touched.
--
-- The shapes, each for one check:
--   GradAdm Trialkid    a PAST unmarked trial AND a FUTURE trial in the same
--                       class — the only shape on which Convert's two-press
--                       guard (trialConvert.ts) fires.
--   GradAdm Twoclass    active in TWO same-category classes (Tue + Thu), so
--                       the make-up modal must ASK which class is being made
--                       up; the Saturday class is the host.
--   GradAdm Promo       on Level One, TOP grade on both skills, backdated 90
--                       days — stale, so no promotion until re-painted today.
--   GradAdm Held        holds the LOWEST grade on one skill — the grade the
--                       scale editor must refuse to remove.
--   GradAdm Modalkid    on Level One, ungraded — graded from the Students drawer.
--   GradAdm Level Three three skills, no children — reordered and pruned.
--
-- IDEMPOTENT AND RESETTING: re-loading undoes every write the driver makes, so
-- a re-run without `supabase db reset` starts from the same state.
-- Teardown: fixtures-grading-admin-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

-- ── The business, its admin (who also coaches), category, pool ──────────────
INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('c3000000-0000-0000-0000-000000000001','grading-admin','GradAdm Swim','SWIM-GRAD')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('00000000-0000-0000-0000-000000000000','c3000000-0000-0000-0000-0000000000a1',
  'authenticated','authenticated','grading-admin-owner@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"GradAdm Owner","role":"tenant_admin","is_coach":true,"tenant_id":"c3000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','','')
ON CONFLICT (id) DO NOTHING;

UPDATE tenants SET owner_profile_id = 'c3000000-0000-0000-0000-0000000000a1'
 WHERE id = 'c3000000-0000-0000-0000-000000000001'
   AND owner_profile_id IS DISTINCT FROM 'c3000000-0000-0000-0000-0000000000a1';

INSERT INTO class_categories (id, tenant_id, name)
VALUES ('c3000000-0000-0000-0000-00000000cc01','c3000000-0000-0000-0000-000000000001','GradAdm Group')
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, tenant_id, name)
VALUES ('c3000000-0000-0000-0000-0000000010c1','c3000000-0000-0000-0000-000000000001','GradAdm Pool')
ON CONFLICT (id) DO NOTHING;

-- ── Three same-category classes. Not overlapping (enforce_enrolment_schedule).
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                     end_time, location_id, price_per_lesson, category_id, is_active)
SELECT v.id, 'c3000000-0000-0000-0000-000000000001', co.id, v.title,
       v.dow::day_of_week, v.st::time, v.et::time,
       'c3000000-0000-0000-0000-0000000010c1', v.price,
       'c3000000-0000-0000-0000-00000000cc01', TRUE
  FROM (VALUES
    ('c3000000-0000-0000-0000-0000000000c1'::uuid,'GradAdm Tuesday','tuesday','09:00','10:00',30.00),
    ('c3000000-0000-0000-0000-0000000000c2'::uuid,'GradAdm Thursday','thursday','09:00','10:00',35.00),
    ('c3000000-0000-0000-0000-0000000000c3'::uuid,'GradAdm Saturday','saturday','09:00','10:00',40.00)
  ) AS v(id, title, dow, st, et, price)
  JOIN coaches co ON co.profile_id = 'c3000000-0000-0000-0000-0000000000a1'
ON CONFLICT (id) DO NOTHING;

-- ── The ladder: three levels. Labels and order RESET on every load (the
-- driver edits Level Three's note and reorders / removes its skills).
INSERT INTO tenant_levels (id, tenant_id, label, sort_order, note)
VALUES
  ('c3000000-0000-0000-0000-0000000001e1','c3000000-0000-0000-0000-000000000001','GradAdm Level One',1,NULL),
  ('c3000000-0000-0000-0000-0000000001e2','c3000000-0000-0000-0000-000000000001','GradAdm Level Two',2,NULL),
  ('c3000000-0000-0000-0000-0000000001e3','c3000000-0000-0000-0000-000000000001','GradAdm Level Three',3,NULL)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, note = NULL;

INSERT INTO tenant_level_skills (id, level_id, label, sort_order)
VALUES
  ('c3000000-0000-0000-0000-0000000005a1','c3000000-0000-0000-0000-0000000001e1','GradAdm Float',1),
  ('c3000000-0000-0000-0000-0000000005a2','c3000000-0000-0000-0000-0000000001e1','GradAdm Glide',2),
  ('c3000000-0000-0000-0000-0000000005b1','c3000000-0000-0000-0000-0000000001e2','GradAdm Kick',1),
  ('c3000000-0000-0000-0000-0000000005c1','c3000000-0000-0000-0000-0000000001e3','GradAdm Tread',1),
  ('c3000000-0000-0000-0000-0000000005c2','c3000000-0000-0000-0000-0000000001e3','GradAdm Dive',2),
  ('c3000000-0000-0000-0000-0000000005c3','c3000000-0000-0000-0000-0000000001e3','GradAdm Scull',3)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- The scale is seeded per business by trg_seed_skill_grade_levels. The driver
-- adds (and should remove) one grade; a crashed run's leftover goes here.
DELETE FROM skill_grade_levels
 WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001'
   AND label NOT IN ('Developing','Competent','Mastered');

-- ── The children ────────────────────────────────────────────────────────────
INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active,
                      level_id, provisional_contact_phone)
VALUES
  ('c3000000-0000-0000-0000-0000000000d1','GradAdm Trialkid','c3000000-0000-0000-0000-000000000001','unassigned',TRUE,NULL,'91230001'),
  ('c3000000-0000-0000-0000-0000000000d2','GradAdm Twoclass','c3000000-0000-0000-0000-000000000001','assigned',TRUE,NULL,NULL),
  ('c3000000-0000-0000-0000-0000000000d3','GradAdm Promo','c3000000-0000-0000-0000-000000000001','assigned',TRUE,'c3000000-0000-0000-0000-0000000001e1',NULL),
  ('c3000000-0000-0000-0000-0000000000d4','GradAdm Held','c3000000-0000-0000-0000-000000000001','assigned',TRUE,'c3000000-0000-0000-0000-0000000001e1',NULL),
  ('c3000000-0000-0000-0000-0000000000d5','GradAdm Modalkid','c3000000-0000-0000-0000-000000000001','assigned',TRUE,'c3000000-0000-0000-0000-0000000001e1',NULL)
ON CONFLICT (id) DO UPDATE SET assignment_status = EXCLUDED.assignment_status,
                               level_id = EXCLUDED.level_id;

-- Reset the driver's side effects BEFORE (re)creating the rows it changes.
DELETE FROM makeup_bookings    WHERE student_id = 'c3000000-0000-0000-0000-0000000000d2';
DELETE FROM student_class_enrolments WHERE student_id = 'c3000000-0000-0000-0000-0000000000d1';
DELETE FROM student_skill_progress
 WHERE student_id IN ('c3000000-0000-0000-0000-0000000000d3','c3000000-0000-0000-0000-0000000000d5');

INSERT INTO student_class_enrolments (student_id, class_id, is_active)
SELECT v.sid, v.cid, TRUE
  FROM (VALUES
    ('c3000000-0000-0000-0000-0000000000d2'::uuid,'c3000000-0000-0000-0000-0000000000c1'::uuid),
    ('c3000000-0000-0000-0000-0000000000d2'::uuid,'c3000000-0000-0000-0000-0000000000c2'::uuid),
    ('c3000000-0000-0000-0000-0000000000d3'::uuid,'c3000000-0000-0000-0000-0000000000c3'::uuid),
    ('c3000000-0000-0000-0000-0000000000d4'::uuid,'c3000000-0000-0000-0000-0000000000c3'::uuid),
    ('c3000000-0000-0000-0000-0000000000d5'::uuid,'c3000000-0000-0000-0000-0000000000c3'::uuid)
  ) AS v(sid, cid)
 WHERE NOT EXISTS (SELECT 1 FROM student_class_enrolments e
                    WHERE e.student_id = v.sid AND e.class_id = v.cid AND e.is_active);

-- ── Trials: the most recent Tuesday strictly BEFORE today (SGT) and the next
-- strictly AFTER. Both on the class's own weekday. Reset to live every load.
DELETE FROM trial_bookings WHERE student_id = 'c3000000-0000-0000-0000-0000000000d1';
INSERT INTO trial_bookings (tenant_id, student_id, class_id, session_date, category_id, booked_by)
SELECT 'c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-0000000000d1',
       'c3000000-0000-0000-0000-0000000000c1', v.d,
       'c3000000-0000-0000-0000-00000000cc01', 'c3000000-0000-0000-0000-0000000000a1'
  FROM (SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS t) sg,
  LATERAL (VALUES
    (sg.t - ((EXTRACT(DOW FROM sg.t)::int - 2 + 7) % 7)
          - CASE WHEN EXTRACT(DOW FROM sg.t)::int = 2 THEN 7 ELSE 0 END),
    (sg.t + ((2 - EXTRACT(DOW FROM sg.t)::int + 7) % 7)
          + CASE WHEN EXTRACT(DOW FROM sg.t)::int = 2 THEN 7 ELSE 0 END)
  ) AS v(d);

-- ── Grades ──────────────────────────────────────────────────────────────────
-- Promo: TOP grade on both Level One skills, then backdated 90 days under a
-- disabled trigger (the trigger stamps graded_at = now() on every write).
INSERT INTO student_skill_progress (tenant_id, student_id, skill_id, grade_level_id)
SELECT 'c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-0000000000d3', s.id,
       (SELECT id FROM skill_grade_levels WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001'
         ORDER BY rank DESC LIMIT 1)
  FROM tenant_level_skills s WHERE s.level_id = 'c3000000-0000-0000-0000-0000000001e1';

ALTER TABLE student_skill_progress DISABLE TRIGGER trg_skill_progress_tenant;
UPDATE student_skill_progress SET graded_at = now() - interval '90 days'
 WHERE student_id = 'c3000000-0000-0000-0000-0000000000d3';
ALTER TABLE student_skill_progress ENABLE TRIGGER trg_skill_progress_tenant;

-- Held: the LOWEST grade on Float, so that grade is in use.
INSERT INTO student_skill_progress (tenant_id, student_id, skill_id, grade_level_id)
SELECT 'c3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-0000000000d4',
       'c3000000-0000-0000-0000-0000000005a1',
       (SELECT id FROM skill_grade_levels WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001'
         ORDER BY rank ASC LIMIT 1)
 WHERE NOT EXISTS (SELECT 1 FROM student_skill_progress
                    WHERE student_id = 'c3000000-0000-0000-0000-0000000000d4'
                      AND skill_id = 'c3000000-0000-0000-0000-0000000005a1');

-- ── Postconditions — fail at load time, not twenty checks later ────────────
DO $$
DECLARE v_scale int; v_trials int; v_homes int;
BEGIN
  SELECT count(*) INTO v_scale FROM skill_grade_levels WHERE tenant_id = 'c3000000-0000-0000-0000-000000000001';
  SELECT count(*) INTO v_trials FROM trial_bookings
   WHERE student_id = 'c3000000-0000-0000-0000-0000000000d1' AND cancelled_at IS NULL;
  SELECT count(*) INTO v_homes FROM student_class_enrolments
   WHERE student_id = 'c3000000-0000-0000-0000-0000000000d2' AND is_active;
  IF v_scale <> 3 OR v_trials <> 2 OR v_homes <> 2 THEN
    RAISE EXCEPTION 'fixture: expected scale 3 / live trials 2 / Twoclass homes 2, got % / % / %',
      v_scale, v_trials, v_homes;
  END IF;
END $$;

COMMIT;
