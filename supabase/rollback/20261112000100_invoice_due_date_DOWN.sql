-- DOWN for 20261112000100_invoice_due_date.sql. Run only BEFORE any app/engine reads due_date / is_overdue /
-- invoice_payment_days / change_invoice_due_date — afterwards the live bundles 400 on the missing names.
-- Restores guard_tenant_columns and pin_invoice_public_fields to the pre-change bodies (prod md5 d79e6f41… /
-- 31e30ed7…, rehearsed 2026-11-12). Recorded due-date changes are LOST.
BEGIN;
DROP FUNCTION IF EXISTS public.change_invoice_due_date(uuid, date, text);
DROP TABLE IF EXISTS public.invoice_due_date_changes;
DROP FUNCTION IF EXISTS public.is_overdue(public.invoices);
DROP TRIGGER IF EXISTS trg_set_invoice_due_date ON public.invoices;
DROP FUNCTION IF EXISTS public.set_invoice_due_date();
DROP FUNCTION IF EXISTS public.invoice_due_date_for(timestamptz, uuid);
ALTER TABLE public.invoices DROP COLUMN IF EXISTS due_date;
ALTER TABLE public.tenants  DROP COLUMN IF EXISTS invoice_payment_days;

CREATE OR REPLACE FUNCTION public.guard_tenant_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.pin_invoice_public_fields()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (NEW.reference_number IS DISTINCT FROM OLD.reference_number
      OR NEW.public_token IS DISTINCT FROM OLD.public_token)
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'invoices.reference_number and public_token are not client-writable — they identify the invoice to banks and to the public page.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.invoice_email_sent_at IS DISTINCT FROM OLD.invoice_email_sent_at
      OR NEW.invoice_email_claimed_at IS DISTINCT FROM OLD.invoice_email_claimed_at)
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'invoices.invoice_email_sent_at and invoice_email_claimed_at are not client-writable — only the email sender settles them.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
