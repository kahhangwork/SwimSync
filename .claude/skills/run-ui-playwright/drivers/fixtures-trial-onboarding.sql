-- Fixture for verify-trial-onboarding.mjs.
--
-- WHY A FIXTURE IS NEEDED AT ALL. The coach half of the driver adds a walk-in
-- through the real UI, on TODAY's date — which is exactly right for testing the
-- add and the roster union, and useless for testing BILLING: generation only
-- ever bills a month that has ENDED (PRD §5.5), so today's lesson is out of
-- scope by design. Trying to drive that half through the UI would mean marking
-- attendance a month back and is not what the assertion is about.
--
-- So this builds a complete, billable PREVIOUS month containing exactly one
-- unclaimed billable lesson: everything the seal needs except a parent to bill.
--
-- Idempotent — safe to re-run between driver runs.
--
-- IT OWNS ITS CLASS, AND THAT IS LOAD-BEARING (2026-08-01). This used to do
-- `SELECT id INTO v_class FROM classes WHERE tenant_id = ... LIMIT 1` — unordered,
-- so *which* class it borrowed depended on how many others existed and on physical
-- row order. It broke CI the day two classes were added to the seed tenant: the
-- pick moved to 'Saturday Beginners', where it created a session on every Saturday
-- of the previous month, and `fixtures-unmarked-lessons.sql` then hit
-- `lesson_sessions_class_id_session_date_key` inserting its own 2026-07-04 row.
-- Locally the same code picked a different class and passed — the worst kind of
-- difference (§7.73).
--
-- Owning the class also retired this fixture's `roundtrip-exempt` declaration. It
-- marks "every actively enrolled student in the class" to build a COMPLETE month;
-- on a borrowed class that meant siblings' children, so its footprint changed when
-- other fixtures were loaded. On its own class the same statement touches only its
-- own walk-in, so the scenario is unchanged and the write is now self-scoped.

BEGIN;

-- The seed tenant, and this fixture's own class within it.
\set tenant '70000000-0000-0000-0000-000000000001'

DO $$
DECLARE
  v_tenant   UUID := '70000000-0000-0000-0000-000000000001';
  v_class    UUID := 'fb000000-0000-0000-0000-000000000001';
  v_coach    UUID;
  v_coach_pf UUID;
  v_month    DATE;
  v_sat      DATE;
  v_session  UUID;
  v_walkin   UUID;
BEGIN
  -- By email, not LIMIT 1: the seed coach is a known identity, and an unordered
  -- pick is what this fixture was just fixed for.
  SELECT co.id, co.profile_id INTO v_coach, v_coach_pf
    FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
   WHERE pr.email = 'coach@swimsync.test';

  -- Saturday, because the loop below walks the previous month's Saturdays.
  INSERT INTO classes (id, coach_id, tenant_id, title, day_of_week,
                       start_time, end_time, location_name, price_per_lesson, category_id)
  VALUES (v_class, v_coach, v_tenant, 'Trial Onboarding Class', 'saturday',
          '14:00', '15:00', 'Test Pool', 40,
          (SELECT cc.id FROM class_categories cc
            WHERE cc.tenant_id = v_tenant
              AND lower(trim(cc.name)) = 'default group'))
  ON CONFLICT (id) DO NOTHING;

  -- First day of the PREVIOUS month, in SGT. Derived from the DB clock only
  -- because a fixture is allowed to; the PRODUCT never does this (§7.7).
  v_month := date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')::date) - INTERVAL '1 month';

  -- Clean up any previous run so re-running is safe.
  DELETE FROM attendance a USING students s
    WHERE a.student_id = s.id AND s.full_name = 'Fixture Walkin';
  DELETE FROM student_class_enrolments e USING students s
    WHERE e.student_id = s.id AND s.full_name = 'Fixture Walkin';
  DELETE FROM student_settlements ss USING students s
    WHERE ss.student_id = s.id AND s.full_name = 'Fixture Walkin';
  DELETE FROM students WHERE full_name = 'Fixture Walkin';
  DELETE FROM billing_periods
    WHERE tenant_id = v_tenant AND billing_month = to_char(v_month, 'YYYY-MM');

  -- ── An UNCLAIMED child with one billable lesson in that month ─────────────
  -- No parent_students row: that absence IS the fixture.
  INSERT INTO students (full_name, tenant_id, assignment_status, created_by)
  VALUES ('Fixture Walkin', v_tenant, 'assigned', v_coach_pf)
  RETURNING id INTO v_walkin;

  -- Every Saturday of that month gets a session, all of them fully marked, so
  -- the completeness gate passes and the ONLY thing left holding the month open
  -- is the unbillable lesson. Without this the run would refuse for the wrong
  -- reason and the assertion would pass vacuously.
  FOR v_sat IN
    SELECT d::date FROM generate_series(
      v_month, (v_month + INTERVAL '1 month - 1 day')::date, INTERVAL '1 day'
    ) d
    WHERE EXTRACT(DOW FROM d) = 6
  LOOP
    INSERT INTO lesson_sessions (class_id, session_date)
    VALUES (v_class, v_sat)
    ON CONFLICT ON CONSTRAINT lesson_sessions_class_id_session_date_key DO NOTHING;

    SELECT id INTO v_session FROM lesson_sessions
      WHERE class_id = v_class AND session_date = v_sat;

    -- Every ACTIVELY ENROLLED student marked — that is what the gate measures.
    INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
    SELECT v_session, e.student_id, 'present', v_coach_pf
      FROM student_class_enrolments e
     WHERE e.class_id = v_class AND e.is_active
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- The walk-in attends the FIRST Saturday only, as a paid trial: billable,
  -- and with nobody to invoice.
  SELECT MIN(session_date) INTO v_sat FROM lesson_sessions
    WHERE class_id = v_class
      AND session_date >= v_month
      AND session_date < v_month + INTERVAL '1 month';

  SELECT id INTO v_session FROM lesson_sessions
    WHERE class_id = v_class AND session_date = v_sat;

  -- Trial shape: enrolment opened AND closed on its own date, so they never
  -- block a later lesson's completeness check.
  INSERT INTO student_class_enrolments
    (student_id, class_id, enrolled_at, unenrolled_at, is_active)
  VALUES (v_walkin, v_class, v_sat, v_sat, FALSE);

  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
  VALUES (v_session, v_walkin, 'trial_paid', v_coach_pf);

  RAISE NOTICE 'Fixture Walkin billable on % (billing month %)',
    v_sat, to_char(v_month, 'YYYY-MM');
END $$;

COMMIT;
