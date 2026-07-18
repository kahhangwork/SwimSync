-- ============================================================
-- Multi-tenancy: teach the auth trigger about tenants.
--
-- `coaches.tenant_id` is now NOT NULL, but the trigger that creates the coaches
-- row fires on auth.users INSERT and has no idea which business the new coach
-- belongs to. The caller does: a coach is created BY a tenant admin, from the
-- admin panel, so the tenant is the creator's. It travels in user_metadata
-- alongside the `role` that is already passed there.
--
-- Roles handled:
--   parent        — GLOBAL. No tenant_id, deliberately: a parent may have one
--                   child at a school and another with a private coach
--                   (PRD §11.3). They reach tenants through join codes.
--   coach         — needs a tenant. Refused without one rather than defaulting,
--                   because a silent default would put a coach in the wrong
--                   business, and with one tenant on the platform that would
--                   look like it worked.
--   tenant_admin  — needs a tenant, same reasoning. Also gets a coaches row
--                   when `is_coach` is set: that is the private-coach shape,
--                   one person holding both roles (TENANCY_DESIGN.md §1).
--   platform_admin— no tenant by definition.
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     user_role;
  v_tenant   UUID;
  v_is_coach BOOLEAN;
BEGIN
  v_role := COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'parent');
  v_tenant := NULLIF(NEW.raw_user_meta_data->>'tenant_id', '')::UUID;
  v_is_coach := COALESCE((NEW.raw_user_meta_data->>'is_coach')::boolean, FALSE);

  IF v_role IN ('coach', 'tenant_admin') AND v_tenant IS NULL THEN
    RAISE EXCEPTION
      'creating a % requires tenant_id in user_metadata — refusing to guess which business they belong to',
      v_role;
  END IF;

  INSERT INTO profiles (id, email, role, full_name, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    v_role,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    CASE WHEN v_role IN ('parent', 'platform_admin') THEN NULL ELSE v_tenant END
  );

  IF v_role = 'parent' THEN
    INSERT INTO parents (profile_id) VALUES (NEW.id);
  ELSIF v_role = 'coach' THEN
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  ELSIF v_role = 'tenant_admin' AND v_is_coach THEN
    -- A private coach: administers the business and teaches in it.
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  END IF;

  RETURN NEW;
END;
$$;
