-- ============================================================
-- ROLLBACK of 20260821000800 (advance-cancel extends a prepaid package).
-- Rehearsed (§7.93): apply UP, apply this DOWN, re-apply UP, run the suite.
--
-- Reverse order of dependency. The three shared callers
-- (enforce_parent_package_lifecycle, extend_package, apply_holiday_reconcile) are
-- restored VERBATIM to the bodies dumped from the live schema at 20260821000700
-- (pg_get_functiondef — §7.115), i.e. the 4-arg package_effective_end and no
-- cancel term. package_effective_end returns to its 4-arg signature first so the
-- restored bodies resolve.
-- ============================================================

-- 1. Remove the reconcile trigger fan + its functions (they call the 5-arg formula).
DROP TRIGGER IF EXISTS trg_cancel_package_reconcile_ins ON lesson_sessions;
DROP TRIGGER IF EXISTS trg_cancel_package_reconcile_upd ON lesson_sessions;
DROP TRIGGER IF EXISTS trg_cancel_package_reconcile_del ON lesson_sessions;
DROP FUNCTION IF EXISTS cancel_package_reconcile();
DROP FUNCTION IF EXISTS apply_cancel_reconcile(uuid, date);

-- 2. package_effective_end back to 4 args (drop the 5-arg, recreate the 4-arg).
DROP FUNCTION IF EXISTS package_effective_end(DATE, INTEGER, INTEGER, INTEGER, INTEGER);

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

REVOKE ALL     ON FUNCTION package_effective_end(DATE, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION package_effective_end(DATE, INTEGER, INTEGER, INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION package_effective_end(DATE, INTEGER, INTEGER, INTEGER)
  TO authenticated, service_role;

-- 3. Restore the three callers to their pre-migration bodies (no cancel term).
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

CREATE OR REPLACE FUNCTION public.apply_holiday_reconcile(p_dates date[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_touched UUID[];
BEGIN
  IF p_dates IS NULL OR array_length(p_dates, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Remove state rows no longer justified by a holiday lesson; add newly-justified
  -- ones (applied_days = the tenant's current setting; 0 => write nothing, RISK 11).
  -- Collect every package whose state changed so we can recompute its expiry once.
  WITH del AS (
    DELETE FROM package_holiday_extensions phe
    WHERE phe.holiday_date = ANY(p_dates)
      AND NOT EXISTS (
        SELECT 1
        FROM attendance a
        JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
        JOIN classes c          ON c.id  = ls.class_id
        WHERE a.status = 'holiday'
          AND ls.session_date = phe.holiday_date
          AND holiday_covering_package(a.student_id, ls.session_date, c.category_id, c.tenant_id) = phe.parent_package_id
      )
    RETURNING phe.parent_package_id
  ),
  ins AS (
    INSERT INTO package_holiday_extensions (parent_package_id, holiday_date, applied_days)
    SELECT DISTINCT
           holiday_covering_package(a.student_id, ls.session_date, c.category_id, c.tenant_id) AS pkg,
           ls.session_date,
           t.holiday_extension_days
    FROM attendance a
    JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
    JOIN classes c          ON c.id  = ls.class_id
    JOIN parent_packages pp ON pp.id = holiday_covering_package(a.student_id, ls.session_date, c.category_id, c.tenant_id)
    JOIN tenants t          ON t.id  = pp.tenant_id
    WHERE a.status = 'holiday'
      AND ls.session_date = ANY(p_dates)
      AND t.holiday_extension_days > 0
    ON CONFLICT (parent_package_id, holiday_date) DO NOTHING
    RETURNING parent_package_id
  )
  SELECT array_agg(DISTINCT pid) INTO v_touched
  FROM (SELECT parent_package_id AS pid FROM del
        UNION
        SELECT parent_package_id FROM ins) u;

  IF v_touched IS NULL THEN
    RETURN;
  END IF;

  -- Serialize concurrent reconciles on the same package, then rewrite its
  -- accumulator = SUM(applied_days) and its expiry from the spine formula.
  -- ORDER BY so two overlapping reconciles lock in the same order (no deadlock).
  PERFORM 1 FROM parent_packages WHERE id = ANY(v_touched) ORDER BY id FOR UPDATE;

  UPDATE parent_packages pp SET
    holiday_extension_days = COALESCE(
      (SELECT SUM(applied_days) FROM package_holiday_extensions WHERE parent_package_id = pp.id), 0)::int,
    expires_on = package_effective_end(
      pp.start_date, pp.validity_weeks,
      COALESCE((SELECT SUM(applied_days) FROM package_holiday_extensions WHERE parent_package_id = pp.id), 0)::int,
      pp.manual_extension_days)
  WHERE pp.id = ANY(v_touched)
    AND pp.start_date IS NOT NULL;
END;
$function$;

-- 4. Drop the state table and the accumulator column (last — the restored
--    bodies no longer reference either).
DROP TABLE IF EXISTS package_cancel_extensions;
ALTER TABLE parent_packages DROP COLUMN IF EXISTS cancel_extension_days;
