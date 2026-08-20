-- Rollback of 20260820000100: restore mark_day_holiday's original predicate
-- (the 20260818000900 body verbatim — bare ::date `> p_date`, both places).
-- Run once against a real apply (§7.93), then re-apply the UP.

CREATE OR REPLACE FUNCTION mark_day_holiday(p_tenant uuid, p_date date)
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

REVOKE ALL ON FUNCTION mark_day_holiday(uuid, date)   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_day_holiday(uuid, date) TO authenticated;
