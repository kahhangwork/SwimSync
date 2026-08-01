-- ============================================================
-- student_package_coverage(): "is this child paid by package or ad hoc,
-- and how many prepaid lessons does their family have left?"
--
-- WHY IT EXISTS. A package is money held per (parent, tenant), optionally
-- scoped to a class category — never per child. Every screen that shows a
-- child's name now wants a payment-method chip, and each of them would
-- otherwise have to join packages → enrolments → categories itself, in two
-- codebases. This function is that join, written once. It is category
-- *matching* over package_live_balances() output — the live numbers are
-- CONSUMED, never recomputed, so PACKAGES_DESIGN.md ⚠ RISK 4 ("only one
-- derivation of pending draws") is upheld, not violated.
--
-- THE COVERAGE PREDICATE IS CATEGORY + DATE ONLY — deliberately NOT the
-- engine's affordability rule. An exhausted but active, unexpired package
-- (0 lessons left) still covers its categories: that child reads
-- "Package · 0 left", never "Ad-hoc", because "buy a top-up" and "you are
-- not a package family" are different messages. Do not add
-- live_value_remaining >= rate_per_lesson here; that is the engine's
-- per-lesson draw rule, and a pgTAP test pins its absence.
--
-- VERDICTS, one row per (student, linked parent):
--   'package' — every category the child is actively enrolled in is covered
--               by some active, unexpired package of that parent at that
--               child's business (a NULL-category package covers all).
--   'mixed'   — some enrolled categories covered, some not.
--   'ad_hoc'  — none covered, or the family holds no live package there.
--   A child with NO active enrolments has no category to match: any live
--   package at their business → 'package' (generic), else 'ad_hoc'.
--   An unclaimed child (no parent_students row) returns NO row — there is
--   no family to have a payment method yet.
--
-- lessons_remaining sums live_lessons_remaining over the packages that
-- cover at least one of the child's categories (all of the family's
-- packages at that tenant, for the no-enrolment case); NULL when ad_hoc.
-- It is FAMILY-SHARED: two siblings can both truthfully read "8 left" from
-- the same pool, and UI copy must say so.
--
-- SECURITY INVOKER on purpose: RLS scopes everything. A parent computes
-- over their own children and packages; a tenant admin over their tenant's;
-- the platform admin over everyone (rows carry tenant_id for grouping); a
-- coach sees zero package rows, so this function tells a coach nothing —
-- which is the standing design decision, not an accident.
-- ============================================================

CREATE FUNCTION public.student_package_coverage()
RETURNS TABLE (
  student_id        UUID,
  parent_id         UUID,
  tenant_id         UUID,
  coverage          TEXT,
  lessons_remaining INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH live AS (
  -- Active AND unexpired. package_live_balances() returns date-expired rows
  -- whose status is still 'active' (expiry is derived, never flipped); every
  -- caller used to be trusted to re-filter, and the Students page didn't.
  SELECT lv.parent_id, lv.tenant_id, lv.category_id, lv.live_lessons_remaining
  FROM package_live_balances() lv
  WHERE lv.expires_on >= (now() AT TIME ZONE 'Asia/Singapore')::date
),
links AS (
  SELECT ps.student_id, ps.parent_id, s.tenant_id
  FROM parent_students ps
  JOIN students s ON s.id = ps.student_id
),
cats AS (
  -- The categories each child is ACTIVELY enrolled in.
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

COMMENT ON FUNCTION public.student_package_coverage() IS
  'Per-child payment-method verdict (package | mixed | ad_hoc) + family-shared '
  'live lessons remaining. Category matching over package_live_balances(); '
  'coverage is category + date only — never the engine''s affordability rule. '
  'One row per (student, linked parent); unclaimed children return no row.';

REVOKE ALL ON FUNCTION public.student_package_coverage() FROM PUBLIC;
-- §7.39 — cloud default-grants new functions to anon; revoke explicitly and
-- verify with a remote grant dump at deploy time.
REVOKE EXECUTE ON FUNCTION public.student_package_coverage() FROM anon;
GRANT EXECUTE ON FUNCTION public.student_package_coverage() TO authenticated, service_role;
