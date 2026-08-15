-- pgTAP: the category / all-classes DEFAULT package slots (Migration B).
-- Plan: docs/plans/PACKAGE_RENEWAL_AUTOMATION_PLAN.md, Phase 2.
-- The guards fire in triggers regardless of role, so this runs as owner.
-- Self-contained; rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('d1000000-0000-0000-0000-000000000001','dp-a','Default Swim A','SWIM-DPA'),
  ('d1000000-0000-0000-0000-000000000002','dp-b','Default Swim B','SWIM-DPB');

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('d1c00000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','DP Group'),
  ('d1c00000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001','DP Private');

INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count,
                              rate_per_lesson, validity_months, validity_weeks, is_active) VALUES
  -- Group-scoped, tenant A
  ('d1e00000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001',
   'DP Group Pkg', 'd1c00000-0000-0000-0000-000000000001', 8, 40, 12, 4, true),
  -- All-classes, tenant A
  ('d1e00000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001',
   'DP Any Pkg', NULL, 8, 40, 12, 4, true),
  -- Private-scoped, tenant A
  ('d1e00000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000001',
   'DP Private Pkg', 'd1c00000-0000-0000-0000-000000000002', 8, 40, 12, 4, true),
  -- Retired, tenant A
  ('d1e00000-0000-0000-0000-000000000004','d1000000-0000-0000-0000-000000000001',
   'DP Retired', 'd1c00000-0000-0000-0000-000000000001', 8, 40, 12, 4, false),
  -- Tenant B product
  ('d1e00000-0000-0000-0000-000000000005','d1000000-0000-0000-0000-000000000002',
   'DP B Pkg', NULL, 8, 40, 12, 4, true);

-- ── Category default ────────────────────────────────────────────────────────
SELECT lives_ok($$UPDATE class_categories SET default_product_id='d1e00000-0000-0000-0000-000000000002'
  WHERE id='d1c00000-0000-0000-0000-000000000001'$$,
  'category default accepts an ALL-CLASSES product');
SELECT lives_ok($$UPDATE class_categories SET default_product_id='d1e00000-0000-0000-0000-000000000001'
  WHERE id='d1c00000-0000-0000-0000-000000000001'$$,
  'category default accepts a SAME-category product');
SELECT throws_ok($$UPDATE class_categories SET default_product_id='d1e00000-0000-0000-0000-000000000003'
  WHERE id='d1c00000-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'category default REJECTS a different-category product');
SELECT throws_ok($$UPDATE class_categories SET default_product_id='d1e00000-0000-0000-0000-000000000005'
  WHERE id='d1c00000-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'category default REJECTS another business''s product');
SELECT throws_ok($$UPDATE class_categories SET default_product_id='d1e00000-0000-0000-0000-000000000004'
  WHERE id='d1c00000-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'category default REJECTS a retired product');

-- ── Tenant (all-classes) default ────────────────────────────────────────────
SELECT lives_ok($$UPDATE tenants SET default_package_product_id='d1e00000-0000-0000-0000-000000000002'
  WHERE id='d1000000-0000-0000-0000-000000000001'$$,
  'tenant default accepts a product of this business');
SELECT throws_ok($$UPDATE tenants SET default_package_product_id='d1e00000-0000-0000-0000-000000000005'
  WHERE id='d1000000-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'tenant default REJECTS another business''s product');

-- ── Retiring a product clears any default pointing at it ────────────────────
-- Group category currently defaults to the Group product; retire it.
UPDATE package_products SET is_active = false
  WHERE id = 'd1e00000-0000-0000-0000-000000000001';
SELECT is(
  (SELECT default_product_id FROM class_categories
    WHERE id='d1c00000-0000-0000-0000-000000000001'),
  NULL,
  'retiring a product clears the CATEGORY default pointing at it');

-- Tenant defaults to the Any product; retire it.
UPDATE package_products SET is_active = false
  WHERE id = 'd1e00000-0000-0000-0000-000000000002';
SELECT is(
  (SELECT default_package_product_id FROM tenants
    WHERE id='d1000000-0000-0000-0000-000000000001'),
  NULL,
  'retiring a product clears the ALL-CLASSES default pointing at it');

SELECT * FROM finish();
ROLLBACK;
