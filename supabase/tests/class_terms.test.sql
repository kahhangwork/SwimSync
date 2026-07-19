-- pgTAP: set_class_terms (20260719001000).
--
-- Covers the CORRECT-vs-CHANGE distinction, the "a rename records nothing"
-- rule, and the guards that stop settled money from moving.
--
-- Deliberately its OWN tenant rather than sharing the coach_wages fixture:
-- that one marks a December-2026 payout paid, and the settled-money guard
-- correctly refuses any terms change dated on or before a paid period. Reusing
-- it would have meant weakening a guard to suit a fixture.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(14);

INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('88888888-0000-0000-0000-000000000002','terms','Terms Swim','SWIM-TERM');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','79000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','terms-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Terms Admin","role":"tenant_admin","tenant_id":"88888888-0000-0000-0000-000000000002"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','79000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','terms-coach@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Terms Coach","role":"coach","tenant_id":"88888888-0000-0000-0000-000000000002"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','79000000-0000-0000-0000-000000000003',
   'authenticated','authenticated','terms-coach-b@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Terms Coach B","role":"coach","tenant_id":"88888888-0000-0000-0000-000000000002"}', now(), now(), '', '', '', '');

-- A coach at a DIFFERENT business, for the cross-tenant check.
INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('88888888-0000-0000-0000-000000000003','other','Other Swim','SWIM-OTHR');
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','79000000-0000-0000-0000-000000000004',
   'authenticated','authenticated','other-coach@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Other Coach","role":"coach","tenant_id":"88888888-0000-0000-0000-000000000003"}', now(), now(), '', '', '', '');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, tenant_id)
SELECT '67000000-0000-0000-0000-000000000001', c.id, 'Terms Test', 'monday',
       '10:00','11:00','Pool', 30, '88888888-0000-0000-0000-000000000002'
  FROM coaches c WHERE c.profile_id='79000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"79000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ── A save that moves no money records nothing ─────────────────────────────
SELECT lives_ok(
  $$ SELECT set_class_terms('67000000-0000-0000-0000-000000000001','Renamed','monday',
       '10:00','11:00','Pool', 30,
       (SELECT id FROM coaches WHERE profile_id='79000000-0000-0000-0000-000000000002')) $$,
  'a class can be renamed through the RPC'
);
SELECT is(
  (SELECT COUNT(*)::INT FROM class_rates WHERE class_id='67000000-0000-0000-0000-000000000001'),
  1,
  'a rename inserts NO dated row — only the seeded one exists'
);
SELECT is((SELECT title FROM classes WHERE id='67000000-0000-0000-0000-000000000001'),
          'Renamed', 'and the rename actually landed');

-- ── CORRECT: a typo. Rewrites in place; no period is invented ──────────────
SELECT lives_ok(
  $$ SELECT set_class_terms('67000000-0000-0000-0000-000000000001','Renamed','monday',
       '10:00','11:00','Pool', 45,
       (SELECT id FROM coaches WHERE profile_id='79000000-0000-0000-0000-000000000002'),
       NULL, TRUE) $$,
  'a price typo can be corrected in place'
);
SELECT is(
  (SELECT COUNT(*)::INT FROM class_rates WHERE class_id='67000000-0000-0000-0000-000000000001'),
  1,
  'CORRECT rewrites the existing row rather than adding a period'
);
SELECT is(
  (SELECT price_per_lesson FROM class_rate_on('67000000-0000-0000-0000-000000000001', DATE '2020-01-01')),
  45.00,
  'and the correction reaches history too — there was never a $30 period'
);

-- ── CHANGE: a genuine rise. Earlier lessons keep the old price ─────────────
SELECT lives_ok(
  $$ SELECT set_class_terms('67000000-0000-0000-0000-000000000001','Renamed','monday',
       '10:00','11:00','Pool', 60,
       (SELECT id FROM coaches WHERE profile_id='79000000-0000-0000-0000-000000000002'),
       CURRENT_DATE, FALSE) $$,
  'a genuine price rise can be dated from today'
);
SELECT is(
  (SELECT COUNT(*)::INT FROM class_rates WHERE class_id='67000000-0000-0000-0000-000000000001'),
  2,
  'CHANGE adds a second period'
);
SELECT is(
  (SELECT price_per_lesson FROM class_rate_on('67000000-0000-0000-0000-000000000001', DATE '2020-01-01')),
  45.00,
  'CHANGE leaves earlier lessons on the OLD price — the whole point'
);
SELECT is(
  (SELECT price_per_lesson FROM class_rate_on('67000000-0000-0000-0000-000000000001', CURRENT_DATE)),
  60.00,
  'and today onward is on the new one'
);

-- ── Guards ─────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT set_class_terms('67000000-0000-0000-0000-000000000001','Renamed','monday',
       '10:00','11:00','Pool', 99,
       (SELECT id FROM coaches WHERE profile_id='79000000-0000-0000-0000-000000000002'),
       CURRENT_DATE + 30, FALSE) $$,
  NULL, NULL,
  'terms cannot be dated into the future (the display sync only tracks today)'
);

SELECT throws_ok(
  $$ SELECT set_class_terms('67000000-0000-0000-0000-000000000001','Renamed','monday',
       '10:00','11:00','Pool', -5,
       (SELECT id FROM coaches WHERE profile_id='79000000-0000-0000-0000-000000000002')) $$,
  NULL, NULL,
  'a negative price is refused'
);

-- Cross-tenant coach: neither RLS nor the engine would catch this, because the
-- function is SECURITY DEFINER and billing bypasses RLS entirely.
SELECT throws_ok(
  $$ SELECT set_class_terms('67000000-0000-0000-0000-000000000001','Renamed','monday',
       '10:00','11:00','Pool', 60,
       (SELECT id FROM coaches WHERE profile_id='79000000-0000-0000-0000-000000000004')) $$,
  NULL, NULL,
  'a coach from ANOTHER business cannot be assigned the class'
);

-- Settled money must not move: seal the month, then try to reprice into it.
RESET ROLE;
INSERT INTO billing_periods (tenant_id, billing_month, invoices_issued)
VALUES ('88888888-0000-0000-0000-000000000002', to_char(CURRENT_DATE,'YYYY-MM'), 1);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"79000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT set_class_terms('67000000-0000-0000-0000-000000000001','Renamed','monday',
       '10:00','11:00','Pool', 75,
       (SELECT id FROM coaches WHERE profile_id='79000000-0000-0000-0000-000000000002'),
       CURRENT_DATE, FALSE) $$,
  NULL, NULL,
  'terms cannot be repriced into a month that has already been invoiced and sealed'
);

SELECT * FROM finish();
ROLLBACK;
