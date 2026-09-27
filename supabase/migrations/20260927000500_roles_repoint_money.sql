-- ============================================================
-- Roles & permissions migration C: re-point the MONEY areas — pricing,
-- billing, packages, wages, accounting — to has_admin_area()
-- (ROLES_PERMISSIONS_PLAN.md §5.3, step 3; ROLES_ENFORCEMENT_MAP.md §2, §3).
--
-- Mechanical part (generated from the live database 2026-09-27, §7.40, and
-- reviewed per call site), same rule as migration B:
--   is_tenant_admin(X)  → has_admin_area(X, area, level)
--   can_admin_tenant(X) → (is_platform_admin() OR has_admin_area(X, area, level))
--   is_tenant_owner(X)  → has_admin_area(X, 'accounting', 'view')   (accounting RPCs — owner still passes, D1)
-- SELECT → view; INSERT / UPDATE / DELETE / ALL / mutating RPC → edit.
-- 31 policies (3 on storage.objects — the PayNow QR bucket) + 14 functions.
--
-- Four tables had an ALL policy as their ONLY admin read path (class_rates,
-- class_rate_overrides, coach_rates, session_pay_overrides): moving it to
-- edit would hide them from a view-only role, so each gains a view-level
-- *_admin_select policy (grant already held — §7.87).
--
-- The COACH ARM on money is REMOVED (P11 + X3, decided with the user
-- 2026-09-27): coach_serves_parent() is dropped from invoices (select +
-- update), invoice_items, credit_notes, credit_applications, payment_records
-- (select + insert) and confirm_invoice_paid. The coach app shows no
-- invoices (PRD §7.9; its pay screen says so in a comment) and every money
-- read in SwimSyncApp is on a parent screen; credit-note-emails authorises a
-- coach once and then reads with the service role. X3 named invoices and
-- payment_records; the three sibling tables go with them because a coach who
-- cannot see an invoice has no reason to see its lines or credit notes.
--
-- Hand-built parts:
--   * set_class_terms: additive checks — a rate change needs pricing:edit, a
--     schedule / coach / location / title change needs operations:edit.
--   * guard_class_price (BEFORE INSERT OR UPDATE on classes): a priced class
--     INSERT (it seeds the first billing rate) or a direct price edit needs
--     pricing:edit.
--   * guard_tenant_columns (BEFORE UPDATE on tenants): every column maps to
--     profile / billing / wages / packages, or to nobody (ids, counters,
--     owner, suspension); an unmapped column is refused — deny by default.
--
-- NOT changed: billing_periods / billing_runs reads stay open to any active
-- admin (X2 — month state, not money).
--
-- BEHAVIOUR-PRESERVING for every existing admin: the owner passes all (D1);
-- "Co-admin (as before)" holds pricing, billing, packages, wages and profile
-- at edit and accounting at none — exactly today. The only accounts that
-- lose anything are COACHES, who lose the money read/write arm (P11/X3).
--
-- Rollback: supabase/rollback/20260927000500_roles_repoint_money_DOWN.sql
-- ============================================================

-- public.class_rates.class_rates_admin (ALL → pricing:edit)
ALTER POLICY class_rates_admin ON public.class_rates
  USING ((is_platform_admin() OR has_admin_area(class_tenant(class_id), 'pricing', 'edit')))
  WITH CHECK ((is_platform_admin() OR has_admin_area(class_tenant(class_id), 'pricing', 'edit')));

-- public.class_rate_overrides.class_rate_overrides_admin (ALL → pricing:edit)
ALTER POLICY class_rate_overrides_admin ON public.class_rate_overrides
  USING ((is_platform_admin() OR has_admin_area(class_tenant(class_id), 'pricing', 'edit')))
  WITH CHECK ((is_platform_admin() OR has_admin_area(class_tenant(class_id), 'pricing', 'edit')));

-- public.trial_rates.trial_rates_insert (INSERT → pricing:edit)
ALTER POLICY trial_rates_insert ON public.trial_rates
  WITH CHECK ((is_platform_admin() OR has_admin_area(tenant_id, 'pricing', 'edit')));

-- public.invoices.invoices_select (SELECT → billing:view, coach arm removed x1)
ALTER POLICY invoices_select ON public.invoices
  USING ((((parent_id = current_parent_id()) AND (NOT tenant_suspended(tenant_id))) OR is_platform_admin() OR has_admin_area(tenant_id, 'billing', 'view')));

-- public.invoices.invoices_update (UPDATE → billing:edit, coach arm removed x2)
ALTER POLICY invoices_update ON public.invoices
  USING (((is_platform_admin() OR has_admin_area(tenant_id, 'billing', 'edit'))))
  WITH CHECK (((is_platform_admin() OR has_admin_area(tenant_id, 'billing', 'edit'))));

-- public.invoice_items.invoice_items_select (SELECT → billing:view, coach arm removed x1)
ALTER POLICY invoice_items_select ON public.invoice_items
  USING ((EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = invoice_items.invoice_id) AND (((i.parent_id = current_parent_id()) AND (NOT tenant_suspended(i.tenant_id))) OR is_platform_admin() OR has_admin_area(i.tenant_id, 'billing', 'view'))))));

-- public.credit_notes.credit_notes_select (SELECT → billing:view, coach arm removed x1)
ALTER POLICY credit_notes_select ON public.credit_notes
  USING ((((parent_id = current_parent_id()) AND (NOT tenant_suspended(tenant_id))) OR is_platform_admin() OR has_admin_area(tenant_id, 'billing', 'view')));

-- public.credit_applications.credit_applications_select (SELECT → billing:view, coach arm removed x1)
ALTER POLICY credit_applications_select ON public.credit_applications
  USING ((EXISTS ( SELECT 1
   FROM credit_notes cn
  WHERE ((cn.id = credit_applications.credit_note_id) AND (((cn.parent_id = current_parent_id()) AND (NOT tenant_suspended(cn.tenant_id))) OR is_platform_admin() OR has_admin_area(cn.tenant_id, 'billing', 'view'))))));

-- public.payment_records.payment_records_select (SELECT → billing:view, coach arm removed x1)
ALTER POLICY payment_records_select ON public.payment_records
  USING ((is_platform_admin() OR (EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = payment_records.invoice_id) AND (((i.parent_id = current_parent_id()) AND (NOT tenant_suspended(i.tenant_id))) OR has_admin_area(i.tenant_id, 'billing', 'view')))))));

-- public.payment_records.payment_records_insert (INSERT → billing:edit, coach arm removed x1)
ALTER POLICY payment_records_insert ON public.payment_records
  WITH CHECK ((is_platform_admin() OR (EXISTS ( SELECT 1
   FROM invoices i
  WHERE ((i.id = payment_records.invoice_id) AND (has_admin_area(i.tenant_id, 'billing', 'edit')))))));

-- public.student_settlements.student_settlements_select (SELECT → billing:view)
ALTER POLICY student_settlements_select ON public.student_settlements
  USING ((is_platform_admin() OR (is_platform_admin() OR has_admin_area(tenant_id, 'billing', 'view'))));

-- public.student_settlements.student_settlements_insert (INSERT → billing:edit)
ALTER POLICY student_settlements_insert ON public.student_settlements
  WITH CHECK ((is_platform_admin() OR has_admin_area(tenant_id, 'billing', 'edit')));

-- public.student_settlements.student_settlements_update (UPDATE → billing:edit)
ALTER POLICY student_settlements_update ON public.student_settlements
  USING ((is_platform_admin() OR has_admin_area(tenant_id, 'billing', 'edit')))
  WITH CHECK ((is_platform_admin() OR has_admin_area(tenant_id, 'billing', 'edit')));

-- storage.objects.paynow_qr_tenant_insert (INSERT → billing:edit)
ALTER POLICY paynow_qr_tenant_insert ON storage.objects
  WITH CHECK (((bucket_id = 'paynow-qr'::text) AND (is_platform_admin() OR has_admin_area((NULLIF((storage.foldername(name))[1], ''::text))::uuid, 'billing', 'edit'))));

-- storage.objects.paynow_qr_tenant_update (UPDATE → billing:edit)
ALTER POLICY paynow_qr_tenant_update ON storage.objects
  USING (((bucket_id = 'paynow-qr'::text) AND (is_platform_admin() OR has_admin_area((NULLIF((storage.foldername(name))[1], ''::text))::uuid, 'billing', 'edit'))));

-- storage.objects.paynow_qr_tenant_delete (DELETE → billing:edit)
ALTER POLICY paynow_qr_tenant_delete ON storage.objects
  USING (((bucket_id = 'paynow-qr'::text) AND (is_platform_admin() OR has_admin_area((NULLIF((storage.foldername(name))[1], ''::text))::uuid, 'billing', 'edit'))));

-- public.package_products.package_products_write (ALL → packages:edit)
ALTER POLICY package_products_write ON public.package_products
  USING ((is_platform_admin() OR has_admin_area(tenant_id, 'packages', 'edit')))
  WITH CHECK ((is_platform_admin() OR has_admin_area(tenant_id, 'packages', 'edit')));

-- public.parent_packages.parent_packages_select (SELECT → packages:view)
ALTER POLICY parent_packages_select ON public.parent_packages
  USING ((is_platform_admin() OR (is_platform_admin() OR has_admin_area(tenant_id, 'packages', 'view')) OR ((parent_id = current_parent_id()) AND (NOT tenant_suspended(tenant_id)))));

-- public.parent_packages.parent_packages_insert (INSERT → packages:edit)
ALTER POLICY parent_packages_insert ON public.parent_packages
  WITH CHECK (((is_platform_admin() OR has_admin_area(tenant_id, 'packages', 'edit')) OR ((parent_id = current_parent_id()) AND parent_in_tenant(tenant_id) AND (NOT tenant_suspended(tenant_id)))));

-- public.parent_packages.parent_packages_update (UPDATE → packages:edit)
ALTER POLICY parent_packages_update ON public.parent_packages
  USING (((is_platform_admin() OR has_admin_area(tenant_id, 'packages', 'edit')) OR ((parent_id = current_parent_id()) AND (NOT tenant_suspended(tenant_id)))))
  WITH CHECK (((is_platform_admin() OR has_admin_area(tenant_id, 'packages', 'edit')) OR ((parent_id = current_parent_id()) AND (NOT tenant_suspended(tenant_id)))));

-- public.package_applications.package_applications_select (SELECT → packages:view)
ALTER POLICY package_applications_select ON public.package_applications
  USING ((EXISTS ( SELECT 1
   FROM parent_packages pp
  WHERE ((pp.id = package_applications.parent_package_id) AND (is_platform_admin() OR (is_platform_admin() OR has_admin_area(pp.tenant_id, 'packages', 'view')) OR ((pp.parent_id = current_parent_id()) AND (NOT tenant_suspended(pp.tenant_id))))))));

-- public.package_cancel_extensions.package_cancel_extensions_select (SELECT → packages:view)
ALTER POLICY package_cancel_extensions_select ON public.package_cancel_extensions
  USING ((EXISTS ( SELECT 1
   FROM parent_packages pp
  WHERE ((pp.id = package_cancel_extensions.parent_package_id) AND (is_platform_admin() OR (is_platform_admin() OR has_admin_area(pp.tenant_id, 'packages', 'view')) OR (pp.parent_id = current_parent_id()))))));

-- public.package_extension_events.package_extension_events_select (SELECT → packages:view)
ALTER POLICY package_extension_events_select ON public.package_extension_events
  USING ((EXISTS ( SELECT 1
   FROM parent_packages pp
  WHERE ((pp.id = package_extension_events.parent_package_id) AND (is_platform_admin() OR (is_platform_admin() OR has_admin_area(pp.tenant_id, 'packages', 'view')) OR (pp.parent_id = current_parent_id()))))));

-- public.package_holiday_extensions.package_holiday_extensions_select (SELECT → packages:view)
ALTER POLICY package_holiday_extensions_select ON public.package_holiday_extensions
  USING ((EXISTS ( SELECT 1
   FROM parent_packages pp
  WHERE ((pp.id = package_holiday_extensions.parent_package_id) AND (is_platform_admin() OR (is_platform_admin() OR has_admin_area(pp.tenant_id, 'packages', 'view')) OR (pp.parent_id = current_parent_id()))))));

-- public.referrals.referrals_select (SELECT → packages:view)
ALTER POLICY referrals_select ON public.referrals
  USING (((is_platform_admin() OR has_admin_area(tenant_id, 'packages', 'view')) OR (referrer_parent_id = current_parent_id()) OR (referee_parent_id = current_parent_id())));

-- public.referral_rewards.referral_rewards_select (SELECT → packages:view)
ALTER POLICY referral_rewards_select ON public.referral_rewards
  USING (((is_platform_admin() OR has_admin_area(tenant_id, 'packages', 'view')) OR (parent_id = current_parent_id())));

-- public.coach_rates.coach_rates_admin (ALL → wages:edit)
ALTER POLICY coach_rates_admin ON public.coach_rates
  USING ((EXISTS ( SELECT 1
   FROM coaches c
  WHERE ((c.id = coach_rates.coach_id) AND (is_platform_admin() OR has_admin_area(c.tenant_id, 'wages', 'edit'))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM coaches c
  WHERE ((c.id = coach_rates.coach_id) AND (is_platform_admin() OR has_admin_area(c.tenant_id, 'wages', 'edit'))))));

-- public.coach_payouts.coach_payouts_select (SELECT → wages:view)
ALTER POLICY coach_payouts_select ON public.coach_payouts
  USING (((is_platform_admin() OR has_admin_area(tenant_id, 'wages', 'view')) OR (coach_id = current_coach_id())));

-- public.coach_payouts.coach_payouts_write (ALL → wages:edit)
ALTER POLICY coach_payouts_write ON public.coach_payouts
  USING ((is_platform_admin() OR has_admin_area(tenant_id, 'wages', 'edit')))
  WITH CHECK ((is_platform_admin() OR has_admin_area(tenant_id, 'wages', 'edit')));

-- public.coach_payout_items.coach_payout_items_select (SELECT → wages:view)
ALTER POLICY coach_payout_items_select ON public.coach_payout_items
  USING ((EXISTS ( SELECT 1
   FROM coach_payouts p
  WHERE ((p.id = coach_payout_items.payout_id) AND ((is_platform_admin() OR has_admin_area(p.tenant_id, 'wages', 'view')) OR (p.coach_id = current_coach_id()))))));

-- public.session_pay_overrides.session_pay_overrides_admin (ALL → wages:edit)
ALTER POLICY session_pay_overrides_admin ON public.session_pay_overrides
  USING ((is_platform_admin() OR has_admin_area(session_tenant(lesson_session_id), 'wages', 'edit')))
  WITH CHECK ((is_platform_admin() OR has_admin_area(session_tenant(lesson_session_id), 'wages', 'edit')));

-- class_rates: the ALL policy was the only admin read path; view gets its own
CREATE POLICY class_rates_admin_select ON public.class_rates FOR SELECT TO authenticated
  USING ((is_platform_admin() OR has_admin_area(class_tenant(class_id), 'pricing', 'view')));

-- class_rate_overrides: the ALL policy was the only admin read path; view gets its own
CREATE POLICY class_rate_overrides_admin_select ON public.class_rate_overrides FOR SELECT TO authenticated
  USING ((is_platform_admin() OR has_admin_area(class_tenant(class_id), 'pricing', 'view')));

-- coach_rates: the ALL policy was the only admin read path; view gets its own
CREATE POLICY coach_rates_admin_select ON public.coach_rates FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM coaches c
  WHERE ((c.id = coach_rates.coach_id) AND (is_platform_admin() OR has_admin_area(c.tenant_id, 'wages', 'view'))))));

-- session_pay_overrides: the ALL policy was the only admin read path; view gets its own
CREATE POLICY session_pay_overrides_admin_select ON public.session_pay_overrides FOR SELECT TO authenticated
  USING ((is_platform_admin() OR has_admin_area(session_tenant(lesson_session_id), 'wages', 'view')));

-- confirm_invoice_paid → billing:edit (1 site(s), coach arm removed)
CREATE OR REPLACE FUNCTION public.confirm_invoice_paid(p_invoice_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_row invoices%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_row FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice not found';
  END IF;

  -- Gate copied verbatim from the invoices_update policy — see header.
  IF NOT ((is_platform_admin() OR has_admin_area(v_row.tenant_id, 'billing', 'edit'))) THEN
    RAISE EXCEPTION 'not allowed to confirm this invoice';
  END IF;

  IF v_row.status = 'paid' THEN
    RAISE EXCEPTION 'invoice is already paid';
  END IF;

  UPDATE invoices
     SET status = 'paid',
         paid_at = NOW(),
         paid_marked_by = v_uid
   WHERE id = p_invoice_id;

  -- The half the admin panel used to skip: every confirmation leaves an
  -- audit row, whoever performed it.
  INSERT INTO payment_records (invoice_id, marked_by, notes)
  VALUES (p_invoice_id, v_uid, p_notes);

  RETURN NOW();
END;
$function$;

-- void_credit_note → billing:edit (1 site(s))
CREATE OR REPLACE FUNCTION public.void_credit_note(p_note_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor      UUID := auth.uid();
  v_tenant     UUID;
  v_parent     UUID;
  v_amount     NUMERIC(10, 2);
  v_status     TEXT;
  v_ref        TEXT;
  v_drawn      NUMERIC(10, 2) := 0;
  v_debited    NUMERIC(10, 2) := 0;   -- ⟨DEBIT⟩ paid draws recovered as debit
  v_undrawn    NUMERIC(10, 2);
  v_new_bal    NUMERIC(10, 2);
  v_app        RECORD;
  v_inv_status TEXT;                  -- ⟨DEBIT⟩ paid vs outstanding per draw
  v_reopened   JSONB := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required to void a credit note';
  END IF;

  SELECT tenant_id, parent_id, amount, status, reference_number
    INTO v_tenant, v_parent, v_amount, v_status, v_ref
    FROM credit_notes WHERE id = p_note_id FOR UPDATE;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'credit note not found';
  END IF;

  IF NOT has_admin_area(v_tenant, 'billing', 'edit') THEN
    RAISE EXCEPTION 'only this business''s admin may void a credit note';
  END IF;

  IF v_status = 'reversed' THEN
    RAISE EXCEPTION 'that credit note is already reversed';
  END IF;

  -- ── Unwind each un-recovered LIVE draw ─────────────────────────────────────
  -- ⟨DEBIT⟩ skip draws already recovered as a debit (debited_at) so a re-void of
  -- a re-activated note cannot charge the same draw twice.
  FOR v_app IN
    SELECT id, invoice_id, amount
      FROM credit_applications
     WHERE credit_note_id = p_note_id
       AND reversed_at IS NULL
       AND debited_at  IS NULL
     FOR UPDATE
  LOOP
    -- Lock the invoice to serialise against confirm_invoice_paid().
    SELECT status INTO v_inv_status
      FROM invoices WHERE id = v_app.invoice_id FOR UPDATE;

    IF v_inv_status = 'paid' THEN
      -- ⟨DEBIT⟩ Paid invoice is immutable: its discount STANDS (credit_applied and
      -- net_amount stay as history). Recover the drawn value as a debit on the
      -- account. Mark debited_at ONLY, never reversed_at — the draw is NOT undone,
      -- so credit_applied still reconciles with its non-reversed applications
      -- (RISK 6). The debited_at guard alone stops a re-void from double-charging.
      UPDATE credit_applications
         SET debited_at = NOW(), debited_by = v_actor
       WHERE id = v_app.id;
      v_debited := v_debited + v_app.amount;
    ELSE
      -- Outstanding invoice: reopen it (existing behaviour).
      UPDATE credit_applications
         SET reversed_at = NOW(), reversed_by = v_actor
       WHERE id = v_app.id;
      UPDATE invoices
         SET credit_applied  = credit_applied - v_app.amount,
             net_amount      = net_amount + v_app.amount,
             status          = 'outstanding',
             paid_at         = NULL,
             paid_marked_by  = NULL,
             paid_claimed_at = NULL
       WHERE id = v_app.invoice_id;
      v_reopened := v_reopened
        || jsonb_build_object('invoice_id', v_app.invoice_id, 'amount', v_app.amount);
    END IF;

    v_drawn := v_drawn + v_app.amount;
  END LOOP;

  v_undrawn := v_amount - v_drawn;

  UPDATE credit_notes
     SET status                = 'reversed',
         reversed_at           = NOW(),
         reversed_by           = v_actor,
         applied_to_invoice_id = NULL,
         applied_at            = NULL
   WHERE id = p_note_id;

  -- Pool: remove the undrawn remainder only (unchanged). The reopened draws
  -- return to the tenant as the invoices' increased net; the debited draws are
  -- recovered via debit_balance below — neither returns to the pool.
  IF v_undrawn <> 0 THEN
    UPDATE parent_tenant_balances
       SET credit_balance = credit_balance - v_undrawn, updated_at = NOW()
     WHERE parent_id = v_parent AND tenant_id = v_tenant;
  END IF;

  -- ⟨DEBIT⟩ post the paid-draw total as a debit the next invoice will collect.
  IF v_debited > 0 THEN
    INSERT INTO parent_tenant_balances (parent_id, tenant_id, debit_balance)
    VALUES (v_parent, v_tenant, v_debited)
    ON CONFLICT (parent_id, tenant_id) DO UPDATE
      SET debit_balance = parent_tenant_balances.debit_balance + EXCLUDED.debit_balance,
          updated_at = NOW();
  END IF;

  SELECT credit_balance INTO v_new_bal
    FROM parent_tenant_balances
   WHERE parent_id = v_parent AND tenant_id = v_tenant;
  IF COALESCE(v_new_bal, 0) < 0 THEN
    RAISE EXCEPTION
      'voiding % would drive the credit balance negative (to %)', v_ref, v_new_bal;
  END IF;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, tenant_id, new_value)
  VALUES (
    v_actor, 'credit_note_voided', 'credit_note', p_note_id, v_tenant,
    jsonb_build_object(
      'reference', v_ref,
      'reason', btrim(p_reason),
      'amount', v_amount,
      'drawn_reversed', v_drawn,
      'debit_posted', v_debited,
      'undrawn_removed', v_undrawn,
      'invoices_reopened', v_reopened
    )
  );
END;
$function$;

-- write_off_parent_balance → billing:edit (1 site(s))
CREATE OR REPLACE FUNCTION public.write_off_parent_balance(p_parent_id uuid, p_tenant_id uuid, p_reason text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor   UUID := auth.uid();
  v_debit   NUMERIC(10, 2);
  v_stamped NUMERIC(10, 2);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required to write off a balance';
  END IF;

  IF NOT has_admin_area(p_tenant_id, 'billing', 'edit') THEN
    RAISE EXCEPTION 'only this business''s admin may write off a balance';
  END IF;

  SELECT debit_balance INTO v_debit
    FROM parent_tenant_balances
   WHERE parent_id = p_parent_id AND tenant_id = p_tenant_id
   FOR UPDATE;

  -- CN-R3: refuse on absent row too, not only on 0.
  IF v_debit IS NULL OR v_debit = 0 THEN
    RAISE EXCEPTION 'this family has nothing to write off';
  END IF;

  WITH woff AS (
    UPDATE credit_applications ca
       SET written_off_at = NOW(), written_off_by = v_actor
      FROM credit_notes cn
     WHERE ca.credit_note_id = cn.id
       AND cn.parent_id      = p_parent_id
       AND cn.tenant_id      = p_tenant_id
       AND ca.debited_at     IS NOT NULL
       AND ca.folded_at      IS NULL
       AND ca.written_off_at IS NULL
    RETURNING ca.amount
  )
  SELECT COALESCE(SUM(amount), 0) INTO v_stamped FROM woff;

  IF v_stamped <> v_debit THEN
    RAISE EXCEPTION
      'write-off reconciliation failed: stamped % but debit_balance is % (invariant drift)',
      v_stamped, v_debit;
  END IF;

  UPDATE parent_tenant_balances
     SET debit_balance = 0, updated_at = NOW()
   WHERE parent_id = p_parent_id AND tenant_id = p_tenant_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, tenant_id, new_value)
  VALUES (
    v_actor, 'parent_debit_written_off', 'ParentTenant', p_parent_id, p_tenant_id,
    jsonb_build_object('reason', btrim(p_reason), 'amount', v_debit)
  );

  RETURN v_debit;
END;
$function$;

-- create_package_offer → packages:edit (1 site(s))
CREATE OR REPLACE FUNCTION public.create_package_offer(p_parent_id uuid, p_product_id uuid, p_start_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product  package_products%ROWTYPE;
  v_offer_id uuid;
BEGIN
  SELECT * INTO v_product FROM package_products WHERE id = p_product_id;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Unknown package product.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(v_product.tenant_id, 'packages', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized to offer a package for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT v_product.is_active THEN
    RAISE EXCEPTION 'That package is no longer offered.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The parent must belong to this product's business. Parents link to a tenant
  -- via parent_tenants (many-to-many), NOT profiles.tenant_id (that is NULL for
  -- a parent — it names a STAFF member's home tenant).
  IF NOT EXISTS (
    SELECT 1 FROM parent_tenants pt
    WHERE pt.parent_id = p_parent_id AND pt.tenant_id = v_product.tenant_id
  ) THEN
    RAISE EXCEPTION 'That family is not in this business.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ⚠ RISK 12 — one open offer per family. A second (or a double-click) must
  -- not mint a second pay link; the first would then 404 after supersede.
  IF EXISTS (
    SELECT 1 FROM parent_packages
    WHERE tenant_id = v_product.tenant_id
      AND parent_id = p_parent_id
      AND status = 'pending'
      AND offered_by IS NOT NULL
      AND paid_claimed_at IS NULL
      AND superseded_by IS NULL
  ) THEN
    RAISE EXCEPTION 'An offer is already open for this family — Decline it first.'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO parent_packages (tenant_id, parent_id, product_id, status,
                               start_date, offered_by, offered_at)
  VALUES (v_product.tenant_id, p_parent_id, p_product_id, 'pending',
          p_start_date, auth.uid(), now())
  RETURNING id INTO v_offer_id;

  RETURN v_offer_id;
END;
$function$;

-- extend_package → packages:edit (1 site(s))
CREATE OR REPLACE FUNCTION public.extend_package(p_package_id uuid, p_days integer, p_reason text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pp parent_packages%ROWTYPE;
BEGIN
  SELECT * INTO pp FROM parent_packages WHERE id = p_package_id;
  IF pp.id IS NULL THEN
    RAISE EXCEPTION 'Unknown package.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(pp.tenant_id, 'packages', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized to extend this package.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF pp.status <> 'active' THEN
    RAISE EXCEPTION 'Only an active package can be extended.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'Extension must be between 1 and 365 days.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE parent_packages SET
    manual_extension_days = manual_extension_days + p_days,
    expires_on = package_effective_end(start_date, validity_weeks,
                                       holiday_extension_days,
                                       cancel_extension_days,
                                       manual_extension_days + p_days)
  WHERE id = p_package_id;

  INSERT INTO package_extension_events (parent_package_id, kind, delta_days, reason, created_by)
  VALUES (p_package_id, 'manual', p_days, COALESCE(NULLIF(trim(p_reason), ''), 'Manual extension'),
          auth.uid());
END;
$function$;

-- grant_referral_reward → packages:edit (1 site(s))
CREATE OR REPLACE FUNCTION public.grant_referral_reward(p_parent_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid;
  v_expiry   timestamptz;
  v_reward_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profiles WHERE id = auth.uid();
  IF v_tenant IS NULL OR NOT (is_platform_admin() OR has_admin_area(v_tenant, 'packages', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized to grant a referral reward.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM parent_tenants WHERE parent_id = p_parent_id AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'That family is not in this business.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT CASE WHEN t.referral_reward_expiry_days IS NULL THEN NULL
              ELSE now() + (t.referral_reward_expiry_days || ' days')::interval END
    INTO v_expiry FROM tenants t WHERE t.id = v_tenant;

  INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id, expires_at,
                                granted_by, grant_reason)
  VALUES (v_tenant, p_parent_id, 'manual', NULL, v_expiry, auth.uid(), p_reason)
  RETURNING id INTO v_reward_id;
  RETURN v_reward_id;
END;
$function$;

-- void_referral_reward → packages:edit (1 site(s))
CREATE OR REPLACE FUNCTION public.void_referral_reward(p_reward_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reward referral_rewards%ROWTYPE;
  v_claimed timestamptz;
BEGIN
  SELECT * INTO v_reward FROM referral_rewards WHERE id = p_reward_id FOR UPDATE;
  IF v_reward.id IS NULL THEN
    RAISE EXCEPTION 'No such reward.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (is_platform_admin() OR has_admin_area(v_reward.tenant_id, 'packages', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized to void this reward.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_reward.status NOT IN ('available', 'reserved') THEN
    RAISE EXCEPTION 'Only an unused reward can be voided.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_reward.status = 'reserved' AND v_reward.reserved_package_id IS NOT NULL THEN
    SELECT paid_claimed_at INTO v_claimed FROM parent_packages
      WHERE id = v_reward.reserved_package_id;
    IF v_claimed IS NOT NULL THEN
      RAISE EXCEPTION 'This reward is on a package the family has already paid — it cannot be voided.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Unclaimed: restore the reserved package to full price.
    UPDATE parent_packages
       SET discount_amount = 0, amount_payable = total_value, referral_reward_id = NULL
     WHERE id = v_reward.reserved_package_id;
  END IF;

  UPDATE referral_rewards
     SET status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = p_reason
   WHERE id = p_reward_id;
END;
$function$;

-- set_referral_code_disabled → packages:edit (1 site(s))
CREATE OR REPLACE FUNCTION public.set_referral_code_disabled(p_parent_tenant_id uuid, p_disabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM parent_tenants WHERE id = p_parent_tenant_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No such membership.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (is_platform_admin() OR has_admin_area(v_tenant, 'packages', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE parent_tenants
     SET referral_code_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END
   WHERE id = p_parent_tenant_id;
END;
$function$;

-- enforce_parent_package_lifecycle → packages:edit (4 site(s))
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
      NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
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
      NEW.confirmed_at := COALESCE(NULLIF(NEW.confirmed_at, OLD.confirmed_at), NOW());
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

-- preview_package_price → packages:view (1 site(s))
CREATE OR REPLACE FUNCTION public.preview_package_price(p_parent_id uuid, p_product_id uuid)
 RETURNS TABLE(total_value numeric, discount_amount numeric, amount_payable numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p       package_products%ROWTYPE;
  v_type  text;
  v_value numeric;
  v_disc  numeric := 0;
BEGIN
  SELECT * INTO p FROM package_products WHERE id = p_product_id;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'Unknown package product.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (is_platform_admin() OR has_admin_area(p.tenant_id, 'packages', 'view')) THEN
    RAISE EXCEPTION 'Not authorized to preview a package price for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  total_value := p.lesson_count * p.rate_per_lesson;

  IF family_has_usable_reward(p_parent_id, p.tenant_id) THEN
    SELECT dt.discount_type, dt.discount_value INTO v_type, v_value
      FROM referral_discount_for(p_product_id) dt;
    v_disc := referral_discount_amount(v_type, v_value, total_value);
  END IF;

  discount_amount := v_disc;
  amount_payable  := total_value - v_disc;
  RETURN NEXT;
END;
$function$;

-- generate_coach_payouts → wages:edit (1 site(s))
CREATE OR REPLACE FUNCTION public.generate_coach_payouts(p_tenant_id uuid, p_period_month text)
 RETURNS TABLE(coach_id uuid, coach_name text, gross numeric, status text, items integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start DATE;
  v_end   DATE;
  v_coach RECORD;
  v_pay   RECORD;
  v_sess  RECORD;
  v_payout UUID;
  v_gross NUMERIC;
  v_items INT;
  v_status payout_status;
  v_bad   RECORD;
BEGIN
  IF NOT (is_platform_admin() OR has_admin_area(p_tenant_id, 'wages', 'edit')) THEN
    RAISE EXCEPTION 'not permitted to run payroll for this business';
  END IF;

  IF p_period_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'period must be YYYY-MM';
  END IF;

  v_start := (p_period_month || '-01')::DATE;
  v_end   := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- A lesson whose class has no terms in force belongs to NO coach, so it would
  -- vanish from every payout rather than raise. Check the whole period up front
  -- and refuse: a silent underpayment is the failure mode this cluster exists
  -- to remove, and it must not be reintroduced by a quiet skip.
  --
  -- CARRIED THROUGH WAVE 3 UNCHANGED, AND IT CAUGHT THE WAVE'S OWN REGRESSION.
  -- The first draft of this rewrite dropped this block and moved attribution
  -- into the selection query's WHERE, where a NULL paid_coach_id simply fails
  -- to match and the lesson leaves payroll in silence — the exact "quiet skip"
  -- the paragraph above forbids. coach_wages.test.sql 33 went red on it.
  IF EXISTS (
    SELECT 1
      FROM lesson_sessions ls
      JOIN classes c ON c.id = ls.class_id
     WHERE c.tenant_id = p_tenant_id
       AND ls.session_date BETWEEN v_start AND v_end
       AND NOT EXISTS (
         SELECT 1 FROM class_rates r
          WHERE r.class_id = ls.class_id AND r.effective_from <= ls.session_date
       )
  ) THEN
    RAISE EXCEPTION
      'a lesson in % has no class terms in force — refusing to run payroll '
      'rather than silently underpay', p_period_month;
  END IF;

  -- ── The same refusal, for a shadow with no SHADOW rate ──────────────────
  -- The user's decision, taken deliberately over a fallback to the coach's main
  -- rate: falling back pays a trainee a full coach's rate, which is the thing
  -- the shadow rate exists to prevent. Loud beats wrong.
  --
  -- This covers the period being RUN. session_pay_amount() raises on the same
  -- condition, which is the backstop for a historical lesson reached through
  -- the adjustment loops — that message names the coach and the date too.
  SELECT co.id, p.full_name AS coach_name, c.title AS class_title, ls.session_date
    INTO v_bad
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
    JOIN class_shadow_coaches s
      ON s.class_id = ls.class_id
     AND s.effective_from <= ls.session_date
     AND (s.effective_to IS NULL OR s.effective_to >= ls.session_date)
    JOIN coaches co ON co.id = s.coach_id
    JOIN profiles p ON p.id = co.profile_id
   WHERE c.tenant_id = p_tenant_id
     AND ls.session_date BETWEEN v_start AND v_end
     -- ⚠ ONLY WHERE THE SHADOW IS ACTUALLY OWED SOMETHING. Without these two
     -- the refusal is strictly stricter than session_pay_amount(): a shadow the
     -- main coach unticked on every lesson, or one whose lessons were all
     -- coach-cancelled, is owed nothing anywhere — and payroll for the WHOLE
     -- business would still refuse, with no override, for a non-condition.
     AND coach_attribution_kind(ls.id, s.coach_id) = 'shadow'
     AND session_pays_coach(ls.id)
     AND NOT EXISTS (
       SELECT 1 FROM coach_rates r
        WHERE r.coach_id = s.coach_id
          AND r.role = 'shadow'
          AND r.effective_from <= ls.session_date
     )
   ORDER BY ls.session_date
   LIMIT 1;

  IF v_bad.id IS NOT NULL THEN
    RAISE EXCEPTION
      'a shadow coach has no shadow rate in force — refusing to run payroll '
      'rather than pay the wrong rate: % on %, %',
      v_bad.coach_name, v_bad.class_title, v_bad.session_date;
  END IF;

  FOR v_coach IN
    SELECT c.id, p.full_name
      FROM coaches c JOIN profiles p ON p.id = c.profile_id
     WHERE c.tenant_id = p_tenant_id
       -- On payroll only if a rate exists at all. A private coach has none.
       --
       -- ⚠ DELIBERATELY ROLE-BLIND. A coach who holds ONLY a shadow rate must
       -- still enter this loop, or their pay is skipped in silence before the
       -- refusal above can ever fire. Do not add `AND r.role = 'main'`.
       AND EXISTS (SELECT 1 FROM coach_rates r WHERE r.coach_id = c.id)
     ORDER BY p.full_name
  LOOP
    SELECT cp.id, cp.status INTO v_payout, v_status
      FROM coach_payouts cp
     WHERE cp.tenant_id = p_tenant_id
       AND cp.coach_id = v_coach.id
       AND cp.period_month = p_period_month;

    IF v_status = 'paid' THEN
      SELECT cp.gross_amount INTO v_gross FROM coach_payouts cp WHERE cp.id = v_payout;
      SELECT COUNT(*) INTO v_items FROM coach_payout_items WHERE payout_id = v_payout;
      RETURN QUERY SELECT v_coach.id, v_coach.full_name, v_gross, 'paid'::TEXT, v_items;
      CONTINUE;
    END IF;

    IF v_payout IS NULL THEN
      INSERT INTO coach_payouts (tenant_id, coach_id, period_month)
      VALUES (p_tenant_id, v_coach.id, p_period_month)
      RETURNING id INTO v_payout;
    ELSE
      DELETE FROM coach_payout_items WHERE payout_id = v_payout;
    END IF;

    v_gross := 0;
    v_items := 0;

    -- ---- This period's own sessions -------------------------------------
    -- Three sources now, all behind ONE predicate: the roster names this coach
    -- as the substitute, OR nobody is covering and the class's terms paid them
    -- on that date, OR they were an assigned class shadow and were not recorded
    -- absent. coach_attribution_kind() is the ordered form of that rule and
    -- session_pay_amount() reads the SAME call, so the two cannot disagree.
    FOR v_sess IN
      SELECT ls.id, ls.session_date, c.title
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = p_tenant_id
         AND ls.session_date BETWEEN v_start AND v_end
         AND coach_attributed_to_session(ls.id, v_coach.id)
       ORDER BY ls.session_date
    LOOP
      CONTINUE WHEN NOT session_pays_coach(v_sess.id);

      SELECT * INTO v_pay FROM session_pay_amount(v_sess.id, v_coach.id);
      CONTINUE WHEN v_pay.amount IS NULL;

      DECLARE
        v_carried NUMERIC;
        v_net     NUMERIC;
      BEGIN
        -- Net out anything already carried for this session on another payout.
        -- Without this, an admin who re-runs a settled period AFTER a later
        -- period already carried the correction pays the same money twice.
        v_carried := session_carried_for_coach(
                       p_tenant_id, v_coach.id, v_sess.id, v_payout);
        v_net := v_pay.amount - v_carried;

        IF v_net <> 0 THEN
          INSERT INTO coach_payout_items
            (payout_id, lesson_session_id, class_title, session_date, basis, minutes, amount)
          VALUES
            (v_payout, v_sess.id, v_sess.title, v_sess.session_date,
             v_pay.basis, v_pay.minutes, v_net);

          v_gross := v_gross + v_net;
          v_items := v_items + 1;
        END IF;
      END;
    END LOOP;

    -- ---- Adjustments A: sessions already paid, whose pay has since changed
    FOR v_sess IN
      SELECT i.lesson_session_id AS id, i.session_date, i.class_title AS title,
             i.amount AS paid_amount, prev.period_month AS orig
        FROM coach_payout_items i
        JOIN coach_payouts prev ON prev.id = i.payout_id
       WHERE prev.tenant_id = p_tenant_id
         AND prev.coach_id = v_coach.id
         AND prev.status = 'paid'
         AND prev.period_month < p_period_month
         AND NOT i.is_adjustment
    LOOP
      DECLARE
        v_now     NUMERIC := 0;
        v_carried NUMERIC;
        v_diff    NUMERIC;
      BEGIN
        IF session_pays_coach(v_sess.id) THEN
          SELECT a.amount INTO v_now
            FROM session_pay_amount(v_sess.id, v_coach.id) a;
          v_now := COALESCE(v_now, 0);
        END IF;

        SELECT COALESCE(SUM(i2.amount), 0) INTO v_carried
          FROM coach_payout_items i2
          JOIN coach_payouts p2 ON p2.id = i2.payout_id
         WHERE p2.tenant_id = p_tenant_id
           AND p2.coach_id = v_coach.id
           AND i2.lesson_session_id = v_sess.id
           AND i2.is_adjustment
           AND p2.id <> v_payout;

        v_diff := v_now - v_sess.paid_amount - v_carried;

        IF v_diff <> 0 THEN
          INSERT INTO coach_payout_items
            (payout_id, lesson_session_id, class_title, session_date, basis,
             amount, is_adjustment, original_period)
          VALUES
            (v_payout, v_sess.id, v_sess.title, v_sess.session_date,
             'adjustment', v_diff, TRUE, v_sess.orig)
          ON CONFLICT DO NOTHING;
          v_gross := v_gross + v_diff;
          v_items := v_items + 1;
        END IF;
      END;
    END LOOP;

    -- ---- Adjustments B: NEWLY OWED for a settled period -------------------
    --
    -- Adjustments A is driven FROM EXISTING ITEMS, so it can only ever visit a
    -- coach who was already paid something in that period. A substitute named
    -- after the month was settled has no item and no payout at all, so their
    -- money is invisible to it: A's -$40 lands and B's +$55 never does.
    --
    -- ⚠ TWO SOURCES OF CANDIDATE, NOT ONE. A class shadow holds no
    -- session_coaches row, so the substitute arm alone cannot see them. Both
    -- arms are only a CANDIDATE set — session_pay_amount() applies the real
    -- attribution, so being slightly wide here costs nothing and being narrow
    -- costs a coach their money.
    --
    -- Same three-term form as A, with paid_originally = 0, and the SAME
    -- carried-once helper — written as "emit once then suppress" it would
    -- re-emit forever, which is exactly the bug 20260719000900 closed.
    FOR v_sess IN
      SELECT ls.id, ls.session_date, c.title,
             to_char(ls.session_date, 'YYYY-MM') AS orig
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = p_tenant_id
         AND ls.session_date < v_start
         AND (
           EXISTS (SELECT 1 FROM session_coaches sc
                    WHERE sc.lesson_session_id = ls.id
                      AND sc.coach_id = v_coach.id)
           OR coach_shadowed_class_on(ls.class_id, ls.session_date, v_coach.id)
         )
         AND EXISTS (
           SELECT 1 FROM coach_payouts settled
            WHERE settled.tenant_id = p_tenant_id
              AND settled.period_month = to_char(ls.session_date, 'YYYY-MM')
              AND settled.status = 'paid'
         )
         AND NOT EXISTS (
           SELECT 1
             FROM coach_payout_items i3
             JOIN coach_payouts p3 ON p3.id = i3.payout_id
            WHERE p3.tenant_id = p_tenant_id
              AND p3.coach_id = v_coach.id
              AND i3.lesson_session_id = ls.id
              AND NOT i3.is_adjustment
         )
    LOOP
      DECLARE
        v_now     NUMERIC := 0;
        v_carried NUMERIC;
        v_diff    NUMERIC;
      BEGIN
        IF session_pays_coach(v_sess.id) THEN
          SELECT a.amount INTO v_now
            FROM session_pay_amount(v_sess.id, v_coach.id) a;
          v_now := COALESCE(v_now, 0);
        END IF;

        v_carried := session_carried_for_coach(
                       p_tenant_id, v_coach.id, v_sess.id, v_payout);

        v_diff := v_now - 0 - v_carried;

        IF v_diff <> 0 THEN
          INSERT INTO coach_payout_items
            (payout_id, lesson_session_id, class_title, session_date, basis,
             amount, is_adjustment, original_period)
          VALUES
            (v_payout, v_sess.id, v_sess.title, v_sess.session_date,
             'adjustment', v_diff, TRUE, v_sess.orig)
          ON CONFLICT DO NOTHING;
          v_gross := v_gross + v_diff;
          v_items := v_items + 1;
        END IF;
      END;
    END LOOP;

    UPDATE coach_payouts
       SET gross_amount = v_gross, generated_at = NOW()
     WHERE id = v_payout;

    RETURN QUERY SELECT v_coach.id, v_coach.full_name, v_gross, 'draft'::TEXT, v_items;
  END LOOP;
END;
$function$;

-- mark_payout_paid → wages:edit (1 site(s))
CREATE OR REPLACE FUNCTION public.mark_payout_paid(p_payout_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_status payout_status;
BEGIN
  SELECT tenant_id, status INTO v_tenant, v_status
    FROM coach_payouts WHERE id = p_payout_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'payout not found';
  END IF;
  IF NOT (is_platform_admin() OR has_admin_area(v_tenant, 'wages', 'edit')) THEN
    RAISE EXCEPTION 'not permitted to mark this payout paid';
  END IF;
  IF v_status = 'paid' THEN
    RETURN;   -- idempotent: a double tap is not an error
  END IF;

  UPDATE coach_payouts
     SET status = 'paid', paid_at = NOW(), paid_marked_by = auth.uid()
   WHERE id = p_payout_id;
END;
$function$;

-- accounting_summary → accounting:view (1 site(s))
CREATE OR REPLACE FUNCTION public.accounting_summary(p_tenant uuid, p_month character)
 RETURNS TABLE(revenue numeric, revenue_invoiced numeric, revenue_settlements numeric, revenue_gross numeric, revenue_package_applied numeric, revenue_credit_applied numeric, revenue_balance_adjustment numeric, outstanding numeric, wages numeric, net numeric, wages_state text)
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
$function$;

-- accounting_months → accounting:view (1 site(s))
CREATE OR REPLACE FUNCTION public.accounting_months(p_tenant uuid)
 RETURNS TABLE(billing_month text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_admin_area(p_tenant, 'accounting', 'view') THEN
    RAISE EXCEPTION 'only the business owner may read accounting figures';
  END IF;

  RETURN QUERY
  SELECT bp.billing_month::TEXT
    FROM billing_periods bp
   WHERE bp.tenant_id = p_tenant
   ORDER BY bp.billing_month DESC;
END;
$function$;

-- set_class_terms → additive split (body read from the database 2026-09-27, §7.40)
CREATE OR REPLACE FUNCTION public.set_class_terms(p_class_id uuid, p_title text, p_day_of_week day_of_week, p_start_time time without time zone, p_end_time time without time zone, p_location_name text, p_price_per_lesson numeric, p_coach_id uuid, p_effective_from date DEFAULT NULL::date, p_correct_in_place boolean DEFAULT false, p_location_address text DEFAULT NULL::text, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor    UUID := auth.uid();
  v_tenant   UUID;
  v_from     DATE := COALESCE(p_effective_from, today_sg());
  v_cur      RECORD;
  v_old      JSONB;
  v_month    TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_tenant := class_tenant(p_class_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;
  -- 20260927000500: additive area checks, one per group that actually
  -- changes (ROLES_PERMISSIONS_PLAN.md §5.3 2). The platform admin keeps its
  -- arm (P7). A call that changes nothing still needs one of the two.
  IF NOT is_platform_admin() THEN
    IF NOT (has_admin_area(v_tenant, 'operations', 'edit') OR has_admin_area(v_tenant, 'pricing', 'edit')) THEN
      RAISE EXCEPTION 'not permitted to edit this class';
    END IF;
    IF EXISTS (SELECT 1 FROM classes c WHERE c.id = p_class_id AND (
             c.title       IS DISTINCT FROM p_title
          OR c.day_of_week IS DISTINCT FROM p_day_of_week
          OR c.start_time  IS DISTINCT FROM p_start_time
          OR c.end_time    IS DISTINCT FROM p_end_time
          OR c.coach_id    IS DISTINCT FROM p_coach_id
          OR (p_location_id IS NOT NULL AND c.location_id IS DISTINCT FROM p_location_id)))
       AND NOT has_admin_area(v_tenant, 'operations', 'edit') THEN
      RAISE EXCEPTION 'your role can change this class''s price but not its schedule, coach or location';
    END IF;
    IF (SELECT r.price_per_lesson FROM class_rate_on(p_class_id, COALESCE(p_effective_from, today_sg())) r)
         IS DISTINCT FROM p_price_per_lesson
       AND NOT has_admin_area(v_tenant, 'pricing', 'edit') THEN
      RAISE EXCEPTION 'your role can change this class''s schedule but not its price';
    END IF;
  END IF;

  IF p_price_per_lesson IS NULL OR p_price_per_lesson < 0 THEN
    RAISE EXCEPTION 'price per lesson must be zero or more';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM coaches c WHERE c.id = p_coach_id AND c.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'that coach does not belong to this business';
  END IF;

  IF p_coach_id IS DISTINCT FROM (SELECT c.coach_id FROM classes c WHERE c.id = p_class_id)
     AND EXISTS (
       SELECT 1 FROM class_shadow_coaches s
        WHERE s.class_id = p_class_id
          AND s.coach_id = p_coach_id
          AND s.effective_to IS NULL)
  THEN
    RAISE EXCEPTION
      'that coach is currently shadowing this class — end their shadow '
      'assignment first, then hand the class over. Their past shadow pay is '
      'kept either way.';
  END IF;

  IF v_from > today_sg() THEN
    RAISE EXCEPTION 'terms cannot start in the future (got %)', v_from;
  END IF;

  SELECT to_jsonb(c) INTO v_old FROM classes c WHERE c.id = p_class_id;

  -- The free-text columns are gone; location is set by FK only.  A NULL
  -- p_location_id (an old 11-arg positional caller) leaves the location unchanged.
  UPDATE classes
     SET title            = p_title,
         day_of_week      = p_day_of_week,
         start_time       = p_start_time,
         end_time         = p_end_time,
         location_id      = COALESCE(p_location_id, location_id),
         coach_id         = p_coach_id,
         updated_at       = NOW()
   WHERE id = p_class_id;

  SELECT r.price_per_lesson, r.paid_coach_id
    INTO v_cur
    FROM class_rate_on(p_class_id, v_from) r;

  IF v_cur.price_per_lesson IS NOT DISTINCT FROM p_price_per_lesson
     AND v_cur.paid_coach_id IS NOT DISTINCT FROM p_coach_id THEN
    RETURN;
  END IF;

  v_month := to_char(v_from, 'YYYY-MM');

  IF EXISTS (
    SELECT 1 FROM billing_periods bp
     WHERE bp.tenant_id = v_tenant AND bp.billing_month >= v_month
  ) THEN
    RAISE EXCEPTION
      'cannot change terms from % — % or a later month has already been '
      'invoiced and sealed. Issue a credit note instead.', v_from, v_month;
  END IF;

  IF EXISTS (
    SELECT 1 FROM coach_payouts cp
     WHERE cp.tenant_id = v_tenant AND cp.status = 'paid'
       AND cp.period_month >= v_month
  ) THEN
    RAISE EXCEPTION
      'cannot change terms from % — a coach payout for % or later has already '
      'been paid. The correction will surface as an adjustment instead.',
      v_from, v_month;
  END IF;

  IF p_correct_in_place THEN
    UPDATE class_rates r
       SET price_per_lesson = p_price_per_lesson,
           paid_coach_id    = p_coach_id
     WHERE r.class_id = p_class_id
       AND r.effective_from = (
         SELECT MAX(r2.effective_from) FROM class_rates r2
          WHERE r2.class_id = p_class_id AND r2.effective_from <= v_from
       );
  ELSE
    INSERT INTO class_rates (class_id, price_per_lesson, paid_coach_id, effective_from)
    VALUES (p_class_id, p_price_per_lesson, p_coach_id, v_from)
    ON CONFLICT (class_id, effective_from)
    DO UPDATE SET price_per_lesson = EXCLUDED.price_per_lesson,
                  paid_coach_id    = EXCLUDED.paid_coach_id;
  END IF;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (
    v_actor,
    CASE WHEN p_correct_in_place THEN 'class_terms_corrected'
         ELSE 'class_terms_changed' END,
    'Class',
    p_class_id,
    v_old,
    jsonb_build_object(
      'effective_from',   v_from,
      'price_per_lesson', p_price_per_lesson,
      'paid_coach_id',    p_coach_id,
      'class',            (SELECT to_jsonb(c) FROM classes c WHERE c.id = p_class_id)
    ),
    v_tenant
  );
END;
$function$;

-- ── classes.price_per_lesson is a PRICE (§5.3 2b) ───────────────────────────
-- A class INSERT seeds its first billing rate from price_per_lesson
-- (trg classes_seed_rate → seed_class_rate(), SECURITY DEFINER), so a priced
-- insert — or editing the column directly — needs pricing:edit on top of the
-- operations:edit that classes_write already asks. Only direct client writes
-- are checked (current_user = 'authenticated'); definer RPCs gate themselves.
-- A zero-priced class may be created by operations alone: it bills nothing
-- until someone with pricing sets its terms.
CREATE OR REPLACE FUNCTION public.guard_class_price()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user = 'authenticated'
     AND NOT is_platform_admin()
     AND ((TG_OP = 'INSERT' AND COALESCE(NEW.price_per_lesson, 0) <> 0)
       OR (TG_OP = 'UPDATE' AND NEW.price_per_lesson IS DISTINCT FROM OLD.price_per_lesson))
     AND NOT has_admin_area(NEW.tenant_id, 'pricing', 'edit') THEN
    RAISE EXCEPTION 'your role cannot set a class price' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_class_price() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_class_price
  BEFORE INSERT OR UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.guard_class_price();

-- ── tenants: every column belongs to exactly one area, or to nobody ─────────
-- tenants_update lets any active admin (and the platform admin) UPDATE the
-- row; this trigger decides COLUMN by column (§5.3 1). DENY BY DEFAULT: a
-- changed column missing from the map is refused, so a column added next
-- month is locked until it is mapped here. Only direct client writes are
-- checked; the platform admin keeps its arm for mapped columns (P7).
-- §7.57: an upsert that resolves to an UPDATE fires this BEFORE UPDATE too,
-- with a real OLD — the diff below is correct for it.
CREATE OR REPLACE FUNCTION public.guard_tenant_columns()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_map CONSTANT JSONB := '{
    "display_name":"profile","slug":"profile","logo_url":"profile","join_code":"profile",
    "paynow_qr_url":"billing","paynow_uen":"billing","paynow_mobile":"billing",
    "auto_invoice_enabled":"billing","invoice_run_day":"billing",
    "rain_pays_coach":"wages","wage_run_day":"wages",
    "low_package_lessons":"packages","package_expiry_warning_days":"packages",
    "default_package_product_id":"packages","holiday_extension_days":"packages",
    "referral_enabled":"packages","referral_discount_type":"packages",
    "referral_discount_value":"packages","referral_reward_expiry_days":"packages",
    "updated_at":"any",
    "id":"nobody","created_at":"nobody","owner_profile_id":"nobody","suspended_at":"nobody",
    "credit_note_counter":"nobody","invoice_counter":"nobody","package_counter":"nobody"
  }';
  v_old  JSONB := to_jsonb(OLD);
  v_new  JSONB := to_jsonb(NEW);
  v_col  TEXT;
  v_area TEXT;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  FOR v_col IN SELECT k FROM jsonb_object_keys(v_new) k WHERE v_new->k IS DISTINCT FROM v_old->k LOOP
    v_area := v_map->>v_col;
    IF v_area IS NULL THEN
      RAISE EXCEPTION 'tenants.% is not mapped to an area — add it to guard_tenant_columns() before a client may change it', v_col
        USING ERRCODE = 'insufficient_privilege';
    ELSIF v_area = 'any' THEN
      CONTINUE;
    ELSIF v_area = 'nobody' THEN
      -- guard_tenants_owner already refuses owner_profile_id with its own
      -- message; this also closes the counters and suspension.
      RAISE EXCEPTION 'tenants.% cannot be changed directly', v_col USING ERRCODE = 'insufficient_privilege';
    ELSIF NOT is_platform_admin() AND NOT has_admin_area(NEW.id, v_area::admin_area, 'edit') THEN
      RAISE EXCEPTION 'your role cannot change % settings (tenants.%)', v_area, v_col
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_tenant_columns() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_tenant_columns
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_columns();
