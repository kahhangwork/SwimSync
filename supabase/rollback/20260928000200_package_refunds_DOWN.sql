-- Rollback for 20260928000200_package_refunds.sql — restores accounting_summary as 20260928000100 left it
-- (captured from the database before this migration), drops both RPCs and the table.
-- After running: DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260928000200';
-- and remove ('package_refunds|profiles') from supabase/tests/recurring_gotchas.test.sql.
--
-- REFUSES if any refund was recorded: rolling back would delete them. Never delete refund rows to make this run.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.package_refunds) THEN
    RAISE EXCEPTION 'package_refunds holds rows — rolling back would delete recorded refunds';
  END IF;
END $$;

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
$function$
;
REVOKE ALL ON FUNCTION public.accounting_summary(UUID, CHAR) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_summary(UUID, CHAR) TO authenticated;

DROP FUNCTION public.reverse_package_refund(UUID);
DROP FUNCTION public.record_package_refund(UUID, NUMERIC, DATE, TEXT);
DROP TABLE public.package_refunds;
