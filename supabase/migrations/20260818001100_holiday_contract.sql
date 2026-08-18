-- ============================================================
-- Holiday attendance, step 7 (CONTRACT) — drop the retired weeks machinery.
--
-- RUNS LAST, AFTER BOTH APPS HAVE SHIPPED (§7.60). Until the deployed admin
-- Packages page and parent Billing page stop SELECTing ph_extension_weeks /
-- ph_ack_weeks_*, dropping these columns 400s both pages. The deploy runbook gates
-- this migration on a bundle-grep of the live apps returning zero hits.
--
-- Removes, now that holiday extension is event-driven (days) and the loud/quiet
-- acknowledgement badge is gone:
--   * recompute_package_extensions (neutered in 20260818000600),
--   * acknowledge_package_extension / acknowledge_all_extensions,
--   * parent_packages.ph_extension_weeks / ph_ack_weeks_parent / ph_ack_weeks_admin,
-- and recreates the lifecycle trigger without their seeds and pins (holiday_extension_days
-- and manual_extension_days stay pinned — those ARE still system-owned).
-- ============================================================

DROP FUNCTION IF EXISTS recompute_package_extensions(uuid, uuid);
DROP FUNCTION IF EXISTS acknowledge_package_extension(uuid, text);
DROP FUNCTION IF EXISTS acknowledge_all_extensions(uuid);

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
    NEW.manual_extension_days  := 0;
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
     AND (NEW.holiday_extension_days IS DISTINCT FROM OLD.holiday_extension_days
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

ALTER TABLE parent_packages
  DROP COLUMN IF EXISTS ph_extension_weeks,
  DROP COLUMN IF EXISTS ph_ack_weeks_parent,
  DROP COLUMN IF EXISTS ph_ack_weeks_admin;
