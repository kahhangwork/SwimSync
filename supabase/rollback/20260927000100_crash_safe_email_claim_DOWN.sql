-- ROLLBACK for 20260927000100_crash_safe_email_claim.sql
--
-- Drops the claim columns, the claim RPCs, the state functions and the
-- re-issue trigger, and restores pin_invoice_public_fields to its
-- pre-migration body (read from the database 2026-09-27).
--
-- WHAT IS LOST: every in-flight claim (*_claimed_at). Harmless only while the
-- edge functions still use the OLD one-column claim — i.e. roll the functions
-- back FIRST (`supabase functions deploy` from the previous commit), then the
-- admin app, then this. A function that calls claim_*_email after this runs
-- fails every send.
--
-- REHEARSED (§7.93): apply the UP, run this, confirm email_claim.test.sql
-- fails, re-apply the UP, confirm green.

DROP TRIGGER IF EXISTS trg_reset_credit_note_email_on_reissue ON public.credit_notes;
DROP FUNCTION IF EXISTS public.reset_credit_note_email_on_reissue();

DROP FUNCTION IF EXISTS public.claim_invoice_email(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.claim_credit_note_email(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.invoice_email_state(public.invoices);
DROP FUNCTION IF EXISTS public.credit_note_email_state(public.credit_notes);
DROP FUNCTION IF EXISTS public.email_delivery_state(TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.pin_invoice_public_fields()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF (NEW.reference_number IS DISTINCT FROM OLD.reference_number
      OR NEW.public_token IS DISTINCT FROM OLD.public_token)
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'invoices.reference_number and public_token are not client-writable — they identify the invoice to banks and to the public page.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER TABLE public.invoices     DROP COLUMN IF EXISTS invoice_email_claimed_at;
ALTER TABLE public.credit_notes DROP COLUMN IF EXISTS email_claimed_at;
