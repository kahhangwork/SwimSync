-- ============================================================
-- mark_day_holiday: fix the retirement-boundary predicate on TWO axes.
--
-- 20260818000900 wrote the "is this class still running on p_date?" test as
--   (c.deactivated_at IS NOT NULL AND c.deactivated_at::date > p_date)
-- which drifts on two axes at once (docs/plans/CAPACITY_HOLIDAY_BADGE_PLAN.md, Phase A):
--   1. TIMEZONE — bare ::date is the server's UTC date (§7.7). A class retired
--      00:00–08:00 SGT reads as "still running" for one extra UTC day. The very
--      same function casts enrolment spans in SGT six lines down (its own comment
--      names the hazard); the retirement predicate should too.
--   2. INCLUSIVITY — the engine clamps a retired class's expected dates at the SGT
--      retirement date INCLUSIVE (core.ts expectedTo = lastScheduledDate;
--      dates.ts iterates ms <= end). `>` excludes the retirement date; `>=` matches.
--
-- Reachable effect: a class retired 00:00–08:00 SGT on D+1 has ::date = D in UTC,
-- so voiding D under the old predicate SKIPS the class — its already-marked
-- 'present' rows keep billing and covering packages are not extended (a wrong bill).
-- The SGT `>=` reaches it and ON CONFLICT flips those rows to 'holiday'.
-- Side effect (harmless, verified against core.ts:754-797): a class retired ON
-- p_date now materialises an EMPTY lesson_sessions row — nobody is expected, so the
-- gate `continue`s it and unmark_day_holiday deletes it, exactly as for an active
-- class with no students.
--
-- Same signature -> same pg_proc row -> the ACL survives (§7.123). unmark_day_holiday
-- matches on ls.session_date and has no date casts — do not touch it.
-- ============================================================

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

  -- Materialize the missing sessions (a class scheduled that weekday, running on
  -- that date — includes one retired ON OR AFTER the date, by its SGT date).
  INSERT INTO lesson_sessions (class_id, session_date, start_time, end_time)
  SELECT c.id, p_date, c.start_time, c.end_time
  FROM classes c
  WHERE c.tenant_id = p_tenant
    AND c.day_of_week::text = v_dow
    AND (c.is_active OR (c.deactivated_at IS NOT NULL
         AND (c.deactivated_at AT TIME ZONE 'Asia/Singapore')::date >= p_date))
  ON CONFLICT (class_id, session_date) DO NOTHING;

  WITH sessions AS (
    SELECT ls.id AS session_id, ls.class_id
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
    WHERE ls.session_date = p_date
      AND c.tenant_id = p_tenant
      AND c.day_of_week::text = v_dow
      AND (c.is_active OR (c.deactivated_at IS NOT NULL
           AND (c.deactivated_at AT TIME ZONE 'Asia/Singapore')::date >= p_date))
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

COMMENT ON FUNCTION mark_day_holiday(uuid, date) IS
  'Voids a declared public-holiday day: a holiday attendance row for every expected student of every class scheduled that weekday and still running on that date — a class retired on or after the date, by its SGT date (inclusive). SECURITY DEFINER; its own can_admin_tenant check is the gate.';

REVOKE ALL ON FUNCTION mark_day_holiday(uuid, date)   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_day_holiday(uuid, date) TO authenticated;

-- ── Apply-time ACL probe (⚠ plan RISK 7) — RAISE, do not warn ────────────────
-- CREATE OR REPLACE preserves the ACL, so nothing should have moved; §7.87 makes
-- that worth asserting. 20260818000900 revoked from PUBLIC only, never from anon
-- explicitly, so this is the FIRST migration to assert the cloud ACL of this
-- function: if it aborts db push on production, that is a real finding (§7.39).
DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.mark_day_holiday(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'mark_day_holiday() lost EXECUTE for authenticated — the admin UI would fail with permission denied';
  END IF;
  IF has_function_privilege('anon', 'public.mark_day_holiday(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'mark_day_holiday() is EXECUTE-able by anon — see §7.82';
  END IF;
END $$;
