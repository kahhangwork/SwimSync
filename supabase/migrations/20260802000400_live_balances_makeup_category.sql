-- ============================================================
-- package_live_balances() learns the make-up category snapshot.
--
-- The function simulates the engine's package allocation over billable,
-- not-yet-invoiced attendance — and the two are PINNED by a Deno test ("no
-- pending-draw logic in TypeScript", PACKAGES_DESIGN ⚠ RISK 4). The engine
-- now matches a MAKE-UP row against the booking's snapshotted category
-- (makeup_bookings.category_id, §7.45); this simulation matched the host
-- class's LIVE category. Re-tag the host class between booking and generation
-- and the two would drift — the chip predicting one draw, the invoice settling
-- another. The COALESCE below makes the simulation read the same snapshot.
--
-- Body re-derived from the live definition (§7.40); the ONLY change is the
-- LEFT JOIN + COALESCE in the pending-lessons loop.
-- ============================================================

CREATE OR REPLACE FUNCTION public.package_live_balances()
RETURNS TABLE(parent_package_id uuid, parent_id uuid, tenant_id uuid, name text,
              category_id uuid, rate_per_lesson numeric, lesson_count integer,
              total_value numeric, expires_on date, value_remaining numeric,
              live_value_remaining numeric, live_lessons_remaining integer)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
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
           (pp.confirmed_at AT TIME ZONE 'Asia/Singapore')::date AS starts
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
  -- order). "No invoice line" is the definition of pending — invoiced draws
  -- are already inside value_remaining.
  --
  -- A lesson's CATEGORY is the make-up booking's snapshot when the row is a
  -- make-up guest's, else the class's live category — exactly the engine's
  -- rule at item construction.
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
$$;
