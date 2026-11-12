-- Invoice due dates, Overdue, and a per-invoice extension (docs/plans/OVERDUE_INVOICES_PLAN.md, BACKLOG
-- *UI restyle leftovers* → Overdue, old S7).
--
-- WHY. Every unpaid invoice read "Outstanding" (amber) because nothing said when an invoice was due, and Overdue
-- may not be derived in a client (UI_RESTYLE_PLAN 1.4). The rule is the user's (2026-11-12):
--   D1 due date = the invoice's SGT generated date + N days; Overdue from the day AFTER the due date.
--   D2 N is per tenant (tenants.invoice_payment_days, default 14); a change affects NEW invoices only — the date is
--      stored at insert and never re-derived.
--   D5 an admin with billing EDIT may move ONE outstanding invoice's due date LATER, through
--      change_invoice_due_date() only; every change is recorded in invoice_due_date_changes.
--
-- EXPAND-ONLY. The old engine keeps working: it never sends due_date, and the BEFORE INSERT trigger fills it. The
-- engine inserts each invoice once (core.ts "already_exists" skip) and nothing upserts invoices, so §7.57 does not
-- apply. invoices.generated_at is NOT NULL DEFAULT now(), and defaults land before BEFORE triggers, so the trigger
-- always has a stamp — there is deliberately NO coalesce(…, app_now()) branch (it would be dead code).
--
-- Bodies of guard_tenant_columns() and pin_invoice_public_fields() re-read from pg_get_functiondef() on the local DB
-- 2026-11-12 (§7.40); prod md5 = local md5 of the pre-change bodies (§7.336): guard_tenant_columns d79e6f41…,
-- pin_invoice_public_fields 31e30ed7…. The only change in each: guard_tenant_columns gains one v_map key
-- ("invoice_payment_days":"billing"); pin_invoice_public_fields gains a THIRD block (due_date). Both stay as they
-- were otherwise — the pin stays INVOKER (current_user must be the caller; recurring_gotchas assertion 2), and no
-- column-level grant is used (table_grants assertion 6, §7.292).
--
-- Overdue is a computed field, is_overdue(invoices), reading app_today() so swimsync.now pins it. service_role holds
-- EXECUTE on purpose: public-invoice reads with it, and any select error there is the shared 404 on every family's
-- payment link.
--
-- Rollback: none needed — every object is additive and unused until the engine/apps read it. To undo by hand:
-- drop the RPC, the audit table, is_overdue, the trigger + its function, invoice_due_date_for, the two columns, and
-- re-run the two CREATE OR REPLACE bodies from 20260927000500 / 20260927000100 (read them from prod first, §7.40).

-- ── 1. Days to pay, per tenant ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN invoice_payment_days integer NOT NULL DEFAULT 14
  CONSTRAINT tenants_invoice_payment_days_range CHECK (invoice_payment_days BETWEEN 1 AND 90);

COMMENT ON COLUMN public.tenants.invoice_payment_days IS
  'Days a family has to pay: due_date = SGT generated date + this. New invoices only. 20261112000100.';

CREATE OR REPLACE FUNCTION public.guard_tenant_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_map CONSTANT JSONB := '{
    "display_name":"profile","slug":"profile","logo_url":"profile","join_code":"profile",
    "paynow_qr_url":"billing","paynow_uen":"billing","paynow_mobile":"billing",
    "auto_invoice_enabled":"billing","invoice_run_day":"billing","invoice_payment_days":"billing",
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

-- ── 2. The column ──────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.invoices ADD COLUMN due_date date;

-- ── 3. ONE formula — the backfill and the trigger both call it, so they cannot disagree ────────────────────────
-- Reads no clock. AT TIME ZONE 'Asia/Singapore' is load-bearing: a bare ::date on a timestamptz is the UTC date,
-- a day early before 08:00 SGT (§7.7).
CREATE OR REPLACE FUNCTION public.invoice_due_date_for(p_generated_at timestamptz, p_tenant uuid)
RETURNS date LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (p_generated_at AT TIME ZONE 'Asia/Singapore')::date + t.invoice_payment_days
    FROM tenants t WHERE t.id = p_tenant;
$$;
REVOKE ALL ON FUNCTION public.invoice_due_date_for(timestamptz, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ── 4. Fill it at insert ───────────────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so it can call invoice_due_date_for, which nobody else may (the next_invoice_ref shape, §7.78).
CREATE OR REPLACE FUNCTION public.set_invoice_due_date()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    NEW.due_date := invoice_due_date_for(NEW.generated_at, NEW.tenant_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_invoice_due_date() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_set_invoice_due_date
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_due_date();

-- ── 5. Backfill, then NOT NULL ─────────────────────────────────────────────────────────────────────────────────
UPDATE public.invoices SET due_date = public.invoice_due_date_for(generated_at, tenant_id) WHERE due_date IS NULL;
ALTER TABLE public.invoices ALTER COLUMN due_date SET NOT NULL;

COMMENT ON COLUMN public.invoices.due_date IS
  'SGT date the invoice is due. Set at insert (generated date + tenants.invoice_payment_days); moved later only by change_invoice_due_date(). 20261112000100.';

-- ── 6. Overdue — decided here, never in a client ───────────────────────────────────────────────────────────────
-- Not refined for Claimed: Claimed beats Overdue in the TAG (D4), which each app's one tag helper decides.
CREATE OR REPLACE FUNCTION public.is_overdue(public.invoices)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT $1.status = 'outstanding' AND app_today() > $1.due_date;
$$;
REVOKE ALL ON FUNCTION public.is_overdue(public.invoices) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_overdue(public.invoices) TO authenticated, service_role;
COMMENT ON FUNCTION public.is_overdue(public.invoices) IS
  'PostgREST computed column: select=*,is_overdue. Outstanding and past its due date (app_today()). RLS on invoices is the gate. 20261112000100.';

-- ── 7. The audit trail of due-date changes ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.invoice_due_date_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id),
  -- CASCADE: driver teardowns and the Deno helpers delete invoices; a plain FK would abort them (§7.15).
  invoice_id    uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  old_due_date  date NOT NULL,
  new_due_date  date NOT NULL,
  reason        text NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  changed_by    uuid NOT NULL REFERENCES public.profiles(id),
  changed_at    timestamptz NOT NULL DEFAULT now() -- clock: stamp
);
CREATE INDEX invoice_due_date_changes_invoice_idx ON public.invoice_due_date_changes (invoice_id);
CREATE INDEX invoice_due_date_changes_tenant_idx  ON public.invoice_due_date_changes (tenant_id);

ALTER TABLE public.invoice_due_date_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_due_date_changes_select ON public.invoice_due_date_changes
  FOR SELECT TO authenticated USING (has_admin_area(tenant_id, 'billing', 'view'));

REVOKE ALL ON TABLE public.invoice_due_date_changes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.invoice_due_date_changes TO authenticated;

-- ── 8. Close the direct path: due_date is not client-writable ──────────────────────────────────────────────────
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
  IF NEW.due_date IS DISTINCT FROM OLD.due_date
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'invoices.due_date is changed only through change_invoice_due_date() — later only, and recorded.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 9. The one writer ──────────────────────────────────────────────────────────────────────────────────────────
-- Every refusal RAISES (never a silent no-op). FOR UPDATE serialises against confirm_invoice_paid, which locks the
-- same row. has_admin_area is false for a platform admin, a suspended business and a disabled admin.
CREATE OR REPLACE FUNCTION public.change_invoice_due_date(p_invoice_id uuid, p_new_date date, p_reason text DEFAULT '')
RETURNS date LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  IF NOT has_admin_area(v_row.tenant_id, 'billing', 'edit') THEN
    RAISE EXCEPTION 'not allowed to change this invoice''s due date';
  END IF;
  IF v_row.status <> 'outstanding' THEN
    RAISE EXCEPTION 'only an outstanding invoice''s due date can change';
  END IF;
  IF p_new_date IS NULL OR p_new_date <= v_row.due_date THEN
    RAISE EXCEPTION 'the new due date must be after the current one (%)', v_row.due_date;
  END IF;
  IF p_new_date > v_row.due_date + 365 THEN
    RAISE EXCEPTION 'the new due date can be at most a year after the current one';
  END IF;

  INSERT INTO invoice_due_date_changes (tenant_id, invoice_id, old_due_date, new_due_date, reason, changed_by)
  VALUES (v_row.tenant_id, p_invoice_id, v_row.due_date, p_new_date,
          left(btrim(coalesce(p_reason, '')), 500), v_uid);

  UPDATE invoices SET due_date = p_new_date WHERE id = p_invoice_id;

  RETURN p_new_date;
END;
$$;
REVOKE ALL ON FUNCTION public.change_invoice_due_date(uuid, date, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.change_invoice_due_date(uuid, date, text) TO authenticated;
COMMENT ON FUNCTION public.change_invoice_due_date(uuid, date, text) IS
  'Move one outstanding invoice''s due date LATER (≤ +365 d). Billing edit only. Records invoice_due_date_changes. 20261112000100.';
