-- ============================================================
-- Roles & permissions migration D: admin management moves to the
-- "Admins & roles" area, with the owner protected and the escalation guard
-- on every path that restores a role (ROLES_PERMISSIONS_PLAN.md §5.4, step 4;
-- P12).
--
--   * deactivate_admin / reactivate_admin / prepare_admin_delete /
--     remove_admin_role: is_tenant_owner → has_admin_area(t, 'admins', 'edit').
--     Bodies read from the database 2026-09-27 (§7.40); messages kept
--     verbatim so admin_management / owner_transfer still pin them.
--   * THE OWNER-TARGET RULE, ADDED (§5.4): each of the four refuses when the
--     target is tenants.owner_profile_id and the caller is not the owner.
--     Until now the only protection was that the caller had to BE the owner;
--     once a co-admin can call these, deactivate / prepare_admin_delete /
--     remove_admin_role would otherwise lock the owner out.
--   * reactivate_admin restores the target's role, so a non-owner may only
--     reactivate a co-admin whose role is no stronger than their own
--     (role_is_within) — deactivate-then-reactivate is not an escalation path.
--   * can_assign_role(role) / can_restore_admin(profile): the same two rules
--     as booleans, for the invite-admin and resend-admin-invite routes to ask
--     with the caller's JWT — the routes never re-implement the rule (§5.4).
--   * profiles_update (P12): the admin arm splits by the target's role — a
--     coach's profile needs operations:edit, a co-admin's needs admins:edit,
--     and the owner's profile is the owner's alone. Parent profiles carry no
--     tenant_id, so they had no admin arm before and have none now.
--
-- BEHAVIOUR: the owner passes everything, as before. "Co-admin (as before)"
-- holds admins = none, so co-admins stay refused admin management, exactly
-- as today. The one tightening is P12's: a co-admin without admins:edit can
-- no longer edit ANOTHER admin's name / phone through profiles_update (the
-- Admins page never offered it — management was owner-only).
--
-- Rollback: supabase/rollback/20260927000600_roles_admin_management_DOWN.sql
-- ============================================================

-- deactivate_admin → admins:edit + owner-target refusal
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
  -- 20260927000600: the Admins & roles area, not ownership (D9). The
  -- message is kept verbatim — the owner-only suites still pin it.
  IF NOT has_admin_area(v_tenant, 'admins', 'edit') THEN
    RAISE EXCEPTION 'only the business owner may manage admin accounts';
  END IF;

  SELECT * INTO v_target FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an admin of your business';
  END IF;

  -- §5.4: nobody but the owner may act on the owner — ADDED here; until now
  -- only the caller-must-be-owner rule protected them.
  IF p_profile_id = (SELECT owner_profile_id FROM tenants WHERE id = v_tenant)
     AND p_profile_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'the business owner cannot be changed by another admin'
      USING ERRCODE = 'insufficient_privilege';
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

-- reactivate_admin → admins:edit + owner-target refusal + escalation guard
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
  -- 20260927000600: the Admins & roles area, not ownership (D9). The
  -- message is kept verbatim — the owner-only suites still pin it.
  IF NOT has_admin_area(v_tenant, 'admins', 'edit') THEN
    RAISE EXCEPTION 'only the business owner may manage admin accounts';
  END IF;

  SELECT * INTO v_target FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an admin of your business';
  END IF;

  -- §5.4: nobody but the owner may act on the owner — ADDED here; until now
  -- only the caller-must-be-owner rule protected them.
  IF p_profile_id = (SELECT owner_profile_id FROM tenants WHERE id = v_tenant)
     AND p_profile_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'the business owner cannot be changed by another admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Reactivating restores the target's role, so a non-owner may reactivate
  -- only a co-admin whose role is no stronger than their own — otherwise
  -- deactivate-then-reactivate would be an escalation path (§5.4).
  IF NOT is_tenant_owner(v_tenant)
     AND NOT role_is_within(v_target.admin_role_id,
                            (SELECT admin_role_id FROM profiles WHERE id = auth.uid())) THEN
    RAISE EXCEPTION 'you can only reactivate an admin whose role is no stronger than your own'
      USING ERRCODE = 'insufficient_privilege';
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

-- prepare_admin_delete → admins:edit + owner-target refusal
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
  -- 20260927000600: the Admins & roles area, not ownership (D9). The
  -- message is kept verbatim — the owner-only suites still pin it.
  IF NOT has_admin_area(v_tenant, 'admins', 'edit') THEN
    RAISE EXCEPTION 'only the business owner may manage admin accounts';
  END IF;

  SELECT * INTO v_target FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an admin of your business';
  END IF;

  -- §5.4: nobody but the owner may act on the owner — ADDED here; until now
  -- only the caller-must-be-owner rule protected them.
  IF p_profile_id = (SELECT owner_profile_id FROM tenants WHERE id = v_tenant)
     AND p_profile_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'the business owner cannot be changed by another admin'
      USING ERRCODE = 'insufficient_privilege';
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

-- remove_admin_role → admins:edit + owner-target refusal
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
  -- 20260927000600: the Admins & roles area, not ownership (D9). The
  -- message is kept verbatim — the owner-only suites still pin it.
  IF NOT has_admin_area(v_tenant, 'admins', 'edit') THEN
    RAISE EXCEPTION 'only the business owner may manage admin accounts';
  END IF;

  SELECT * INTO v_target FROM profiles
   WHERE id = p_profile_id AND tenant_id = v_tenant AND role = 'tenant_admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not an admin of your business';
  END IF;

  -- §5.4: nobody but the owner may act on the owner — ADDED here; until now
  -- only the caller-must-be-owner rule protected them.
  IF p_profile_id = (SELECT owner_profile_id FROM tenants WHERE id = v_tenant)
     AND p_profile_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'the business owner cannot be changed by another admin'
      USING ERRCODE = 'insufficient_privilege';
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

-- ── Route-facing checks (the routes ask; they never re-implement) ──────────
CREATE OR REPLACE FUNCTION public.can_assign_role(p_role_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM tenant_roles r WHERE r.id = p_role_id AND r.tenant_id = current_tenant_id())
     AND (is_tenant_owner(current_tenant_id())
          OR (has_admin_area(current_tenant_id(), 'admins', 'edit')
              AND role_is_within(p_role_id, (SELECT admin_role_id FROM profiles WHERE id = auth.uid()))));
$$;

CREATE OR REPLACE FUNCTION public.can_restore_admin(p_profile_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles t
     WHERE t.id = p_profile_id AND t.role = 'tenant_admin' AND t.tenant_id = current_tenant_id()
       AND t.id IS DISTINCT FROM (SELECT owner_profile_id FROM tenants WHERE id = t.tenant_id)
       AND (is_tenant_owner(t.tenant_id)
            OR (has_admin_area(t.tenant_id, 'admins', 'edit')
                AND role_is_within(t.admin_role_id, (SELECT admin_role_id FROM profiles WHERE id = auth.uid())))));
$$;

REVOKE ALL ON FUNCTION public.can_assign_role(UUID)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_restore_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_assign_role(UUID)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_restore_admin(UUID) TO authenticated, service_role;

-- ── profiles_update (P12) — live expression read 2026-09-27 ────────────────
ALTER POLICY profiles_update ON public.profiles
  USING ((id = auth.uid()) OR is_platform_admin()
         OR (role = 'coach' AND has_admin_area(tenant_id, 'operations', 'edit'))
         OR (role = 'tenant_admin' AND has_admin_area(tenant_id, 'admins', 'edit')
             AND id IS DISTINCT FROM (SELECT t.owner_profile_id FROM tenants t WHERE t.id = profiles.tenant_id)))
  WITH CHECK ((id = auth.uid()) OR is_platform_admin()
         OR (role = 'coach' AND has_admin_area(tenant_id, 'operations', 'edit'))
         OR (role = 'tenant_admin' AND has_admin_area(tenant_id, 'admins', 'edit')
             AND id IS DISTINCT FROM (SELECT t.owner_profile_id FROM tenants t WHERE t.id = profiles.tenant_id)));
