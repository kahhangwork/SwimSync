-- ============================================================
-- Package renewal automation — Migration B: DEFAULT packages (Phase 2).
-- Plan: docs/plans/PACKAGE_RENEWAL_AUTOMATION_PLAN.md.
--
-- A renewal offer pre-selects a product (Decision 5): the family's active
-- original → the CATEGORY default → the ALL-CLASSES default → nothing. This
-- migration adds the two default slots, guards them (same tenant; a category
-- default must fit the category or be all-classes; retiring a product clears
-- any default pointing at it), and teaches package_renewal_candidates() to use
-- them (Migration A shipped it original-only).
-- ============================================================

ALTER TABLE class_categories
  ADD COLUMN default_product_id UUID
    REFERENCES package_products(id) ON DELETE SET NULL;
ALTER TABLE tenants
  ADD COLUMN default_package_product_id UUID
    REFERENCES package_products(id) ON DELETE SET NULL;

COMMENT ON COLUMN class_categories.default_product_id IS
  'The package to pre-select for a renewal in this category (Decision 5). Must '
  'be an active product of the same tenant, scoped to this category or all-classes.';
COMMENT ON COLUMN tenants.default_package_product_id IS
  'The all-classes fallback package for a renewal offer when neither the '
  'family''s original nor a category default applies.';

-- ── Guard the category default ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_category_default_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $$
DECLARE
  v_product package_products%ROWTYPE;
BEGIN
  IF NEW.default_product_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.default_product_id IS NOT DISTINCT FROM OLD.default_product_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_product FROM package_products WHERE id = NEW.default_product_id;
  IF v_product.id IS NULL OR v_product.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'A category default must be a package of this business.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_product.is_active THEN
    RAISE EXCEPTION 'A retired package cannot be a default.'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The package must fit this category, or be all-classes (NULL category).
  IF v_product.category_id IS NOT NULL AND v_product.category_id <> NEW.id THEN
    RAISE EXCEPTION 'That package belongs to a different category.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_category_default_product
  BEFORE INSERT OR UPDATE ON class_categories
  FOR EACH ROW EXECUTE FUNCTION enforce_category_default_product();

-- ── Guard the all-classes (tenant) default ──────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_tenant_default_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $$
DECLARE
  v_product package_products%ROWTYPE;
BEGIN
  IF NEW.default_package_product_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.default_package_product_id
         IS NOT DISTINCT FROM OLD.default_package_product_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_product
    FROM package_products WHERE id = NEW.default_package_product_id;
  IF v_product.id IS NULL OR v_product.tenant_id <> NEW.id THEN
    RAISE EXCEPTION 'The default package must belong to this business.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_product.is_active THEN
    RAISE EXCEPTION 'A retired package cannot be a default.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenant_default_product
  BEFORE INSERT OR UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_default_product();

-- ── Retiring a product clears any default pointing at it ────────────────────
-- The FK is ON DELETE SET NULL, but retiring is an is_active flip, not a delete;
-- this trigger is the is_active half. Already-open offers stay valid — their
-- terms are snapshotted on the row, not read from the product.
CREATE OR REPLACE FUNCTION clear_defaults_on_product_retire()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $$
BEGIN
  IF OLD.is_active AND NOT NEW.is_active THEN
    UPDATE class_categories SET default_product_id = NULL
      WHERE default_product_id = NEW.id;
    UPDATE tenants SET default_package_product_id = NULL
      WHERE default_package_product_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clear_defaults_on_product_retire
  AFTER UPDATE ON package_products
  FOR EACH ROW EXECUTE FUNCTION clear_defaults_on_product_retire();

-- ── package_renewal_candidates() learns the defaults (Decision 5) ───────────
-- suggested_product_id = active original → the original's CATEGORY default →
-- the all-classes default → NULL. Defaults are always active (the retire
-- trigger clears them), so no is_active re-check is needed on the default path.
CREATE OR REPLACE FUNCTION public.package_renewal_candidates()
 RETURNS TABLE(parent_id uuid, tenant_id uuid, parent_name text, parent_phone text,
               children text, package_name text, lessons_left integer, expires_on date,
               expired_days_ago integer,
               original_product_id uuid, suggested_product_id uuid, has_open_offer boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS d),
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

-- Grants unchanged from Migration A (CREATE OR REPLACE keeps the ACL), but
-- re-assert defensively (§7.82).
REVOKE EXECUTE ON FUNCTION package_renewal_candidates() FROM public;
GRANT  EXECUTE ON FUNCTION package_renewal_candidates() TO authenticated, service_role;
