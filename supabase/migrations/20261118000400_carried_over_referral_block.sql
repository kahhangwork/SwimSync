-- A referred family cannot be brought in; a pending referral can be voided by the admin.
-- Plan: docs/plans/CARRIED_OVER_REFERRAL_BLOCK_PLAN.md (decision: user, 2026-11-18; plan-reviewed 2026-11-19).
--
-- WHY. A package brought in from before SwimSync (20261118000200, PRD §7.16) belongs to an existing customer. If that
-- family joined with a friend's REF- code, its referral stayed PENDING (D6 of CARRIED_OVER_PACKAGES_PLAN), so the
-- family's next real purchase would take the friend's first-package discount and mint the referrer a reward. The user's
-- call: refuse the bring-in while such a referral is pending, and give the admin a way to void it. Auto-voiding at
-- bring-in was offered and declined.
--
-- WHAT.
--   1. record_carried_over_package: one refusal, the LAST check (after the INSERT — see the comment in the body).
--   2. audit_log_tenant_of: a 'referral' arm. Without it every void_referral() would RAISE (§7.297).
--   3. void_referral(referral, reason): NEW. Voids a PENDING referral and its unused referee_first reward together,
--      through void_referral_reward() (same refusal for a discount on a package the family already marked paid, same
--      price restore for an unpaid offer). No EXCEPTION block: a refusal aborts the whole call, so the referral is
--      never voided while the discount survives. The reward is chosen by referral_id + kind, never by parent — the
--      family's referrer/manual rewards are untouched.
--   The D6 early returns in apply_referral_reward / settle_referral_reward are NOT touched: they still keep a
--   referrer/manual reward off a carried package.
--
-- DATA. Prod held 0 referrals and 0 carried packages on 2026-11-18 — nothing is refused retroactively.
--
-- GRANTS. void_referral: EXECUTE to authenticated only (REVOKE from PUBLIC, anon). The two re-bodied functions keep
-- their ACLs (CREATE OR REPLACE). No table grant changes (§7.87). After `db push`, dump the remote and confirm
-- void_referral has no anon/PUBLIC EXECUTE (§7.39):
--   supabase db dump --linked -f /tmp/remote_dump.sql && grep -i 'void_referral(' /tmp/remote_dump.sql | grep -iE 'grant|revoke'
--
-- Rollback: supabase/rollback/20261118000400_carried_over_referral_block_DOWN.sql

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

  -- A family that joined with a friend's REF- code is an existing customer once its old package is brought in, not a
  -- referral (CARRIED_OVER_REFERRAL_BLOCK_PLAN §1). Refuse while that referral is still pending; the exit is
  -- void_referral() (Referrals page → Void referral). ⚠ THIS MUST STAY THE LAST CHECK — after the INSERT, so every
  -- other refusal (expired, lesson count, which child, already brought in) answers first: the exit is an irreversible
  -- void, and the admin must never be sent to do it for a bring-in that would fail anyway (plan RISK 1). Raising here
  -- rolls back the INSERT and everything its triggers did (all in-database; the PKG counter is a row, not a sequence).
  -- Only the REFEREE side: a family that referred others can still be brought in.
  IF EXISTS (SELECT 1 FROM referrals r
              WHERE r.referee_parent_id = p_parent AND r.tenant_id = v_product.tenant_id
                AND r.status = 'pending') THEN
    RAISE EXCEPTION 'This family joined with a referral code. Void their referral on the Referrals page (Void referral) before bringing in a package.'
      USING ERRCODE = 'check_violation';
  END IF;

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
    WHEN 'referral' THEN
      -- 20261118000400: void_referral() audits under the referral. It is UPDATEd, never deleted.
      SELECT r.tenant_id INTO v_tenant FROM referrals r WHERE r.id = p_entity_id;
    ELSE
      RAISE EXCEPTION
        'audit_log: no tenant derivation for entity_type %. Add one to '
        'audit_log_tenant_of() — a row with no tenant is readable by the '
        'platform admin and by nobody else (20260804000300).', p_entity_type;
  END CASE;

  RETURN v_tenant;
END;
$function$;

CREATE FUNCTION public.void_referral(p_referral_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ref      referrals%ROWTYPE;
  v_reason   TEXT := coalesce(nullif(trim(p_reason), ''), 'Voided by admin');
  v_reward   UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_ref FROM referrals WHERE id = p_referral_id FOR UPDATE;
  IF v_ref.id IS NULL THEN
    RAISE EXCEPTION 'No such referral.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(v_ref.tenant_id, 'packages', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized to void this referral.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_ref.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending referral can be voided.' USING ERRCODE = 'check_violation';
  END IF;

  -- The family's own first-package discount for THIS referral — by referral_id + kind, never by parent (plan RISK 4).
  -- Already 'void' (the Rewards page's Void) is skipped. ⚠ NO EXCEPTION BLOCK around this call (plan RISK 5): a
  -- refusal (the discount is on a package the family has marked paid) must abort the whole void.
  SELECT rr.id INTO v_reward FROM referral_rewards rr
   WHERE rr.referral_id = v_ref.id AND rr.kind = 'referee_first' AND rr.status IN ('available', 'reserved');
  IF v_reward IS NOT NULL THEN
    PERFORM void_referral_reward(v_reward, v_reason);
  END IF;

  UPDATE referrals SET status = 'void', void_reason = v_reason WHERE id = v_ref.id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_value, new_value)
  VALUES (auth.uid(), 'referral_voided', 'referral', v_ref.id,
          jsonb_build_object('status', 'pending'),
          jsonb_build_object('status', 'void', 'void_reason', v_reason, 'referee_reward_voided', v_reward IS NOT NULL));
END;
$function$;

REVOKE ALL ON FUNCTION public.void_referral(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_referral(uuid, text) TO authenticated;
