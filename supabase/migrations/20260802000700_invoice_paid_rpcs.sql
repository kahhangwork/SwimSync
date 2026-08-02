-- ============================================================
-- Payment collection, Phase 3 (docs/design/PAYMENT_COLLECTION_DESIGN.md):
-- the parent's "I've paid" claim, and ONE mark-paid path.
--
--   • claim_invoice_paid(): the authed parent's claim. (The sessionless
--     twin lives in the public-invoice edge function, keyed by token.)
--   • confirm_invoice_paid(): the ONLY way a human marks an invoice paid
--     from now on. Before this, the coach app updated invoices AND inserted
--     payment_records while the admin panel updated invoices only — so the
--     audit trail existed for exactly one of the two paths. Both clients now
--     call this; the direct .update({status:"paid"}) writers are deleted in
--     the same change.
--
-- ⚠ RISK 5: confirm's gate is copied VERBATIM from the invoices_update
-- policy (20260718000900_tenant_rls.sql:412-415) — that policy is the
-- source of truth for who may mark paid. If it ever changes, change this
-- gate with it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_invoice_paid(p_invoice_id UUID)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_row  invoices%ROWTYPE;
  v_when TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- The caller must BE the invoice's parent — not an admin, not a coach.
  -- A claim is the family speaking for itself.
  SELECT i.* INTO v_row
    FROM invoices i
    JOIN parents p ON p.id = i.parent_id
   WHERE i.id = p_invoice_id
     AND p.profile_id = v_uid
     FOR UPDATE OF i;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'invoice not found';
  END IF;

  -- Idempotent: claiming twice keeps the FIRST timestamp — when the parent
  -- first said "paid" is the fact the admin checks the bank against.
  IF v_row.paid_claimed_at IS NOT NULL THEN
    RETURN v_row.paid_claimed_at;
  END IF;

  IF v_row.status <> 'outstanding' THEN
    RAISE EXCEPTION 'invoice is not outstanding';
  END IF;

  UPDATE invoices
     SET paid_claimed_at = NOW()
   WHERE id = p_invoice_id
  RETURNING paid_claimed_at INTO v_when;

  RETURN v_when;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_invoice_paid(
  p_invoice_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF NOT (can_admin_tenant(v_row.tenant_id) OR coach_serves_parent(v_row.parent_id)) THEN
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
$$;

-- House recipe (§7.39): strip cloud's default grants, allow authenticated.
REVOKE ALL ON FUNCTION public.claim_invoice_paid(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_invoice_paid(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_invoice_paid(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_invoice_paid(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_invoice_paid(UUID, TEXT) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_invoice_paid(UUID, TEXT) TO authenticated;

-- Fold-in: 20260802000600 revoked its two sensitive functions but missed
-- the pin trigger function, and the 2026-08-02 remote grant dump duly
-- showed cloud's default EXECUTE grants on it. Harmless in practice —
-- Postgres refuses to call trigger functions directly regardless of
-- privilege — but off-posture, and posture is what the grant dump audits.
REVOKE ALL ON FUNCTION public.pin_invoice_public_fields() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pin_invoice_public_fields()
  FROM anon, authenticated, service_role;
