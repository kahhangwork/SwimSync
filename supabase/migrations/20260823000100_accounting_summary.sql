-- ============================================================
-- Owner-only accounting page (BACKLOG.md → "An owner-only accounting page").
-- Two owner-gated aggregate RPCs behind ONE gate, feeding a single admin page:
--   accounting_months(tenant)          → the sealed months the picker offers
--   accounting_summary(tenant, month)  → Revenue / Outstanding / Wages / Net
--
-- ACCRUAL basis, decided with the user 2026-08-16: revenue is what was ISSUED
-- for the month (invoices billed for it + paid_outside settlements covering it),
-- not cash received. "Never a partial figure" (PRD/BACKLOG): every figure below
-- is either complete or explicitly withheld (NULL + wages_state), never a
-- silent under-sum.
--
-- SECURITY DEFINER because the aggregates must see the whole tenant regardless
-- of which policies the caller's role narrows (§7.125). The explicit
-- is_tenant_owner() gate below is therefore load-bearing.
--
-- ⚠ RISK 4 (plan): the gate is is_tenant_owner(), NOT the
-- can_admin_tenant()/is_platform_admin() pair that unbilled_sealed_lessons uses
-- as its template. This is a P&L: a co-admin must not read it, and the platform
-- admin is refused too (owner-only was the settled decision). is_tenant_owner
-- composes is_tenant_admin, so a co-admin, a cross-tenant owner passing this
-- tenant's id, a suspended owner, and the platform admin are all already false.
-- DO NOT add is_platform_admin() back "to help support" — that is its own
-- decision.
--
-- Grants follow §7.87 / §7.39: callable by nobody until granted; the REVOKE
-- lists authenticated before the single GRANT back (belt — a cloud project
-- default can still hand a new function to anon/authenticated; the post-deploy
-- dump is the proof).
-- ============================================================

-- ── accounting_months ────────────────────────────────────────────────────────
-- The months the picker may offer: exactly those this tenant has SEALED (a
-- billing_periods row IS the seal — there is no boolean). billing_periods is in
-- fact readable by a tenant admin directly (billing_periods_select,
-- 20260718000900); this RPC exists NOT because that read is blocked but to keep
-- the whole page's data surface behind ONE owner gate rather than two access
-- paths with different audiences. (So there is deliberately no test asserting a
-- co-admin cannot read billing_periods directly — that would fail, correctly.)
CREATE FUNCTION public.accounting_months(p_tenant UUID)
RETURNS TABLE (billing_month TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_tenant_owner(p_tenant) THEN
    RAISE EXCEPTION 'only the business owner may read accounting figures';
  END IF;

  RETURN QUERY
  SELECT bp.billing_month::TEXT
    FROM billing_periods bp
   WHERE bp.tenant_id = p_tenant
   ORDER BY bp.billing_month DESC;
END;
$$;

COMMENT ON FUNCTION public.accounting_months(UUID) IS
  'Owner-only. The sealed billing months for a tenant, newest first — the month picker on the accounting page. A billing_periods row IS the seal.';

REVOKE ALL ON FUNCTION public.accounting_months(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_months(UUID) TO authenticated;


-- ── accounting_summary ───────────────────────────────────────────────────────
-- One row of figures for one sealed month.
--
-- REVENUE (⟨RISK 3⟩): sum of net_amount MINUS balance_adjustment over invoices
-- billed for M, plus live paid_outside settlements covering M.
--   net_amount = gross_amount − package_applied − credit_applied + balance_adjustment
--                (COMMENT on invoices.balance_adjustment, 20260822000100).
--   balance_adjustment is a PRIOR month's debit folded onto M's invoice at
--   settle time — a collection event for an earlier month, not value delivered
--   in M — so it is subtracted back out. credit_applied stays excluded (net,
--   not gross: credit is value received in a prior month). package_applied is
--   likewise excluded: the package purchase was off-invoice cash and belongs to
--   no month here. Components are all returned so a surprising Revenue is
--   auditable without re-deriving SQL.
--
-- SETTLEMENTS (⟨RISK 5⟩): bucketed by to_char(settled_through,'YYYY-MM'). That
-- date is EFFECTIVE-DATED (covers attendance on or before it), not a month
-- bucket, so cross-month attribution is knowingly coarse — but conservation is
-- exact: each settlement lands in exactly ONE month. No invoice/settlement
-- double-count: a paid_outside settlement exists precisely for lessons no
-- invoice line covers (the engine and unbilled_sealed_lessons both net them out
-- first), so net_amount + settlements.amount is sound.
-- Edge (accepted, vigilance): a settlement whose settled_through falls in a
-- month the tenant never seals appears in NO picker month.
--
-- OUTSTANDING (⟨RISK 7⟩): sum of net_amount over M's still-outstanding invoices
-- — identical to the invoices page's totalOutstanding
-- (SwimSyncAdmin/app/(admin)/invoices/page.tsx). It is a cash "still asked for"
-- figure, so it does NOT subtract balance_adjustment (unlike Revenue), and it
-- legitimately CHANGES over time as invoices get paid.
--
-- WAGES (⟨RISK 1⟩ + ⟨RISK 2⟩): accrued cost of lessons TAUGHT in M.
--   = Σ non-adjustment payout items of period M
--   + Σ adjustment items (on ANY period's payout) whose original_period = M.
--   generate_coach_payouts posts a correction to an already-paid period M as an
--   is_adjustment item on a LATER payout carrying original_period=M; excluding
--   those would make M's wages permanently uncorrectable, so they are pulled
--   back to M by original_period.
--   wages_state is a per-rated-coach COVERAGE check, NOT "any payout row":
--     - no rated coach at all (rate lookup MUST join coaches.tenant_id —
--       coach_rates has no tenant column) → 'final', wages 0. This is prod.
--     - a rated coach with NO payout row for M → 'run_payouts', wages/net NULL
--       (never a partial sum — that is the silent understatement this page's
--       backlog entry warns against). A coach rated AFTER the payout run has no
--       row while colleagues do; a binary "any row?" check would call that
--       final and overstate Net.
--     - every rated coach has a row, ≥1 draft → 'draft' (a draft rebuilds on
--       regenerate and M stays markable ~a month after sealing, §8.32, so the
--       number can still move — badge it).
--     - every rated coach has a row, all paid → 'final'.
--   Historical-stability note: coach_payout_items CASCADE-delete with a
--   hard-deleted coach, which would shrink a past 'final' wages figure. The
--   product DISABLES coaches, never hard-deletes them (20260813000200), so in
--   practice a sealed month's wages stay stable; recorded here, not guarded.
CREATE FUNCTION public.accounting_summary(p_tenant UUID, p_month CHAR(7))
RETURNS TABLE (
  revenue                    NUMERIC,
  revenue_invoiced           NUMERIC,
  revenue_settlements        NUMERIC,
  revenue_gross              NUMERIC,
  revenue_package_applied    NUMERIC,
  revenue_credit_applied     NUMERIC,
  revenue_balance_adjustment NUMERIC,
  outstanding                NUMERIC,
  wages                      NUMERIC,
  net                        NUMERIC,
  wages_state                TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
BEGIN
  IF NOT is_tenant_owner(p_tenant) THEN
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
    v_invoiced + v_settlements,                              -- revenue
    v_invoiced,                                              -- revenue_invoiced
    v_settlements,                                           -- revenue_settlements
    v_gross,                                                 -- revenue_gross
    v_package,                                               -- revenue_package_applied
    v_credit,                                                -- revenue_credit_applied
    v_adjust,                                                -- revenue_balance_adjustment
    v_outstanding,                                           -- outstanding
    v_wages,                                                 -- wages (NULL on run_payouts)
    CASE WHEN v_wages IS NULL THEN NULL
         ELSE (v_invoiced + v_settlements) - v_wages END,    -- net
    v_state;                                                 -- wages_state
END;
$$;

COMMENT ON FUNCTION public.accounting_summary(UUID, CHAR) IS
  'Owner-only accrual figures for one SEALED month: revenue (net_amount − balance_adjustment + paid_outside settlements covering the month), outstanding (M''s unpaid invoices, raw net_amount), accrued wages (M''s non-adjustment payout items + adjustments reallocated by original_period), and net. wages_state is a per-rated-coach coverage check: run_payouts (wages/net NULL) when a rated coach has no payout row for M; draft when any is still draft; final otherwise (or when the tenant has no rated coach). RAISEs on an unsealed month.';

REVOKE ALL ON FUNCTION public.accounting_summary(UUID, CHAR) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_summary(UUID, CHAR) TO authenticated;
