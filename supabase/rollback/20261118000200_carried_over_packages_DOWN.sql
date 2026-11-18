-- DOWN for 20261118000200_carried_over_packages.sql. APPS FIRST (the admin calls record_carried_over_package).
-- Valid only while NO carried row exists: SELECT count(*) FROM parent_packages WHERE carried_over_start IS NOT NULL;
-- must be 0, or this refuses (it does not silently turn a carried package into a full one).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.parent_packages WHERE carried_over_start IS NOT NULL) THEN
    RAISE EXCEPTION 'carried-over packages exist — rolling back would re-price them; cancel/refund them first';
  END IF;
END $$;

DROP FUNCTION public.record_carried_over_package(UUID, UUID, DATE, INTEGER, UUID);

-- The ten bodies exactly as they were before (pg_get_functiondef, 2026-11-18).
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

    -- Single-child packages (20261010000100): the product's kind, read at sale.
    IF v_product.single_child THEN
      IF NEW.student_id IS NULL THEN
        RAISE EXCEPTION 'Choose which child this package is for.' USING ERRCODE = 'check_violation';
      END IF;
      PERFORM assert_package_child(NEW.tenant_id, NEW.parent_id, NEW.student_id);
    ELSIF NEW.student_id IS NOT NULL THEN
      RAISE EXCEPTION 'This package is shared — it can''t be tied to one child.' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM assert_package_kind_free(NEW.tenant_id, NEW.parent_id, v_product.single_child);

    IF current_user = 'authenticated' AND NOT (is_platform_admin() OR has_admin_area(NEW.tenant_id, 'packages', 'edit')) THEN
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.start_date   := NULL;
      NEW.expires_on   := NULL;
      NEW.offered_by   := NULL;
      NEW.offered_at   := NULL;
    ELSIF NEW.status = 'active' THEN
      NEW.confirmed_at := CASE WHEN current_user = 'authenticated' THEN app_now() ELSE COALESCE(NEW.confirmed_at, app_now()) END;
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

  -- Single-child packages (20261010000100): the kind is a sold term (D2) for every role; the child moves only
  -- through reassign_package_child (or merge_students), never a client's direct write.
  IF (OLD.student_id IS NULL) <> (NEW.student_id IS NULL) THEN
    RAISE EXCEPTION 'Whether a package is shared or for one child is part of the sale and cannot be changed.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
    IF current_user = 'authenticated' THEN
      RAISE EXCEPTION 'Use Change child to move a package to another child.'
        USING ERRCODE = 'check_violation';
    END IF;
    PERFORM assert_package_child(NEW.tenant_id, NEW.parent_id, NEW.student_id);
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
      NEW.confirmed_at := CASE WHEN current_user = 'authenticated' THEN app_now() ELSE COALESCE(NULLIF(NEW.confirmed_at, OLD.confirmed_at), app_now()) END;
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.start_date   := COALESCE(NEW.start_date, OLD.start_date,
                                   (NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date);
      NEW.expires_on   := package_effective_end(NEW.start_date, NEW.validity_weeks,
                                                 NEW.holiday_extension_days,
                                                 NEW.cancel_extension_days,
                                                 NEW.manual_extension_days);
    ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());  -- clock: stamp
    ELSIF OLD.status = 'active' AND NEW.status = 'cancelled' THEN
      IF current_user = 'authenticated' AND NOT (is_platform_admin() OR has_admin_area(OLD.tenant_id, 'packages', 'edit')) THEN
        RAISE EXCEPTION 'Only the business can cancel an active package.'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());  -- clock: stamp
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
      pp.cancel_extension_days,
      pp.manual_extension_days)
  WHERE pp.id = ANY(v_touched)
    AND pp.start_date IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_cancel_reconcile(p_class_id uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_touched UUID[];
BEGIN
  IF p_class_id IS NULL OR p_date IS NULL THEN
    RETURN;
  END IF;

  WITH del AS (
    -- Drop rows for THIS lesson no longer justified: the lesson is no longer
    -- cancelled (a restore or a delete), or the covering enrolment is gone.
    DELETE FROM package_cancel_extensions pce
    WHERE pce.class_id = p_class_id
      AND pce.session_date = p_date
      AND NOT EXISTS (
        SELECT 1
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
        JOIN student_class_enrolments e
          ON e.class_id = ls.class_id
         AND (e.enrolled_at   AT TIME ZONE 'Asia/Singapore')::date <= ls.session_date
         AND (e.unenrolled_at IS NULL
              OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= ls.session_date)
        WHERE ls.class_id = p_class_id
          AND ls.session_date = p_date
          AND ls.cancelled_at IS NOT NULL
          AND holiday_covering_package(e.student_id, ls.session_date, c.category_id, c.tenant_id)
              = pce.parent_package_id
      )
    RETURNING pce.parent_package_id
  ),
  ins AS (
    -- Add rows for the packages covering THIS lesson's currently-enrolled kids,
    -- if it is cancelled and the tenant grants > 0 days. DISTINCT dedups siblings
    -- sharing one package on this one lesson.
    INSERT INTO package_cancel_extensions (parent_package_id, class_id, session_date, applied_days)
    SELECT DISTINCT
           holiday_covering_package(e.student_id, ls.session_date, c.category_id, c.tenant_id) AS pkg,
           p_class_id,
           p_date,
           t.holiday_extension_days
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
    JOIN student_class_enrolments e
      ON e.class_id = ls.class_id
     AND (e.enrolled_at   AT TIME ZONE 'Asia/Singapore')::date <= ls.session_date
     AND (e.unenrolled_at IS NULL
          OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= ls.session_date)
    JOIN parent_packages pp
      ON pp.id = holiday_covering_package(e.student_id, ls.session_date, c.category_id, c.tenant_id)
    JOIN tenants t ON t.id = c.tenant_id
    WHERE ls.class_id = p_class_id
      AND ls.session_date = p_date
      AND ls.cancelled_at IS NOT NULL
      AND t.holiday_extension_days > 0
    ON CONFLICT (parent_package_id, class_id, session_date) DO NOTHING
    RETURNING parent_package_id
  )
  SELECT array_agg(DISTINCT pid) INTO v_touched
  FROM (SELECT parent_package_id AS pid FROM del
        UNION
        SELECT parent_package_id FROM ins) u;

  IF v_touched IS NULL THEN
    RETURN;
  END IF;

  -- Serialize concurrent reconciles on the same package (ORDER BY => no
  -- deadlock), then rewrite its cancel accumulator (SUM over ALL its cancelled
  -- lessons) and expiry from the spine.
  PERFORM 1 FROM parent_packages WHERE id = ANY(v_touched) ORDER BY id FOR UPDATE;

  UPDATE parent_packages pp SET
    cancel_extension_days = COALESCE(
      (SELECT SUM(applied_days) FROM package_cancel_extensions WHERE parent_package_id = pp.id), 0)::int,
    expires_on = package_effective_end(
      pp.start_date, pp.validity_weeks,
      pp.holiday_extension_days,
      COALESCE((SELECT SUM(applied_days) FROM package_cancel_extensions WHERE parent_package_id = pp.id), 0)::int,
      pp.manual_extension_days)
  WHERE pp.id = ANY(v_touched)
    AND pp.start_date IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.holiday_covering_package(p_student_id uuid, p_date date, p_category_id uuid, p_tenant_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT pp.id
  FROM parent_packages pp
  JOIN parent_students ps ON ps.parent_id = pp.parent_id
  WHERE ps.student_id = p_student_id
    AND pp.tenant_id = p_tenant_id
    AND pp.status = 'active'
    AND (pp.student_id IS NULL OR pp.student_id = p_student_id)
    AND (pp.category_id IS NULL OR pp.category_id = p_category_id)
    AND p_date >= pp.start_date
    AND p_date <  pp.start_date + (pp.validity_weeks * 7)
  ORDER BY (pp.student_id IS NULL), pp.expires_on, pp.confirmed_at, pp.id
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.holiday_reconcile_on_activation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dates DATE[];
BEGIN
  IF NOT (
       (TG_OP = 'INSERT' AND NEW.status = 'active')
    OR (TG_OP = 'UPDATE' AND NEW.status = 'active' AND OLD.status IS DISTINCT FROM NEW.status)
  ) THEN
    RETURN NULL;
  END IF;

  -- Holiday dates already inside this package's NOMINAL window, for its parent's
  -- children, in a class of a covered category.
  SELECT array_agg(DISTINCT ls.session_date) INTO v_dates
  FROM attendance a
  JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
  JOIN classes c          ON c.id  = ls.class_id
  JOIN parent_students ps ON ps.student_id = a.student_id AND ps.parent_id = NEW.parent_id
  WHERE a.status = 'holiday'
    AND c.tenant_id = NEW.tenant_id  -- the resolver is tenant-scoped; don't collect another business's dates
    AND ls.session_date >= NEW.start_date
    AND ls.session_date <  NEW.start_date + (NEW.validity_weeks * 7)
    AND (NEW.category_id IS NULL OR c.category_id = NEW.category_id);

  IF v_dates IS NOT NULL THEN
    PERFORM apply_holiday_reconcile(v_dates);
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reassign_package_child(p_package uuid, p_student uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_pkg    parent_packages%ROWTYPE;
  v_end    DATE;
  v_dates  DATE[];
  r        RECORD;
BEGIN
  SELECT pp.tenant_id INTO v_tenant FROM parent_packages pp WHERE pp.id = p_package;
  IF NOT COALESCE(is_platform_admin() OR has_admin_area(v_tenant, 'packages', 'edit'), false) THEN
    RAISE EXCEPTION 'Not authorized to change this package.' USING ERRCODE = '42501';
  END IF;

  -- RISK 10: lock the row BEFORE the draw check. package_draw_for locks its candidates FOR UPDATE before it
  -- inserts a draw, so a concurrent marking and this reassignment serialise.
  SELECT * INTO v_pkg FROM parent_packages WHERE id = p_package FOR UPDATE;
  IF v_pkg.id IS NULL THEN
    RAISE EXCEPTION 'Package not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_pkg.student_id IS NULL THEN
    RAISE EXCEPTION 'This package is shared — it is not tied to one child.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pkg.status = 'cancelled' THEN
    RAISE EXCEPTION 'This package is cancelled.' USING ERRCODE = 'check_violation';
  END IF;
  -- D4: "ever drawn", reversed draws included — a reversal restores the balance, so the balance cannot tell.
  IF EXISTS (SELECT 1 FROM package_applications pa WHERE pa.parent_package_id = p_package) THEN
    RAISE EXCEPTION 'A lesson has already drawn from this package — refund it instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_student = v_pkg.student_id THEN
    RAISE EXCEPTION 'The package is already for that child.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM assert_package_child(v_pkg.tenant_id, v_pkg.parent_id, p_student);

  UPDATE parent_packages SET student_id = p_student WHERE id = p_package;

  -- Recompute extensions so none earned by the old child survive, and the new child's are earned. Only an active
  -- package can hold one (holiday_covering_package reads active rows); the window is the nominal one it uses.
  IF v_pkg.status = 'active' THEN
    v_end := v_pkg.start_date + (v_pkg.validity_weeks * 7);
    SELECT array_agg(DISTINCT d) INTO v_dates FROM (
      SELECT ls.session_date AS d
        FROM attendance a
        JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
        JOIN classes c          ON c.id = ls.class_id
       WHERE a.status = 'holiday'
         AND a.student_id IN (v_pkg.student_id, p_student)
         AND c.tenant_id = v_pkg.tenant_id
         AND ls.session_date >= v_pkg.start_date AND ls.session_date < v_end
      UNION
      SELECT phe.holiday_date FROM package_holiday_extensions phe WHERE phe.parent_package_id = p_package
    ) x;
    PERFORM apply_holiday_reconcile(v_dates);

    FOR r IN
      SELECT ls.class_id, ls.session_date
        FROM lesson_sessions ls
       WHERE ls.cancelled_at IS NOT NULL
         AND ls.session_date >= v_pkg.start_date AND ls.session_date < v_end
         AND EXISTS (SELECT 1 FROM student_class_enrolments e
                      WHERE e.class_id = ls.class_id AND e.student_id IN (v_pkg.student_id, p_student))
      UNION
      SELECT pce.class_id, pce.session_date FROM package_cancel_extensions pce WHERE pce.parent_package_id = p_package
    LOOP
      PERFORM apply_cancel_reconcile(r.class_id, r.session_date);
    END LOOP;
  END IF;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_value, new_value)
  VALUES (auth.uid(), 'package_child_reassigned', 'parent_package', p_package,
          jsonb_build_object('student_id', v_pkg.student_id),
          jsonb_build_object('student_id', p_student));
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_referral_reward()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reward_id uuid;
  v_type  text;
  v_value numeric;
  v_disc  numeric;
BEGIN
  -- Pick the oldest usable reward for THIS family. The candidate set is:
  --   available + unexpired, OR reserved by an open unclaimed offer of the same
  -- family that this insert is about to supersede (RISK 4 — the offer still
  -- holds the reward while this row is priced; create_package_offer refuses on
  -- an open offer so it cannot release it, so the handoff resolves HERE).
  -- Single-child packages (20261010000100): "about to supersede" is exactly
  -- supersede_open_package_offer()'s predicate (same parent, tenant AND audience)
  -- — change both or neither. Otherwise Ben's request would take the reward Ava's
  -- offer holds, and both rows would carry the discount (RISK 3).
  SELECT rr.id INTO v_reward_id
  FROM referral_rewards rr
  WHERE rr.parent_id = NEW.parent_id
    AND rr.tenant_id = NEW.tenant_id
    AND (rr.expires_at IS NULL OR rr.expires_at > app_now())
    AND (
      rr.status = 'available'
      OR (
        rr.status = 'reserved'
        AND NEW.status IN ('pending', 'active')
        AND EXISTS (
          SELECT 1 FROM parent_packages pp
          WHERE pp.id = rr.reserved_package_id
            AND pp.id <> NEW.id
            AND pp.parent_id = NEW.parent_id
            AND pp.tenant_id = NEW.tenant_id
            AND pp.student_id IS NOT DISTINCT FROM NEW.student_id
            AND pp.status = 'pending'
            AND pp.offered_by IS NOT NULL
            AND pp.paid_claimed_at IS NULL
        )
      )
    )
  ORDER BY rr.earned_at, rr.id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_reward_id IS NULL THEN
    RETURN NEW;  -- no reward; base price stands.
  END IF;

  SELECT dt.discount_type, dt.discount_value INTO v_type, v_value
    FROM referral_discount_for(NEW.product_id) dt;
  v_disc := referral_discount_amount(v_type, v_value, NEW.total_value);

  -- ⚠ D9 / D15 — a 0-discount product (or programme off) does NOT consume a
  -- reward; it waits for the next eligible package.
  IF v_disc <= 0 THEN
    RETURN NEW;
  END IF;

  NEW.discount_amount    := v_disc;
  NEW.amount_payable     := NEW.total_value - v_disc;
  NEW.referral_reward_id := v_reward_id;

  UPDATE referral_rewards
     SET status = 'reserved', reserved_package_id = NEW.id
   WHERE id = v_reward_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_referral_reward()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_became_active boolean;
  v_reward        referral_rewards%ROWTYPE;
  v_ref           referrals%ROWTYPE;
  v_same_house    boolean;
  v_expiry        timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_became_active := (NEW.status = 'active');
  ELSE
    v_became_active := (NEW.status = 'active' AND OLD.status <> 'active');
  END IF;

  -- (a) Reserved reward settles when its package goes active. ⚠ RISK 13 — a
  -- reward that EXPIRED while reserved settles as 'expired' and the discount is
  -- zeroed ONLY on an unclaimed row; a claimed row keeps the price it was paid
  -- (§7.159 family — never re-price a paid_claimed_at row).
  IF NEW.referral_reward_id IS NOT NULL AND v_became_active THEN
    SELECT * INTO v_reward FROM referral_rewards
      WHERE id = NEW.referral_reward_id FOR UPDATE;
    IF v_reward.status = 'reserved' THEN
      IF v_reward.expires_at IS NOT NULL AND v_reward.expires_at <= app_now()
         AND NEW.paid_claimed_at IS NULL THEN
        UPDATE referral_rewards SET status = 'expired' WHERE id = v_reward.id;
        UPDATE parent_packages
           SET discount_amount = 0, amount_payable = total_value, referral_reward_id = NULL
         WHERE id = NEW.id;
      ELSE
        UPDATE referral_rewards
           SET status = 'used', used_package_id = NEW.id, used_at = now()
         WHERE id = v_reward.id;
      END IF;
    END IF;
  END IF;

  -- (b) A pending row that is cancelled (parent cancel, or supersede) releases
  -- its reserved reward back to available (or expired). The reserved_package_id
  -- guard is the RISK 4 safety: if apply_referral_reward re-pointed the reward
  -- to a newer row, this WHERE does not match and the reward is NOT released.
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'cancelled'
     AND NEW.referral_reward_id IS NOT NULL THEN
    UPDATE referral_rewards
       SET status = CASE WHEN expires_at IS NOT NULL AND expires_at <= app_now()
                         THEN 'expired' ELSE 'available' END,
           reserved_package_id = NULL
     WHERE id = NEW.referral_reward_id
       AND status = 'reserved'
       AND reserved_package_id = NEW.id;
  END IF;

  -- (c) Conversion — the referee's first package goes active. Once per referral
  -- (the pending→converted transition is the idempotency guard). ⚠ RISK 1 — a
  -- shared student / phone / postal_code voids it as same_household with no
  -- reward; the admin's manual Grant is the override.
  IF v_became_active THEN
    SELECT * INTO v_ref FROM referrals
      WHERE referee_parent_id = NEW.parent_id
        AND tenant_id = NEW.tenant_id
        AND status = 'pending'
      FOR UPDATE;
    IF FOUND THEN
      v_same_house := (
        EXISTS (
          SELECT 1 FROM parent_students a
          JOIN parent_students b ON a.student_id = b.student_id
          WHERE a.parent_id = v_ref.referrer_parent_id
            AND b.parent_id = v_ref.referee_parent_id
        )
        OR EXISTS (
          SELECT 1
          FROM parents pa1 JOIN profiles pr1 ON pr1.id = pa1.profile_id
          JOIN parents pa2 ON pa2.id = v_ref.referee_parent_id
          JOIN profiles pr2 ON pr2.id = pa2.profile_id
          WHERE pa1.id = v_ref.referrer_parent_id
            AND pr1.phone IS NOT NULL AND pr1.phone = pr2.phone
        )
        OR EXISTS (
          SELECT 1 FROM parents pa1 JOIN parents pa2 ON pa2.id = v_ref.referee_parent_id
          WHERE pa1.id = v_ref.referrer_parent_id
            AND pa1.postal_code IS NOT NULL AND pa1.postal_code = pa2.postal_code
        )
      );

      IF v_same_house THEN
        UPDATE referrals
           SET status = 'void', void_reason = 'same_household'
         WHERE id = v_ref.id;
      ELSE
        UPDATE referrals
           SET status = 'converted', converted_package_id = NEW.id, converted_at = now()
         WHERE id = v_ref.id;

        SELECT CASE WHEN t.referral_reward_expiry_days IS NULL THEN NULL
                    ELSE app_now() + (t.referral_reward_expiry_days || ' days')::interval END
          INTO v_expiry
          FROM tenants t WHERE t.id = NEW.tenant_id;

        INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id, expires_at)
        VALUES (NEW.tenant_id, v_ref.referrer_parent_id, 'referrer', v_ref.id, v_expiry);
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_package_refund(p_package uuid, p_amount numeric, p_refunded_on date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pp        parent_packages%ROWTYPE;
  v_paid_on   DATE;
  v_id        UUID;
  v_note      TEXT := NULLIF(btrim(p_note), '');
BEGIN
  -- Lock the package first: a double-click or two admins collapse to one refund.
  SELECT * INTO v_pp FROM parent_packages WHERE id = p_package FOR UPDATE;
  IF v_pp.id IS NULL THEN
    RAISE EXCEPTION 'That package could not be found.';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(v_pp.tenant_id, 'packages'::admin_area, 'edit'::admin_level)) THEN
    RAISE EXCEPTION 'Your role cannot record refunds for this business.';
  END IF;

  IF v_pp.status <> 'cancelled' OR v_pp.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Only a cancelled package that was paid for can be refunded.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter a refund amount above S$0.';
  END IF;
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'A refund amount can have at most two decimal places.';
  END IF;
  IF p_amount > v_pp.amount_payable THEN
    RAISE EXCEPTION 'A refund cannot be more than the family paid (S$%).', to_char(v_pp.amount_payable, 'FM999999990.00');
  END IF;

  -- Dates in SGT (§7.7/§7.227): today_sg(), and the confirmation instant read in Asia/Singapore.
  v_paid_on := (v_pp.confirmed_at AT TIME ZONE 'Asia/Singapore')::date;
  IF p_refunded_on IS NULL THEN
    RAISE EXCEPTION 'Choose the date the refund was paid.';
  END IF;
  IF p_refunded_on > today_sg() THEN
    RAISE EXCEPTION 'A refund cannot be dated in the future.';
  END IF;
  IF p_refunded_on < v_paid_on THEN
    RAISE EXCEPTION 'A refund cannot be dated before the package was paid (%).', sg_date_label(v_paid_on, 'FMDD Mon YYYY');
  END IF;
  IF EXISTS (SELECT 1 FROM billing_periods bp
              WHERE bp.tenant_id = v_pp.tenant_id
                AND bp.billing_month = to_char(p_refunded_on, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'That month is closed — refunds can only be dated in an open month.';
  END IF;

  IF EXISTS (SELECT 1 FROM package_refunds pr WHERE pr.parent_package_id = v_pp.id AND pr.reversed_at IS NULL) THEN
    RAISE EXCEPTION 'This package already has a refund recorded. Reverse it first to record a different one.';
  END IF;

  INSERT INTO package_refunds (tenant_id, parent_package_id, amount, refunded_on, note, recorded_by)
  VALUES (v_pp.tenant_id, v_pp.id, p_amount, p_refunded_on, v_note, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), 'package_refund', 'parent_package', v_pp.id,
          jsonb_build_object('refund_id', v_id, 'amount', p_amount, 'refunded_on', p_refunded_on, 'note', v_note));

  RETURN v_id;
END;
$function$;

DROP INDEX public.parent_packages_carried_once;
ALTER TABLE public.parent_packages
  DROP CONSTRAINT cop_pair, DROP CONSTRAINT cop_lessons, DROP CONSTRAINT cop_price,
  DROP CONSTRAINT cop_status, DROP CONSTRAINT cop_anchor, DROP CONSTRAINT cop_expiry,
  DROP COLUMN carried_over_start, DROP COLUMN carried_over_lessons;
