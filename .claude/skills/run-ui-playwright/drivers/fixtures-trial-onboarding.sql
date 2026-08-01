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
-- roundtrip-exempt: cross-fixture-writes — a COMPLETE month is the scenario, so it must mark every child enrolled in the class, siblings' included.
--
-- Completeness is measured across the whole roster, so scoping this to its own
-- walk-in would make the run refuse for the wrong reason and the assertion pass
-- vacuously. The teardown compensates — it deletes every attendance row in that
-- month on that class, for ANY student, not just its own.
--
-- This is a compensated hazard, not a safe pattern. The durable fix is for the
-- fixture to own its own class instead of borrowing the seed one
-- (`classes WHERE tenant_id = ... LIMIT 1` is also unordered, so which class it
-- borrows is not even stable). Filed in BACKLOG.md.

BEGIN;

-- The seed tenant and its one class.
\set tenant '70000000-0000-0000-0000-000000000001'

DO $$
DECLARE
  v_tenant   UUID := '70000000-0000-0000-0000-000000000001';
  v_class    UUID;
  v_coach_pf UUID;
  v_month    DATE;
  v_sat      DATE;
  v_session  UUID;
  v_walkin   UUID;
BEGIN
  SELECT id INTO v_class FROM classes WHERE tenant_id = v_tenant LIMIT 1;
  SELECT profile_id INTO v_coach_pf FROM coaches WHERE tenant_id = v_tenant LIMIT 1;

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
