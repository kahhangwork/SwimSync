-- DOWN for 20261118000400_carried_over_referral_block.sql — restores both re-bodied functions byte-identically
-- (captured with pg_get_functiondef before UP) and drops void_referral.
-- APPS FIRST: the admin Referrals page calls void_referral — revert that app change before running this.
-- Run with psql (several statements; `supabase db query -f` refuses multiple commands). Rehearsed 2026-11-19:
-- UP → DOWN → both bodies byte-identical to their pre-UP pg_get_functiondef, void_referral absent → UP again.

DROP FUNCTION IF EXISTS public.void_referral(uuid, text);

CREATE OR REPLACE FUNCTION public.record_carried_over_package(p_parent uuid, p_product uuid, p_original_start date, p_lessons_remaining integer, p_student uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product  package_products%ROWTYPE;
  v_end      DATE;
  v_id       UUID;
  v_cons     TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The tenant comes from the PRODUCT, never from a caller argument.
  SELECT * INTO v_product FROM package_products WHERE id = p_product;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Unknown package product.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(v_product.tenant_id, 'packages', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized to bring in a package for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT v_product.is_active THEN
    RAISE EXCEPTION 'That package is no longer offered.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM parent_tenants pt
                  WHERE pt.parent_id = p_parent AND pt.tenant_id = v_product.tenant_id) THEN
    RAISE EXCEPTION 'That family is not in this business.' USING ERRCODE = 'check_violation';
  END IF;

  IF p_original_start IS NULL THEN
    RAISE EXCEPTION 'Choose the date the package originally started.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_original_start > app_today() THEN
    RAISE EXCEPTION 'The original start date can''t be in the future.' USING ERRCODE = 'check_violation';
  END IF;

  IF p_lessons_remaining IS NULL OR p_lessons_remaining < 1 OR p_lessons_remaining > v_product.lesson_count THEN
    RAISE EXCEPTION 'Lessons remaining must be between 1 and %.', v_product.lesson_count
      USING ERRCODE = 'check_violation';
  END IF;

  -- expires_on is the LAST covered day (coverage is <= expires_on), so it may be today but not before.
  v_end := package_effective_end(p_original_start, v_product.validity_weeks, 0, 0, 0);
  IF v_end < app_today() THEN
    RAISE EXCEPTION 'That package expired on % — it can''t be brought in.', sg_date_label(v_end, 'FMDD Mon YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  -- The lifecycle trigger owns start_date / expires_on / the balance / the price, and enforces kind <-> child.
  BEGIN
    INSERT INTO parent_packages (tenant_id, parent_id, product_id, status, student_id,
                                 carried_over_start, carried_over_lessons)
    VALUES (v_product.tenant_id, p_parent, p_product, 'active', p_student,
            p_original_start, p_lessons_remaining)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
    IF v_cons = 'parent_packages_carried_once' THEN
      RAISE EXCEPTION 'This package has already been brought in.' USING ERRCODE = 'check_violation';
    END IF;
    RAISE;
  END;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  SELECT auth.uid(), 'package_carried_over', 'parent_package', pp.id,
         jsonb_build_object('original_start', pp.carried_over_start, 'lessons_remaining', pp.carried_over_lessons,
                            'rate_per_lesson', pp.rate_per_lesson, 'start_date', pp.start_date,
                            'expires_on', pp.expires_on)
    FROM parent_packages pp WHERE pp.id = v_id;

  RETURN v_id;
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
    WHEN 'TenantRole' THEN
      -- 20260927000300: role CRUD. delete_role audits BEFORE deleting, so
      -- the row still exists here.
      SELECT r.tenant_id INTO v_tenant FROM tenant_roles r WHERE r.id = p_entity_id;
    WHEN 'parent_package' THEN
      -- 20260928000100: record/reverse_package_refund audit under the package.
      SELECT pp.tenant_id INTO v_tenant FROM parent_packages pp WHERE pp.id = p_entity_id;
    ELSE
      RAISE EXCEPTION
        'audit_log: no tenant derivation for entity_type %. Add one to '
        'audit_log_tenant_of() — a row with no tenant is readable by the '
        'platform admin and by nobody else (20260804000300).', p_entity_type;
  END CASE;

  RETURN v_tenant;
END;
$function$;
