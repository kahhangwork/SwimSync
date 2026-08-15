-- ============================================================
-- ROLLBACK for 20260815000500_package_offers.sql (Migration A).
-- Restores the schema to the state just AFTER 20260815000400.
--
-- Run order if rolling back BOTH: apply the B DOWN first, then this.
-- Rehearsed locally (§7.93) before the 2026-08-15 packages deploy.
--
-- Strategy: restore every REPLACED function to its pre-A body FIRST (so none
-- references a column about to be dropped), drop the NEW objects, then drop the
-- new columns.
-- ============================================================

-- ── Restore the reference trigger (drop the public_token mint) ───────────────
CREATE OR REPLACE FUNCTION public.assign_parent_package_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION
      'package reference cannot be minted before tenant_id is set — trigger order broken (expected trg_parent_package_reference to fire AFTER trg_parent_package_lifecycle)'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.reference_number := next_package_ref(
    NEW.tenant_id,
    to_char(NEW.requested_at AT TIME ZONE 'Asia/Singapore', 'YYYY')
  );
  RETURN NEW;
END;
$function$;

-- ── Restore the pin trigger (drop the public_token clause) ───────────────────
CREATE OR REPLACE FUNCTION public.pin_parent_package_reference()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.reference_number IS DISTINCT FROM OLD.reference_number
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'parent_packages.reference_number is not client-writable — it identifies this package payment to the bank.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Restore the lifecycle trigger (drop the offer pins) ──────────────────────
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
    NEW.ph_extension_weeks    := 0;
    NEW.manual_extension_days := 0;
    NEW.ph_ack_weeks_parent   := 0;
    NEW.ph_ack_weeks_admin    := 0;

    IF current_user = 'authenticated' AND NOT can_admin_tenant(NEW.tenant_id) THEN
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.start_date   := NULL;
      NEW.expires_on   := NULL;
    ELSIF NEW.status = 'active' THEN
      NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.start_date   := COALESCE(NEW.start_date,
                                   (NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date);
      NEW.expires_on   := package_effective_end(NEW.start_date, NEW.validity_weeks,
                                                 NEW.ph_extension_weeks, NEW.manual_extension_days);
    ELSE
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.expires_on   := NULL;
    END IF;

    RETURN NEW;
  END IF;

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
     AND (NEW.ph_extension_weeks    IS DISTINCT FROM OLD.ph_extension_weeks
          OR NEW.manual_extension_days IS DISTINCT FROM OLD.manual_extension_days
          OR NEW.ph_ack_weeks_parent   IS DISTINCT FROM OLD.ph_ack_weeks_parent
          OR NEW.ph_ack_weeks_admin    IS DISTINCT FROM OLD.ph_ack_weeks_admin)
  THEN
    RAISE EXCEPTION 'Package extension and acknowledgement fields are set by the system, not edited directly.'
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
                                                 NEW.ph_extension_weeks, NEW.manual_extension_days);
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

-- ── Restore student_package_coverage() to its pre-A signature ────────────────
DROP FUNCTION IF EXISTS student_package_coverage();
CREATE FUNCTION public.student_package_coverage()
 RETURNS TABLE(student_id uuid, parent_id uuid, tenant_id uuid, coverage text,
               lessons_remaining integer)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
WITH live AS (
  SELECT lv.parent_id, lv.tenant_id, lv.category_id, lv.live_lessons_remaining
  FROM package_live_balances() lv
  JOIN parent_packages pp ON pp.id = lv.parent_package_id
  WHERE lv.expires_on >= (now() AT TIME ZONE 'Asia/Singapore')::date
    AND pp.start_date <= (now() AT TIME ZONE 'Asia/Singapore')::date
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
)
SELECT
  v.student_id, v.parent_id, v.tenant_id,
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
  END AS lessons_remaining
FROM verdict v
$function$;
REVOKE ALL     ON FUNCTION student_package_coverage() FROM public;
REVOKE EXECUTE ON FUNCTION student_package_coverage() FROM anon;
GRANT  EXECUTE ON FUNCTION student_package_coverage() TO authenticated, service_role;

-- ── Drop the NEW objects ─────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_supersede_open_package_offer ON parent_packages;
DROP FUNCTION IF EXISTS supersede_open_package_offer();
DROP FUNCTION IF EXISTS create_package_offer(uuid, uuid, date);
DROP FUNCTION IF EXISTS package_renewal_candidates();

-- ── Drop the new columns ─────────────────────────────────────────────────────
ALTER TABLE tenants DROP COLUMN IF EXISTS package_expiry_warning_days;
ALTER TABLE parent_packages
  DROP COLUMN IF EXISTS offered_by,
  DROP COLUMN IF EXISTS offered_at,
  DROP COLUMN IF EXISTS public_token,
  DROP COLUMN IF EXISTS paid_claimed_at,
  DROP COLUMN IF EXISTS superseded_by;
