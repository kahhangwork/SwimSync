-- ROLLBACK for 20260927000200_staff_accounts_by_invitation.sql
--
-- ⚠ RE-OPENS THE HOLE: afterwards a public signUp() can again create a
-- platform_admin or a tenant_admin of any business. Only ever run this as
-- part of rolling the admin app back too, and only as long as it takes to
-- roll forward again.
--
-- Restores handle_new_user() to its pre-migration body (read from the
-- database 2026-09-27) and drops staff_invitations. The admin app's routes
-- write to that table, so roll the APP back first or every staff invite fails.
--
-- REHEARSED (§7.93): apply the UP, run this, confirm
-- supabase/tests/http/signup_trust.sh goes red, re-apply the UP, confirm green.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

DROP TABLE IF EXISTS public.staff_invitations;
