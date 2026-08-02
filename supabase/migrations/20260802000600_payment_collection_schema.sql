-- ============================================================
-- Payment collection, Phase 0 (docs/design/PAYMENT_COLLECTION_DESIGN.md).
--
-- SwimSync stays out of the money path: the parent pays the tenant's own
-- PayNow account directly. What the schema needs for that:
--
--   • WHO to pay — tenants.paynow_uen / paynow_mobile (a PayNow QR is a
--     computed payload, not an uploaded image; these two text fields replace
--     the static tenants.paynow_qr_url for invoices, which stays as fallback).
--   • WHICH payment is WHICH invoice — invoices.reference_number
--     (INV-YYYY-NNNN, per-tenant numbering — same shape and same volume-leak
--     rationale as credit notes, 20260718001200).
--   • A LOGIN-FREE way for the parent to see one invoice —
--     invoices.public_token, 128-bit, served only by the public-invoice
--     edge function (deliberately NOT an anon RPC: anon has no USAGE on
--     schema public, and opening it would arm §7.39's cloud default-EXECUTE
--     grants on every function whose revoke was ever forgotten).
--   • Two operational timestamps — reminded_at (the admin OPENED a WhatsApp
--     chat; it does not prove a message was sent) and paid_claimed_at (the
--     parent SAYS they paid; the admin still confirms).
--
-- The invoice engine is NOT modified: reference + token are assigned by a
-- BEFORE INSERT trigger, which the engine's plain .insert() picks up
-- transparently (verified: nothing upserts invoices, so §7.57 does not bite).
-- ============================================================

-- gen_random_bytes lives in pgcrypto. First migration to need it.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ------------------------------------------------------------
-- Tenants: the PayNow proxy, and the per-tenant invoice counter.
-- ------------------------------------------------------------

ALTER TABLE tenants
  ADD COLUMN paynow_uen TEXT,
  ADD COLUMN paynow_mobile TEXT,
  ADD COLUMN invoice_counter INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN tenants.paynow_uen IS
  'PayNow Corporate proxy (UEN). Preferred over paynow_mobile when both are '
  'set: a UEN account is guaranteed to receive the QR''s reference on its '
  'statement. Validation is advisory and client-side only (sgPhone doctrine) '
  '— no CHECK, because a blocked save helps nobody.';
COMMENT ON COLUMN tenants.paynow_mobile IS
  'PayNow personal proxy (SG mobile, 8 digits stored bare). Used when '
  'paynow_uen is NULL. Reference pass-through to a personal statement is '
  'bank-dependent — best-effort, and the copy must never promise it.';
COMMENT ON COLUMN tenants.invoice_counter IS
  'Per-tenant invoice numbering, drawn by next_invoice_ref() with a row lock. '
  'Per-tenant for the same two reasons as credit_note_counter '
  '(20260718001200): each business expects its own numbering, and a shared '
  'sequence leaks platform volume through the gaps.';

-- ------------------------------------------------------------
-- Invoices: reference, public token, and the two operational stamps.
-- ------------------------------------------------------------

ALTER TABLE invoices
  ADD COLUMN reference_number TEXT,
  ADD COLUMN public_token TEXT,
  ADD COLUMN reminded_at TIMESTAMPTZ,
  ADD COLUMN paid_claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN invoices.reference_number IS
  'INV-YYYY-NNNN, numbered within the tenant. YYYY is the year of the '
  'invoice''s OWN billing_month, never the clock (§7.7): a December invoice '
  'billed in January carries December''s year. Embedded in the PayNow QR '
  '(Tag 62 bill number, so it must stay ≤25 chars) — it is how a bank '
  'transfer is matched back to this invoice. Pinned: not client-writable.';
COMMENT ON COLUMN invoices.public_token IS
  '128-bit hex token; the tokenized invoice page''s whole access control. '
  'Served only via the public-invoice edge function. Pinned: not '
  'client-writable — a client that could rewrite it could re-point or '
  'republish the invoice''s public URL.';
COMMENT ON COLUMN invoices.reminded_at IS
  'When the admin last OPENED a WhatsApp chat for this invoice (wa.me '
  'click-through). It does not prove a message was sent — UI copy must say '
  '"chat opened", never "reminded" or "sent".';
COMMENT ON COLUMN invoices.paid_claimed_at IS
  'When the parent tapped "I''ve paid" (in-app RPC or the tokenized page). '
  'A claim, not a confirmation — status flips only when the admin/coach '
  'confirms against their bank.';

-- ------------------------------------------------------------
-- Reference numbering. Clone of next_credit_note_ref (20260718001200) with
-- one deliberate difference: the year is the INVOICE's year (from its
-- billing_month), passed in — never to_char(NOW()) — because an invoice for
-- December generated in January must not read INV-<next year>-NNNN (§7.7).
--
-- Grants: NOBODY may call this externally — not even service_role. Its only
-- caller is the SECURITY DEFINER trigger below, which reaches it as the
-- function owner. (If a future migration ever flattens that trigger to a
-- plain function, the engine's service_role inserts would start failing on
-- this revoke — that is the tripwire working, not a bug to "fix" by granting.)
-- ------------------------------------------------------------

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

  RETURN 'INV-' || p_year || '-' || LPAD(v_n::TEXT, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_invoice_ref(UUID, TEXT) FROM PUBLIC;
-- §7.39: cloud default privileges grant EXECUTE on new public functions to
-- anon/authenticated/service_role — strip all three. No external caller exists.
REVOKE EXECUTE ON FUNCTION public.next_invoice_ref(UUID, TEXT)
  FROM anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Assignment trigger. SECURITY DEFINER is LOAD-BEARING: the engine inserts as
-- service_role, which (correctly) has no EXECUTE on next_invoice_ref; only
-- the DEFINER hop lets the draw happen. Assign-only-when-NULL keeps it inert
-- for any row that already carries values (defensive; nothing upserts
-- invoices today — §7.57 checked).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_invoice_public_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.reference_number IS NULL THEN
    NEW.reference_number :=
      next_invoice_ref(NEW.tenant_id, substring(NEW.billing_month FROM 1 FOR 4));
  END IF;
  IF NEW.public_token IS NULL THEN
    NEW.public_token := encode(extensions.gen_random_bytes(16), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_invoice_public_fields() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_invoice_public_fields()
  FROM anon, authenticated, service_role;

CREATE TRIGGER trg_assign_invoice_public_fields
  BEFORE INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION assign_invoice_public_fields();

-- ------------------------------------------------------------
-- Backfill existing invoices (production has none today, but local seeds and
-- any July billing that lands before this deploys do), then lock the columns.
-- Ordered by generated_at so numbering follows issue order; year from each
-- row's own billing_month.
-- ------------------------------------------------------------

WITH numbered AS (
  SELECT id,
         'INV-' || substring(billing_month FROM 1 FOR 4) || '-' ||
           LPAD((ROW_NUMBER() OVER (
             PARTITION BY tenant_id ORDER BY generated_at, id))::TEXT, 4, '0')
           AS ref
  FROM invoices
)
UPDATE invoices i
   SET reference_number = n.ref
  FROM numbered n
 WHERE i.id = n.id
   AND i.reference_number IS NULL;

UPDATE tenants t
   SET invoice_counter = COALESCE(
     (SELECT COUNT(*) FROM invoices i WHERE i.tenant_id = t.id), 0
   );

UPDATE invoices
   SET public_token = encode(extensions.gen_random_bytes(16), 'hex')
 WHERE public_token IS NULL;

ALTER TABLE invoices
  ALTER COLUMN reference_number SET NOT NULL,
  ALTER COLUMN public_token SET NOT NULL,
  ADD CONSTRAINT invoices_tenant_reference_key UNIQUE (tenant_id, reference_number),
  ADD CONSTRAINT invoices_public_token_key UNIQUE (public_token);

-- ------------------------------------------------------------
-- Pin the two public identifiers. Plain (NOT SECURITY DEFINER — DEFINER would
-- defeat the current_user check, same as pin_parent_identity, 20260719002000).
-- reminded_at / paid_claimed_at stay unpinned on purpose: the admin stamps
-- reminded_at by direct UPDATE under invoices_update.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pin_invoice_public_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.reference_number IS DISTINCT FROM OLD.reference_number
      OR NEW.public_token IS DISTINCT FROM OLD.public_token)
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'invoices.reference_number and public_token are not client-writable — they identify the invoice to banks and to the public page.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pin_invoice_public_fields
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION pin_invoice_public_fields();
