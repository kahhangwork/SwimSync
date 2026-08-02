-- ============================================================
-- Reference numbers past 9999 must GROW, not truncate.
--
-- Postgres LPAD truncates input LONGER than the target length:
-- lpad('10000', 4, '0') = '1000'. So the 10,000th invoice (or credit note)
-- in a tenant would silently reuse reference ...-1000 — wrong on the
-- parent's bank statement, and a UNIQUE (tenant_id, reference_number)
-- violation (= a failed billing run) the moment numbers 1000 and 10000 fall
-- in the same year. A tenant billing ~800 families monthly reaches 10,000
-- in ~13 months, so this is a real ceiling, not a theoretical one.
--
-- Found 2026-08-02 when the user asked what NNNN caps at, the same day
-- next_invoice_ref shipped; next_credit_note_ref (20260718001200) had
-- carried the identical latent truncation since July. Both functions now
-- pad TO AT LEAST four digits and grow naturally past them:
-- 0001 … 9999, 10000, 10001, …  (EMVCo's 25-char reference cap leaves 16
-- digits of headroom after 'INV-YYYY-'.)
--
-- Bodies otherwise verbatim from 20260802000600 / 20260718001200; grants
-- unchanged (CREATE OR REPLACE preserves ACLs).
-- ============================================================

CREATE OR REPLACE FUNCTION public.next_invoice_ref(p_tenant_id UUID, p_year TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE tenants
     SET invoice_counter = invoice_counter + 1
   WHERE id = p_tenant_id
  RETURNING invoice_counter INTO v_n;

  IF v_n IS NULL THEN
    RAISE EXCEPTION 'cannot number an invoice for unknown tenant %', p_tenant_id;
  END IF;

  RETURN 'INV-' || p_year || '-' ||
         LPAD(v_n::TEXT, GREATEST(4, length(v_n::TEXT)), '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.next_credit_note_ref(p_tenant_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE tenants
     SET credit_note_counter = credit_note_counter + 1
   WHERE id = p_tenant_id
  RETURNING credit_note_counter INTO v_n;

  IF v_n IS NULL THEN
    RAISE EXCEPTION 'cannot number a credit note for unknown tenant %', p_tenant_id;
  END IF;

  RETURN 'CN-' || to_char(NOW(), 'YYYY') || '-' ||
         LPAD(v_n::TEXT, GREATEST(4, length(v_n::TEXT)), '0');
END;
$$;
