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
SELECT plan(17);

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

-- classes.category_id is NOT NULL (20260725000400). A test creates its own
-- tenants inside this transaction, so they have none of the categories the
-- migration backfilled onto pre-existing ones — give every tenant a Default
-- Group to hang classes off. Idempotent, and deliberately tenant-agnostic so
-- this block is identical in every fixture.
INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM class_categories c
    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, tenant_id, category_id)
SELECT '67000000-0000-0000-0000-000000000001', c.id, 'Terms Test', 'monday',
       '10:00','11:00','Pool', 30, '88888888-0000-0000-0000-000000000002',
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = c.tenant_id
           AND lower(trim(cc.name)) = 'default group')
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
       today_sg(), FALSE) $$,
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
  (SELECT price_per_lesson FROM class_rate_on('67000000-0000-0000-0000-000000000001', today_sg())),
  60.00,
  'and today onward is on the new one'
);

-- ── Guards ─────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT set_class_terms('67000000-0000-0000-0000-000000000001','Renamed','monday',
       '10:00','11:00','Pool', 99,
       (SELECT id FROM coaches WHERE profile_id='79000000-0000-0000-0000-000000000002'),
       today_sg() + 30, FALSE) $$,
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

-- ══ 14-16. THE CLOCK. `CURRENT_DATE` IS THE SESSION'S TIME ZONE, NOT SGT ════
-- Live bug, 20260719000700 → 20260807000100: the guard below compared against
-- CURRENT_DATE while the admin panel sends todayInSg(), so between 00:00 and
-- 08:00 SGT every class edit was refused with "terms cannot start in the
-- future". Eight hours out of every twenty-four, for three weeks.
--
-- ⚠ WHY THE EXISTING GUARD TEST ABOVE COULD NOT CATCH IT: it dates terms a
-- MONTH out, which is refused under either clock. The whole bug lives in the
-- ONE-DAY gap between two notions of "today", so only a boundary case reaches
-- it. Test a date guard AT its boundary, never at a comfortable distance.

-- 14. The actual admin action: terms effective TODAY, Singapore. Must always
--     be accepted. Before the fix this passed for sixteen hours a day and
--     failed for eight, which is the shape that makes a suite look healthy.
SELECT lives_ok(
  $$ SELECT set_class_terms('67000000-0000-0000-0000-000000000001','Renamed','monday',
       '10:00','11:00','Pool', 30,
       (SELECT id FROM coaches WHERE profile_id='79000000-0000-0000-0000-000000000002'),
       today_sg(), FALSE) $$,
  'terms may start TODAY in Singapore — the guard must not read a UTC date'
);

-- 15. …and the guard is still a guard, tested one day out rather than thirty.
SELECT throws_ok(
  $$ SELECT set_class_terms('67000000-0000-0000-0000-000000000001','Renamed','monday',
       '10:00','11:00','Pool', 30,
       (SELECT id FROM coaches WHERE profile_id='79000000-0000-0000-0000-000000000002'),
       today_sg() + 1, FALSE) $$,
  NULL, NULL,
  'tomorrow is still refused — the fix moves the boundary, it does not remove it'
);

-- 16. ⚠ THE CLASS OF BUG, NOT THE TWO INSTANCES — and the only one of these
--     three that is deterministic. Tests 14 and 15 are honest but pass all day
--     outside the window; this one fails at 3pm too. Same shape as
--     function_grants.test.sql: assert over pg_proc so it catches the function
--     nobody thought to name. Dates in this product are Singapore-local
--     (§7.7) — today_sg() is the only correct source inside the database.
SELECT is(
  (SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.prosrc ~ 'CURRENT_DATE' OR p.prosrc ~ 'now\(\)::date')
      -- Extension-owned functions are not ours to fix: pgTAP ships `_def_is`,
      -- which matches. Without this the assertion passes or fails depending on
      -- whether pgTAP happens to be installed — a test that is red against a
      -- correct database is a test that gets disabled (§7.87).
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                       WHERE d.objid = p.oid AND d.deptype = 'e')),
  NULL,
  'NO function in public derives a date from the session time zone — use today_sg()'
);


-- Settled money must not move: seal the month, then try to reprice into it.
RESET ROLE;
INSERT INTO billing_periods (tenant_id, billing_month, invoices_issued)
VALUES ('88888888-0000-0000-0000-000000000002', to_char(today_sg(),'YYYY-MM'), 1);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"79000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT set_class_terms('67000000-0000-0000-0000-000000000001','Renamed','monday',
       '10:00','11:00','Pool', 75,
       (SELECT id FROM coaches WHERE profile_id='79000000-0000-0000-0000-000000000002'),
       today_sg(), FALSE) $$,
  NULL, NULL,
  'terms cannot be repriced into a month that has already been invoiced and sealed'
);


SELECT * FROM finish();
ROLLBACK;
