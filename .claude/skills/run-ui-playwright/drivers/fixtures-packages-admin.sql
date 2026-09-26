-- Fixture for verify-packages-admin.mjs — the ten Packages admin actions no
-- other driver presses (BACKLOG → Foundations; docs/plans/DRIVER_BACKLOG_PLAN.md U5).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-packages-admin.sql
--
-- ITS OWN BUSINESS ("PkgAdm Swim", prefix c8000000-). Categories, their
-- Default / Max, the products and the all-classes default are TENANT-level:
-- editing the seed tenant's would move what verify-packages / verify-package-
-- renewal read (plan rule 12). Nothing here is shared with fixtures-packages.sql
-- (whose Pablo Package child id collides with makeup_bookings.test.sql, §7.272).
--
-- The shapes, each for one check:
--   PkgAdm Owner          tenant admin (owner), NOT a coach — the login.
--   PkgAdm Group          category; the Default / Max target.
--   PkgAdm Private        category; carries the Retiree product.
--   PkgAdm 10 Group       product, Group, 10 x S$30, 12 weeks — held by Alder,
--                         sold to Cedar by the driver.
--   PkgAdm 5 Any          product, all classes, 5 x S$40, 6 weeks.
--   PkgAdm Retiree        product, Private, 4 x S$50, 8 weeks — Retire/Reoffer.
--   PkgAdm Parent Alder   holds an ACTIVE PkgAdm 10 Group (started 14 days ago,
--                         SGT) — Extend, then Cancel.
--   PkgAdm Parent Birch   an admin OFFER (pending, offered_by set) that her own
--                         later PENDING request SUPERSEDED (the real trigger,
--                         supersede_open_package_offer, does the cancelling) —
--                         the pending row is Declined; the offer is what
--                         "Show superseded" reveals.
--   PkgAdm Parent Cedar   holds nothing — the Record-a-sale target.
--
-- IDEMPOTENT AND RESETTING: re-loading deletes every package in the business
-- and re-inserts the three above (a cancelled package cannot be un-cancelled —
-- the lifecycle trigger refuses — so a reset is a delete + insert), resets the
-- reference counter, drops what the driver added (a category, a product),
-- re-activates every product and clears every Default / Max.
-- Teardown: fixtures-packages-admin-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

-- ── The business and its people ─────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('c8000000-0000-0000-0000-000000000001','packages-admin','PkgAdm Swim','SWIM-PKAD')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
 ('00000000-0000-0000-0000-000000000000','c8000000-0000-0000-0000-0000000000a1',
  'authenticated','authenticated','packages-admin-owner@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"PkgAdm Owner","role":"tenant_admin","is_coach":false,"tenant_id":"c8000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','c8000000-0000-0000-0000-0000000000f1',
  'authenticated','authenticated','packages-admin-alder@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"PkgAdm Parent Alder","role":"parent"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','c8000000-0000-0000-0000-0000000000f2',
  'authenticated','authenticated','packages-admin-birch@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"PkgAdm Parent Birch","role":"parent"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','c8000000-0000-0000-0000-0000000000f3',
  'authenticated','authenticated','packages-admin-cedar@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"PkgAdm Parent Cedar","role":"parent"}',
  now(), now(), '','','','')
ON CONFLICT (id) DO NOTHING;

-- ── Reset the driver's side effects FIRST ───────────────────────────────────
-- Every package (fixture + a recorded sale); extension events cascade.
DELETE FROM parent_packages  WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';
DELETE FROM audit_log        WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';

UPDATE tenants
   SET owner_profile_id = 'c8000000-0000-0000-0000-0000000000a1',
       package_counter = 0,
       default_package_product_id = NULL,
       referral_enabled = FALSE
 WHERE id = 'c8000000-0000-0000-0000-000000000001';

-- ── Catalogue: two categories, three products ───────────────────────────────
INSERT INTO class_categories (id, tenant_id, name)
VALUES ('c8000000-0000-0000-0000-00000000cc01','c8000000-0000-0000-0000-000000000001','PkgAdm Group'),
       ('c8000000-0000-0000-0000-00000000cc02','c8000000-0000-0000-0000-000000000001','PkgAdm Private')
ON CONFLICT (id) DO NOTHING;
UPDATE class_categories SET default_product_id = NULL, default_capacity = NULL
 WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';

INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count,
                              rate_per_lesson, validity_weeks)
VALUES ('c8000000-0000-0000-0000-0000000002a1','c8000000-0000-0000-0000-000000000001',
        'PkgAdm 10 Group','c8000000-0000-0000-0000-00000000cc01',10,30.00,12),
       ('c8000000-0000-0000-0000-0000000002a2','c8000000-0000-0000-0000-000000000001',
        'PkgAdm 5 Any',NULL,5,40.00,6),
       ('c8000000-0000-0000-0000-0000000002a3','c8000000-0000-0000-0000-000000000001',
        'PkgAdm Retiree','c8000000-0000-0000-0000-00000000cc02',4,50.00,8)
ON CONFLICT (id) DO UPDATE SET is_active = TRUE;

-- What the driver ADDED (a product, a category) — after the packages are gone.
DELETE FROM package_products WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001'
  AND id NOT IN ('c8000000-0000-0000-0000-0000000002a1','c8000000-0000-0000-0000-0000000002a2',
                 'c8000000-0000-0000-0000-0000000002a3');
DELETE FROM class_categories WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001'
  AND id NOT IN ('c8000000-0000-0000-0000-00000000cc01','c8000000-0000-0000-0000-00000000cc02');

-- ── Families (keyed on the random parents.id) and their packages ────────────
DO $$
DECLARE
  t     CONSTANT uuid := 'c8000000-0000-0000-0000-000000000001';
  v_a   uuid;
  v_b   uuid;
  v_c   uuid;
  v_sg  date := (now() AT TIME ZONE 'Asia/Singapore')::date;
BEGIN
  SELECT id INTO v_a FROM parents WHERE profile_id = 'c8000000-0000-0000-0000-0000000000f1';
  SELECT id INTO v_b FROM parents WHERE profile_id = 'c8000000-0000-0000-0000-0000000000f2';
  SELECT id INTO v_c FROM parents WHERE profile_id = 'c8000000-0000-0000-0000-0000000000f3';

  INSERT INTO parent_tenants (parent_id, tenant_id)
  VALUES (v_a, t), (v_b, t), (v_c, t)
  ON CONFLICT (parent_id, tenant_id) DO UPDATE SET is_active = TRUE;

  -- One child each. NOT decoration: the admin can read a parent's name only
  -- through a child at the business (tenant_serves_parent), so a childless
  -- family reads "Unknown" on the Awaiting panel and has no name in the sale's
  -- Parent select.
  INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active)
  VALUES ('c8000000-0000-0000-0000-0000000000d1','PkgAdm Kid Alder', t, 'assigned', TRUE),
         ('c8000000-0000-0000-0000-0000000000d2','PkgAdm Kid Birch', t, 'assigned', TRUE),
         ('c8000000-0000-0000-0000-0000000000d3','PkgAdm Kid Cedar', t, 'assigned', TRUE)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO parent_students (parent_id, student_id)
  SELECT v.p, v.s FROM (VALUES (v_a, 'c8000000-0000-0000-0000-0000000000d1'::uuid),
                               (v_b, 'c8000000-0000-0000-0000-0000000000d2'::uuid),
                               (v_c, 'c8000000-0000-0000-0000-0000000000d3'::uuid)) AS v(p, s)
   WHERE NOT EXISTS (SELECT 1 FROM parent_students ps
                      WHERE ps.parent_id = v.p AND ps.student_id = v.s);

  -- 1. Alder's ACTIVE package, started 14 days ago (SGT). The lifecycle
  --    trigger snapshots the terms and dates expires_on = start + 84.
  INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status,
                               requested_at, confirmed_at, start_date)
  VALUES ('c8000000-0000-0000-0000-0000000003a1', t, v_a,
          'c8000000-0000-0000-0000-0000000002a1', 'active',
          now() - interval '20 days', now() - interval '14 days', v_sg - 14);

  -- 2. Birch's admin OFFER (pending, offered_by set, unclaimed)…
  INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status,
                               requested_at, offered_by, offered_at, start_date)
  VALUES ('c8000000-0000-0000-0000-0000000003a2', t, v_b,
          'c8000000-0000-0000-0000-0000000002a2', 'pending',
          now() - interval '3 days', 'c8000000-0000-0000-0000-0000000000a1',
          now() - interval '3 days', v_sg);

  -- 3. …then her OWN pending request, whose AFTER INSERT trigger
  --    (supersede_open_package_offer) cancels the offer with superseded_by = 3.
  INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, requested_at)
  VALUES ('c8000000-0000-0000-0000-0000000003a3', t, v_b,
          'c8000000-0000-0000-0000-0000000002a1', 'pending', now() - interval '1 day');
END $$;

-- ── Postconditions — fail at load time, not twenty checks later ────────────
DO $$
DECLARE v_pk text; v_prod text; v_cat text; v_pt int;
BEGIN
  SELECT string_agg(right(id::text, 3) || ':' || status || ':' ||
                    coalesce(right(superseded_by::text, 3), '-'), ',' ORDER BY id) INTO v_pk
    FROM parent_packages WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';
  SELECT string_agg(name || ':' || is_active, ',' ORDER BY name) INTO v_prod
    FROM package_products WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';
  SELECT string_agg(name || ':' || coalesce(default_product_id::text, '-') || ':' ||
                    coalesce(default_capacity::text, '-'), ',' ORDER BY name) INTO v_cat
    FROM class_categories WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001';
  SELECT count(*) INTO v_pt FROM parent_tenants
   WHERE tenant_id = 'c8000000-0000-0000-0000-000000000001' AND is_active;
  IF v_pk IS DISTINCT FROM '3a1:active:-,3a2:cancelled:3a3,3a3:pending:-'
     OR v_prod IS DISTINCT FROM 'PkgAdm 10 Group:true,PkgAdm 5 Any:true,PkgAdm Retiree:true'
     OR v_cat IS DISTINCT FROM 'PkgAdm Group:-:-,PkgAdm Private:-:-'
     OR v_pt <> 3 THEN
    RAISE EXCEPTION 'fixture: packages % / products % / categories % / members %',
      v_pk, v_prod, v_cat, v_pt;
  END IF;
END $$;

COMMIT;
