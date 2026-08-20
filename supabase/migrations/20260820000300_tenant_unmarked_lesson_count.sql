-- ============================================================
-- tenant_unmarked_lesson_count(p_tenant) — the Lessons sidebar badge.
-- (docs/plans/CAPACITY_HOLIDAY_BADGE_PLAN.md, Phase C.)
--
-- A tenant-scoped scalar copy of the /lessons?mode=needs predicate: the count of
-- DISTINCT (class, date) lessons whose progress is 'unmarked' or 'partial'. It
-- must equal the page's needsCount (calendarLessons.ts buildCalendarLessons +
-- lessons/page.tsx), pinned by a driver that compares the badge to the page's
-- row count (§7.18 — two SQL/TS copies of one union).
--
-- The page's rules, reproduced exactly:
--   * Window: markable_floor(p_tenant) .. today_sg(). markableWindowStart(today,
--     floor) is min(floor, 1st-of-last-month), and markable_floor is already
--     LEAST(session_window_start()=1st-of-last-month, …) <= 1st-of-last-month, so
--     the two are equal (verified).
--   * Candidate (class, date): the class's weekday series in the window UNION the
--     class's actual session dates (off-weekday extras). ALL classes of the
--     tenant, retired included (calendarData loads with NO is_active filter —
--     RISK 5: do NOT add WHERE c.is_active).
--   * Retired: drop a PATTERN date on/after the SGT retirement date unless a
--     session row exists for it (calendarLessons.ts cutoff); a session-row date
--     is always kept.
--   * Expected: enrolment SPANS (SGT, inclusive) + uncancelled trials + make-ups,
--     DISTINCT student. Zero expected => 'no-students', not a lesson.
--   * Ended: date < today_sg() OR (date = today_sg() AND the CLASS's end_time <=
--     now SGT time) — calendarLessons.ts uses cls.end_time, not the session's.
--   * Counted iff expected>0 AND marked<expected AND (marked>0 OR ended):
--       marked=0 & ended            -> 'unmarked'  (counted)
--       0<marked<expected           -> 'partial'   (counted)
--       marked=0 & not ended        -> 'upcoming'  (skipped)
--       marked=expected             -> 'complete'/'holiday' (skipped)
--     A fully-voided day has a row per student (marked=expected) -> not counted.
--
-- SECURITY DEFINER; its own is_platform_admin/can_admin_tenant gate is the guard
-- (load-bearing — unbilled_sealed_lessons shape). Granted to authenticated only;
-- anon gets nothing (§7.39/§7.87). Weekday series uses a 7-DAY step from the first
-- matching weekday (RISK 5 — one-seventh of a daily series, same set). Local
-- EXPLAIN (ANALYZE) over seed + fixtures-admin-calendar: < 5 ms.
--
-- Does NOT modify class_unmarked_lesson_dates (deactivate_class's ungranted guard).
-- ============================================================

CREATE FUNCTION public.tenant_unmarked_lesson_count(p_tenant uuid) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT (is_platform_admin() OR can_admin_tenant(p_tenant)) THEN
    RAISE EXCEPTION 'Not authorized to read the unmarked-lesson count for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH win AS (
    SELECT markable_floor(p_tenant)                    AS floor_date,
           today_sg()                                  AS today_date,
           (now() AT TIME ZONE 'Asia/Singapore')::time AS now_time
  ),
  cls AS (
    SELECT c.id, c.day_of_week, c.end_time,
           CASE WHEN c.deactivated_at IS NOT NULL
                THEN (c.deactivated_at AT TIME ZONE 'Asia/Singapore')::date
           END AS cutoff,
           (CASE c.day_of_week
              WHEN 'sunday' THEN 0 WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2
              WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5
              WHEN 'saturday' THEN 6 END) AS dow
      FROM classes c
     WHERE c.tenant_id = p_tenant
  ),
  -- Weekday series with a 7-day step from the first matching weekday >= floor.
  pattern AS (
    SELECT cl.id AS class_id, d::date AS session_date
      FROM cls cl, win w,
           generate_series(
             w.floor_date + (((cl.dow - EXTRACT(DOW FROM w.floor_date)::int) + 7) % 7) * INTERVAL '1 day',
             w.today_date,
             INTERVAL '7 days'
           ) AS d
  ),
  sess AS (
    SELECT ls.class_id, ls.session_date
      FROM lesson_sessions ls
      JOIN cls cl ON cl.id = ls.class_id
      CROSS JOIN win w
     WHERE ls.session_date BETWEEN w.floor_date AND w.today_date
  ),
  -- A pattern date on/after the retirement cutoff is dropped unless a session
  -- row exists for it; a session-row date is always kept.
  candidate AS (
    SELECT p.class_id, p.session_date
      FROM pattern p
      JOIN cls cl ON cl.id = p.class_id
     WHERE cl.cutoff IS NULL
        OR p.session_date < cl.cutoff
        OR EXISTS (SELECT 1 FROM sess s WHERE s.class_id = p.class_id AND s.session_date = p.session_date)
    UNION
    SELECT s.class_id, s.session_date FROM sess s
  ),
  expected AS (
    SELECT cd.class_id, cd.session_date, e.student_id
      FROM candidate cd
      JOIN student_class_enrolments e
        ON e.class_id = cd.class_id
       AND (e.enrolled_at AT TIME ZONE 'Asia/Singapore')::date <= cd.session_date
       AND (e.unenrolled_at IS NULL
            OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= cd.session_date)
    UNION
    SELECT cd.class_id, cd.session_date, tb.student_id
      FROM candidate cd
      JOIN trial_bookings tb ON tb.class_id = cd.class_id AND tb.session_date = cd.session_date AND tb.cancelled_at IS NULL
    UNION
    SELECT cd.class_id, cd.session_date, mb.student_id
      FROM candidate cd
      JOIN makeup_bookings mb ON mb.class_id = cd.class_id AND mb.session_date = cd.session_date AND mb.cancelled_at IS NULL
  ),
  agg AS (
    SELECT x.class_id, x.session_date,
           count(*) AS expected_ct,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM lesson_sessions ls
              JOIN attendance a ON a.lesson_session_id = ls.id AND a.student_id = x.student_id
             WHERE ls.class_id = x.class_id AND ls.session_date = x.session_date
           )) AS marked_ct
      FROM expected x
     GROUP BY x.class_id, x.session_date
  )
  SELECT count(*)::int INTO v_count
    FROM agg a
    JOIN cls cl ON cl.id = a.class_id
    CROSS JOIN win w
   WHERE a.expected_ct > 0
     AND a.marked_ct < a.expected_ct
     AND (
       a.marked_ct > 0
       OR a.session_date < w.today_date
       OR (a.session_date = w.today_date AND cl.end_time <= w.now_time)
     );

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.tenant_unmarked_lesson_count(uuid) IS
  'Count of DISTINCT (class, date) lessons in this tenant whose progress is unmarked or partial — the scalar copy of /lessons?mode=needs (§7.18). SECURITY DEFINER; its own is_platform_admin/can_admin_tenant check is the gate.';

REVOKE ALL ON FUNCTION public.tenant_unmarked_lesson_count(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_unmarked_lesson_count(uuid) TO authenticated;

-- Apply-time ACL probe (§7.87): granted to authenticated, denied to anon.
DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.tenant_unmarked_lesson_count(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'tenant_unmarked_lesson_count lost EXECUTE for authenticated';
  END IF;
  IF has_function_privilege('anon', 'public.tenant_unmarked_lesson_count(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'tenant_unmarked_lesson_count is EXECUTE-able by anon — see §7.82';
  END IF;
END $$;
