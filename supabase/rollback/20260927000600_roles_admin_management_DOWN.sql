-- ROLLBACK for 20260927000600_roles_admin_management.sql
--
-- Restores the four admin-management RPCs to owner-only (bodies captured
-- 2026-09-27), drops the two route checks, and restores profiles_update.
-- REHEARSED (§7.93): UP → this → roles_admins.test.sql red → UP; dump identical.

DROP FUNCTION IF EXISTS public.can_restore_admin(UUID);
DROP FUNCTION IF EXISTS public.can_assign_role(UUID);

ALTER POLICY profiles_update ON public.profiles
  USING (((id = auth.uid()) OR is_platform_admin() OR can_admin_tenant(tenant_id)))
  WITH CHECK (((id = auth.uid()) OR is_platform_admin() OR can_admin_tenant(tenant_id)));

CREATE OR REPLACE FUNCTION public.deactivate_admin(p_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_target profiles%ROWTYPE;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = auth.uid();
  IF NOT is_tenant_owner(v_tenant) THEN
    RAISE EXCEPTION 'only the business owner may manage admin accounts';
  END IF;

  SELECT * INTO v_target FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an admin of your business';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'the owner cannot be deactivated';
  END IF;

  IF v_target.admin_disabled_at IS NOT NULL THEN
    RETURN; -- idempotent: already deactivated, nothing to do, no audit row
  END IF;

  UPDATE profiles SET admin_disabled_at = NOW() WHERE id = p_profile_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), 'admin_deactivated', 'Profile', p_profile_id,
          jsonb_build_object('tenant_id', v_tenant));
END;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_admin(p_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_target profiles%ROWTYPE;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = auth.uid();
  IF NOT is_tenant_owner(v_tenant) THEN
    RAISE EXCEPTION 'only the business owner may manage admin accounts';
  END IF;

  SELECT * INTO v_target FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an admin of your business';
  END IF;

  IF v_target.admin_disabled_at IS NULL THEN
    RETURN; -- idempotent: already active
  END IF;

  UPDATE profiles SET admin_disabled_at = NULL WHERE id = p_profile_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), 'admin_reactivated', 'Profile', p_profile_id,
          jsonb_build_object('tenant_id', v_tenant));
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_admin_delete(p_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_target profiles%ROWTYPE;
  r        RECORD;
  v_hit    BOOLEAN;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = auth.uid();
  IF NOT is_tenant_owner(v_tenant) THEN
    RAISE EXCEPTION 'only the business owner may manage admin accounts';
  END IF;

  SELECT * INTO v_target FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an admin of your business';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'the owner cannot be deleted';
  END IF;

  IF EXISTS (SELECT 1 FROM coaches WHERE profile_id = p_profile_id) THEN
    RAISE EXCEPTION
      'this admin is also a coach — remove their admin role instead of deleting';
  END IF;

  -- Catalogue-derived reference check (§7.46). Any surviving reference makes
  -- the eventual auth.users → profiles cascade fail anyway; refusing here, by
  -- name, is the honest version of that failure.
  FOR r IN SELECT ref_table, ref_column FROM profile_reference_columns() LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)',
                   r.ref_table, r.ref_column)
      INTO v_hit USING p_profile_id;
    IF v_hit THEN
      -- audit_log gets a sentence rather than a table name. After
      -- 20260813000400 this is the COMMON outcome, not the rare one — every
      -- edit to a student writes a row — and delete-admin/route.ts hands the
      -- message straight to the business owner in the modal. "this admin has
      -- recorded activity (audit_log.actor_id)" is not something to show them.
      IF r.ref_table = 'public.audit_log'::regclass THEN
        RAISE EXCEPTION
          'this admin has history recorded against their account and cannot be '
          'deleted — deactivate them instead. That revokes their access '
          'immediately, and keeps the record of what they did.';
      END IF;
      RAISE EXCEPTION
        'this admin has recorded activity (%.%) — deactivate them instead of deleting',
        r.ref_table, r.ref_column;
    END IF;
  END LOOP;

  -- The deletion audit row, while the subject profile still exists
  -- (audit_log_tenant_of derives the tenant from it), attributed to the OWNER,
  -- who survives. entity_id is a plain UUID and NOT an FK (20260309000100:236),
  -- so this row does not block the cascade it is recording.
  --
  -- THE PURGE THAT USED TO FOLLOW IS GONE. It read
  --   DELETE FROM audit_log WHERE actor_id = p_profile_id;
  -- and it is why this migration exists. Execution can no longer reach here
  -- with any such row in existence — the loop above refuses first — so the
  -- statement was not merely undesirable, it was dead.
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), 'admin_deleted', 'Profile', p_profile_id,
          jsonb_build_object('tenant_id', v_tenant, 'email', v_target.email,
                             'full_name', v_target.full_name));

  -- The profile row itself is NOT deleted here: the API route calls
  -- auth.admin.deleteUser, and auth.users → profiles cascades. Route order is
  -- ban → this RPC → deleteUser. The ban no longer closes a purge-to-cascade
  -- window (there is no purge), but it still closes the window in which the
  -- target could write a FRESH audit row between this check and the cascade —
  -- which would now fail the cascade on the actor_id FK.
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_admin_role(p_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_target profiles%ROWTYPE;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = auth.uid();
  IF NOT is_tenant_owner(v_tenant) THEN
    RAISE EXCEPTION 'only the business owner may manage admin accounts';
  END IF;

  SELECT * INTO v_target FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an admin of your business';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'the owner cannot remove their own admin role';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM coaches WHERE profile_id = p_profile_id) THEN
    RAISE EXCEPTION
      'this admin is not a coach — a pure admin account is deleted, not demoted';
  END IF;

  UPDATE profiles SET role = 'coach', admin_disabled_at = NULL
   WHERE id = p_profile_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), 'admin_role_removed', 'Profile', p_profile_id,
          jsonb_build_object('tenant_id', v_tenant));
END;
$function$;
