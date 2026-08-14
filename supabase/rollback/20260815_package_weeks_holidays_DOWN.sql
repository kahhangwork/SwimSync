-- ============================================================
-- ROLLBACK for the weeks / start-date / holiday-extension feature
-- (migrations 20260814000400 … 20260815000400). Reverses the batch in the
-- correct dependency order. Rehearse locally, then keep committed as cover.
--
-- SAFE on production because it holds ZERO packages, holidays, and extension
-- events at deploy time (§3): every DROP below removes an empty structure and
-- every restored function reverts to its prior, still-correct body. If any of
-- those tables is non-empty when you run this, STOP — a package's start_date /
-- validity_weeks would be lost and its expiry would revert to the months-based
-- computation. Export the data first.
-- ============================================================

-- ── 1. 20260815000400 — restore student_package_coverage without the
--       start_date gate (its pre-change body). ─────────────────────────────
CREATE OR REPLACE FUNCTION student_package_coverage()
RETURNS TABLE (student_id uuid, parent_id uuid, tenant_id uuid,
               coverage text, lessons_remaining integer)
LANGUAGE sql STABLE SET search_path = public
AS $$
WITH live AS (
  SELECT lv.parent_id, lv.tenant_id, lv.category_id, lv.live_lessons_remaining
  FROM package_live_balances() lv
  WHERE lv.expires_on >= (now() AT TIME ZONE 'Asia/Singapore')::date
),
links AS (
  SELECT ps.student_id, ps.parent_id, s.tenant_id
  FROM parent_students ps JOIN students s ON s.id = ps.student_id
),
cats AS (
  SELECT DISTINCT sce.student_id, c.category_id
  FROM student_class_enrolments sce JOIN classes c ON c.id = sce.class_id
  WHERE sce.is_active
),
verdict AS (
  SELECT l.student_id, l.parent_id, l.tenant_id,
    (SELECT count(*) FROM cats ct WHERE ct.student_id = l.student_id) AS n_cats,
    (SELECT count(*) FROM cats ct WHERE ct.student_id = l.student_id
        AND EXISTS (SELECT 1 FROM live lv WHERE lv.parent_id = l.parent_id
            AND lv.tenant_id = l.tenant_id
            AND (lv.category_id IS NULL OR lv.category_id = ct.category_id))) AS n_covered,
    EXISTS (SELECT 1 FROM live lv WHERE lv.parent_id = l.parent_id AND lv.tenant_id = l.tenant_id) AS has_any
  FROM links l
)
SELECT v.student_id, v.parent_id, v.tenant_id,
  CASE WHEN v.n_cats = 0 THEN CASE WHEN v.has_any THEN 'package' ELSE 'ad_hoc' END
       WHEN v.n_covered = 0 THEN 'ad_hoc'
       WHEN v.n_covered = v.n_cats THEN 'package' ELSE 'mixed' END AS coverage,
  CASE WHEN (v.n_cats = 0 AND v.has_any) OR v.n_covered > 0 THEN
      (SELECT sum(lv.live_lessons_remaining)::integer FROM live lv
       WHERE lv.parent_id = v.parent_id AND lv.tenant_id = v.tenant_id
         AND (v.n_cats = 0 OR lv.category_id IS NULL
              OR lv.category_id IN (SELECT ct.category_id FROM cats ct WHERE ct.student_id = v.student_id)))
    ELSE NULL END AS lessons_remaining
FROM verdict v
$$;

-- ── 2. 20260815000300 — the manual-extend RPC. ─────────────────────────────
DROP FUNCTION IF EXISTS extend_package(uuid, integer, text);

-- ── 3. 20260815000200 — the holiday recompute, ack RPCs, audit table. ──────
DROP FUNCTION IF EXISTS acknowledge_all_extensions(uuid);
DROP FUNCTION IF EXISTS acknowledge_package_extension(uuid, text);
DROP FUNCTION IF EXISTS recompute_package_extensions(uuid, uuid);
DROP TABLE IF EXISTS package_extension_events;

-- ── 4. 20260815000100 — the holiday calendar. ──────────────────────────────
DROP TABLE IF EXISTS tenant_public_holidays;

-- ── 5. 20260814000500 — the start-date suggestion. ─────────────────────────
DROP FUNCTION IF EXISTS suggest_package_start(uuid, uuid);

-- ── 6. 20260814000400 — restore the months-based world. ────────────────────
-- 6a. package_live_balances back to the make-up-aware, confirmed_at-anchored
--     body (20260802000400).
CREATE OR REPLACE FUNCTION package_live_balances()
RETURNS TABLE(parent_package_id uuid, parent_id uuid, tenant_id uuid, name text,
              category_id uuid, rate_per_lesson numeric, lesson_count integer,
              total_value numeric, expires_on date, value_remaining numeric,
              live_value_remaining numeric, live_lessons_remaining integer)
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  pkg_ids UUID[]:='{}'; pkg_parents UUID[]:='{}'; pkg_tenants UUID[]:='{}';
  pkg_cats UUID[]:='{}'; pkg_rates NUMERIC[]:='{}'; pkg_starts DATE[]:='{}';
  pkg_ends DATE[]:='{}'; pkg_remaining NUMERIC[]:='{}'; r RECORD; les RECORD; i INTEGER;
BEGIN
  FOR r IN
    SELECT pp.id, pp.parent_id AS p_id, pp.tenant_id AS t_id, pp.category_id AS c_id,
           pp.rate_per_lesson AS rate, pp.expires_on AS ends, pp.value_remaining AS rem,
           (pp.confirmed_at AT TIME ZONE 'Asia/Singapore')::date AS starts
    FROM parent_packages pp WHERE pp.status = 'active'
    ORDER BY pp.expires_on, pp.confirmed_at, pp.id
  LOOP
    pkg_ids:=pkg_ids||r.id; pkg_parents:=pkg_parents||r.p_id; pkg_tenants:=pkg_tenants||r.t_id;
    pkg_cats:=pkg_cats||r.c_id; pkg_rates:=pkg_rates||r.rate; pkg_starts:=pkg_starts||r.starts;
    pkg_ends:=pkg_ends||r.ends; pkg_remaining:=pkg_remaining||r.rem;
  END LOOP;
  FOR les IN
    SELECT ps.parent_id AS p_id, c.tenant_id AS t_id,
           COALESCE(mb.category_id, c.category_id) AS c_id, ls.session_date AS d
    FROM attendance a
    JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
    JOIN classes c ON c.id = ls.class_id
    JOIN parent_students ps ON ps.student_id = a.student_id
    LEFT JOIN makeup_bookings mb ON mb.student_id = a.student_id AND mb.class_id = ls.class_id
      AND mb.session_date = ls.session_date AND mb.cancelled_at IS NULL
    WHERE a.status IN ('present','trial_paid')
      AND NOT EXISTS (SELECT 1 FROM invoice_items ii
        WHERE ii.lesson_session_id = a.lesson_session_id AND ii.student_id = a.student_id)
    ORDER BY ls.session_date, a.student_id
  LOOP
    FOR i IN 1 .. coalesce(array_length(pkg_ids,1),0) LOOP
      IF pkg_parents[i]=les.p_id AND pkg_tenants[i]=les.t_id
         AND (pkg_cats[i] IS NULL OR pkg_cats[i]=les.c_id)
         AND les.d>=pkg_starts[i] AND les.d<=pkg_ends[i] AND pkg_remaining[i]>=pkg_rates[i]
      THEN pkg_remaining[i]:=pkg_remaining[i]-pkg_rates[i]; EXIT; END IF;
    END LOOP;
  END LOOP;
  FOR i IN 1 .. coalesce(array_length(pkg_ids,1),0) LOOP
    RETURN QUERY SELECT pp.id, pp.parent_id, pp.tenant_id, pp.name, pp.category_id,
      pp.rate_per_lesson, pp.lesson_count, pp.total_value, pp.expires_on, pp.value_remaining,
      pkg_remaining[i], floor(pkg_remaining[i]/pp.rate_per_lesson)::integer
      FROM parent_packages pp WHERE pp.id = pkg_ids[i];
  END LOOP;
END; $$;

-- 6b. lifecycle trigger back to the months body (20260720000100). Drops all
--     references to the new columns before they are dropped.
CREATE OR REPLACE FUNCTION enforce_parent_package_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE v_product package_products%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_product FROM package_products WHERE id = NEW.product_id;
    IF v_product.id IS NULL THEN RAISE EXCEPTION 'Unknown package product.' USING ERRCODE='check_violation'; END IF;
    IF NOT v_product.is_active THEN RAISE EXCEPTION 'That package is no longer offered.' USING ERRCODE='check_violation'; END IF;
    NEW.tenant_id:=v_product.tenant_id; NEW.name:=v_product.name; NEW.category_id:=v_product.category_id;
    NEW.lesson_count:=v_product.lesson_count; NEW.rate_per_lesson:=v_product.rate_per_lesson;
    NEW.validity_months:=v_product.validity_months; NEW.total_value:=v_product.lesson_count*v_product.rate_per_lesson;
    NEW.value_remaining:=NEW.total_value; NEW.cancelled_at:=NULL;
    IF current_user='authenticated' AND NOT can_admin_tenant(NEW.tenant_id) THEN
      NEW.status:='pending'; NEW.confirmed_at:=NULL; NEW.confirmed_by:=NULL; NEW.expires_on:=NULL;
    ELSIF NEW.status='active' THEN
      NEW.confirmed_at:=COALESCE(NEW.confirmed_at,NOW()); NEW.confirmed_by:=COALESCE(NEW.confirmed_by,auth.uid());
      NEW.expires_on:=((NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date + make_interval(months=>NEW.validity_months))::date;
    ELSE NEW.status:='pending'; NEW.confirmed_at:=NULL; NEW.confirmed_by:=NULL; NEW.expires_on:=NULL; END IF;
    RETURN NEW;
  END IF;
  IF NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.lesson_count IS DISTINCT FROM OLD.lesson_count
     OR NEW.rate_per_lesson IS DISTINCT FROM OLD.rate_per_lesson OR NEW.total_value IS DISTINCT FROM OLD.total_value
     OR NEW.validity_months IS DISTINCT FROM OLD.validity_months OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
  THEN RAISE EXCEPTION 'A package''s terms are a record of the sale and cannot be edited.' USING ERRCODE='check_violation'; END IF;
  IF NEW.value_remaining IS DISTINCT FROM OLD.value_remaining AND current_user='authenticated'
  THEN RAISE EXCEPTION 'A package balance is moved by billing, never edited directly.' USING ERRCODE='check_violation'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status='pending' AND NEW.status='active' THEN
      IF current_user='authenticated' AND NOT can_admin_tenant(OLD.tenant_id) THEN
        RAISE EXCEPTION 'Only the business can confirm a package purchase.' USING ERRCODE='check_violation'; END IF;
      NEW.confirmed_at:=COALESCE(NULLIF(NEW.confirmed_at,OLD.confirmed_at),NOW()); NEW.confirmed_by:=COALESCE(NEW.confirmed_by,auth.uid());
      NEW.expires_on:=((NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date + make_interval(months=>NEW.validity_months))::date;
    ELSIF OLD.status='pending' AND NEW.status='cancelled' THEN NEW.cancelled_at:=COALESCE(NEW.cancelled_at,NOW());
    ELSIF OLD.status='active' AND NEW.status='cancelled' THEN
      IF current_user='authenticated' AND NOT can_admin_tenant(OLD.tenant_id) THEN
        RAISE EXCEPTION 'Only the business can cancel an active package.' USING ERRCODE='check_violation'; END IF;
      NEW.cancelled_at:=COALESCE(NEW.cancelled_at,NOW());
    ELSE RAISE EXCEPTION 'Illegal package status change (% -> %).', OLD.status, NEW.status USING ERRCODE='check_violation'; END IF;
  ELSE
    IF current_user='authenticated' AND (NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
        OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.expires_on IS DISTINCT FROM OLD.expires_on
        OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at)
    THEN RAISE EXCEPTION 'Confirmation fields are set by the status transition, not edited.' USING ERRCODE='check_violation'; END IF;
  END IF;
  RETURN NEW;
END; $$;

-- 6c. pin_package_product_terms back without validity_weeks.
CREATE OR REPLACE FUNCTION pin_package_product_terms()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lesson_count IS DISTINCT FROM OLD.lesson_count OR NEW.rate_per_lesson IS DISTINCT FROM OLD.rate_per_lesson
     OR NEW.validity_months IS DISTINCT FROM OLD.validity_months OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
  THEN RAISE EXCEPTION 'A package product''s terms cannot be edited. Retire it (is_active = false) and create a new one.' USING ERRCODE='check_violation'; END IF;
  RETURN NEW;
END; $$;

-- 6d. restore the pre-change active-row CHECK (no start_date requirement).
ALTER TABLE parent_packages DROP CONSTRAINT parent_packages_check1;
ALTER TABLE parent_packages ADD CONSTRAINT parent_packages_check1
  CHECK (status <> 'active' OR (confirmed_at IS NOT NULL AND expires_on IS NOT NULL));

-- 6e. drop the new columns and helpers.
DROP TRIGGER IF EXISTS trg_derive_package_product_validity ON package_products;
DROP FUNCTION IF EXISTS derive_package_product_validity();
DROP FUNCTION IF EXISTS package_effective_end(date, integer, integer, integer);
ALTER TABLE parent_packages
  DROP COLUMN IF EXISTS start_date,
  DROP COLUMN IF EXISTS validity_weeks,
  DROP COLUMN IF EXISTS ph_extension_weeks,
  DROP COLUMN IF EXISTS manual_extension_days,
  DROP COLUMN IF EXISTS ph_ack_weeks_parent,
  DROP COLUMN IF EXISTS ph_ack_weeks_admin;
ALTER TABLE package_products
  DROP CONSTRAINT IF EXISTS package_products_validity_weeks_check,
  DROP COLUMN IF EXISTS validity_weeks;
