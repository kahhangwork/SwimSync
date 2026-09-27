-- ============================================================
-- Wave 2 · U2 — in-app package refunds
-- (docs/plans/PACKAGE_REVENUE_REFUNDS_PLAN.md U2; BACKLOG "In-app package refunds").
--
-- Decisions (settled with the user 2026-09-27 — do not re-open in code):
--   • A refund is recorded against a CANCELLED package that was PAID (confirmed_at set).
--   • The admin types any amount; the database caps it at what the family PAID (amount_payable).
--   • One LIVE refund per package; a mistake is REVERSED (kept for audit), then re-recorded.
--   • Recorded = paid out. refunded_on decides its Accounting month: today or earlier (SGT), never before the
--     package was paid, never in a CLOSED month (one with a billing_periods row) — closed figures never change.
--   • Who: packages:edit (grantable under Roles; Full admin by default) or the platform admin.
--
-- Writes only through the two SECURITY DEFINER RPCs — authenticated holds SELECT only (§7.87), under an RLS
-- policy for packages:view or accounting:view. Every refusal is a sentence an owner can read (the modal shows it
-- verbatim). Both RPCs audit under entity_type 'parent_package' (arm added in 20260928000100, §7.297).
--
-- ACCEPTED RACE (plan RISK 5): a refund back-dated into LAST month can commit in the moment after
-- generate-invoices seals that month (the engine seals over HTTP, no shared lock). Accounting reads live, so the
-- refund simply belongs to the just-closed month. Do NOT "close" this with an override or a post-seal edit path.
--
-- service_role keeps its usual table privileges (every public table's shape; it bypasses RLS and is how Deno
-- teardowns clean up). Rollback: supabase/rollback/20260928000200_package_refunds_DOWN.sql
-- ============================================================

-- ── 1. The table ────────────────────────────────────────────────────────────
CREATE TABLE public.package_refunds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_package_id UUID NOT NULL REFERENCES public.parent_packages(id) ON DELETE CASCADE,
  amount            NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  refunded_on       DATE NOT NULL,
  note              TEXT,
  recorded_by       UUID NOT NULL REFERENCES public.profiles(id),
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at       TIMESTAMPTZ,
  reversed_by       UUID REFERENCES public.profiles(id),
  CONSTRAINT package_refunds_reversal_pair CHECK (
    (reversed_at IS NULL AND reversed_by IS NULL) OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL))
);

-- One LIVE refund per package (Q3); the RPC refuses first, readably — this is the backstop.
CREATE UNIQUE INDEX package_refunds_one_live ON public.package_refunds (parent_package_id) WHERE reversed_at IS NULL;
CREATE INDEX package_refunds_tenant_month ON public.package_refunds (tenant_id, refunded_on) WHERE reversed_at IS NULL;

ALTER TABLE public.package_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY package_refunds_select ON public.package_refunds
  FOR SELECT TO authenticated
  USING (is_platform_admin()
         OR has_admin_area(tenant_id, 'packages'::admin_area, 'view'::admin_level)
         OR has_admin_area(tenant_id, 'accounting'::admin_area, 'view'::admin_level));

REVOKE ALL ON TABLE public.package_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.package_refunds TO authenticated;
GRANT ALL ON TABLE public.package_refunds TO service_role;

-- ── 2. record_package_refund ────────────────────────────────────────────────
CREATE FUNCTION public.record_package_refund(p_package UUID, p_amount NUMERIC, p_refunded_on DATE, p_note TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pp        parent_packages%ROWTYPE;
  v_paid_on   DATE;
  v_id        UUID;
  v_note      TEXT := NULLIF(btrim(p_note), '');
BEGIN
  -- Lock the package first: a double-click or two admins collapse to one refund.
  SELECT * INTO v_pp FROM parent_packages WHERE id = p_package FOR UPDATE;
  IF v_pp.id IS NULL THEN
    RAISE EXCEPTION 'That package could not be found.';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(v_pp.tenant_id, 'packages'::admin_area, 'edit'::admin_level)) THEN
    RAISE EXCEPTION 'Your role cannot record refunds for this business.';
  END IF;

  IF v_pp.status <> 'cancelled' OR v_pp.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Only a cancelled package that was paid for can be refunded.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter a refund amount above S$0.';
  END IF;
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'A refund amount can have at most two decimal places.';
  END IF;
  IF p_amount > v_pp.amount_payable THEN
    RAISE EXCEPTION 'A refund cannot be more than the family paid (S$%).', to_char(v_pp.amount_payable, 'FM999999990.00');
  END IF;

  -- Dates in SGT (§7.7/§7.227): today_sg(), and the confirmation instant read in Asia/Singapore.
  v_paid_on := (v_pp.confirmed_at AT TIME ZONE 'Asia/Singapore')::date;
  IF p_refunded_on IS NULL THEN
    RAISE EXCEPTION 'Choose the date the refund was paid.';
  END IF;
  IF p_refunded_on > today_sg() THEN
    RAISE EXCEPTION 'A refund cannot be dated in the future.';
  END IF;
  IF p_refunded_on < v_paid_on THEN
    RAISE EXCEPTION 'A refund cannot be dated before the package was paid (%).', to_char(v_paid_on, 'FMDD Mon YYYY');
  END IF;
  IF EXISTS (SELECT 1 FROM billing_periods bp
              WHERE bp.tenant_id = v_pp.tenant_id
                AND bp.billing_month = to_char(p_refunded_on, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'That month is closed — refunds can only be dated in an open month.';
  END IF;

  IF EXISTS (SELECT 1 FROM package_refunds pr WHERE pr.parent_package_id = v_pp.id AND pr.reversed_at IS NULL) THEN
    RAISE EXCEPTION 'This package already has a refund recorded. Reverse it first to record a different one.';
  END IF;

  INSERT INTO package_refunds (tenant_id, parent_package_id, amount, refunded_on, note, recorded_by)
  VALUES (v_pp.tenant_id, v_pp.id, p_amount, p_refunded_on, v_note, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), 'package_refund', 'parent_package', v_pp.id,
          jsonb_build_object('refund_id', v_id, 'amount', p_amount, 'refunded_on', p_refunded_on, 'note', v_note));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_package_refund(UUID, NUMERIC, DATE, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_package_refund(UUID, NUMERIC, DATE, TEXT) TO authenticated;

-- ── 3. reverse_package_refund ───────────────────────────────────────────────
CREATE FUNCTION public.reverse_package_refund(p_refund UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r package_refunds%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM package_refunds WHERE id = p_refund FOR UPDATE;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'That refund could not be found.';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(v_r.tenant_id, 'packages'::admin_area, 'edit'::admin_level)) THEN
    RAISE EXCEPTION 'Your role cannot reverse refunds for this business.';
  END IF;

  IF v_r.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This refund has already been reversed.';
  END IF;

  IF EXISTS (SELECT 1 FROM billing_periods bp
              WHERE bp.tenant_id = v_r.tenant_id
                AND bp.billing_month = to_char(v_r.refunded_on, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'That refund''s month is closed — it can no longer be reversed.';
  END IF;

  UPDATE package_refunds SET reversed_at = now(), reversed_by = auth.uid() WHERE id = v_r.id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_value)
  VALUES (auth.uid(), 'package_refund_reversed', 'parent_package', v_r.parent_package_id,
          jsonb_build_object('refund_id', v_r.id, 'amount', v_r.amount, 'refunded_on', v_r.refunded_on));
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_package_refund(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_package_refund(UUID) TO authenticated;

-- ── 4. accounting_summary + revenue_package_refunds ─────────────────────────
-- Body from the live DB (20260928000100's); diff = the refund hunks only.
DROP FUNCTION public.accounting_summary(UUID, CHAR);

CREATE FUNCTION public.accounting_summary(p_tenant uuid, p_month character)
 RETURNS TABLE(revenue numeric, revenue_invoiced numeric, revenue_settlements numeric, revenue_gross numeric, revenue_package_applied numeric, revenue_credit_applied numeric, revenue_balance_adjustment numeric, outstanding numeric, wages numeric, net numeric, wages_state text, revenue_packages numeric, revenue_package_refunds numeric)
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
  v_refunds     NUMERIC;
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

  -- Package refunds PAID OUT in M (Wave 2 U2) — the mirror of the line above.
  -- refunded_on is a DATE the admin chose in SGT, so no zone cast; reversed
  -- refunds never count. Returned positive; subtracted in v_revenue.
  SELECT COALESCE(SUM(pr.amount), 0)
    INTO v_refunds
    FROM package_refunds pr
   WHERE pr.tenant_id = p_tenant
     AND pr.reversed_at IS NULL
     AND to_char(pr.refunded_on, 'YYYY-MM') = p_month;

  -- §7.298: revenue is assigned ONCE; revenue and net both read it. No
  -- revenue arithmetic inside RETURN QUERY.
  v_revenue := v_invoiced + v_settlements + v_packages - v_refunds;

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
    v_packages,                                              -- revenue_packages
    v_refunds;                                               -- revenue_package_refunds
END;
$function$;

REVOKE ALL ON FUNCTION public.accounting_summary(UUID, CHAR) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_summary(UUID, CHAR) TO authenticated;
