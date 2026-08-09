-- Verification scenario for the PayNow fallback chain (verify-paynow-fallback.mjs).
--
-- WHY THIS EXISTS. Wave 1 Chunk 2 made the computed dynamic QR the primary way
-- a parent pays and demoted the uploaded static image to a collapsed fallback.
-- The failure that mitigation guards against is a business with NO way to be
-- paid: a PayNow ID that is stored but cannot be encoded (sgPhone normalises by
-- stripping non-digits and never blocks, so a nine-digit typo saves fine),
-- buildPayNowPayload throws, and if the upload had been REMOVED rather than
-- collapsed there is no image either. Nothing in either test suite and none of
-- the other 38 drivers touches app/(coach)/settings, so without this the step
-- ships blind.
--
-- Shape: one parent in the seed tenant with a PENDING package request — which
-- carries a PKG-YYYY-NNNN reference (20260809000100) and is therefore reachable
-- on the parent's PayNow screen — plus one PLAIN coach, who must NOT see the
-- admin-panel link.
--
-- OWNS ONLY ITS OWN ROWS. Every id is pinned and prefixed; no LIMIT 1 over a
-- table it does not own (§7.73), no positional selection (§7.101), and it
-- writes no lesson_sessions (the §8.36 collision). The tenant's own
-- paynow_uen / paynow_mobile / paynow_qr_url are NOT set here: the driver
-- flips them between its three cases and restores them in a finally, so a
-- crashed run self-heals rather than leaving the seed tenant configured.
--
-- Apply on a fresh `supabase db reset`:
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < drivers/fixtures-paynow-fallback.sql

-- ── People ──────────────────────────────────────────────────────────────────
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  -- The paying parent.
  ('00000000-0000-0000-0000-000000000000',
   'b1000000-0000-0000-0000-0000000000f1',
   'authenticated', 'authenticated', 'parent-pnfb@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Pat Fallback","role":"parent"}',
   NOW(), NOW(), '', '', '', ''),
  -- A PLAIN coach — not an admin. The persona for "the admin-panel link must
  -- be ABSENT, not merely disabled": a disabled link still leaks that the
  -- panel exists to a role that cannot use it (§7.91).
  ('00000000-0000-0000-0000-000000000000',
   'b1000000-0000-0000-0000-0000000000f2',
   'authenticated', 'authenticated', 'coach-pnfb@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Pnfb Coach","role":"coach","tenant_id":"70000000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '70000000-0000-0000-0000-000000000001'
FROM parents p WHERE p.profile_id = 'b1000000-0000-0000-0000-0000000000f1';

-- ── The package to pay for ──────────────────────────────────────────────────
-- Its own category, so stacking beside fixtures-packages.sql cannot collide on
-- the name 'Group'.
INSERT INTO class_categories (id, tenant_id, name)
VALUES ('cf000000-0000-0000-0000-0000000000f1',
        '70000000-0000-0000-0000-000000000001', 'PnFb Group');

INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count,
                              rate_per_lesson, validity_months)
VALUES ('df000000-0000-0000-0000-0000000000f1',
        '70000000-0000-0000-0000-000000000001',
        'PnFb 4 Lesson Pack', 'cf000000-0000-0000-0000-0000000000f1',
        4, 45.00, 6);

-- PENDING, so it renders in the parent's Packages tab with a "Pay now" route
-- to the PayNow screen. Terms and the reference are both assigned by triggers;
-- 4 x $45 = $180 is the amount the driver asserts.
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status)
SELECT 'ef000000-0000-0000-0000-0000000000f1',
       '70000000-0000-0000-0000-000000000001', p.id,
       'df000000-0000-0000-0000-0000000000f1', 'pending'
FROM parents p WHERE p.profile_id = 'b1000000-0000-0000-0000-0000000000f1';
