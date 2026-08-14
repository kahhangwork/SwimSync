-- pgTAP: the admin's manual package extension (20260815000300). ⚠ RISK 5.
-- Self-contained; own tenant; rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('ea000000-0000-0000-0000-000000000001','mx','Manual Ext','SWIM-MXT');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','eb000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','mx-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"MX Admin","role":"tenant_admin","tenant_id":"ea000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ec000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','mx-parent@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"MX Parent","role":"parent"}',
   now(), now(), '','','','');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'ea000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='mx-parent@test.local';

INSERT INTO package_products (id, tenant_id, name, lesson_count, rate_per_lesson, validity_weeks)
VALUES ('e0000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000001',
        '10 lessons', 10, 30.00, 10);
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, start_date)
SELECT 'e1000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000001',
       p.id,'e0000000-0000-0000-0000-000000000001','active','2026-03-01'
FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='mx-parent@test.local';

CREATE TEMP TABLE mx AS SELECT
  (SELECT p.id FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='mx-parent@test.local') AS parent1;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"eb000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ── 1-3. Admin extends +14 days: stored days, moved expiry, audit row ───────
SELECT lives_ok($$ SELECT extend_package('e1000000-0000-0000-0000-000000000001', 14, 'goodwill') $$,
  'admin extends an active package');
SELECT is((SELECT manual_extension_days FROM parent_packages WHERE id='e1000000-0000-0000-0000-000000000001'),
  14, 'manual_extension_days = 14');
SELECT is((SELECT expires_on FROM parent_packages WHERE id='e1000000-0000-0000-0000-000000000001'),
  DATE '2026-05-24', 'expiry = nominal 2026-05-10 + 14 manual days');
SELECT is((SELECT count(*)::int FROM package_extension_events
            WHERE parent_package_id='e1000000-0000-0000-0000-000000000001'
              AND kind='manual' AND delta_days=14),
  1, 'a manual audit event was written');

-- ── 4. A second extension STACKS ────────────────────────────────────────────
SELECT extend_package('e1000000-0000-0000-0000-000000000001', 7, 'more goodwill');
SELECT is((SELECT manual_extension_days || '/' || to_char(expires_on,'YYYY-MM-DD')
            FROM parent_packages WHERE id='e1000000-0000-0000-0000-000000000001'),
  '21/2026-05-31', 'a second extension stacks (21 days ⇒ 2026-05-31)');

-- ── 5-7. Bounds: 0, negative, and over-365 are all refused ──────────────────
SELECT throws_ok($$ SELECT extend_package('e1000000-0000-0000-0000-000000000001', 0, 'x') $$,
  '23514', NULL, 'zero days is refused');
SELECT throws_ok($$ SELECT extend_package('e1000000-0000-0000-0000-000000000001', -5, 'x') $$,
  '23514', NULL, 'a negative extension is refused');
SELECT throws_ok($$ SELECT extend_package('e1000000-0000-0000-0000-000000000001', 400, 'x') $$,
  '23514', NULL, 'over 365 days is refused');

-- ── 8. A parent cannot extend ───────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"ec000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_ok($$ SELECT extend_package('e1000000-0000-0000-0000-000000000001', 7, 'x') $$,
  '42501', NULL, 'a parent cannot extend a package');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
