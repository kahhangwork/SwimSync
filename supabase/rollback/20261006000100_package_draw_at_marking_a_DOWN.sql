-- Rollback for 20261006000100_package_draw_at_marking_a.sql (Wave 6, migration A — expand only).
--
-- ⚠ ONLY BEFORE MIGRATION B. Once B has flipped the switch, roll B back first (its own DOWN), which reverses
-- every marking-time draw. This file REFUSES while any tenant's switch is on or any marking-time draw exists.
-- ⚠ APPS FIRST: no served bundle may call package_backlog_preview / draw_package_backlog / package_usage /
-- package_month_funding (grep the served admin + app bundles, §7.31) before this runs.
-- After running: DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261006000100';
-- The four redefined functions are restored to their bodies as read from the DB before A (§7.40).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenants WHERE package_draw_at_marking) THEN
    RAISE EXCEPTION 'a tenant has package_draw_at_marking on — roll back migration B first';
  END IF;
  IF EXISTS (SELECT 1 FROM package_applications WHERE invoice_item_id IS NULL) THEN
    RAISE EXCEPTION 'marking-time draws exist — roll back migration B first';
  END IF;
END $$;

DROP TRIGGER guard_package_draw_order_trg ON public.attendance;
DROP TRIGGER trg_attendance_package_draw ON public.attendance;
DROP TRIGGER trg_invoice_item_not_drawn ON public.invoice_items;

DROP FUNCTION public.package_month_funding(UUID);
DROP FUNCTION public.package_usage(UUID);
DROP FUNCTION public.draw_package_backlog(UUID);
DROP FUNCTION public.package_backlog_preview(UUID);
DROP FUNCTION public.package_backlog_lessons(UUID);
DROP FUNCTION public.guard_package_draw_order();
DROP FUNCTION public.guard_invoice_item_not_drawn();
DROP FUNCTION public.attendance_package_draw();
DROP FUNCTION public.package_return_for(UUID, UUID);
DROP FUNCTION public.package_draw_for(UUID, UUID);

CREATE OR REPLACE FUNCTION public.class_unmarked_lesson_dates(p_class_id uuid)
 RETURNS date[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cls AS (
    SELECT c.id, c.tenant_id, c.day_of_week
      FROM classes c
     WHERE c.id = p_class_id
  ),
  win AS (
    SELECT markable_floor((SELECT tenant_id FROM cls)) AS floor_date,
           today_sg()                                  AS today_date
  ),
  -- Every date the class was DUE to run in the window, plus every date it
  -- actually recorded a session on. The second arm is not redundant: an extra
  -- lesson (schedule_extra_lesson) sits off the class's own weekday and would
  -- never appear in the weekday series.
  candidate_dates AS (
    SELECT d::date AS session_date
      FROM win w,
           generate_series(w.floor_date, w.today_date, INTERVAL '1 day') AS d
     WHERE (ARRAY['sunday','monday','tuesday','wednesday','thursday',
                  'friday','saturday'])[EXTRACT(DOW FROM d)::int + 1]
           = (SELECT day_of_week::text FROM cls)
    UNION
    SELECT ls.session_date
      FROM lesson_sessions ls, win w
     WHERE ls.class_id = p_class_id
       AND ls.session_date BETWEEN w.floor_date AND w.today_date
  ),
  -- (date, student) pairs someone should have marked.
  expected AS (
    SELECT cd.session_date, e.student_id
      FROM candidate_dates cd
      JOIN student_class_enrolments e
        ON e.class_id = p_class_id
       AND (e.enrolled_at AT TIME ZONE 'Asia/Singapore')::date <= cd.session_date
       AND (e.unenrolled_at IS NULL
            OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= cd.session_date)
     -- A cancelled lesson expects nobody enrolled (20260821000700).
     WHERE NOT EXISTS (
       SELECT 1 FROM lesson_sessions ls
        WHERE ls.class_id = p_class_id
          AND ls.session_date = cd.session_date
          AND ls.cancelled_at IS NOT NULL
     )
    UNION
    SELECT tb.session_date, tb.student_id
      FROM trial_bookings tb
      JOIN candidate_dates cd ON cd.session_date = tb.session_date
     WHERE tb.class_id = p_class_id
       AND tb.cancelled_at IS NULL
    UNION
    SELECT mb.session_date, mb.student_id
      FROM makeup_bookings mb
      JOIN candidate_dates cd ON cd.session_date = mb.session_date
     WHERE mb.class_id = p_class_id
       AND mb.cancelled_at IS NULL
  )
  SELECT COALESCE(
           array_agg(DISTINCT x.session_date ORDER BY x.session_date),
           '{}'::DATE[]
         )
    FROM expected x
   WHERE NOT EXISTS (
     SELECT 1
       FROM lesson_sessions ls
       JOIN attendance a
         ON a.lesson_session_id = ls.id
        AND a.student_id = x.student_id
      WHERE ls.class_id = p_class_id
        AND ls.session_date = x.session_date
   );
$function$

;

DROP FUNCTION public.class_unmarked_lesson_pairs(UUID);
DROP FUNCTION public.package_candidates_for(UUID, UUID);

CREATE OR REPLACE FUNCTION public.package_live_balances()
 RETURNS TABLE(parent_package_id uuid, parent_id uuid, tenant_id uuid, name text, category_id uuid, rate_per_lesson numeric, lesson_count integer, total_value numeric, expires_on date, value_remaining numeric, live_value_remaining numeric, live_lessons_remaining integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  pkg_ids        UUID[]    := '{}';
  pkg_parents    UUID[]    := '{}';
  pkg_tenants    UUID[]    := '{}';
  pkg_cats       UUID[]    := '{}';
  pkg_rates      NUMERIC[] := '{}';
  pkg_starts     DATE[]    := '{}';
  pkg_ends       DATE[]    := '{}';
  pkg_remaining  NUMERIC[] := '{}';
  r    RECORD;
  les  RECORD;
  i    INTEGER;
BEGIN
  -- Active packages, in exactly the engine's draw order.
  FOR r IN
    SELECT pp.id, pp.parent_id AS p_id, pp.tenant_id AS t_id, pp.category_id AS c_id,
           pp.rate_per_lesson AS rate, pp.expires_on AS ends, pp.value_remaining AS rem,
           pp.start_date AS starts
    FROM parent_packages pp
    WHERE pp.status = 'active'
    ORDER BY pp.expires_on, pp.confirmed_at, pp.id
  LOOP
    pkg_ids       := pkg_ids       || r.id;
    pkg_parents   := pkg_parents   || r.p_id;
    pkg_tenants   := pkg_tenants   || r.t_id;
    pkg_cats      := pkg_cats      || r.c_id;
    pkg_rates     := pkg_rates     || r.rate;
    pkg_starts    := pkg_starts    || r.starts;
    pkg_ends      := pkg_ends      || r.ends;
    pkg_remaining := pkg_remaining || r.rem;
  END LOOP;

  -- Billable, not-yet-invoiced lessons, chronological (the engine's item
  -- order). A lesson's CATEGORY is the make-up booking's snapshot when the row
  -- is a make-up guest's, else the class's live category — the engine's rule.
  FOR les IN
    SELECT ps.parent_id AS p_id, c.tenant_id AS t_id,
           COALESCE(mb.category_id, c.category_id) AS c_id,
           ls.session_date AS d
    FROM attendance a
    JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
    JOIN classes c          ON c.id = ls.class_id
    JOIN parent_students ps ON ps.student_id = a.student_id
    LEFT JOIN makeup_bookings mb
      ON mb.student_id = a.student_id
     AND mb.class_id = ls.class_id
     AND mb.session_date = ls.session_date
     AND mb.cancelled_at IS NULL
    WHERE a.status IN ('present', 'trial_paid')
      AND NOT EXISTS (
        SELECT 1 FROM invoice_items ii
        WHERE ii.lesson_session_id = a.lesson_session_id
          AND ii.student_id = a.student_id
      )
    ORDER BY ls.session_date, a.student_id
  LOOP
    FOR i IN 1 .. coalesce(array_length(pkg_ids, 1), 0) LOOP
      IF pkg_parents[i] = les.p_id
         AND pkg_tenants[i] = les.t_id
         AND (pkg_cats[i] IS NULL OR pkg_cats[i] = les.c_id)
         AND les.d >= pkg_starts[i]
         AND les.d <= pkg_ends[i]
         AND pkg_remaining[i] >= pkg_rates[i]
      THEN
        pkg_remaining[i] := pkg_remaining[i] - pkg_rates[i];
        EXIT;
      END IF;
    END LOOP;
  END LOOP;

  FOR i IN 1 .. coalesce(array_length(pkg_ids, 1), 0) LOOP
    RETURN QUERY
      SELECT pp.id, pp.parent_id, pp.tenant_id, pp.name, pp.category_id,
             pp.rate_per_lesson, pp.lesson_count, pp.total_value, pp.expires_on,
             pp.value_remaining,
             pkg_remaining[i],
             floor(pkg_remaining[i] / pp.rate_per_lesson)::integer
      FROM parent_packages pp WHERE pp.id = pkg_ids[i];
  END LOOP;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.unbilled_sealed_lessons(p_tenant uuid)
 RETURNS TABLE(student_id uuid, student_name text, billing_month text, lessons bigint, earliest_session_date date, latest_session_date date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (is_platform_admin() OR (is_platform_admin() OR has_admin_area(p_tenant, 'operations', 'view'))) THEN
    RAISE EXCEPTION 'not authorised to read this business''s billing reports';
  END IF;

  RETURN QUERY
  SELECT
    a.student_id,
    s.full_name,
    to_char(ls.session_date, 'YYYY-MM'),
    count(*),
    min(ls.session_date),
    max(ls.session_date)
  FROM attendance a
  JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
  JOIN classes c          ON c.id = ls.class_id
  JOIN students s         ON s.id = a.student_id
  WHERE c.tenant_id = p_tenant
    -- The engine's own billability rule (core.ts BILLABLE, PRD §5.4).
    AND a.status IN ('present', 'trial_paid')
    -- Only months this tenant has SEALED. An unsealed month is not orphaned:
    -- its lessons hold the month open and bill normally.
    AND EXISTS (
      SELECT 1 FROM billing_periods bp
       WHERE bp.tenant_id = p_tenant
         AND bp.billing_month = to_char(ls.session_date, 'YYYY-MM'))
    -- Never billed: no invoice line for THIS student on THIS lesson.
    AND NOT EXISTS (
      SELECT 1 FROM invoice_items ii
       WHERE ii.student_id = a.student_id
         AND ii.lesson_session_id = a.lesson_session_id)
    -- Not already settled: same rule the engine applies to unclaimed
    -- attendance — a live settlement covers lessons ON OR BEFORE its date.
    AND NOT EXISTS (
      SELECT 1 FROM student_settlements ss
       WHERE ss.student_id = a.student_id
         AND ss.reversed_at IS NULL
         AND ss.settled_through >= ls.session_date)
  GROUP BY a.student_id, s.full_name, to_char(ls.session_date, 'YYYY-MM')
  ORDER BY to_char(ls.session_date, 'YYYY-MM'), s.full_name;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.guard_tenant_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_map CONSTANT JSONB := '{
    "display_name":"profile","slug":"profile","logo_url":"profile","join_code":"profile",
    "paynow_qr_url":"billing","paynow_uen":"billing","paynow_mobile":"billing",
    "auto_invoice_enabled":"billing","invoice_run_day":"billing",
    "rain_pays_coach":"wages","wage_run_day":"wages",
    "low_package_lessons":"packages","package_expiry_warning_days":"packages",
    "default_package_product_id":"packages","holiday_extension_days":"packages",
    "referral_enabled":"packages","referral_discount_type":"packages",
    "referral_discount_value":"packages","referral_reward_expiry_days":"packages",
    "updated_at":"any",
    "id":"nobody","created_at":"nobody","owner_profile_id":"nobody","suspended_at":"nobody",
    "credit_note_counter":"nobody","invoice_counter":"nobody","package_counter":"nobody"
  }';
  v_old  JSONB := to_jsonb(OLD);
  v_new  JSONB := to_jsonb(NEW);
  v_col  TEXT;
  v_area TEXT;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  FOR v_col IN SELECT k FROM jsonb_object_keys(v_new) k WHERE v_new->k IS DISTINCT FROM v_old->k LOOP
    v_area := v_map->>v_col;
    IF v_area IS NULL THEN
      RAISE EXCEPTION 'tenants.% is not mapped to an area — add it to guard_tenant_columns() before a client may change it', v_col
        USING ERRCODE = 'insufficient_privilege';
    ELSIF v_area = 'any' THEN
      CONTINUE;
    ELSIF v_area = 'nobody' THEN
      -- guard_tenants_owner already refuses owner_profile_id with its own
      -- message; this also closes the counters and suspension.
      RAISE EXCEPTION 'tenants.% cannot be changed directly', v_col USING ERRCODE = 'insufficient_privilege';
    ELSIF NOT is_platform_admin() AND NOT has_admin_area(NEW.id, v_area::admin_area, 'edit') THEN
      RAISE EXCEPTION 'your role cannot change % settings (tenants.%)', v_area, v_col
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$

;

DROP INDEX public.package_applications_live_lesson_uniq;
ALTER TABLE public.package_applications
  DROP CONSTRAINT package_applications_one_shape,
  DROP COLUMN lesson_date,
  DROP COLUMN student_id,
  DROP COLUMN lesson_session_id,
  ALTER COLUMN invoice_item_id SET NOT NULL;

ALTER TABLE public.tenants DROP COLUMN package_draw_at_marking;
