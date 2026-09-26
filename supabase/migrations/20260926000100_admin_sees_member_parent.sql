-- ============================================================
-- EXPAND: a tenant admin can read the name of a parent who JOINED their
-- business, before that parent has added a child.
--
-- Before this, the admin's only read path to a parent was a child the parent
-- has at the business (tenant_serves_parent). A family that joined by join
-- code and requested a package before adding a child showed as "Unknown" on
-- Packages → Awaiting, and was missing from Record a sale's Parent select —
-- the admin was asked to confirm a payment from someone they could not name.
--
-- Decided 2026-09-26 (user): a parent_tenants membership alone grants the
-- admin name visibility — the parent chose to join this business.
--
-- Scope, deliberately narrow:
--   * ADMINS only (is_tenant_admin, which also refuses a suspended business
--     and a disabled co-admin). Coaches keep the child-based path.
--   * Only parents + profiles. tenant_serves_parent is NOT widened: it also
--     gates parent_students_select, and widening it would show an admin
--     every member's links to children at OTHER businesses.
--   * Any membership, active or not — the child path never looked at
--     is_active either.
--
-- Grants: authenticated already holds SELECT on parents and profiles (the
-- policies only gain an OR arm), so no table grant changes (§7.87). The new
-- helper gets EXECUTE for authenticated only, and never PUBLIC/anon
-- (function_grants.test.sql, 20260804000200).
-- After deploy, dump the REMOTE grants and confirm anon has no EXECUTE on
-- the new function (§7.39):
--   supabase db dump --linked --schema public -f /tmp/d.sql
--   grep 'tenant_admin_has_member' /tmp/d.sql | grep '"anon"'   # must print nothing
--
-- Rollback: supabase/rollback/20260926000100_admin_sees_member_parent_DOWN.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.tenant_admin_has_member(p_parent_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_tenant_admin(current_tenant_id())
     AND EXISTS (
       SELECT 1 FROM parent_tenants
       WHERE parent_id = p_parent_id
         AND tenant_id = current_tenant_id()
     );
$$;

REVOKE ALL ON FUNCTION public.tenant_admin_has_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tenant_admin_has_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.tenant_admin_has_member(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.tenant_admin_has_member(UUID) IS
  'RLS helper: the caller is an admin of the business this parent joined (parent_tenants), child or not. Read-only arms of parents_select / profiles_select only — never parent_students.';

-- Live expressions read from the database 2026-09-26 (§7.40); each gains one arm.
ALTER POLICY parents_select ON public.parents
  USING (
    profile_id = auth.uid()
    OR is_platform_admin()
    OR tenant_serves_parent(id)
    OR tenant_admin_has_member(id)
  );

ALTER POLICY profiles_select ON public.profiles
  USING (
    id = auth.uid()
    OR is_platform_admin()
    OR (tenant_id IS NOT NULL AND tenant_id = current_tenant_id())
    OR (tenant_id IS NOT NULL AND parent_in_tenant(tenant_id))
    OR EXISTS (
      SELECT 1 FROM parents p
      WHERE p.profile_id = profiles.id
        AND (tenant_serves_parent(p.id) OR tenant_admin_has_member(p.id))
    )
  );
