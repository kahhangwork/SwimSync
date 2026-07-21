-- ============================================================
-- Narrow provision_tenant()'s EXECUTE grant to `authenticated` ONLY.
--
-- WHY THIS EXISTS, AND WHY 20260721000100 LOOKED CORRECT LOCALLY.
-- That migration ends with:
--     REVOKE ALL ON FUNCTION ... FROM PUBLIC;
--     GRANT EXECUTE ON FUNCTION ... TO authenticated;
-- and its comment claimed that withholding a service_role grant makes a
-- service-role call fail loudly. On the LOCAL stack that was true — pg_proc
-- showed {postgres, authenticated} and a service-role call returned
-- "permission denied for function provision_tenant".
--
-- IN PRODUCTION IT WAS FALSE. A `supabase db dump` taken straight after the
-- push showed:
--     GRANT ALL ON FUNCTION ... TO "anon";
--     GRANT ALL ON FUNCTION ... TO "authenticated";
--     GRANT ALL ON FUNCTION ... TO "service_role";
--
-- Two reasons, and both are worth knowing before writing another RPC:
--   1. REVOKE ... FROM PUBLIC does NOT remove role-specific grants. PUBLIC is
--      its own grantee, not an umbrella over anon/authenticated/service_role.
--   2. Supabase CLOUD carries project-level ALTER DEFAULT PRIVILEGES that grant
--      EXECUTE on new public functions to anon/authenticated/service_role. This
--      repo's own 20260309000800_grants.sql sets default privileges for TABLES
--      and SEQUENCES only — the function grants are the platform's, and the
--      local stack does not reproduce them.
-- So a grant verified with pg_proc locally can be wrong in production, and the
-- only honest check is a dump of the REMOTE after pushing.
--
-- WAS ANYTHING EXPOSED? No. Both anon and service_role have auth.uid() = NULL,
-- so is_platform_admin() is false and the body raises before writing anything.
-- The gate held; what was missing was the second layer, and the accuracy of the
-- comment describing it.
--
-- NOTE THIS IS PRE-EXISTING AND WIDER THAN THIS FUNCTION. The same dump shows
-- `anon` holding EXECUTE on regenerate_join_code() and close_student_enrolment()
-- too — every SECURITY DEFINER function in this project except
-- platform_tenant_overview(), which is clean precisely because its migration
-- spells out `REVOKE ALL ... FROM anon`. Those are deliberately NOT touched here
-- (a deploy is the wrong moment to widen scope) and are filed in BACKLOG.md.
-- Their body gates hold for the same reason this one's does.
-- ============================================================

REVOKE ALL ON FUNCTION public.provision_tenant(TEXT, tenant_kind) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_tenant(TEXT, tenant_kind) FROM anon;
REVOKE ALL ON FUNCTION public.provision_tenant(TEXT, tenant_kind) FROM service_role;
GRANT EXECUTE ON FUNCTION public.provision_tenant(TEXT, tenant_kind) TO authenticated;

-- Re-issued to correct the claim in 20260721000100, which described a
-- protection that only held locally.
COMMENT ON FUNCTION public.provision_tenant(TEXT, tenant_kind) IS
  'Platform-admin-only: create a business + its join code. The ONLY INSERT path '
  'into tenants — do not add an INSERT grant or a tenants_insert policy. Its '
  'first admin is invited separately by the provision-tenant API route, which '
  'must delete this row if that invite fails (an operator-less tenant is still '
  'joinable by parents). EXECUTE is granted to `authenticated` only: anon and '
  'service_role are revoked explicitly, because REVOKE FROM PUBLIC does not '
  'remove role grants and Supabase cloud grants new public functions to all '
  'three by default. The API route must still call this with the CALLER''s '
  'token — auth.uid() is NULL for the service role, so a service-role call '
  'would be refused by the body gate rather than silently succeeding.';
