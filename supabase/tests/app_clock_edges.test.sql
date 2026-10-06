-- pgTAP: THE PINNED CLOCK ON EDGE DAYS (Wave 7 — docs/plans/WAVE7_DB_CLOCK_PLAN.md, "Edge-day file").
--
-- WHAT THIS FILE PROTECTS. Every date decision in the database reads app_now()/app_today() through the helpers,
-- in Asia/Singapore. These cases are the days where reading the clock in the WRONG zone, or the wrong way, gives
-- a different answer — so a regression shows up here even when an ordinary mid-month test stays green:
--   E1  07:59 SGT on the 1st     — UTC is still the last day of the previous month (§7.7, §7.337)
--   E2  the month boundary       — 23:59 on the 31st vs 00:00 on the 1st: the marking floor moves a month
--   E3  2028-02-29               — a leap day is a real lesson day, and "today"
--   E4  the day before a month's first Saturday — a Saturday class has no lesson yet this month
-- over markable_floor, assert_markable_date, class_unmarked_lesson_pairs, enrolment_start_bounds and
-- student_package_coverage.
--
-- RULES THIS FILE KEEPS (plan, RISK 4):
--   * `SET LOCAL TimeZone = 'UTC'` right after the clock header, so the 07:59 case does not depend on the
--     server's or the Mac's zone (§7.315): a function that took a zoneless ::date would read 30 Sep here.
--   * Each edge has its OWN tenant, created in-transaction with created_at explicitly BEFORE its pin and AFTER
--     the calendar floor, and NO billing_periods rows — so markable_floor() is the calendar rule and nothing
--     the shared DB holds (sealed months from drivers/Deno, the seed tenant) can clamp it locally but not in CI.
--   * Re-pinning mid-file is deliberate: each edge sets its own pin (G1 checks every pin's form).
--
-- RED-PROOF (lane1, under HOLD — it replaces a function on the shared DB): re-body today_sg() (or app_today())
-- as `SELECT app_now()::date` → the E1 assertions go red (the UTC date is 30 Sep) → restore byte-identical.

BEGIN;
SELECT set_config('swimsync.now', '2026-10-01 07:59+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(24);
SELECT is(app_today(), '2026-10-01'::date, 'clock pinned');
SET LOCAL TimeZone = 'UTC';

-- ── Fixture builder: one tenant per edge (prefix e<k>), all ids derived from k ────────────────────────────
--   tenant e<k>…a0 · admin (owner, also a coach) e<k>…a1 · parent e<k>…b1 · category e<k>…e1 · class e<k>…c1
--   student e<k>…d1 · any-class product e<k>…f1 · pending package e<k>…f2
-- `created` is written explicitly everywhere a stamp would otherwise default to the REAL clock.
CREATE FUNCTION pg_temp.edge_fixture(k int, created timestamptz, dow text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  p   text := 'e' || k || '000000-0000-0000-0000-0000000000';
  loc uuid;
BEGIN
  INSERT INTO tenants (id, slug, display_name, join_code, created_at)
  VALUES ((p || 'a0')::uuid, 'edge-' || k, 'Edge Swim ' || k, 'SWIM-EDG' || k, created);

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES
    ('00000000-0000-0000-0000-000000000000', (p || 'a1')::uuid, 'authenticated', 'authenticated',
     'edge-admin-' || k || '@test.local', crypt('x', gen_salt('bf')), created, '{"provider":"email"}',
     jsonb_build_object('full_name', 'Edge Admin ' || k, 'role', 'tenant_admin', 'is_coach', true,
                        'tenant_id', p || 'a0'),
     created, created, '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', (p || 'b1')::uuid, 'authenticated', 'authenticated',
     'edge-parent-' || k || '@test.local', crypt('x', gen_salt('bf')), created, '{"provider":"email"}',
     jsonb_build_object('full_name', 'Edge Parent ' || k, 'role', 'parent'),
     created, created, '', '', '', '');

  INSERT INTO parent_tenants (parent_id, tenant_id)
  SELECT pa.id, (p || 'a0')::uuid FROM parents pa WHERE pa.profile_id = (p || 'b1')::uuid;

  INSERT INTO class_categories (id, tenant_id, name) VALUES ((p || 'e1')::uuid, (p || 'a0')::uuid, 'Edge Group');
  INSERT INTO locations (tenant_id, name) VALUES ((p || 'a0')::uuid, 'Default location') RETURNING id INTO loc;

  INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
  SELECT (p || 'c1')::uuid, co.id, 'Edge Class ' || k, dow::day_of_week, '10:00', '11:00', loc, 40.00, (p || 'e1')::uuid
    FROM coaches co WHERE co.profile_id = (p || 'a1')::uuid;

  INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by)
  VALUES ((p || 'd1')::uuid, 'Edge Kid ' || k, '2018-01-01', 'assigned', (p || 'a0')::uuid, (p || 'b1')::uuid);
  INSERT INTO parent_students (parent_id, student_id)
  SELECT pa.id, (p || 'd1')::uuid FROM parents pa WHERE pa.profile_id = (p || 'b1')::uuid;

  -- enrolled_at explicit: its default would be the pin of whichever edge runs first.
  INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at)
  VALUES ((p || 'd1')::uuid, (p || 'c1')::uuid, created);

  INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count, rate_per_lesson, validity_months)
  VALUES ((p || 'f1')::uuid, (p || 'a0')::uuid, 'Edge 10 Lessons', NULL, 10, 40.00, 12);
  INSERT INTO parent_packages (id, tenant_id, parent_id, product_id)
  SELECT (p || 'f2')::uuid, (p || 'a0')::uuid, pa.id, (p || 'f1')::uuid
    FROM parents pa WHERE pa.profile_id = (p || 'b1')::uuid;
END $$;

--            k  created (before its pin, after its calendar floor)  class day
SELECT pg_temp.edge_fixture(1, '2026-09-20 12:00+08', 'thursday');   -- E1: 2026-10-01 is a Thursday
SELECT pg_temp.edge_fixture(2, '2026-10-15 12:00+08', 'sunday');     -- E2: 2026-11-01 is a Sunday
SELECT pg_temp.edge_fixture(3, '2028-02-10 12:00+08', 'tuesday');    -- E3: 2028-02-29 is a Tuesday
SELECT pg_temp.edge_fixture(4, '2026-10-20 12:00+08', 'saturday');   -- E4: first Saturday of Nov 2026 is the 7th

-- ══ E1. 07:59 SGT on 1 Oct 2026 — UTC still reads 30 Sep ═════════════════════════════════════════════════
-- (the pin above). The package is activated now, so its start_date is the SGT confirmation date: 1 Oct.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e1000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
UPDATE parent_packages SET status = 'active' WHERE id = 'e1000000-0000-0000-0000-0000000000f2';
RESET ROLE;

SELECT is((app_now() AT TIME ZONE 'UTC')::date, '2026-09-30'::date,
  'E1 precondition: at 07:59 SGT on the 1st the UTC date is still the 30th (the edge is real)');
SELECT is(markable_floor('e1000000-0000-0000-0000-0000000000a0'), '2026-09-01'::date,
  'E1: the floor is the 1st of LAST month in SGT (Sep), not of the UTC month (Aug)');
SELECT lives_ok($$ SELECT assert_markable_date('2026-10-01', 'e1000000-0000-0000-0000-0000000000a0') $$,
  'E1: 1 Oct is TODAY in Singapore at 07:59 — markable, not "has not happened yet"');
SELECT throws_ok($$ SELECT assert_markable_date('2026-08-31', 'e1000000-0000-0000-0000-0000000000a0') $$,
  'P0001', NULL, 'E1: 31 Aug is below the SGT floor — closed');
SELECT is(ARRAY(SELECT session_date FROM class_unmarked_lesson_pairs('e1000000-0000-0000-0000-0000000000c1') ORDER BY 1),
  ARRAY['2026-09-24', '2026-10-01']::date[],
  'E1: today''s Thursday lesson (1 Oct, SGT) is owed a mark at 07:59, beside 24 Sep');
SELECT is((SELECT c.coverage FROM student_package_coverage() c
            WHERE c.student_id = 'e1000000-0000-0000-0000-0000000000d1'),
  'package', 'E1: a package starting 1 Oct already covers the child at 07:59 SGT');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e1000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is(enrolment_start_bounds('e1000000-0000-0000-0000-0000000000c1')->>'today', '2026-10-01',
  'E1: enrolment_start_bounds reports today as the SGT date');
SELECT is(enrolment_start_bounds('e1000000-0000-0000-0000-0000000000c1')->>'floor', '2026-09-01',
  'E1: enrolment_start_bounds reports the SGT floor');
RESET ROLE;

-- ══ E2. The month boundary: 23:59 on 31 Oct vs 00:00 on 1 Nov 2026 (SGT) ═══════════════════════════════
SELECT set_config('swimsync.now', '2026-10-31 23:59+08', true);
SELECT is(markable_floor('e2000000-0000-0000-0000-0000000000a0'), '2026-09-01'::date,
  'E2: one minute before November, the floor is still 1 Sep');
SELECT lives_ok($$ SELECT assert_markable_date('2026-09-30', 'e2000000-0000-0000-0000-0000000000a0') $$,
  'E2: …so 30 Sep is still markable at 23:59 on 31 Oct');

SELECT set_config('swimsync.now', '2026-11-01 00:00+08', true);
SELECT is(markable_floor('e2000000-0000-0000-0000-0000000000a0'), '2026-10-01'::date,
  'E2: at 00:00 SGT on 1 Nov the floor moves to 1 Oct');
SELECT throws_ok($$ SELECT assert_markable_date('2026-09-30', 'e2000000-0000-0000-0000-0000000000a0') $$,
  'P0001', NULL, 'E2: …and 30 Sep closes at that minute');
SELECT is(ARRAY(SELECT session_date FROM class_unmarked_lesson_pairs('e2000000-0000-0000-0000-0000000000c1') ORDER BY 1),
  ARRAY['2026-10-18', '2026-10-25', '2026-11-01']::date[],
  'E2: at 00:00 on Sunday 1 Nov, that day''s lesson is already owed (SGT midnight, not UTC)');

-- ══ E3. 29 Feb 2028 — a leap day ═════════════════════════════════════════════════════════════════════
SELECT set_config('swimsync.now', '2028-02-29 10:00+08', true);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e3000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
UPDATE parent_packages SET status = 'active' WHERE id = 'e3000000-0000-0000-0000-0000000000f2';
RESET ROLE;

SELECT is(markable_floor('e3000000-0000-0000-0000-0000000000a0'), '2028-01-01'::date,
  'E3: on a leap day the floor is 1 Jan');
SELECT lives_ok($$ SELECT assert_markable_date('2028-02-29', 'e3000000-0000-0000-0000-0000000000a0') $$,
  'E3: 29 Feb is today — markable');
SELECT throws_ok($$ SELECT assert_markable_date('2028-03-01', 'e3000000-0000-0000-0000-0000000000a0') $$,
  'P0001', NULL, 'E3: 1 Mar has not happened yet');
SELECT is(ARRAY(SELECT session_date FROM class_unmarked_lesson_pairs('e3000000-0000-0000-0000-0000000000c1') ORDER BY 1),
  ARRAY['2028-02-15', '2028-02-22', '2028-02-29']::date[],
  'E3: the Tuesday lesson ON 29 Feb is owed a mark');
SELECT is((SELECT c.coverage FROM student_package_coverage() c
            WHERE c.student_id = 'e3000000-0000-0000-0000-0000000000d1'),
  'package', 'E3: a package confirmed on 29 Feb covers the child that day');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e3000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is(enrolment_start_bounds('e3000000-0000-0000-0000-0000000000c1')->>'today', '2028-02-29',
  'E3: enrolment_start_bounds reports 29 Feb as today');
RESET ROLE;

-- ══ E4. Friday 6 Nov 2026 — the day before the month's first Saturday ═════════════════════════════════
SELECT set_config('swimsync.now', '2026-11-06 10:00+08', true);
SELECT is(markable_floor('e4000000-0000-0000-0000-0000000000a0'), '2026-10-01'::date,
  'E4: the floor is 1 Oct');
SELECT is(ARRAY(SELECT session_date FROM class_unmarked_lesson_pairs('e4000000-0000-0000-0000-0000000000c1') ORDER BY 1),
  ARRAY['2026-10-24', '2026-10-31']::date[],
  'E4: a Saturday class owes only October''s lessons — November has none yet');
SELECT throws_ok($$ SELECT assert_markable_date('2026-11-07', 'e4000000-0000-0000-0000-0000000000a0') $$,
  'P0001', NULL, 'E4: tomorrow''s first Saturday has not happened yet');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"e4000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is(enrolment_start_bounds('e4000000-0000-0000-0000-0000000000c1')->>'today', '2026-11-06',
  'E4: enrolment_start_bounds reports today as 6 Nov');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
