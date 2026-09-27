-- ============================================================
-- Wave 2 · U1 — package revenue on the accounting page
-- (docs/plans/PACKAGE_REVENUE_REFUNDS_PLAN.md; BACKLOG "Package revenue on the
-- accounting page"). Three changes, each copied from pg_get_functiondef of the
-- live body (§7.40) and diffed to exactly the hunks named below:
--
-- 1. enforce_parent_package_lifecycle — confirmed_at is pinned to now() for
--    `authenticated` on both the INSERT-as-active and the pending→active path.
--    confirmed_at now DECIDES a revenue month, so a client-supplied back-date
--    would land revenue in a closed month. Service role / definer paths are
--    unchanged. The current_user read stays in this INVOKER trigger (§7.38).
-- 2. accounting_summary — gains revenue_packages: package purchases PAID in M
--    (cash basis, confirmed_at in SGT, amount_payable). Return type changes, so
--    DROP + CREATE + REVOKE/GRANT (§7.87, §7.39). Revenue is assigned once
--    (§7.298). Gate and unsealed-month refusal byte-identical to 20260927000500.
-- 3. audit_log_tenant_of — a 'parent_package' arm, consumed by U2's refund RPCs
--    (§7.297).
-- Rollback: supabase/rollback/20260928000100_accounting_package_revenue_DOWN.sql
-- ============================================================

-- ── 1. confirmed_at pin ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_parent_package_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product package_products%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_product FROM package_products WHERE id = NEW.product_id;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Unknown package product.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_product.is_active THEN
      RAISE EXCEPTION 'That package is no longer offered.' USING ERRCODE = 'check_violation';
    END IF;

    NEW.tenant_id       := v_product.tenant_id;
    NEW.name            := v_product.name;
    NEW.category_id     := v_product.category_id;
    NEW.lesson_count    := v_product.lesson_count;
    NEW.rate_per_lesson := v_product.rate_per_lesson;
    NEW.validity_months := v_product.validity_months;
    NEW.validity_weeks  := v_product.validity_weeks;
    NEW.total_value     := v_product.lesson_count * v_product.rate_per_lesson;
    NEW.value_remaining := NEW.total_value;
    NEW.cancelled_at    := NULL;
    NEW.discount_amount    := 0;
    NEW.amount_payable     := NEW.total_value;
    NEW.referral_reward_id := NULL;
    NEW.holiday_extension_days := 0;
    NEW.cancel_extension_days  := 0;
    NEW.manual_extension_days  := 0;
    NEW.paid_claimed_at := NULL;
    NEW.superseded_by   := NULL;

    IF current_user = 'authenticated' AND NOT (is_platform_admin() OR has_admin_area(NEW.tenant_id, 'packages', 'edit')) THEN
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.start_date   := NULL;
      NEW.expires_on   := NULL;
      NEW.offered_by   := NULL;
      NEW.offered_at   := NULL;
    ELSIF NEW.status = 'active' THEN
      NEW.confirmed_at := CASE WHEN current_user = 'authenticated' THEN NOW() ELSE COALESCE(NEW.confirmed_at, NOW()) END;
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.start_date   := COALESCE(NEW.start_date,
                                   (NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date);
      NEW.expires_on   := package_effective_end(NEW.start_date, NEW.validity_weeks,
                                                 NEW.holiday_extension_days,
                                                 NEW.cancel_extension_days,
                                                 NEW.manual_extension_days);
    ELSE
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.expires_on   := NULL;
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE ---------------------------------------------------------------

  IF NEW.product_id      IS DISTINCT FROM OLD.product_id
     OR NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id
     OR NEW.parent_id       IS DISTINCT FROM OLD.parent_id
     OR NEW.name            IS DISTINCT FROM OLD.name
     OR NEW.category_id     IS DISTINCT FROM OLD.category_id
     OR NEW.lesson_count    IS DISTINCT FROM OLD.lesson_count
     OR NEW.rate_per_lesson IS DISTINCT FROM OLD.rate_per_lesson
     OR NEW.total_value     IS DISTINCT FROM OLD.total_value
     OR NEW.validity_months IS DISTINCT FROM OLD.validity_months
     OR NEW.validity_weeks  IS DISTINCT FROM OLD.validity_weeks
     OR NEW.requested_at    IS DISTINCT FROM OLD.requested_at
  THEN
    RAISE EXCEPTION 'A package''s terms are a record of the sale and cannot be edited.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user = 'authenticated'
     AND (NEW.holiday_extension_days IS DISTINCT FROM OLD.holiday_extension_days
          OR NEW.cancel_extension_days IS DISTINCT FROM OLD.cancel_extension_days
          OR NEW.manual_extension_days IS DISTINCT FROM OLD.manual_extension_days)
  THEN
    RAISE EXCEPTION 'Package extension fields are set by the system, not edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user = 'authenticated'
     AND (NEW.offered_by         IS DISTINCT FROM OLD.offered_by
          OR NEW.offered_at      IS DISTINCT FROM OLD.offered_at
          OR NEW.paid_claimed_at IS DISTINCT FROM OLD.paid_claimed_at
          OR NEW.superseded_by   IS DISTINCT FROM OLD.superseded_by)
  THEN
    RAISE EXCEPTION 'Offer and payment-claim fields are set by the system, not edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user = 'authenticated'
     AND (NEW.discount_amount    IS DISTINCT FROM OLD.discount_amount
          OR NEW.amount_payable     IS DISTINCT FROM OLD.amount_payable
          OR NEW.referral_reward_id IS DISTINCT FROM OLD.referral_reward_id)
  THEN
    RAISE EXCEPTION 'Referral discount fields are set by the system, not edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user = 'authenticated'
     AND NEW.start_date IS DISTINCT FROM OLD.start_date
  THEN
    IF NOT (is_platform_admin() OR has_admin_area(OLD.tenant_id, 'packages', 'edit')) THEN
      RAISE EXCEPTION 'Only the business sets a package''s start date.'
        USING ERRCODE = 'check_violation';
    ELSIF OLD.status = 'active' THEN
      RAISE EXCEPTION 'A package''s start date is fixed once active — cancel and re-sell to change it.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.value_remaining IS DISTINCT FROM OLD.value_remaining
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION 'A package balance is moved by billing, never edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending' AND NEW.status = 'active' THEN
      IF current_user = 'authenticated' AND NOT (is_platform_admin() OR has_admin_area(OLD.tenant_id, 'packages', 'edit')) THEN
        RAISE EXCEPTION 'Only the business can confirm a package purchase.'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.confirmed_at := CASE WHEN current_user = 'authenticated' THEN NOW() ELSE COALESCE(NULLIF(NEW.confirmed_at, OLD.confirmed_at), NOW()) END;
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.start_date   := COALESCE(NEW.start_date, OLD.start_date,
                                   (NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date);
      NEW.expires_on   := package_effective_end(NEW.start_date, NEW.validity_weeks,
                                                 NEW.holiday_extension_days,
                                                 NEW.cancel_extension_days,
                                                 NEW.manual_extension_days);
    ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    ELSIF OLD.status = 'active' AND NEW.status = 'cancelled' THEN
      IF current_user = 'authenticated' AND NOT (is_platform_admin() OR has_admin_area(OLD.tenant_id, 'packages', 'edit')) THEN
        RAISE EXCEPTION 'Only the business can cancel an active package.'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    ELSE
      RAISE EXCEPTION 'Illegal package status change (% -> %).', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF current_user = 'authenticated'
       AND (NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
            OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
            OR NEW.expires_on   IS DISTINCT FROM OLD.expires_on
            OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at)
    THEN
      RAISE EXCEPTION 'Confirmation fields are set by the status transition, not edited.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 2. accounting_summary + revenue_packages ─────────────────────────────
DROP FUNCTION public.accounting_summary(UUID, CHAR);

CREATE FUNCTION public.accounting_summary(p_tenant uuid, p_month character)
 RETURNS TABLE(revenue numeric, revenue_invoiced numeric, revenue_settlements numeric, revenue_gross numeric, revenue_package_applied numeric, revenue_credit_applied numeric, revenue_balance_adjustment numeric, outstanding numeric, wages numeric, net numeric, wages_state text, revenue_packages numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gross       NUMERIC;
  v_package     NUMERIC;
  v_credit      NUMERIC;
  v_adjust      NUMERIC;
  v_invoiced    NUMERIC;
  v_settlements NUMERIC;
  v_outstanding NUMERIC;
  v_rated       INT;
  v_missing     INT;
  v_draft       INT;
  v_wages       NUMERIC;
  v_state       TEXT;
  v_packages    NUMERIC;
  v_revenue     NUMERIC;
BEGIN
  IF NOT has_admin_area(p_tenant, 'accounting', 'view') THEN
    RAISE EXCEPTION 'only the business owner may read accounting figures';
  END IF;

  IF p_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'month must be YYYY-MM';
  END IF;

  -- ⚠ RISK 5: refuse an unsealed month on our own — the picker only offers
  -- sealed months, but the RPC is the boundary, not the picker. An unsealed
  -- month can still gain invoices and settlements, so any figure for it would
  -- be partial.
  IF NOT EXISTS (
    SELECT 1 FROM billing_periods bp
     WHERE bp.tenant_id = p_tenant AND bp.billing_month = p_month
  ) THEN
    RAISE EXCEPTION 'month % is not sealed for this business', p_month;
  END IF;

  -- Revenue components (⚠ RISK 3).
  SELECT
    COALESCE(SUM(i.gross_amount), 0),
    COALESCE(SUM(i.package_applied), 0),
    COALESCE(SUM(i.credit_applied), 0),
    COALESCE(SUM(i.balance_adjustment), 0),
    COALESCE(SUM(i.net_amount - i.balance_adjustment), 0),
    COALESCE(SUM(i.net_amount) FILTER (WHERE i.status = 'outstanding'), 0)
  INTO v_gross, v_package, v_credit, v_adjust, v_invoiced, v_outstanding
  FROM invoices i
  WHERE i.tenant_id = p_tenant
    AND i.billing_month = p_month;

  -- paid_outside settlements covering M (⚠ RISK 5).
  SELECT COALESCE(SUM(ss.amount), 0)
    INTO v_settlements
    FROM student_settlements ss
   WHERE ss.tenant_id = p_tenant
     AND ss.kind = 'paid_outside'
     AND ss.reversed_at IS NULL
     AND to_char(ss.settled_through, 'YYYY-MM') = p_month;

  -- Package purchases PAID in M (Wave 2, PACKAGE_REVENUE_REFUNDS_PLAN.md U1).
  -- CASH basis, a deliberate exception to the accrual basis above (decided with
  -- the user 2026-09-27 — do not "fix" it back to per-lesson recognition). The
  -- month is confirmed_at in SGT (§7.7/§7.227 — never a zoneless to_char);
  -- the amount is amount_payable (after any referral discount), never
  -- total_value. Status is NOT filtered: a package paid then cancelled was
  -- still paid in M — its refund is its own line. Package-funded invoice lines
  -- stay subtracted inside v_invoiced (revenue_package_applied), so nothing is
  -- counted twice.
  SELECT COALESCE(SUM(pp.amount_payable), 0)
    INTO v_packages
    FROM parent_packages pp
   WHERE pp.tenant_id = p_tenant
     AND pp.confirmed_at IS NOT NULL
     AND to_char(pp.confirmed_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM') = p_month;

  -- §7.298: revenue is assigned ONCE; revenue and net both read it. No
  -- revenue arithmetic inside RETURN QUERY.
  v_revenue := v_invoiced + v_settlements + v_packages;

  -- Wages coverage (⚠ RISK 1). Rate lookup joins coaches.tenant_id — coach_rates
  -- has NO tenant column, and a bare EXISTS(coach_rates) reads other tenants'
  -- rates and freezes prod's rate-less solo coach into eternal run_payouts.
  SELECT count(*) INTO v_rated
    FROM coaches c
   WHERE c.tenant_id = p_tenant
     AND EXISTS (SELECT 1 FROM coach_rates r WHERE r.coach_id = c.id);

  IF v_rated = 0 THEN
    -- No payroll at all: wages are definitionally 0, Net = Revenue. Prod today.
    v_wages := 0;
    v_state := 'final';
  ELSE
    -- Any rated coach missing a payout row for M?
    SELECT count(*) INTO v_missing
      FROM coaches c
     WHERE c.tenant_id = p_tenant
       AND EXISTS (SELECT 1 FROM coach_rates r WHERE r.coach_id = c.id)
       AND NOT EXISTS (
         SELECT 1 FROM coach_payouts cp
          WHERE cp.tenant_id = p_tenant
            AND cp.coach_id = c.id
            AND cp.period_month = p_month);

    IF v_missing > 0 THEN
      v_wages := NULL;      -- never a partial sum
      v_state := 'run_payouts';
    ELSE
      -- A draft ANYWHERE that feeds M's wages makes M 'draft' — not only a draft
      -- dated in M. M's wages include is_adjustment items reallocated to M by
      -- original_period (⚠ RISK 2), and those live on a LATER month's payout; if
      -- THAT payout is still draft the reallocated amount can move on the next
      -- regenerate (generate_coach_payouts DELETEs and rebuilds a draft's items),
      -- so reporting M 'final' would be a quiet wrong number. No coach_rates
      -- filter: whether the coach is still rated is irrelevant to "can this move",
      -- and a draft payout of a since-unrated coach still contributes to wages.
      SELECT count(*) INTO v_draft
        FROM coach_payouts cp
       WHERE cp.tenant_id = p_tenant
         AND cp.status = 'draft'
         AND (
           cp.period_month = p_month
           OR EXISTS (
             SELECT 1 FROM coach_payout_items cpi
              WHERE cpi.payout_id = cp.id
                AND cpi.is_adjustment = TRUE
                AND cpi.original_period = p_month)
         );
      v_state := CASE WHEN v_draft > 0 THEN 'draft' ELSE 'final' END;
    END IF;
  END IF;

  -- Accrued wages for M (⚠ RISK 2): M's own non-adjustment items PLUS
  -- adjustments (on any payout) reallocated to M by original_period.
  IF v_state <> 'run_payouts' THEN
    SELECT COALESCE(SUM(cpi.amount), 0)
      INTO v_wages
      FROM coach_payout_items cpi
      JOIN coach_payouts cp ON cp.id = cpi.payout_id
     WHERE cp.tenant_id = p_tenant
       AND (
         (cp.period_month = p_month AND cpi.is_adjustment = FALSE)
         OR (cpi.is_adjustment = TRUE AND cpi.original_period = p_month)
       );
  END IF;

  RETURN QUERY SELECT
    v_revenue,                                               -- revenue
    v_invoiced,                                              -- revenue_invoiced
    v_settlements,                                           -- revenue_settlements
    v_gross,                                                 -- revenue_gross
    v_package,                                               -- revenue_package_applied
    v_credit,                                                -- revenue_credit_applied
    v_adjust,                                                -- revenue_balance_adjustment
    v_outstanding,                                           -- outstanding
    v_wages,                                                 -- wages (NULL on run_payouts)
    CASE WHEN v_wages IS NULL THEN NULL
         ELSE v_revenue - v_wages END,                       -- net
    v_state,                                                 -- wages_state
    v_packages;                                              -- revenue_packages
END;
$function$;

REVOKE ALL ON FUNCTION public.accounting_summary(UUID, CHAR) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_summary(UUID, CHAR) TO authenticated;

-- ── 3. audit_log_tenant_of: parent_package ──────────────────────────────────
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
