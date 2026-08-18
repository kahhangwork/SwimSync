-- ============================================================
-- Holiday attendance, step 3 of 4: the DAYS-based extension accumulator.
--
-- The old holiday model stored extensions as WEEKS (parent_packages.ph_extension_weeks,
-- multiplied by 7 in package_effective_end) and recomputed them by scanning a
-- calendar. The new model stores a tenant-CONFIGURABLE number of DAYS per holiday
-- (tenants.holiday_extension_days), written event-by-event by the reconcile trigger
-- (20260818000700). So the spine formula moves from a weeks term to a days term.
--
-- EXPAND/CONTRACT (§7.60): this migration ADDS parent_packages.holiday_extension_days
-- and stops the formula reading ph_extension_weeks, but LEAVES ph_extension_weeks /
-- ph_ack_weeks_* in place — the deployed admin Packages page and parent Billing page
-- still SELECT those columns by name until the apps ship. They become vestigial here
-- (nothing feeds expires_on from them) and are dropped only by the final contract
-- migration, after the apps stop reading them.
--
-- package_effective_end's 3rd parameter changes NAME (p_ph_ext_weeks -> p_holiday_days)
-- and loses its *7, so this is a DROP + CREATE, not CREATE OR REPLACE (Postgres cannot
-- rename an input parameter) — and a recreated function is callable by nobody until
-- re-GRANTed (§7.87), or every package sale breaks via the invoker lifecycle trigger.
-- The type signature (DATE,INTEGER,INTEGER,INTEGER) is unchanged, so the three live
-- callers (enforce_parent_package_lifecycle, extend_package, recompute — the last
-- neutered below) still resolve; all three are updated here to pass the days column.
-- ============================================================

-- 1. The days accumulator. Client writes are pinned by the lifecycle trigger below
--    (same as ph_extension_weeks): only the reconcile trigger / extend_package touch it.
ALTER TABLE parent_packages
  ADD COLUMN holiday_extension_days INTEGER NOT NULL DEFAULT 0
    CHECK (holiday_extension_days >= 0);

COMMENT ON COLUMN parent_packages.holiday_extension_days IS
  'Total days added to this package''s validity by public-holiday voids. Maintained by the reconcile trigger to equal SUM(applied_days) over package_holiday_extensions. System-owned; clients cannot write it.';

-- 2. The spine formula, days instead of weeks for the holiday term.
DROP FUNCTION package_effective_end(DATE, INTEGER, INTEGER, INTEGER);

CREATE FUNCTION package_effective_end(
  p_start_date      DATE,
  p_validity_weeks  INTEGER,
  p_holiday_days    INTEGER,
  p_manual_days     INTEGER
) RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_start_date
       + (p_validity_weeks * 7)
       + p_holiday_days
       + p_manual_days;
$$;

GRANT EXECUTE ON FUNCTION package_effective_end(DATE, INTEGER, INTEGER, INTEGER)
  TO authenticated, service_role;

-- 3. Lifecycle trigger — identical to its 20260815000700 definition except: seed
--    holiday_extension_days := 0 on INSERT, pin it against client writes, and feed
--    it (not ph_extension_weeks) into the two package_effective_end calls.
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

    -- The product decides the business and the terms; the client cannot.
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
    -- The discount BASE: full price, no discount, no reward. apply_referral_reward
    -- (trg_zz, DEFINER, runs after this) is the ONLY thing that reduces it.
    NEW.discount_amount    := 0;
    NEW.amount_payable     := NEW.total_value;
    NEW.referral_reward_id := NULL;
    -- Extensions and acks always start at zero — they are never seeded by a sale.
    NEW.ph_extension_weeks     := 0;
    NEW.holiday_extension_days := 0;
    NEW.manual_extension_days  := 0;
    NEW.ph_ack_weeks_parent    := 0;
    NEW.ph_ack_weeks_admin     := 0;
    -- Offer claim / supersede columns are system-lifecycle; never seeded here.
    NEW.paid_claimed_at := NULL;
    NEW.superseded_by   := NULL;

    IF current_user = 'authenticated' AND NOT can_admin_tenant(NEW.tenant_id) THEN
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
                                                 NEW.holiday_extension_days, NEW.manual_extension_days);
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
     AND (NEW.ph_extension_weeks     IS DISTINCT FROM OLD.ph_extension_weeks
          OR NEW.holiday_extension_days IS DISTINCT FROM OLD.holiday_extension_days
          OR NEW.manual_extension_days  IS DISTINCT FROM OLD.manual_extension_days
          OR NEW.ph_ack_weeks_parent    IS DISTINCT FROM OLD.ph_ack_weeks_parent
          OR NEW.ph_ack_weeks_admin     IS DISTINCT FROM OLD.ph_ack_weeks_admin)
  THEN
    RAISE EXCEPTION 'Package extension and acknowledgement fields are set by the system, not edited directly.'
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

  -- ⚠ RISK 11 — the referral discount snapshot is system-owned. Written on
  -- INSERT by apply_referral_reward and zeroed on expiry by settle_referral_reward
  -- (both DEFINER/postgres, which bypass this clause). Without this pin a parent
  -- PATCHes amount_payable to 0.01 and the QR honours it (parent_packages_update
  -- is row-scoped to their own rows).
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
    IF NOT can_admin_tenant(OLD.tenant_id) THEN
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
      IF current_user = 'authenticated' AND NOT can_admin_tenant(OLD.tenant_id) THEN
        RAISE EXCEPTION 'Only the business can confirm a package purchase.'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.confirmed_at := COALESCE(NULLIF(NEW.confirmed_at, OLD.confirmed_at), NOW());
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.start_date   := COALESCE(NEW.start_date, OLD.start_date,
                                   (NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date);
      NEW.expires_on   := package_effective_end(NEW.start_date, NEW.validity_weeks,
                                                 NEW.holiday_extension_days, NEW.manual_extension_days);
    ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    ELSIF OLD.status = 'active' AND NEW.status = 'cancelled' THEN
      IF current_user = 'authenticated' AND NOT can_admin_tenant(OLD.tenant_id) THEN
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

-- 4. extend_package — same body, days column into the formula.
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

  IF NOT can_admin_tenant(pp.tenant_id) THEN
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
                                       manual_extension_days + p_days)
  WHERE id = p_package_id;

  INSERT INTO package_extension_events (parent_package_id, kind, delta_days, reason, created_by)
  VALUES (p_package_id, 'manual', p_days, COALESCE(NULLIF(trim(p_reason), ''), 'Manual extension'),
          auth.uid());
END;
$function$;

-- 5. Neuter the calendar-scan recompute. It is retired by the event-driven trigger
--    in 20260818000700; between now and the contract migration it must not run
--    (its body assumed a weeks term and would fight the trigger over shared columns).
--    All three callers (packages page :208, billing :183, holidays :58) are
--    best-effort try/catch, so a no-op return is safe. Signature and grants unchanged.
CREATE OR REPLACE FUNCTION public.recompute_package_extensions(
  p_tenant uuid DEFAULT NULL,
  p_parent uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Neutered: holiday extension is now event-driven at attendance-marking time
  -- (recompute_holiday_extension trigger, 20260818000700). Retained only so the
  -- deployed best-effort callers keep resolving until the contract migration drops it.
  RETURN 0;
END;
$$;
