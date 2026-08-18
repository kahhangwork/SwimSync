-- ============================================================
-- Holiday attendance, step 4c: the admin's "void this day" entry point.
--
-- mark_day_holiday materializes a lesson_session (lazy — none exist for future
-- dates) and a 'holiday' attendance row for every EXPECTED student of every class
-- scheduled on that date, so the day is voided in one click. The reconcile trigger
-- (20260818000700) then extends the covering packages; the credit-note trigger
-- (20260309000500) auto-credits any lesson already billed at 'present'.
--
-- SECURITY DEFINER, so it runs as postgres and is exempt from the admin-only guard
-- (20260818000800) at the current_user seam — its own can_admin_tenant check IS the
-- gate. The window guard (§8.15) exempts it the same way, so it can void a past or
-- future date; nothing else bounds the date, so it is bounded HERE to a declared
-- calendar holiday (which also keeps parents' upcoming-lessons suppression in step).
--
-- EXPECTED-SET PARITY (⚠ plan RISK 6): a holiday row for every student the
-- completeness gate would name — active-as-of-date enrolments AND trial/make-up
-- guests — or an unvoided guest lesson still blocks the month's billing.
-- ============================================================

CREATE FUNCTION mark_day_holiday(p_tenant uuid, p_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_dow   text := (ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])
                    [EXTRACT(ISODOW FROM p_date)::int];
  v_count integer;
BEGIN
  IF NOT can_admin_tenant(p_tenant) THEN
    RAISE EXCEPTION 'Not authorized to void a day for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tenant_public_holidays
                  WHERE tenant_id = p_tenant AND holiday_date = p_date) THEN
    RAISE EXCEPTION 'Add % to the public-holiday calendar before voiding its lessons.', p_date
      USING ERRCODE = 'check_violation';
  END IF;

  -- Materialize the missing sessions (a class scheduled that weekday, running on
  -- that date — includes one retired AFTER the date when voiding the past).
  INSERT INTO lesson_sessions (class_id, session_date, start_time, end_time)
  SELECT c.id, p_date, c.start_time, c.end_time
  FROM classes c
  WHERE c.tenant_id = p_tenant
    AND c.day_of_week::text = v_dow
    AND (c.is_active OR (c.deactivated_at IS NOT NULL AND c.deactivated_at::date > p_date))
  ON CONFLICT (class_id, session_date) DO NOTHING;

  WITH sessions AS (
    SELECT ls.id AS session_id, ls.class_id
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
    WHERE ls.session_date = p_date
      AND c.tenant_id = p_tenant
      AND c.day_of_week::text = v_dow
      AND (c.is_active OR (c.deactivated_at IS NOT NULL AND c.deactivated_at::date > p_date))
  ),
  expected AS (
    -- SGT casts, not bare ::date (which is the UTC date, §7.7): the billing
    -- gate's enrolment spans are SGT (core.ts dateInTimeZone), and this set
    -- must match it exactly or an unvoided student blocks the month (RISK 6).
    SELECT s.session_id, e.student_id
      FROM sessions s
      JOIN student_class_enrolments e ON e.class_id = s.class_id
       AND (e.enrolled_at AT TIME ZONE 'Asia/Singapore')::date <= p_date
       AND (e.unenrolled_at IS NULL
            OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= p_date)
    UNION
    SELECT s.session_id, tb.student_id
      FROM sessions s
      JOIN trial_bookings tb ON tb.class_id = s.class_id
       AND tb.session_date = p_date AND tb.cancelled_at IS NULL
    UNION
    SELECT s.session_id, mb.student_id
      FROM sessions s
      JOIN makeup_bookings mb ON mb.class_id = s.class_id
       AND mb.session_date = p_date AND mb.cancelled_at IS NULL
  ),
  ins AS (
    INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
    SELECT session_id, student_id, 'holiday', v_actor FROM expected
    ON CONFLICT (lesson_session_id, student_id)
      DO UPDATE SET status = 'holiday', marked_by = v_actor
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN v_count;
END;
$$;

-- Undo: remove the holiday rows for the date, then any session left empty by it
-- (an empty materialized session would make unmarkedOn() return every student and
-- BLOCK the whole month's billing — core.ts). The DELETE fires the reconcile
-- DELETE trigger, which retracts the extensions exactly.
CREATE FUNCTION unmark_day_holiday(p_tenant uuid, p_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT can_admin_tenant(p_tenant) THEN
    RAISE EXCEPTION 'Not authorized to un-void a day for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH del AS (
    DELETE FROM attendance a
    USING lesson_sessions ls, classes c
    WHERE a.lesson_session_id = ls.id
      AND ls.class_id = c.id
      AND c.tenant_id = p_tenant
      AND ls.session_date = p_date
      AND a.status = 'holiday'
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM del;

  DELETE FROM lesson_sessions ls
  USING classes c
  WHERE ls.class_id = c.id
    AND c.tenant_id = p_tenant
    AND ls.session_date = p_date
    AND ls.off_schedule_reason IS NULL
    AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.lesson_session_id = ls.id);

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION mark_day_holiday(uuid, date)   FROM PUBLIC;
REVOKE ALL ON FUNCTION unmark_day_holiday(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_day_holiday(uuid, date)   TO authenticated;
GRANT EXECUTE ON FUNCTION unmark_day_holiday(uuid, date) TO authenticated;
