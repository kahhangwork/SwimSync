-- Wave 4 → Wave 5 pulled forward: an operations-only co-admin can see WHO TAUGHT, never the price.
-- docs/plans/WAVE4_START_DATE_FRONT_DESK_PLAN.md §2.3; BACKLOG *A co-admin without pricing access may see NO
-- teaching coach anywhere* — CONFIRMED 2026-10-05 by lane 2's verify-front-desk-role driver.
--
-- WHY. Since 20260927000500, reading class_rates needs pricing:view (class_rates_admin_select). The teaching
-- coach of a lesson is resolved from the class rate in force (lib/lessonAttribution.ts) unless a substitute is
-- named, so a Front-desk co-admin (operations edit, every money area none — the role being hired) read ZERO
-- rates: the Calendar named nobody, the lesson page said "Teaching: —", the prev/next strip grouped the day
-- under "Unassigned", and the Attendance page's Coach column was blank. RLS filters rather than errors, so it
-- was silent.
--
-- WHAT. class_coach_terms(p_class_ids): the three NON-money columns of class_rates — (class_id,
-- effective_from, paid_coach_id) — for every class the caller may see with operations:view OR pricing:view
-- (or as platform admin). price_per_lesson is NEVER returned. Rows the caller may not see are FILTERED, not
-- refused — the same shape RLS gave the readers, so each reader swaps its .from("class_rates") for this RPC
-- with no other change. NULL p_class_ids = every visible class.
--
-- NOT CHANGED: class_rates' policies. Pricing stays behind pricing:view; this is a narrower window beside it.
--
-- REMOTE CHECK after deploy (§7.39):
--   scripts/prod-query-ro.sh "select has_function_privilege('anon','public.class_coach_terms(uuid[])','EXECUTE')"  → false
--
-- ROLLBACK: supabase/rollback/20261005000200_who_taught_for_operations_DOWN.sql — APPS FIRST.

CREATE FUNCTION public.class_coach_terms(p_class_ids UUID[])
RETURNS TABLE (class_id UUID, effective_from DATE, paid_coach_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.class_id, r.effective_from, r.paid_coach_id
    FROM class_rates r
   WHERE (p_class_ids IS NULL OR r.class_id = ANY (p_class_ids))
     AND auth.uid() IS NOT NULL
     AND (   is_platform_admin()
          OR has_admin_area(class_tenant(r.class_id), 'operations', 'view')
          OR has_admin_area(class_tenant(r.class_id), 'pricing', 'view'))
   ORDER BY r.class_id, r.effective_from
$$;

COMMENT ON FUNCTION public.class_coach_terms(UUID[]) IS
  'Who-taught terms without the price: (class_id, effective_from, paid_coach_id) from class_rates for classes the caller may see with operations:view or pricing:view (or platform admin). Filters, never refuses. price_per_lesson is never returned. NULL = every visible class. 20261005000200.';

REVOKE ALL ON FUNCTION public.class_coach_terms(UUID[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.class_coach_terms(UUID[]) TO authenticated;
