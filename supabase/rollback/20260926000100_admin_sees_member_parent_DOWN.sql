-- ROLLBACK for 20260926000100_admin_sees_member_parent.sql
--
-- Restores parents_select / profiles_select to their pre-migration expressions
-- (read from the database 2026-09-26) and drops the helper.
--
-- WHAT IS LOST: nothing stored. An admin goes back to seeing a childless
-- member family as "Unknown" on Packages → Awaiting.
--
-- ORDER: roll the apps back first if a later app change relies on the name
-- being readable; today nothing does beyond the display fallback.
--
-- REHEARSED (§7.93): apply the UP, run this, confirm
-- admin_sees_member_parent.test.sql fails, re-apply the UP, confirm green.

ALTER POLICY parents_select ON public.parents
  USING (
    profile_id = auth.uid()
    OR is_platform_admin()
    OR tenant_serves_parent(id)
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
        AND tenant_serves_parent(p.id)
    )
  );

DROP FUNCTION IF EXISTS public.tenant_admin_has_member(UUID);
