-- ============================================================
-- suggest_package_start() — the smart default for a new sale's start date.
-- Plan: docs/plans/PACKAGE_WEEKS_HOLIDAYS_PLAN.md, Decision 2 / ⚠ RISK 7.
--
-- "Start the new package when the parent's current coverage ENDS", where a
-- package is done at whichever comes first — its lessons run out or its time
-- runs out:
--
--     done_date = LEAST(effective_expiry, forecast_exhaustion)
--     suggestion = MAX(done_date over the parent's overlapping active packages) + 1
--
-- forecast_exhaustion simulates weekly draws from TODAY over the covered kids'
-- CURRENT active enrolments; with no enrolments the stream cannot be forecast,
-- so the package is bounded by its expiry alone. No overlapping coverage ⇒
-- today (SGT).
--
-- ⚠ RISK 7 — wrong-but-harmless: the value is an editable pre-fill, so a soft
-- forecast is fine, but availability and the clock are not. Everything is SQL
-- over DATEs with SGT "today" (never a client toISOString, §7.7); the caller
-- fails open to today if this returns NULL. SECURITY INVOKER — it reads only
-- rows the admin can already see; nothing is disclosed.
-- ============================================================

CREATE OR REPLACE FUNCTION suggest_package_start(p_parent_id uuid, p_product_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH today AS (
    SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS d
  ),
  prod AS (
    SELECT tenant_id, category_id FROM package_products WHERE id = p_product_id
  ),
  -- The parent's active packages that would OVERLAP the new one's coverage
  -- (same category, or either side is all-classes).
  active_pkgs AS (
    SELECT pp.id, pp.category_id, pp.expires_on, pp.rate_per_lesson, pp.value_remaining
    FROM parent_packages pp
    JOIN prod ON pp.tenant_id = prod.tenant_id
    WHERE pp.parent_id = p_parent_id
      AND pp.status = 'active'
      AND (prod.category_id IS NULL
           OR pp.category_id IS NULL
           OR pp.category_id = prod.category_id)
  ),
  -- Weekly draw rate PER package: how many of the covered kids' current
  -- active class enrolments this package would fund (one class = one lesson/wk;
  -- two kids, or a kid in two classes, both raise the rate — §8.43).
  weekly AS (
    SELECT ap.id,
           count(*) AS weekly_lessons
    FROM active_pkgs ap
    JOIN parent_students ps        ON ps.parent_id = p_parent_id
    JOIN student_class_enrolments e ON e.student_id = ps.student_id AND e.is_active
    JOIN classes c                  ON c.id = e.class_id
                                    AND c.is_active
                                    AND c.tenant_id = (SELECT tenant_id FROM prod)
                                    AND (ap.category_id IS NULL OR c.category_id = ap.category_id)
    GROUP BY ap.id
  ),
  done_dates AS (
    SELECT
      CASE
        WHEN COALESCE(w.weekly_lessons, 0) > 0 THEN
          LEAST(
            ap.expires_on,
            (SELECT d FROM today)
              + (ceil(floor(ap.value_remaining / ap.rate_per_lesson)::numeric
                      / w.weekly_lessons)::int * 7)
          )
        ELSE ap.expires_on
      END AS done_date
    FROM active_pkgs ap
    LEFT JOIN weekly w ON w.id = ap.id
  )
  SELECT COALESCE(
    (SELECT max(done_date) + 1 FROM done_dates),
    (SELECT d FROM today)
  );
$$;

REVOKE EXECUTE ON FUNCTION suggest_package_start(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION suggest_package_start(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION suggest_package_start(uuid, uuid) IS
  'Editable default for a new package sale''s start date: MAX over the parent''s '
  'overlapping active packages of LEAST(effective expiry, forecast exhaustion), '
  'plus one day; today (SGT) if there is no current coverage. ⚠ RISK 7 — a '
  'pre-fill, not a rule; callers fail open to today.';
