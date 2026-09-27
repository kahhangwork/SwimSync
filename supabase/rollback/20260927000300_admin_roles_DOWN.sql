-- ROLLBACK for 20260927000300_admin_roles.sql
--
-- Drops roles entirely: tables, enums, the gate, the role RPCs, the triggers,
-- and restores handle_new_user (the 20260927000200 body — KEEPS the
-- staff-invitation security fix), guard_profiles_privileges and
-- platform_reassign_owner to their pre-migration bodies (read from the
-- database 2026-09-27).
--
-- WHAT IS LOST: every role and every co-admin's role assignment. Safe only
-- while nothing reads them — i.e. before migrations B–D re-point any policy
-- to has_admin_area(). After B, roll B back first.
--
-- REHEARSED (§7.93): apply the UP, run this, confirm roles_permissions.test.sql
-- fails, re-apply the UP, confirm green; schema dump identical.

DROP FUNCTION IF EXISTS public.assign_admin_role(UUID, UUID);
DROP FUNCTION IF EXISTS public.delete_role(UUID);
DROP FUNCTION IF EXISTS public.rename_role(UUID, TEXT);
DROP FUNCTION IF EXISTS public.update_role_permissions(UUID, JSONB);
DROP FUNCTION IF EXISTS public.create_role(TEXT, JSONB);
DROP FUNCTION IF EXISTS public.my_admin_permissions(UUID);
DROP FUNCTION IF EXISTS public.has_admin_area(UUID, admin_area, admin_level);

DROP TRIGGER IF EXISTS trg_tenants_old_owner_role_present ON public.tenants;
DROP TRIGGER IF EXISTS trg_profiles_admin_role_present ON public.profiles;
DROP FUNCTION IF EXISTS public.check_admin_role_present();
DROP TRIGGER IF EXISTS trg_profiles_admin_role_shape ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_admin_role_shape();
DROP TRIGGER IF EXISTS trg_seed_roles_for_new_tenant ON public.tenants;
DROP FUNCTION IF EXISTS public.seed_roles_for_new_tenant();
DROP FUNCTION IF EXISTS public.seed_standard_roles(UUID);
DROP FUNCTION IF EXISTS public.role_is_within(UUID, UUID);
DROP FUNCTION IF EXISTS public.set_role_grid(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.guard_profiles_privileges()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF current_user = 'authenticated' AND (
       OLD.role              IS DISTINCT FROM NEW.role
    OR OLD.tenant_id         IS DISTINCT FROM NEW.tenant_id
    OR OLD.admin_disabled_at IS DISTINCT FROM NEW.admin_disabled_at
  ) THEN
    RAISE EXCEPTION
      'profiles.role / tenant_id / admin_disabled_at cannot be changed directly '
      '— use the admin-management RPCs (20260806000100)';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role       user_role;
  v_tenant     UUID;
  v_is_coach   BOOLEAN;
  v_meta_role  TEXT := NULLIF(NEW.raw_user_meta_data->>'role', '');
  v_nonce      TEXT := NULLIF(NEW.raw_user_meta_data->>'invitation_nonce', '');
  v_inv        staff_invitations%ROWTYPE;
BEGIN
  IF session_user IN ('postgres', 'supabase_admin') THEN
    -- Direct SQL (seed, migrations, tests, fixtures): trusted, as before.
    v_role := COALESCE(v_meta_role::user_role, 'parent');
    v_tenant := NULLIF(NEW.raw_user_meta_data->>'tenant_id', '')::UUID;
    v_is_coach := COALESCE((NEW.raw_user_meta_data->>'is_coach')::boolean, FALSE);
  ELSIF v_nonce IS NOT NULL THEN
    SELECT * INTO v_inv FROM staff_invitations
     WHERE nonce = v_nonce
       AND lower(email) = lower(NEW.email)
       AND consumed_at IS NULL
       AND expires_at > now()
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'this staff invitation is invalid, used or expired — ask the admin to send a new one'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE staff_invitations SET consumed_at = now(), consumed_by = NEW.id WHERE nonce = v_nonce;
    v_role := v_inv.role;
    v_tenant := v_inv.tenant_id;
    v_is_coach := v_inv.is_coach;
  ELSIF v_meta_role IS NULL OR v_meta_role = 'parent' THEN
    v_role := 'parent';
    v_tenant := NULL;
    v_is_coach := FALSE;
  ELSE
    RAISE EXCEPTION 'staff accounts are created by invitation only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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
    INSERT INTO parents (profile_id, signup_join_code)
    VALUES (NEW.id, NULLIF(NEW.raw_user_meta_data->>'join_code', ''));
  ELSIF v_role = 'coach' THEN
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  ELSIF v_role = 'tenant_admin' AND v_is_coach THEN
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  END IF;

  IF v_role = 'tenant_admin' THEN
    UPDATE tenants SET owner_profile_id = NEW.id
     WHERE id = v_tenant AND owner_profile_id IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_reassign_owner(p_tenant_id uuid, p_new_owner_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_owner UUID;
  v_target    profiles%ROWTYPE;
BEGIN
  -- THE GATE, first act. Platform admin only — decision 2: no self-service.
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'only the platform admin may reassign a business''s owner';
  END IF;

  -- FOR UPDATE: serializes concurrent transfers of the same tenant, so the
  -- audit rows' old_value → new_value chain always replays to true history.
  -- Without it, two racing calls both record the original owner as old_value.
  SELECT owner_profile_id INTO v_old_owner
    FROM tenants WHERE id = p_tenant_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such business';
  END IF;

  -- Idempotent: already the owner → nothing to do, no audit row. The API-less
  -- UI path retries freely (the deactivate_admin precedent, 20260806000100).
  IF v_old_owner = p_new_owner_profile_id THEN
    RETURN;
  END IF;

  -- The target must be a LIVE admin of THAT business. v_old_owner may be NULL
  -- (owner's auth account deleted → ON DELETE SET NULL) — that is the
  -- lost-owner case this RPC exists for, and it needs no special arm.
  SELECT * INTO v_target FROM profiles
   WHERE id = p_new_owner_profile_id
     AND role = 'tenant_admin'
     AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the new owner must be an admin of that business';
  END IF;
  IF v_target.admin_disabled_at IS NOT NULL THEN
    RAISE EXCEPTION
      'that admin is deactivated — reactivate them before making them owner';
  END IF;

  -- Passes guard_tenants_owner: current_user is postgres inside a definer
  -- function (§7.38). This UPDATE is the entire transfer; everything downstream
  -- (overview, resend-invite) keys on the column.
  UPDATE tenants SET owner_profile_id = p_new_owner_profile_id
   WHERE id = p_tenant_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (auth.uid(), 'owner_reassigned', 'Tenant', p_tenant_id,
          jsonb_build_object('owner_profile_id', v_old_owner),
          jsonb_build_object('owner_profile_id', p_new_owner_profile_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_log_tenant_of(p_entity_type text, p_entity_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
BEGIN
  CASE p_entity_type
    WHEN 'Student' THEN
      SELECT s.tenant_id INTO v_tenant FROM students s WHERE s.id = p_entity_id;
    WHEN 'Class' THEN
      SELECT c.tenant_id INTO v_tenant FROM classes c WHERE c.id = p_entity_id;
    WHEN 'lesson_session' THEN
      SELECT c.tenant_id INTO v_tenant
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
       WHERE ls.id = p_entity_id;
    WHEN 'Profile' THEN
      SELECT p.tenant_id INTO v_tenant FROM profiles p WHERE p.id = p_entity_id;
    WHEN 'Coach' THEN
      SELECT c.tenant_id INTO v_tenant FROM coaches c WHERE c.id = p_entity_id;
    WHEN 'credit_note' THEN
      -- ⟨ITEM 3⟩ void_credit_note() audits under this type. The note is UPDATEd,
      -- never deleted, so it exists at insert time; its own tenant_id is the row.
      SELECT cn.tenant_id INTO v_tenant FROM credit_notes cn WHERE cn.id = p_entity_id;
    WHEN 'ParentTenant' THEN
      v_tenant := NULL;
    WHEN 'Tenant' THEN
      v_tenant := p_entity_id;
    ELSE
      RAISE EXCEPTION
        'audit_log: no tenant derivation for entity_type %. Add one to '
        'audit_log_tenant_of() — a row with no tenant is readable by the '
        'platform admin and by nobody else (20260804000300).', p_entity_type;
  END CASE;

  RETURN v_tenant;
END;
$function$;

ALTER TABLE public.staff_invitations DROP COLUMN IF EXISTS admin_role_id;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS admin_role_id;
DROP TABLE IF EXISTS public.tenant_role_permissions;
DROP TABLE IF EXISTS public.tenant_roles;
DROP TYPE IF EXISTS public.admin_level;
DROP TYPE IF EXISTS public.admin_area;
