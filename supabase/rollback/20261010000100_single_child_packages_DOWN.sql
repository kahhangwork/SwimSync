-- ROLLBACK for 20261010000100_single_child_packages.sql — restores the 21 function bodies captured from the DB
-- before it (Step 0; prod md5 = local md5) and drops its two triggers' effect.
--
-- ⚠ APPS FIRST: revert the admin + parent app commits and prove the served bundles no longer send p_student_id /
-- call reassign_package_child (§7.31). The 4-arg create_package_offer and 3-arg suggest_package_start are DROPPED
-- here (a 3-arg named call against both forms would be ambiguous), so a live bundle still sending p_student_id breaks.
-- REFUSES while any active/pending package is tied to a child, or any product is one-child: restoring the old matcher would pool
-- them across siblings. Refund/cancel those packages and flip the products back to shared first.
-- KEEPS (§7.335): the two columns (live bundles select them), the EXCLUDE constraint (a true invariant either way),
-- and the new callables assert_package_child / assert_package_kind_free / reassign_package_child /
-- guard_one_child_packages_flag (inert once nothing is one-child; dropping a callee breaks a re-apply).
-- After running: DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261010000100';

DO $$
BEGIN
  -- Active or pending only: a CANCELLED one-child row is inert under the restored bodies (none reads student_id),
  -- and the kind pin means student_id can never be cleared — refusing on it would make this file unrunnable.
  IF EXISTS (SELECT 1 FROM parent_packages WHERE student_id IS NOT NULL AND status IN ('active', 'pending')) THEN
    RAISE EXCEPTION 'one-child packages are held (%): this rollback restores the sibling-pooling matcher — refund or cancel them first',
      (SELECT string_agg(reference_number, ', ' ORDER BY reference_number) FROM parent_packages
        WHERE student_id IS NOT NULL AND status IN ('active', 'pending'));
  END IF;
  IF EXISTS (SELECT 1 FROM package_products WHERE single_child) THEN
    RAISE EXCEPTION 'one-child products exist: flip them back to shared first, or the restored trigger would sell them as shared';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_guard_one_child_packages_flag ON public.tenants;

-- Signature/return-type changes: drop the new form, recreate the old with its captured ACL.
DROP FUNCTION public.package_candidates_for(uuid, uuid);
CREATE OR REPLACE FUNCTION public.package_candidates_for(p_session uuid, p_student uuid)
 RETURNS TABLE(package_id uuid, rate numeric, value_remaining numeric, expires_on date, confirmed_at timestamp with time zone, lesson_date date, tenant_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH les AS (
    SELECT ls.session_date, c.tenant_id,
           COALESCE((SELECT mb.category_id FROM makeup_bookings mb
                      WHERE mb.student_id = p_student AND mb.class_id = ls.class_id
                        AND mb.session_date = ls.session_date AND mb.cancelled_at IS NULL
                      ORDER BY mb.booked_at LIMIT 1),
                    c.category_id) AS category_id
      FROM lesson_sessions ls
      JOIN classes c ON c.id = ls.class_id
     WHERE ls.id = p_session
  )
  SELECT pp.id, pp.rate_per_lesson, pp.value_remaining, pp.expires_on, pp.confirmed_at,
         les.session_date, les.tenant_id
    FROM les
    JOIN parent_packages pp ON pp.tenant_id = les.tenant_id
   WHERE pp.status = 'active'
     AND pp.parent_id IN (SELECT ps.parent_id FROM parent_students ps WHERE ps.student_id = p_student)
     AND (pp.category_id IS NULL OR pp.category_id = les.category_id)
     AND les.session_date >= pp.start_date
     AND les.session_date <= pp.expires_on
     AND NOT EXISTS (SELECT 1 FROM invoice_items ii
                      WHERE ii.lesson_session_id = p_session AND ii.student_id = p_student)
     AND NOT EXISTS (SELECT 1 FROM package_applications pa
                      WHERE pa.lesson_session_id = p_session AND pa.student_id = p_student
                        AND pa.reversed_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM student_settlements ss
                      WHERE ss.student_id = p_student AND ss.reversed_at IS NULL
                        AND ss.settled_through >= les.session_date)
   ORDER BY pp.expires_on, pp.confirmed_at, pp.id
$function$;
REVOKE ALL ON FUNCTION public.package_candidates_for(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.package_renewal_candidates();
CREATE OR REPLACE FUNCTION public.package_renewal_candidates()
 RETURNS TABLE(parent_id uuid, tenant_id uuid, parent_name text, parent_phone text, children text, package_name text, lessons_left integer, expires_on date, expired_days_ago integer, original_product_id uuid, suggested_product_id uuid, has_open_offer boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH today AS (SELECT (app_now() AT TIME ZONE 'Asia/Singapore')::date AS d),
cov AS MATERIALIZED (
  SELECT * FROM student_package_coverage()
),
low_fams AS (
  SELECT DISTINCT c.parent_id, c.tenant_id FROM cov c WHERE c.low
),
expired_fams AS (
  SELECT pp.parent_id, pp.tenant_id,
         (SELECT d FROM today) - max(pp.expires_on) AS expired_days_ago
  FROM parent_packages pp
  WHERE pp.status = 'active'
    AND pp.expires_on <  (SELECT d FROM today)
    AND pp.expires_on >= (SELECT d FROM today) - 30
    AND NOT EXISTS (
      SELECT 1 FROM parent_packages o
      WHERE o.parent_id = pp.parent_id AND o.tenant_id = pp.tenant_id
        AND (o.status = 'pending'
             OR (o.status = 'active' AND o.expires_on >= (SELECT d FROM today)))
    )
  GROUP BY pp.parent_id, pp.tenant_id
),
fams AS (
  SELECT parent_id, tenant_id, NULL::integer AS expired_days_ago FROM low_fams
  UNION
  SELECT parent_id, tenant_id, expired_days_ago FROM expired_fams
        WHERE (parent_id, tenant_id) NOT IN (SELECT parent_id, tenant_id FROM low_fams)
),
-- Most recent non-cancelled package the family bought — its product AND category.
original AS (
  SELECT DISTINCT ON (pp.parent_id, pp.tenant_id)
         pp.parent_id, pp.tenant_id, pp.product_id, pp.category_id
  FROM parent_packages pp
  WHERE pp.status <> 'cancelled'
  ORDER BY pp.parent_id, pp.tenant_id, pp.requested_at DESC
)
SELECT
  f.parent_id,
  f.tenant_id,
  pr.full_name AS parent_name,
  pr.phone     AS parent_phone,
  (SELECT string_agg(s.full_name, ', ' ORDER BY s.full_name)
     FROM parent_students ps JOIN students s ON s.id = ps.student_id
    WHERE ps.parent_id = f.parent_id AND s.is_active) AS children,
  (SELECT c.package_name FROM cov c
    WHERE c.parent_id = f.parent_id AND c.tenant_id = f.tenant_id
      AND c.package_id IS NOT NULL
    ORDER BY c.expires_on NULLS LAST LIMIT 1) AS package_name,
  (SELECT max(c.lessons_remaining) FROM cov c
    WHERE c.parent_id = f.parent_id AND c.tenant_id = f.tenant_id) AS lessons_left,
  (SELECT min(c.expires_on) FROM cov c
    WHERE c.parent_id = f.parent_id AND c.tenant_id = f.tenant_id
      AND c.package_id IS NOT NULL) AS expires_on,
  f.expired_days_ago,
  o.product_id AS original_product_id,
  COALESCE(
    CASE WHEN op.is_active THEN o.product_id END,   -- the active original
    cat.default_product_id,                          -- the original's category default
    t.default_package_product_id                     -- the all-classes default
  ) AS suggested_product_id,
  EXISTS (SELECT 1 FROM parent_packages x
           WHERE x.parent_id = f.parent_id AND x.tenant_id = f.tenant_id
             AND x.status = 'pending' AND x.offered_by IS NOT NULL
             AND x.paid_claimed_at IS NULL AND x.superseded_by IS NULL) AS has_open_offer
FROM fams f
JOIN parents pa   ON pa.id = f.parent_id
JOIN profiles pr  ON pr.id = pa.profile_id
JOIN tenants t    ON t.id = f.tenant_id
LEFT JOIN original o           ON o.parent_id = f.parent_id AND o.tenant_id = f.tenant_id
LEFT JOIN package_products op  ON op.id = o.product_id
LEFT JOIN class_categories cat ON cat.id = o.category_id
$function$;
REVOKE ALL ON FUNCTION public.package_renewal_candidates() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.package_renewal_candidates() TO authenticated, service_role;

DROP FUNCTION public.create_package_offer(uuid, uuid, date, uuid);
CREATE OR REPLACE FUNCTION public.create_package_offer(p_parent_id uuid, p_product_id uuid, p_start_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product  package_products%ROWTYPE;
  v_offer_id uuid;
BEGIN
  SELECT * INTO v_product FROM package_products WHERE id = p_product_id;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Unknown package product.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(v_product.tenant_id, 'packages', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized to offer a package for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT v_product.is_active THEN
    RAISE EXCEPTION 'That package is no longer offered.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The parent must belong to this product's business. Parents link to a tenant
  -- via parent_tenants (many-to-many), NOT profiles.tenant_id (that is NULL for
  -- a parent — it names a STAFF member's home tenant).
  IF NOT EXISTS (
    SELECT 1 FROM parent_tenants pt
    WHERE pt.parent_id = p_parent_id AND pt.tenant_id = v_product.tenant_id
  ) THEN
    RAISE EXCEPTION 'That family is not in this business.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ⚠ RISK 12 — one open offer per family. A second (or a double-click) must
  -- not mint a second pay link; the first would then 404 after supersede.
  IF EXISTS (
    SELECT 1 FROM parent_packages
    WHERE tenant_id = v_product.tenant_id
      AND parent_id = p_parent_id
      AND status = 'pending'
      AND offered_by IS NOT NULL
      AND paid_claimed_at IS NULL
      AND superseded_by IS NULL
  ) THEN
    RAISE EXCEPTION 'An offer is already open for this family — Decline it first.'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO parent_packages (tenant_id, parent_id, product_id, status,
                               start_date, offered_by, offered_at)
  VALUES (v_product.tenant_id, p_parent_id, p_product_id, 'pending',
          p_start_date, auth.uid(), now())
  RETURNING id INTO v_offer_id;

  RETURN v_offer_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_package_offer(uuid, uuid, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_package_offer(uuid, uuid, date) TO authenticated, service_role;

DROP FUNCTION public.suggest_package_start(uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION public.suggest_package_start(p_parent_id uuid, p_product_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH today AS (
    SELECT (app_now() AT TIME ZONE 'Asia/Singapore')::date AS d
  ),
  prod AS (
    SELECT tenant_id, category_id FROM package_products WHERE id = p_product_id
  ),
  -- The parent's active packages that would OVERLAP the new one's coverage
  -- (same category, or either side is all-classes).
  active_pkgs AS (
    SELECT pp.id, pp.category_id, pp.expires_on, pp.rate_per_lesson, pp.value_remaining
    FROM parent_packages pp
    JOIN prod ON pp.tenant_id = prod.tenant_id
    WHERE pp.parent_id = p_parent_id
      AND pp.status = 'active'
      AND (prod.category_id IS NULL
           OR pp.category_id IS NULL
           OR pp.category_id = prod.category_id)
  ),
  -- Weekly draw rate PER package: how many of the covered kids' current
  -- active class enrolments this package would fund (one class = one lesson/wk;
  -- two kids, or a kid in two classes, both raise the rate — §8.43).
  weekly AS (
    SELECT ap.id,
           count(*) AS weekly_lessons
    FROM active_pkgs ap
    JOIN parent_students ps        ON ps.parent_id = p_parent_id
    JOIN student_class_enrolments e ON e.student_id = ps.student_id AND e.is_active
    JOIN classes c                  ON c.id = e.class_id
                                    AND c.is_active
                                    AND c.tenant_id = (SELECT tenant_id FROM prod)
                                    AND (ap.category_id IS NULL OR c.category_id = ap.category_id)
    GROUP BY ap.id
  ),
  done_dates AS (
    SELECT
      CASE
        WHEN COALESCE(w.weekly_lessons, 0) > 0 THEN
          LEAST(
            ap.expires_on,
            (SELECT d FROM today)
              + (ceil(floor(ap.value_remaining / ap.rate_per_lesson)::numeric
                      / w.weekly_lessons)::int * 7)
          )
        ELSE ap.expires_on
      END AS done_date
    FROM active_pkgs ap
    LEFT JOIN weekly w ON w.id = ap.id
  )
  SELECT COALESCE(
    (SELECT max(done_date) + 1 FROM done_dates),
    (SELECT d FROM today)
  );
$function$;
REVOKE ALL ON FUNCTION public.suggest_package_start(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suggest_package_start(uuid, uuid) TO authenticated, service_role;

-- Same-signature bodies (CREATE OR REPLACE keeps each ACL).
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
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    ELSIF OLD.status = 'active' AND NEW.status = 'cancelled' THEN
      IF current_user = 'authenticated' AND NOT (is_platform_admin() OR has_admin_area(OLD.tenant_id, 'packages', 'edit')) THEN
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

CREATE OR REPLACE FUNCTION public.package_draw_for(p_session uuid, p_student uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg  UUID;
  v_rate NUMERIC;
  v_date DATE;
  v_app  UUID;
BEGIN
  -- Lock EVERY candidate in the one fixed order first (two coaches marking siblings at once can neither
  -- overdraw nor deadlock), then choose against the post-lock balances.
  PERFORM 1
     FROM parent_packages pp
    WHERE pp.id IN (SELECT c.package_id FROM package_candidates_for(p_session, p_student) c)
    ORDER BY pp.expires_on, pp.confirmed_at, pp.id
      FOR UPDATE;

  SELECT c.package_id, c.rate, c.lesson_date
    INTO v_pkg, v_rate, v_date
    FROM package_candidates_for(p_session, p_student) c
   WHERE c.value_remaining >= c.rate
   ORDER BY c.expires_on, c.confirmed_at, c.package_id
   LIMIT 1;

  IF v_pkg IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO package_applications (parent_package_id, amount, lesson_session_id, student_id, lesson_date)
  VALUES (v_pkg, v_rate, p_session, p_student, v_date)
  RETURNING id INTO v_app;

  UPDATE parent_packages SET value_remaining = value_remaining - v_rate WHERE id = v_pkg;
  RETURN v_app;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_package_draw_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant     UUID;
  v_date       DATE;
  v_pkg        RECORD;
  v_left_now   INTEGER;
  v_left_after INTEGER;
  v_found      INTEGER := 0;
  v_first_date DATE;
  v_first_kid  TEXT;
  v_first_cls  TEXT;
  v_refuse     BOOLEAN := false;
BEGIN
  IF NEW.status NOT IN ('present', 'trial_paid') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM attendance a
                WHERE a.lesson_session_id = NEW.lesson_session_id AND a.student_id = NEW.student_id) THEN
      RETURN NEW;
    END IF;
  ELSIF OLD.status IN ('present', 'trial_paid') THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT c.tenant_id, ls.session_date INTO v_tenant, v_date
      FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
     WHERE ls.id = NEW.lesson_session_id;
    IF NOT COALESCE((SELECT t.package_draw_at_marking FROM tenants t WHERE t.id = v_tenant), false) THEN
      RETURN NEW;
    END IF;

    SELECT pp.id, pp.parent_id, pp.category_id, pp.start_date, pp.expires_on,
           pp.rate_per_lesson, pp.value_remaining
      INTO v_pkg
      FROM package_candidates_for(NEW.lesson_session_id, NEW.student_id) c
      JOIN parent_packages pp ON pp.id = c.package_id
     WHERE c.value_remaining >= c.rate
     ORDER BY c.expires_on, c.confirmed_at, c.package_id
     LIMIT 1;
    IF v_pkg.id IS NULL THEN
      RETURN NEW;                                   -- nothing would draw: ad-hoc, no claim to protect
    END IF;

    v_left_now   := floor(v_pkg.value_remaining / v_pkg.rate_per_lesson)::INTEGER;
    v_left_after := v_left_now - 1;

    -- Earlier unmarked (date, child) pairs this package would also cover. Stops at left_after + 1. The
    -- earliest one is named in the message FROM THE SAME ROWS — a separate lookup would name a lesson the
    -- filters excluded (caught by pgTAP case 19).
    SELECT count(*),
           (array_agg(q.session_date ORDER BY q.session_date, q.full_name, q.title))[1],
           (array_agg(q.full_name    ORDER BY q.session_date, q.full_name, q.title))[1],
           (array_agg(q.title        ORDER BY q.session_date, q.full_name, q.title))[1]
      INTO v_found, v_first_date, v_first_kid, v_first_cls
      FROM (
        SELECT p.session_date, s.full_name, c.title
          FROM classes c
          CROSS JOIN LATERAL class_unmarked_lesson_pairs(c.id) p
          JOIN students s ON s.id = p.student_id
         WHERE c.tenant_id = v_tenant
           -- RISK 10: only classes the family is in (enrolled or booked) — never every class of the business.
           AND (EXISTS (SELECT 1 FROM student_class_enrolments e JOIN parent_students ps ON ps.student_id = e.student_id
                         WHERE e.class_id = c.id AND ps.parent_id = v_pkg.parent_id)
                OR EXISTS (SELECT 1 FROM makeup_bookings mb JOIN parent_students ps ON ps.student_id = mb.student_id
                            WHERE mb.class_id = c.id AND ps.parent_id = v_pkg.parent_id AND mb.cancelled_at IS NULL)
                OR EXISTS (SELECT 1 FROM trial_bookings tb JOIN parent_students ps ON ps.student_id = tb.student_id
                            WHERE tb.class_id = c.id AND ps.parent_id = v_pkg.parent_id AND tb.cancelled_at IS NULL))
           AND (c.deactivated_at IS NULL
                OR p.session_date <= (c.deactivated_at AT TIME ZONE 'Asia/Singapore')::date)
           AND EXISTS (SELECT 1 FROM parent_students ps
                        WHERE ps.student_id = p.student_id AND ps.parent_id = v_pkg.parent_id)
           AND p.session_date <  v_date
           AND p.session_date >= markable_floor(v_tenant)
           AND p.session_date >= v_pkg.start_date
           AND p.session_date <= v_pkg.expires_on
           AND NOT EXISTS (SELECT 1 FROM lesson_sessions lx
                            WHERE lx.class_id = c.id AND lx.session_date = p.session_date
                              AND lx.cancelled_at IS NOT NULL)
           AND (v_pkg.category_id IS NULL
                OR v_pkg.category_id = COALESCE(
                     (SELECT mb.category_id FROM makeup_bookings mb
                       WHERE mb.student_id = p.student_id AND mb.class_id = c.id
                         AND mb.session_date = p.session_date AND mb.cancelled_at IS NULL
                       ORDER BY mb.booked_at LIMIT 1),
                     c.category_id))
         ORDER BY p.session_date, s.full_name, c.title
         LIMIT v_left_after + 1
      ) q;

    v_refuse := v_found > v_left_after;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'guard_package_draw_order failed open for lesson % student %: % (%)',
      NEW.lesson_session_id, NEW.student_id, SQLERRM, SQLSTATE;
    RETURN NEW;
  END;

  IF v_refuse THEN
    RAISE EXCEPTION '%', format(
      'Mark %s first — the package has %s lesson%s left. (%s · %s) Nothing was saved.',
      sg_date_label(v_first_date, 'FMDD Mon'), v_left_now, CASE WHEN v_left_now = 1 THEN '' ELSE 's' END,
      COALESCE(v_first_kid, 'a sibling'), COALESCE(v_first_cls, 'another class'))
      USING ERRCODE = 'PK001';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.package_backlog_lessons(p_package uuid)
 RETURNS TABLE(lesson_session_id uuid, student_id uuid, session_date date, class_title text, student_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT a.lesson_session_id, a.student_id, ls.session_date, c.title, s.full_name
    FROM parent_packages pp
    JOIN parent_students ps ON ps.parent_id = pp.parent_id
    JOIN attendance a       ON a.student_id = ps.student_id
    JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
    JOIN classes c          ON c.id = ls.class_id AND c.tenant_id = pp.tenant_id
    JOIN students s         ON s.id = a.student_id
   WHERE pp.id = p_package
     AND a.status IN ('present', 'trial_paid')
     AND ls.session_date BETWEEN pp.start_date AND pp.expires_on
     AND NOT EXISTS (SELECT 1 FROM billing_periods bp
                      WHERE bp.tenant_id = pp.tenant_id
                        AND bp.billing_month = to_char(ls.session_date, 'YYYY-MM'))
     AND EXISTS (SELECT 1 FROM package_candidates_for(a.lesson_session_id, a.student_id) pc
                  WHERE pc.package_id = p_package)
   ORDER BY ls.session_date, a.student_id
$function$;

CREATE OR REPLACE FUNCTION public.package_backlog_preview(p_package uuid)
 RETURNS TABLE(session_date date, student_id uuid, student_name text, class_title text, funding_package_id uuid, funding_package_name text, funds_this boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_sim    JSONB := '{}';
  les      RECORD;
  c        RECORD;
  v_rem    NUMERIC;
  v_pick   UUID;
  v_rate   NUMERIC;
BEGIN
  SELECT pp.tenant_id INTO v_tenant FROM parent_packages pp WHERE pp.id = p_package;
  IF auth.uid() IS NULL OR v_tenant IS NULL
     OR NOT COALESCE(is_platform_admin() OR has_admin_area(v_tenant, 'packages', 'view'), false) THEN
    RAISE EXCEPTION 'not authorised to read this package' USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR les IN SELECT * FROM package_backlog_lessons(p_package) LOOP
    v_pick := NULL;
    FOR c IN SELECT * FROM package_candidates_for(les.lesson_session_id, les.student_id) pc
              ORDER BY pc.expires_on, pc.confirmed_at, pc.package_id LOOP
      v_rem := COALESCE((v_sim ->> c.package_id::text)::NUMERIC, c.value_remaining);
      IF v_rem >= c.rate THEN
        v_pick := c.package_id; v_rate := c.rate;
        v_sim := v_sim || jsonb_build_object(c.package_id::text, v_rem - c.rate);
        EXIT;
      END IF;
    END LOOP;
    session_date := les.session_date; student_id := les.student_id;
    student_name := les.student_name; class_title := les.class_title;
    funding_package_id := v_pick;
    funding_package_name := (SELECT name FROM parent_packages WHERE id = v_pick);
    funds_this := v_pick IS NOT DISTINCT FROM p_package;
    RETURN NEXT;
  END LOOP;
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
    AND (pp.category_id IS NULL OR pp.category_id = p_category_id)
    AND p_date >= pp.start_date
    AND p_date <  pp.start_date + (pp.validity_weeks * 7)
  ORDER BY pp.expires_on, pp.confirmed_at, pp.id
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.student_package_coverage()
 RETURNS TABLE(student_id uuid, parent_id uuid, tenant_id uuid, coverage text, lessons_remaining integer, package_id uuid, package_name text, expires_on date, low boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH live AS (
  SELECT lv.parent_package_id, lv.parent_id, lv.tenant_id, lv.category_id,
         lv.live_lessons_remaining, lv.expires_on, lv.name
  FROM package_live_balances() lv
  JOIN parent_packages pp ON pp.id = lv.parent_package_id
  WHERE lv.expires_on >= (app_now() AT TIME ZONE 'Asia/Singapore')::date
    AND pp.start_date <= (app_now() AT TIME ZONE 'Asia/Singapore')::date
),
links AS (
  SELECT ps.student_id, ps.parent_id, s.tenant_id
  FROM parent_students ps
  JOIN students s ON s.id = ps.student_id
),
cats AS (
  SELECT DISTINCT sce.student_id, c.category_id
  FROM student_class_enrolments sce
  JOIN classes c ON c.id = sce.class_id
  WHERE sce.is_active
),
-- ⚠ RISK 2 — "low" is a FAMILY verdict, and a family that already has an open
-- pending row or a future-start active package is NOT low (those are not in
-- `live`, so without this exclusion they would flag as low forever).
fam AS (
  SELECT l.parent_id, l.tenant_id,
         sum(l.live_lessons_remaining)::integer AS fam_left,
         max(l.expires_on)                      AS fam_max_expiry
  FROM live l
  GROUP BY l.parent_id, l.tenant_id
),
open_row AS (
  SELECT DISTINCT pp.parent_id, pp.tenant_id
  FROM parent_packages pp
  WHERE pp.status = 'pending'
     OR (pp.status = 'active'
         AND pp.start_date > (app_now() AT TIME ZONE 'Asia/Singapore')::date)
),
fam_low AS (
  SELECT f.parent_id, f.tenant_id,
    ( (f.fam_left <= t.low_package_lessons
       OR f.fam_max_expiry - (app_now() AT TIME ZONE 'Asia/Singapore')::date
            <= t.package_expiry_warning_days)
      AND NOT EXISTS (SELECT 1 FROM open_row o
                       WHERE o.parent_id = f.parent_id AND o.tenant_id = f.tenant_id)
    ) AS low
  FROM fam f
  JOIN tenants t ON t.id = f.tenant_id
),
verdict AS (
  SELECT
    l.student_id, l.parent_id, l.tenant_id,
    (SELECT count(*) FROM cats ct WHERE ct.student_id = l.student_id) AS n_cats,
    (SELECT count(*) FROM cats ct
      WHERE ct.student_id = l.student_id
        AND EXISTS (
          SELECT 1 FROM live lv
          WHERE lv.parent_id = l.parent_id
            AND lv.tenant_id = l.tenant_id
            AND (lv.category_id IS NULL OR lv.category_id = ct.category_id)
        )) AS n_covered,
    EXISTS (
      SELECT 1 FROM live lv
      WHERE lv.parent_id = l.parent_id AND lv.tenant_id = l.tenant_id
    ) AS has_any
  FROM links l
),
-- The covering package to SHOW per student: earliest-expiring covering package
-- that still has live lessons (fallback: earliest covering). Covering = the
-- package is all-classes, or its category is one of the student's.
cover AS (
  SELECT v.student_id,
    (SELECT lv.parent_package_id FROM live lv
      WHERE lv.parent_id = v.parent_id AND lv.tenant_id = v.tenant_id
        AND (lv.category_id IS NULL
             OR lv.category_id IN (SELECT ct.category_id FROM cats ct
                                    WHERE ct.student_id = v.student_id))
      ORDER BY (lv.live_lessons_remaining > 0) DESC, lv.expires_on, lv.parent_package_id
      LIMIT 1) AS package_id
  FROM verdict v
)
SELECT
  v.student_id,
  v.parent_id,
  v.tenant_id,
  CASE
    WHEN v.n_cats = 0 THEN CASE WHEN v.has_any THEN 'package' ELSE 'ad_hoc' END
    WHEN v.n_covered = 0 THEN 'ad_hoc'
    WHEN v.n_covered = v.n_cats THEN 'package'
    ELSE 'mixed'
  END AS coverage,
  CASE
    WHEN (v.n_cats = 0 AND v.has_any) OR v.n_covered > 0 THEN
      (SELECT sum(lv.live_lessons_remaining)::integer
       FROM live lv
       WHERE lv.parent_id = v.parent_id
         AND lv.tenant_id = v.tenant_id
         AND (v.n_cats = 0
              OR lv.category_id IS NULL
              OR lv.category_id IN (SELECT ct.category_id FROM cats ct
                                     WHERE ct.student_id = v.student_id)))
    ELSE NULL
  END AS lessons_remaining,
  cv.package_id,
  (SELECT lv.name       FROM live lv WHERE lv.parent_package_id = cv.package_id) AS package_name,
  (SELECT lv.expires_on FROM live lv WHERE lv.parent_package_id = cv.package_id) AS expires_on,
  CASE WHEN ((v.n_cats = 0 AND v.has_any) OR v.n_covered > 0)
       THEN COALESCE(fl.low, false) ELSE false END AS low
FROM verdict v
LEFT JOIN cover cv    ON cv.student_id = v.student_id
LEFT JOIN fam_low fl  ON fl.parent_id = v.parent_id AND fl.tenant_id = v.tenant_id
$function$;

CREATE OR REPLACE FUNCTION public.supersede_open_package_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A new pending request (from either side) or a direct active sale closes the
  -- family's open UNCLAIMED admin offer, so a family never holds two live pay
  -- links. It NEVER touches a parent's own pending request (offered_by IS NULL)
  -- nor an offer the family already PAID (paid_claimed_at IS NOT NULL — RISK 1:
  -- cancelled is terminal, and the PKG- reference on the bank statement must
  -- stay live). DEFINER so the lifecycle pins do not reject the system's own
  -- write; explicit tenant/parent scoping because DEFINER bypasses RLS.
  -- AFTER INSERT only: it never fires on UPDATE, so its own UPDATE cannot
  -- re-enter it (§7.57).
  IF NEW.status IN ('pending', 'active') THEN
    UPDATE parent_packages
       SET status        = 'cancelled',
           cancelled_at  = COALESCE(cancelled_at, now()),
           superseded_by = NEW.id
     WHERE tenant_id       = NEW.tenant_id
       AND parent_id       = NEW.parent_id
       AND id             <> NEW.id
       AND status          = 'pending'
       AND offered_by      IS NOT NULL
       AND paid_claimed_at IS NULL;
  END IF;
  RETURN NULL;
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

CREATE OR REPLACE FUNCTION public.book_trial(p_class_id uuid, p_session_date date, p_student_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor    UUID := auth.uid();
  v_tenant   UUID;
  v_category UUID;
  v_class_day day_of_week;
  v_booking  UUID;
  v_class_title TEXT;
  v_host_active BOOLEAN;
  v_cap      SMALLINT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.tenant_id, c.category_id, c.day_of_week, c.title, c.is_active
    INTO v_tenant, v_category, v_class_day, v_class_title, v_host_active
    FROM classes c WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  -- NEW in 20260810000100. See the header.
  IF NOT v_host_active THEN
    RAISE EXCEPTION '% is no longer running', v_class_title;
  END IF;

  -- Admin only. Booking is an arrangement, not an observation.
  IF NOT has_admin_area(v_tenant, 'operations', 'edit') THEN
    RAISE EXCEPTION 'only this business''s admin may book a trial';
  END IF;

  -- The student must belong to this business.
  IF NOT EXISTS (
    SELECT 1 FROM students s
     WHERE s.id = p_student_id AND s.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'that child belongs to another business';
  END IF;

  -- ── 0. Not into an already-billed month ─────────────────────────────────
  -- New in 20260806000200. See the header above this function: this is the one
  -- refusal in that migration that did not exist before it.
  IF p_session_date < markable_floor(v_tenant) THEN
    RAISE EXCEPTION
      'A trial cannot be booked before % — that month has been billed.',
      sg_date_label(markable_floor(v_tenant), 'DD Mon YYYY');
  END IF;

  -- ── 1. The date must be a day this class actually runs ──────────────────
  -- Otherwise the child is expected at a lesson that never happens: never on
  -- any roster, never marked, and blocking the billing month indefinitely with
  -- no visible cause.
  --
  -- EXTRACT(DOW) rather than to_char(…,'day'): to_char renders the weekday
  -- NAME through `lc_time`, so on a server with a non-English locale every
  -- comparison here would fail and NO trial could ever be booked. DOW is an
  -- integer and means the same thing everywhere. 0 = Sunday.
  IF (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
        )[EXTRACT(DOW FROM p_session_date)::int + 1] <> v_class_day::text THEN
    RAISE EXCEPTION
      '% runs on a %, but % is a %',
      v_class_title,
      v_class_day,
      sg_date_label(p_session_date, 'DD Mon YYYY'),
      (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
        )[EXTRACT(DOW FROM p_session_date)::int + 1];
  END IF;

  -- ── 2. Not already a customer: an ACTIVE enrolment in ANY class ─────────
  -- A trial means "not in a class yet". A CLOSED enrolment does not block — a
  -- family that left and is considering coming back, possibly to a different
  -- class, is a real trial.
  IF EXISTS (
    SELECT 1 FROM student_class_enrolments e
     WHERE e.student_id = p_student_id AND e.is_active
  ) THEN
    RAISE EXCEPTION
      'that child is already enrolled in a class — trials are for children not yet in one';
  END IF;

  -- ── 3. Nor holding prepaid value ────────────────────────────────────────
  -- Checked across EVERY parent linked to the child: parent_students is
  -- many-to-many, so testing only the first would make this bypassable
  -- depending on which row came back first.
  IF EXISTS (
    SELECT 1
      FROM parent_students ps
      JOIN parent_packages pp ON pp.parent_id = ps.parent_id
     WHERE ps.student_id = p_student_id
       AND pp.tenant_id = v_tenant
       AND pp.status = 'active'
       AND pp.value_remaining > 0
       AND (pp.expires_on IS NULL OR pp.expires_on >= p_session_date)
  ) THEN
    RAISE EXCEPTION
      'that family already has a prepaid package with this business — a trial is for new families';
  END IF;

  -- ── Serialise against a concurrent RETIRE and the last seat (§7.198, §7.200) ─
  -- Same rule as book_makeup, and same reasoning: lock the class row FIRST and
  -- UNCONDITIONALLY, then re-check is_active and the capacity UNDER the lock.
  -- The lock closes booking-vs-retire on an UNCAPPED class too, where
  -- trial_bookings.class_id's FK (FOR KEY SHARE) does not serialise against
  -- deactivate_class()'s non-key is_active UPDATE.
  PERFORM 1 FROM classes WHERE id = p_class_id FOR UPDATE;

  -- Re-read is_active under the lock: a deactivate_class() that committed since
  -- the top-of-function read would otherwise leave this trial guest in a retired
  -- class (§7.200). The reverse direction is caught by trg_class_retirement_guard
  -- (§7.199).
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id AND is_active) THEN
    RAISE EXCEPTION '% is no longer running', v_class_title;
  END IF;

  -- ── A cancelled lesson takes no guests (20260821000700, plan RISK 3) ─────
  -- Under the lock, for the reason book_makeup gives.
  IF EXISTS (
    SELECT 1 FROM lesson_sessions ls
     WHERE ls.class_id = p_class_id
       AND ls.session_date = p_session_date
       AND ls.cancelled_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      '% on % has been cancelled — restore the lesson first, or pick another date',
      v_class_title, sg_date_label(p_session_date, 'DD Mon YYYY');
  END IF;

  -- ── Capacity: a hard refusal for EVERYONE, admin included (Decision 1) ────
  -- The expected set on p_session_date against the effective maximum, AFTER
  -- every refusal above, read UNDER the lock (§7.200). (A duplicate live trial is
  -- still caught by trial_bookings_live_slot_uniq -> 23505; at capacity the count
  -- check may fire first and read "full" — a cosmetic edge, kept because
  -- book_trial has never carried its own duplicate sentence and trial_onboarding
  -- pins the index behaviour.)
  v_cap := class_effective_capacity(p_class_id);
  IF v_cap IS NOT NULL
     AND class_expected_count(p_class_id, p_session_date) >= v_cap THEN
    RAISE EXCEPTION
      '% is full on % (% of %) — free a place or raise the class''s maximum first',
      v_class_title, sg_date_label(p_session_date, 'DD Mon YYYY'),
      class_expected_count(p_class_id, p_session_date), v_cap;
  END IF;

  -- category_id is SNAPSHOTTED from the class. See the column comment on
  -- trial_bookings: classes.category_id is mutable and money depends on it.
  INSERT INTO trial_bookings
    (tenant_id, student_id, class_id, session_date, category_id, booked_by)
  VALUES (v_tenant, p_student_id, p_class_id, p_session_date, v_category, v_actor)
  RETURNING id INTO v_booking;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_actor, 'trial_booked', 'Student', p_student_id,
    jsonb_build_object('class_id', p_class_id, 'session_date', p_session_date,
                       'category_id', v_category, 'booking_id', v_booking)
  );

  RETURN v_booking;
END;
$function$;

CREATE OR REPLACE FUNCTION public.merge_students(p_survivor_id uuid, p_duplicate_id uuid)
 RETURNS TABLE(moved_parent_links integer, moved_trial_bookings integer, moved_makeup_bookings integer, moved_settlements integer, moved_claims integer, moved_skill_progress integer, dropped_collisions integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor      UUID := auth.uid();
  v_surv       students%ROWTYPE;
  v_dup        students%ROWTYPE;
  v_surv_att   INT;
  v_dup_att    INT;
  v_unknown    TEXT;
  v_ps INT := 0; v_tb INT := 0; v_mb INT := 0; v_ss INT := 0; v_cl INT := 0;
  v_sp INT := 0;
  v_drop INT := 0; v_drop_ps INT := 0; v_drop_tb INT := 0; v_drop_mb INT := 0;
  v_drop_sp INT := 0;
  v_ps_before INT; v_tb_before INT; v_mb_before INT; v_ss_before INT; v_sp_before INT;
  v_ps_after  INT; v_tb_after  INT; v_mb_after  INT; v_ss_after  INT; v_sp_after  INT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_survivor_id = p_duplicate_id THEN
    RAISE EXCEPTION 'those are the same child';
  END IF;

  SELECT * INTO v_surv FROM students WHERE id = p_survivor_id;
  SELECT * INTO v_dup  FROM students WHERE id = p_duplicate_id;

  IF v_surv.id IS NULL OR v_dup.id IS NULL THEN
    RAISE EXCEPTION 'child not found';
  END IF;

  IF v_surv.tenant_id <> v_dup.tenant_id THEN
    RAISE EXCEPTION 'those two children belong to different businesses';
  END IF;

  -- Tenant derived from the ROWS, never from a parameter (§7.42).
  IF NOT has_admin_area(v_surv.tenant_id, 'operations', 'edit') THEN
    RAISE EXCEPTION 'only this business''s admin may merge two children';
  END IF;

  -- ⚠ RISK 4 — THE STRUCTURAL GUARD. DO NOT REMOVE OR "SIMPLIFY" THIS.
  --
  -- This function ends in a DELETE, so every CASCADING foreign key into
  -- students silently takes rows with it. The mitigation cannot be a list in
  -- a comment that someone remembers to update. It is this: ask the CATALOGUE
  -- what cascades, and REFUSE if anything has appeared that this function has
  -- not been taught to move. student_skill_progress (2026-08-28) is the newest
  -- table this guard caught — it failed the suite the moment the table landed.
  SELECT string_agg(conrelid::regclass::text, ', ')
    INTO v_unknown
    FROM pg_constraint
   WHERE confrelid = 'students'::regclass
     AND contype = 'f'
     AND confdeltype = 'c'
     AND conrelid::regclass::text NOT IN
         ('parent_students', 'student_settlements', 'trial_bookings',
          'student_claims', 'makeup_bookings', 'student_skill_progress');

  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION
      'merge_students has not been taught to move %, which now CASCADES from students. Teach it before merging, or the merge will destroy those rows.',
      v_unknown;
  END IF;

  -- ── Direction. Asserted, never inferred silently. ───────────────────────
  SELECT count(*)::INT INTO v_surv_att FROM attendance WHERE student_id = p_survivor_id;
  SELECT count(*)::INT INTO v_dup_att  FROM attendance WHERE student_id = p_duplicate_id;

  IF v_surv_att > 0 AND v_dup_att > 0 THEN
    RAISE EXCEPTION
      'Both children have lessons recorded (% and %). Merging would move attendance off a real record — this one needs to be sorted out by hand.',
      v_surv_att, v_dup_att;
  END IF;

  -- The survivor must be the row with the history. If the caller has them the
  -- wrong way round, REFUSE and say so rather than quietly swapping.
  IF v_dup_att > 0 THEN
    RAISE EXCEPTION
      'The child you marked as the duplicate is the one with % lessons recorded. Swap them: the record with the history must be the one that survives.',
      v_dup_att;
  END IF;

  IF EXISTS (SELECT 1 FROM invoice_items WHERE student_id = p_duplicate_id)
     OR EXISTS (SELECT 1 FROM credit_notes WHERE student_id = p_duplicate_id) THEN
    RAISE EXCEPTION
      'The duplicate record already appears on an invoice or credit note, so it cannot be deleted. Sort this one out by hand.';
  END IF;

  -- Counted before anything moves, so the invariant at the end is honest.
  SELECT count(*)::INT INTO v_ps_before FROM parent_students;
  SELECT count(*)::INT INTO v_tb_before FROM trial_bookings;
  SELECT count(*)::INT INTO v_mb_before FROM makeup_bookings;
  SELECT count(*)::INT INTO v_ss_before FROM student_settlements;
  SELECT count(*)::INT INTO v_sp_before FROM student_skill_progress;

  -- ── 1. The duplicate's better fields, ONLY where the survivor has none ──
  BEGIN
    UPDATE students
       SET date_of_birth = COALESCE(date_of_birth, v_dup.date_of_birth),
           gender        = COALESCE(gender,        v_dup.gender),
           notes         = COALESCE(notes,         v_dup.notes),
           level_id      = COALESCE(level_id,      v_dup.level_id),
           provisional_contact_name  = COALESCE(provisional_contact_name,  v_dup.provisional_contact_name),
           provisional_contact_phone = COALESCE(provisional_contact_phone, v_dup.provisional_contact_phone),
           provisional_contact_email = COALESCE(provisional_contact_email, v_dup.provisional_contact_email)
     WHERE id = p_survivor_id;
  EXCEPTION WHEN unique_violation THEN
    -- Filling the DOB can collide with a THIRD row of the same name and date.
    -- The merge is still correct; only the enrichment is impossible.
    NULL;
  END;

  -- ── 2. Parent links ─────────────────────────────────────────────────────
  WITH moved AS (
    UPDATE parent_students ps
       SET student_id = p_survivor_id
     WHERE ps.student_id = p_duplicate_id
       AND NOT EXISTS (
         SELECT 1 FROM parent_students x
          WHERE x.student_id = p_survivor_id AND x.parent_id = ps.parent_id
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_ps FROM moved;

  WITH dropped AS (
    DELETE FROM parent_students WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_ps FROM dropped;

  -- ── 3. Trial bookings ───────────────────────────────────────────────────
  WITH moved AS (
    UPDATE trial_bookings tb
       SET student_id = p_survivor_id
     WHERE tb.student_id = p_duplicate_id
       AND (
         tb.cancelled_at IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM trial_bookings x
            WHERE x.student_id = p_survivor_id
              AND x.class_id = tb.class_id
              AND x.session_date = tb.session_date
              AND x.cancelled_at IS NULL
         )
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_tb FROM moved;

  WITH dropped AS (
    DELETE FROM trial_bookings WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_tb FROM dropped;

  -- ── 3b. Make-up bookings — same live-slot rule as trials ────────────────
  WITH moved AS (
    UPDATE makeup_bookings mb
       SET student_id = p_survivor_id
     WHERE mb.student_id = p_duplicate_id
       AND (
         mb.cancelled_at IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM makeup_bookings x
            WHERE x.student_id = p_survivor_id
              AND x.class_id = mb.class_id
              AND x.session_date = mb.session_date
              AND x.cancelled_at IS NULL
         )
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_mb FROM moved;

  WITH dropped AS (
    DELETE FROM makeup_bookings WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_mb FROM dropped;

  -- ── 3c. Skill progress — collision key is UNIQUE (student_id, skill_id) ──
  -- A graded skill moves to the survivor unless the survivor already holds a
  -- grade on that skill; the survivor holds the history, so its grade wins and
  -- the duplicate's colliding row is dropped. The student_id repoint fires
  -- enforce_skill_progress_tenant (validation only — the grade is unchanged, so
  -- graded_by/graded_at are preserved, not re-stamped to the merging admin).
  WITH moved AS (
    UPDATE student_skill_progress sp
       SET student_id = p_survivor_id
     WHERE sp.student_id = p_duplicate_id
       AND NOT EXISTS (
         SELECT 1 FROM student_skill_progress x
          WHERE x.student_id = p_survivor_id AND x.skill_id = sp.skill_id
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_sp FROM moved;

  WITH dropped AS (
    DELETE FROM student_skill_progress WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_sp FROM dropped;

  v_drop := v_drop_ps + v_drop_tb + v_drop_mb + v_drop_sp;

  -- ── 4. Settlements — no unique constraint, so all of them move ──────────
  WITH moved AS (
    UPDATE student_settlements SET student_id = p_survivor_id
     WHERE student_id = p_duplicate_id
    RETURNING 1
  ) SELECT count(*)::INT INTO v_ss FROM moved;

  -- ── 5. Claims ───────────────────────────────────────────────────────────
  UPDATE student_claims sc
     SET status = 'declined', decided_at = NOW()
   WHERE sc.student_id = p_duplicate_id
     AND sc.status = 'pending'
     AND EXISTS (
       SELECT 1 FROM student_claims x
        WHERE x.student_id = p_survivor_id
          AND x.parent_id = sc.parent_id
          AND x.status = 'pending'
     );

  WITH moved AS (
    UPDATE student_claims SET student_id = p_survivor_id
     WHERE student_id = p_duplicate_id
    RETURNING 1
  ) SELECT count(*)::INT INTO v_cl FROM moved;

  -- ── 6. Enrolments. Safe to delete: the duplicate has no attendance. ─────
  DELETE FROM student_class_enrolments WHERE student_id = p_duplicate_id;

  -- ── 7. The record of what was destroyed, BEFORE destroying it ───────────
  INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  VALUES (
    v_surv.tenant_id, v_actor, 'students_merged', 'Student', p_survivor_id,
    to_jsonb(v_dup),
    jsonb_build_object(
      'survivor_id', p_survivor_id, 'duplicate_id', p_duplicate_id,
      'moved_parent_links', v_ps, 'moved_trial_bookings', v_tb,
      'moved_makeup_bookings', v_mb,
      'moved_settlements', v_ss, 'moved_claims', v_cl,
      'moved_skill_progress', v_sp
    )
  );

  DELETE FROM students WHERE id = p_duplicate_id;

  -- ── 8. THE INVARIANT: a merge MOVES rows, it never destroys them. ───────
  SELECT count(*)::INT INTO v_ps_after FROM parent_students;
  SELECT count(*)::INT INTO v_tb_after FROM trial_bookings;
  SELECT count(*)::INT INTO v_mb_after FROM makeup_bookings;
  SELECT count(*)::INT INTO v_ss_after FROM student_settlements;
  SELECT count(*)::INT INTO v_sp_after FROM student_skill_progress;

  IF v_ss_after <> v_ss_before THEN
    RAISE EXCEPTION
      'merge lost % settlement row(s) — rolling back. A settlement is recorded revenue.',
      v_ss_before - v_ss_after;
  END IF;

  IF v_ps_after + v_tb_after + v_mb_after + v_sp_after
     > v_ps_before + v_tb_before + v_mb_before + v_sp_before THEN
    RAISE EXCEPTION 'merge invented rows — rolling back';
  END IF;

  IF (v_ps_before + v_tb_before + v_mb_before + v_sp_before)
     - (v_ps_after + v_tb_after + v_mb_after + v_sp_after) <> v_drop THEN
    RAISE EXCEPTION
      'merge lost % row(s) beyond the % deliberate collision drop(s) — rolling back',
      (v_ps_before + v_tb_before + v_mb_before + v_sp_before)
        - (v_ps_after + v_tb_after + v_mb_after + v_sp_after) - v_drop, v_drop;
  END IF;

  RETURN QUERY SELECT v_ps, v_tb, v_mb, v_ss, v_cl, v_sp, v_drop;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reassign_student_tenant(p_student_id uuid, p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  UUID := auth.uid();
  v_old    JSONB;
  v_parent UUID;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'only the platform admin may move a student between businesses';
  END IF;

  SELECT to_jsonb(s) INTO v_old FROM students s WHERE s.id = p_student_id;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;

  UPDATE student_class_enrolments
     SET is_active = FALSE, unenrolled_at = app_now()
   WHERE student_id = p_student_id AND is_active;

  -- level_id = NULL alongside the tenant change: tenant A's level ladder is
  -- meaningless at B, and leaving it set makes trg_student_level_tenant refuse
  -- the whole move (see header #1). B's admin re-levels the student.
  UPDATE students
     SET tenant_id = p_tenant_id,
         assignment_status = 'unassigned',
         level_id = NULL,
         updated_at = NOW()
   WHERE id = p_student_id;

  -- Give every linked parent a membership at B so the family can see the child
  -- they now own. Zero parents (an admin-created child) is a clean no-op.
  FOR v_parent IN
    SELECT parent_id FROM parent_students WHERE student_id = p_student_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM parent_tenants
       WHERE parent_id = v_parent AND tenant_id = p_tenant_id
    ) THEN
      -- Membership exists — reactivate it if a previous offboarding left it
      -- inactive, or the pickers and billing grouping (which filter is_active)
      -- would keep the family invisible at B. Does not fire the offboard guard.
      UPDATE parent_tenants
         SET is_active = TRUE, inactivated_at = NULL
       WHERE parent_id = v_parent
         AND tenant_id = p_tenant_id
         AND NOT is_active;
    ELSE
      -- ON CONFLICT DO NOTHING (never DO UPDATE) so two concurrent moves of
      -- siblings sharing a parent cannot race to a unique violation on
      -- (parent_id, tenant_id). §7.57 does not apply — nothing is UPDATEd on
      -- conflict, so there is no upsert-resolved update to govern.
      INSERT INTO parent_tenants (parent_id, tenant_id)
      VALUES (v_parent, p_tenant_id)
      ON CONFLICT (parent_id, tenant_id) DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (v_actor, 'student_tenant_reassigned', 'Student', p_student_id, v_old,
          (SELECT to_jsonb(s) FROM students s WHERE s.id = p_student_id),
          p_tenant_id);
END;
$function$;

