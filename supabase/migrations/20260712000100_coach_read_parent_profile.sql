-- ============================================================
-- Let a coach read the PROFILE of a parent they serve.
--
-- The coach Billing screen lists invoices for the coach's students
-- and the coach reconciles PayNow payments per parent, so the coach
-- needs the parent's display name. `coach_serves_parent(parent_id)`
-- already exposes the parents/invoices rows, but profiles_select did
-- not include a coach→parent clause, so parents(profiles(full_name))
-- came back null for a coach. This adds a scoped, SECURITY DEFINER
-- helper and widens profiles_select to cover it.
--
-- Scope note: this exposes the whole profile row (incl. email/phone),
-- not just full_name, but only for parents the coach actively serves.
-- That is intentional (a coach may need to contact those parents) and
-- symmetric with coaches_select, which already exposes every coach
-- profile to all signed-in users.
-- ============================================================

CREATE OR REPLACE FUNCTION public.coach_serves_parent_profile(p_profile_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM parents p
    WHERE p.profile_id = p_profile_id
      AND coach_serves_parent(p.id)
  );
$$;

DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR role = 'coach'
    OR is_superadmin()
    OR coach_serves_parent_profile(id)
  );
