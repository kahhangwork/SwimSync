-- ============================================================
-- student_package_coverage() learns the explicit start_date.
--
-- Until packages carried an explicit start_date, "active" implied "already
-- started" (a package was anchored at its SGT confirmation date, never the
-- future). The new admin-set start_date makes "active, but starts next month"
-- a legal state — and this coverage RPC (the package/ad-hoc/mixed badge on ~9
-- screens: admin attendance, trials, classes, dashboard, students, unassigned,
-- and the parent's home / child detail) filtered only on expiry, so it would
-- report a child as package-COVERED during the gap before their package starts,
-- while the engine correctly bills those lessons ad-hoc. An admin trusting the
-- badge would under-collect.
--
-- The fix: a future-start package is not yet coverage. Join back to
-- parent_packages (package_live_balances() already returns parent_package_id)
-- and require start_date <= today. Body otherwise re-derived verbatim from the
-- live definition (§7.115); the ONLY change is the two-line start_date gate.
-- ============================================================

CREATE OR REPLACE FUNCTION student_package_coverage()
RETURNS TABLE (student_id uuid, parent_id uuid, tenant_id uuid,
               coverage text, lessons_remaining integer)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH live AS (
  -- Active, unexpired, AND already started. package_live_balances() returns
  -- date-expired rows whose status is still 'active' (expiry is derived, never
  -- flipped); it also returns future-start packages. Both are excluded here.
  SELECT lv.parent_id, lv.tenant_id, lv.category_id, lv.live_lessons_remaining
  FROM package_live_balances() lv
  JOIN parent_packages pp ON pp.id = lv.parent_package_id
  WHERE lv.expires_on >= (now() AT TIME ZONE 'Asia/Singapore')::date
    AND pp.start_date <= (now() AT TIME ZONE 'Asia/Singapore')::date
),
links AS (
  SELECT ps.student_id, ps.parent_id, s.tenant_id
  FROM parent_students ps
  JOIN students s ON s.id = ps.student_id
),
cats AS (
  SELECT DISTINCT sce.student_id, c.category_id
  FROM student_class_enrolments sce
  JOIN classes c ON c.id = sce.class_id
  WHERE sce.is_active
),
verdict AS (
  SELECT
    l.student_id, l.parent_id, l.tenant_id,
    (SELECT count(*) FROM cats ct WHERE ct.student_id = l.student_id) AS n_cats,
    (SELECT count(*) FROM cats ct
      WHERE ct.student_id = l.student_id
        AND EXISTS (
          SELECT 1 FROM live lv
          WHERE lv.parent_id = l.parent_id
            AND lv.tenant_id = l.tenant_id
            AND (lv.category_id IS NULL OR lv.category_id = ct.category_id)
        )) AS n_covered,
    EXISTS (
      SELECT 1 FROM live lv
      WHERE lv.parent_id = l.parent_id AND lv.tenant_id = l.tenant_id
    ) AS has_any
  FROM links l
)
SELECT
  v.student_id,
  v.parent_id,
  v.tenant_id,
  CASE
    WHEN v.n_cats = 0 THEN CASE WHEN v.has_any THEN 'package' ELSE 'ad_hoc' END
    WHEN v.n_covered = 0 THEN 'ad_hoc'
    WHEN v.n_covered = v.n_cats THEN 'package'
    ELSE 'mixed'
  END AS coverage,
  CASE
    WHEN (v.n_cats = 0 AND v.has_any) OR v.n_covered > 0 THEN
      (SELECT sum(lv.live_lessons_remaining)::integer
       FROM live lv
       WHERE lv.parent_id = v.parent_id
         AND lv.tenant_id = v.tenant_id
         AND (v.n_cats = 0
              OR lv.category_id IS NULL
              OR lv.category_id IN (SELECT ct.category_id FROM cats ct
                                     WHERE ct.student_id = v.student_id)))
    ELSE NULL
  END AS lessons_remaining
FROM verdict v
$$;
