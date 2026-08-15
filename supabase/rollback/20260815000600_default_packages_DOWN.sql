-- ============================================================
-- ROLLBACK for 20260815000600_default_packages.sql (Migration B).
-- Restores the schema to the state just AFTER Migration A.
--
-- Apply this BEFORE the A DOWN when rolling back both. It restores
-- package_renewal_candidates() to its A-version (original-only suggestion,
-- no default lookups) so nothing references the columns being dropped.
-- Rehearsed locally (§7.93).
-- ============================================================

-- ── Restore package_renewal_candidates() to the A-version ────────────────────
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
original AS (
  SELECT DISTINCT ON (pp.parent_id, pp.tenant_id)
         pp.parent_id, pp.tenant_id, pp.product_id
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
  CASE WHEN op.is_active THEN o.product_id ELSE NULL END AS suggested_product_id,
  EXISTS (SELECT 1 FROM parent_packages x
           WHERE x.parent_id = f.parent_id AND x.tenant_id = f.tenant_id
             AND x.status = 'pending' AND x.offered_by IS NOT NULL
             AND x.paid_claimed_at IS NULL AND x.superseded_by IS NULL) AS has_open_offer
FROM fams f
JOIN parents pa   ON pa.id = f.parent_id
JOIN profiles pr  ON pr.id = pa.profile_id
LEFT JOIN original o  ON o.parent_id = f.parent_id AND o.tenant_id = f.tenant_id
LEFT JOIN package_products op ON op.id = o.product_id
$function$;
REVOKE EXECUTE ON FUNCTION package_renewal_candidates() FROM public;
GRANT  EXECUTE ON FUNCTION package_renewal_candidates() TO authenticated, service_role;

-- ── Drop the default guards ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_category_default_product ON class_categories;
DROP FUNCTION IF EXISTS enforce_category_default_product();
DROP TRIGGER IF EXISTS trg_tenant_default_product ON tenants;
DROP FUNCTION IF EXISTS enforce_tenant_default_product();
DROP TRIGGER IF EXISTS trg_clear_defaults_on_product_retire ON package_products;
DROP FUNCTION IF EXISTS clear_defaults_on_product_retire();

-- ── Drop the default columns ─────────────────────────────────────────────────
ALTER TABLE class_categories DROP COLUMN IF EXISTS default_product_id;
ALTER TABLE tenants DROP COLUMN IF EXISTS default_package_product_id;
