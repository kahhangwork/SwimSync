-- Carried-over packages — bring in a package bought BEFORE SwimSync (user feedback #2, 2026-11-18).
-- Plan: docs/plans/CARRIED_OVER_PACKAGES_PLAN.md (plan-reviewed). PRD §7.16.
--
-- WHY. A business moving onto SwimSync has families part-way through a package. A sale always starts FULL
-- (enforce_parent_package_lifecycle snapshots the product) and its price lands on Accounting as revenue, so a
-- family 4 lessons into a 10-pack could not be brought in without over-crediting them or double-counting money
-- paid before SwimSync. The marking floor (PRD §7.6) correctly refuses backdated attendance; this is the route.
--
-- THE USER'S DECISIONS (2026-11-18):
--   D1  lessons remaining are AS OF TODAY — no lesson dated before today ever draws from a carried package.
--   D2  expiry = ORIGINAL start + the product's weeks (Extend for anything granted outside SwimSync).
--   D3  refundable, capped at the value left NOW (value_remaining), not amount_payable (which is S$0).
--   D4  the parent sees an ordinary package.
--
-- THE SHAPE. Two columns. For a carried row (carried_over_start IS NOT NULL):
--   start_date      = today       — the COVERAGE start. Every window-START reader (draw, order guard, backlog,
--                                   coverage) already compares >= start_date, so D1 holds with no change there.
--   expires_on      = carried_over_start + weeks + extensions — the VALIDITY anchor. Every window-END reader
--                                   (each package_effective_end call, each start_date + validity_weeks*7) now
--                                   anchors on COALESCE(carried_over_start, start_date). §7 gotcha: the two dates
--                                   differ for a carried row; never recompute expiry from start_date alone.
--   value_remaining = carried_over_lessons × rate;  amount_payable = discount_amount = 0 (S$0 revenue).
-- For every existing row carried_over_start IS NULL, COALESCE yields start_date, and each patched body is
-- byte-identical in behaviour (diffed against pg_get_functiondef; prod md5 = local for all 10 before the change).
--
-- STRUCTURAL GUARDS (all scoped to carried rows, so existing rows satisfy them trivially):
--   cop_pair / cop_lessons / cop_price / cop_status / cop_anchor / cop_expiry + a partial unique index.
--   cop_expiry makes an unpatched expiry recompute RAISE instead of silently moving a carried package's end.
--
-- NO TABLE GRANT CHANGES (§7.87). The new columns are reachable through authenticated's existing table INSERT/UPDATE
-- privilege, so the lifecycle trigger REFUSES an authenticated insert that sets them and pins them on update for
-- every role. record_carried_over_package is SECURITY DEFINER; REVOKE from PUBLIC/anon/authenticated/service_role,
-- GRANT EXECUTE to authenticated. After `db push`, dump the remote:
--   supabase db dump --linked -f /tmp/remote_dump.sql
--   grep -iE 'record_carried_over_package' /tmp/remote_dump.sql | grep -iE 'grant|revoke'
--
-- Rollback: supabase/rollback/20261118000200_carried_over_packages_DOWN.sql (APPS FIRST; valid only while no
-- carried row exists).

-- ── 1. Columns, guards, index ───────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.parent_packages
  ADD COLUMN carried_over_start   DATE,
  ADD COLUMN carried_over_lessons INTEGER;

COMMENT ON COLUMN public.parent_packages.carried_over_start IS
  'Original start of a package bought before SwimSync. NULL = an ordinary sale. Expiry anchors on it; coverage (start_date) is the day it was brought in.';
COMMENT ON COLUMN public.parent_packages.carried_over_lessons IS
  'Lessons remaining when a pre-SwimSync package was brought in (audit/display). NULL = an ordinary sale.';

ALTER TABLE public.parent_packages
  ADD CONSTRAINT cop_pair    CHECK ((carried_over_start IS NULL) = (carried_over_lessons IS NULL)),
  ADD CONSTRAINT cop_lessons CHECK (carried_over_lessons IS NULL OR carried_over_lessons BETWEEN 1 AND lesson_count),
  ADD CONSTRAINT cop_price   CHECK (carried_over_start IS NULL
                                    OR (amount_payable = 0 AND discount_amount = 0 AND referral_reward_id IS NULL)),
  ADD CONSTRAINT cop_status  CHECK (carried_over_start IS NULL OR status <> 'pending'),
  ADD CONSTRAINT cop_anchor  CHECK (carried_over_start IS NULL OR carried_over_start <= start_date),
  ADD CONSTRAINT cop_expiry  CHECK (carried_over_start IS NULL
                                    OR expires_on = carried_over_start + validity_weeks * 7 + holiday_extension_days
                                                    + cancel_extension_days + manual_extension_days);

-- D8: one ACTIVE carried row per (family, product, original start, child) — a double-submit cannot double-credit.
-- Cancel + bring in again still works (the cancelled row leaves the index).
CREATE UNIQUE INDEX parent_packages_carried_once
  ON public.parent_packages (parent_id, product_id, carried_over_start, student_id) NULLS NOT DISTINCT
  WHERE carried_over_start IS NOT NULL AND status = 'active';

-- ── 2. Window-END readers, the lifecycle arm, referral skips, refund cap ────────────────────────────────────────
-- Each body below is the live pg_get_functiondef with ONLY the lines named in the plan's Step 1.3–1.6 changed.
-- ── enforce_parent_package_lifecycle — from pg_get_functiondef (prod md5 = local, 2026-11-18) ──
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

    -- Carried-over packages (CARRIED_OVER_PACKAGES_PLAN.md): only record_carried_over_package() may create one.
    IF current_user = 'authenticated'
       AND (NEW.carried_over_start IS NOT NULL OR NEW.carried_over_lessons IS NOT NULL) THEN
      RAISE EXCEPTION 'A carried-over package is recorded with Bring in package, not inserted directly.'
        USING ERRCODE = 'check_violation';
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
      -- Carried-over: coverage starts TODAY (nothing earlier draws, D1); the balance is what is left; nothing
      -- was paid here (D3). Expiry is anchored on the ORIGINAL start (D2).
      IF NEW.carried_over_start IS NOT NULL THEN
        NEW.start_date      := app_today();
        NEW.value_remaining := NEW.carried_over_lessons * NEW.rate_per_lesson;
        NEW.amount_payable  := 0;
        NEW.discount_amount := 0;
      END IF;
      NEW.expires_on   := package_effective_end(COALESCE(NEW.carried_over_start, NEW.start_date), NEW.validity_weeks,
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
     OR NEW.carried_over_start   IS DISTINCT FROM OLD.carried_over_start
     OR NEW.carried_over_lessons IS DISTINCT FROM OLD.carried_over_lessons
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
      NEW.expires_on   := package_effective_end(COALESCE(NEW.carried_over_start, NEW.start_date), NEW.validity_weeks,
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

-- ── extend_package — from pg_get_functiondef (prod md5 = local, 2026-11-18) ──
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
    expires_on = package_effective_end(COALESCE(carried_over_start, start_date), validity_weeks,
                                       holiday_extension_days,
                                       cancel_extension_days,
                                       manual_extension_days + p_days)
  WHERE id = p_package_id;

  INSERT INTO package_extension_events (parent_package_id, kind, delta_days, reason, created_by)
  VALUES (p_package_id, 'manual', p_days, COALESCE(NULLIF(trim(p_reason), ''), 'Manual extension'),
          auth.uid());
END;
$function$;

-- ── apply_holiday_reconcile — from pg_get_functiondef (prod md5 = local, 2026-11-18) ──
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
      COALESCE(pp.carried_over_start, pp.start_date), pp.validity_weeks,
      COALESCE((SELECT SUM(applied_days) FROM package_holiday_extensions WHERE parent_package_id = pp.id), 0)::int,
      pp.cancel_extension_days,
      pp.manual_extension_days)
  WHERE pp.id = ANY(v_touched)
    AND pp.start_date IS NOT NULL;
END;
$function$;

-- ── apply_cancel_reconcile — from pg_get_functiondef (prod md5 = local, 2026-11-18) ──
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
      COALESCE(pp.carried_over_start, pp.start_date), pp.validity_weeks,
      pp.holiday_extension_days,
      COALESCE((SELECT SUM(applied_days) FROM package_cancel_extensions WHERE parent_package_id = pp.id), 0)::int,
      pp.manual_extension_days)
  WHERE pp.id = ANY(v_touched)
    AND pp.start_date IS NOT NULL;
END;
$function$;

-- ── holiday_covering_package — from pg_get_functiondef (prod md5 = local, 2026-11-18) ──
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
    AND p_date <  COALESCE(pp.carried_over_start, pp.start_date) + (pp.validity_weeks * 7)
  ORDER BY (pp.student_id IS NULL), pp.expires_on, pp.confirmed_at, pp.id
  LIMIT 1;
$function$;

-- ── holiday_reconcile_on_activation — from pg_get_functiondef (prod md5 = local, 2026-11-18) ──
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
    AND ls.session_date <  COALESCE(NEW.carried_over_start, NEW.start_date) + (NEW.validity_weeks * 7)
    AND (NEW.category_id IS NULL OR c.category_id = NEW.category_id);

  IF v_dates IS NOT NULL THEN
    PERFORM apply_holiday_reconcile(v_dates);
  END IF;
  RETURN NULL;
END;
$function$;

-- ── reassign_package_child — from pg_get_functiondef (prod md5 = local, 2026-11-18) ──
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
    v_end := COALESCE(v_pkg.carried_over_start, v_pkg.start_date) + (v_pkg.validity_weeks * 7);
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

-- ── apply_referral_reward — from pg_get_functiondef (prod md5 = local, 2026-11-18) ──
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
  -- A carried-over package was bought before SwimSync: no referral discount (D6).
  IF NEW.carried_over_start IS NOT NULL THEN
    RETURN NEW;
  END IF;

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

-- ── settle_referral_reward — from pg_get_functiondef (prod md5 = local, 2026-11-18) ──
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
  -- A carried-over package settles no reward and converts no referral (D6).
  IF NEW.carried_over_start IS NOT NULL THEN
    RETURN NULL;
  END IF;

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
           SET status = 'used', used_package_id = NEW.id, used_at = now()  -- clock: stamp
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
           SET status = 'converted', converted_package_id = NEW.id, converted_at = now()  -- clock: stamp
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

-- ── record_package_refund — from pg_get_functiondef (prod md5 = local, 2026-11-18) ──
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
  -- A carried-over package was paid for before SwimSync (amount_payable 0): its cap is the value left NOW (D3/Q1).
  IF v_pp.carried_over_start IS NOT NULL THEN
    IF p_amount > v_pp.value_remaining THEN
      RAISE EXCEPTION 'A refund cannot be more than the value left on the package (S$%).', to_char(v_pp.value_remaining, 'FM999999990.00');
    END IF;
  ELSIF p_amount > v_pp.amount_payable THEN
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

-- ── 3. record_carried_over_package — the only way to create a carried row ───────────────────────────────────────
CREATE FUNCTION public.record_carried_over_package(
  p_parent            UUID,
  p_product           UUID,
  p_original_start    DATE,
  p_lessons_remaining INTEGER,
  p_student           UUID DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product  package_products%ROWTYPE;
  v_end      DATE;
  v_id       UUID;
  v_cons     TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The tenant comes from the PRODUCT, never from a caller argument.
  SELECT * INTO v_product FROM package_products WHERE id = p_product;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Unknown package product.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(v_product.tenant_id, 'packages', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized to bring in a package for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT v_product.is_active THEN
    RAISE EXCEPTION 'That package is no longer offered.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM parent_tenants pt
                  WHERE pt.parent_id = p_parent AND pt.tenant_id = v_product.tenant_id) THEN
    RAISE EXCEPTION 'That family is not in this business.' USING ERRCODE = 'check_violation';
  END IF;

  IF p_original_start IS NULL THEN
    RAISE EXCEPTION 'Choose the date the package originally started.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_original_start > app_today() THEN
    RAISE EXCEPTION 'The original start date can''t be in the future.' USING ERRCODE = 'check_violation';
  END IF;

  IF p_lessons_remaining IS NULL OR p_lessons_remaining < 1 OR p_lessons_remaining > v_product.lesson_count THEN
    RAISE EXCEPTION 'Lessons remaining must be between 1 and %.', v_product.lesson_count
      USING ERRCODE = 'check_violation';
  END IF;

  -- expires_on is the LAST covered day (coverage is <= expires_on), so it may be today but not before.
  v_end := package_effective_end(p_original_start, v_product.validity_weeks, 0, 0, 0);
  IF v_end < app_today() THEN
    RAISE EXCEPTION 'That package expired on % — it can''t be brought in.', sg_date_label(v_end, 'FMDD Mon YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  -- The lifecycle trigger owns start_date / expires_on / the balance / the price, and enforces kind <-> child.
  BEGIN
    INSERT INTO parent_packages (tenant_id, parent_id, product_id, status, student_id,
                                 carried_over_start, carried_over_lessons)
    VALUES (v_product.tenant_id, p_parent, p_product, 'active', p_student,
            p_original_start, p_lessons_remaining)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
    IF v_cons = 'parent_packages_carried_once' THEN
      RAISE EXCEPTION 'This package has already been brought in.' USING ERRCODE = 'check_violation';
    END IF;
    RAISE;
  END;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  SELECT auth.uid(), 'package_carried_over', 'parent_package', pp.id,
         jsonb_build_object('original_start', pp.carried_over_start, 'lessons_remaining', pp.carried_over_lessons,
                            'rate_per_lesson', pp.rate_per_lesson, 'start_date', pp.start_date,
                            'expires_on', pp.expires_on)
    FROM parent_packages pp WHERE pp.id = v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_carried_over_package(UUID, UUID, DATE, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_carried_over_package(UUID, UUID, DATE, INTEGER, UUID) TO authenticated;
