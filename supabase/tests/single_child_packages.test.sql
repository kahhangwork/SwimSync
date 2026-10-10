-- pgTAP: SINGLE-CHILD PACKAGES — 20261010000100. docs/plans/SINGLE_CHILD_PACKAGES_PLAN.md (D1–D11 are the user's).
--
-- WHAT THIS FILE PROTECTS.
--   (1) catalogue: one pg_proc row per changed RPC, no anon EXECUTE, the grants a parent's insert needs, and the
--       draw_rank census — every function that PICKS from package_candidates_for orders by draw_rank (RISK 1);
--   (2) the sale invariant: kind ↔ child, the child is the family's and the business's, flag-off refused (D9);
--   (3) the pins: no client changes the child; nobody changes the kind (D2); a flip affects new sales only (D6);
--   (4) D11: one kind per family, switchable once the old kind is used up;
--   (5) the matcher: the child draws, a sibling is ad-hoc; own pays first (D5) in the draw, the preview, PK001 and
--       the holiday matcher; PK001 counts only the package child's lessons yet still fires for them (RISK 2);
--   (6) the backlog and coverage per child; renewal rows per child (D8); offers, supersede and the referral handoff
--       scoped per audience (RISK 3, RISK 4); trials, merges, cross-business moves; the tenant-flag guard (D9);
--   (7) reassign_package_child: callers, ever-drawn, the extension recompute and the audit row (RISK 10).
--
-- PRECONDITIONS (RISK 11, §7.330): every "does not" case is preceded by a check that it COULD — the package is
-- active, in range, funded, or the same shape draws/blocks for a shared package.
--
-- FIXTURE (prefix 5c…). Tenant T (flag ON, referrals 10%), T2 (flag ON), T3 (flag OFF), all created 200 days ago
-- and never billed, so every dN is markable. The class runs on the pinned day's weekday (Saturday); dN = N days ago.
-- Families (P1–P13), one concern each: P1 Ava/Ben one-child · P2 Cai/Dee/Wes shared · P3 Eve switch · P4 Fay (T3)
-- · P5 Gus flip · P7 Kim/Lou D5 · P8 Mia/Nia reassign · P9 Oli/Pia + P10 Qin/Ray renewal · P11 Sam/Tom referral
-- · P12 Uma/Vic trial · P13 Xia/Xia2 merge. Zed is P1's child at T2.

BEGIN;
SELECT set_config('swimsync.now', '2026-10-10 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(73);
SELECT is(app_today(), '2026-10-10'::date, 'clock pinned');

CREATE TEMP TABLE f AS
SELECT
  '2026-10-10'::date AS d0,
  '2026-10-03'::date AS d7,
  '2026-09-26'::date AS d14,
  '2026-09-19'::date AS d21,
  '2026-09-12'::date AS d28,
  '2026-09-05'::date AS d35,
  '2026-08-29'::date AS d42,
  '2026-10-17'::date AS n7;
GRANT SELECT ON f TO PUBLIC;

INSERT INTO tenants (id, slug, display_name, join_code, created_at, package_draw_at_marking,
                     referral_enabled, referral_discount_type, referral_discount_value) VALUES
  ('5c000000-0000-0000-0000-0000000000a0','sc-t','SC T','SWIM-SCTT', app_now() - INTERVAL '200 days', TRUE, TRUE, 'percent', 10),
  ('5c000000-0000-0000-0000-0000000000b0','sc-t2','SC T2','SWIM-SCT2', app_now() - INTERVAL '200 days', TRUE, FALSE, NULL, NULL),
  ('5c000000-0000-0000-0000-0000000000c0','sc-t3','SC T3','SWIM-SCT3', app_now() - INTERVAL '200 days', FALSE, FALSE, NULL, NULL);

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;

SELECT pg_temp.mkuser('5c100000-0000-0000-0000-0000000000a1','sc-owner@test.local',
  '{"full_name":"SC Owner","role":"tenant_admin","tenant_id":"5c000000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('5c100000-0000-0000-0000-0000000000b1','sc-owner2@test.local',
  '{"full_name":"SC Owner2","role":"tenant_admin","tenant_id":"5c000000-0000-0000-0000-0000000000b0"}');
SELECT pg_temp.mkuser('5c100000-0000-0000-0000-0000000000c9','sc-owner3@test.local',
  '{"full_name":"SC Owner3","role":"tenant_admin","tenant_id":"5c000000-0000-0000-0000-0000000000c0"}');
SELECT pg_temp.mkuser('5c100000-0000-0000-0000-0000000000c1','sc-coach@test.local',
  '{"full_name":"SC Coach","role":"coach","tenant_id":"5c000000-0000-0000-0000-0000000000a0"}');
-- A custom VIEW-only role (packages at view, every other area none).
INSERT INTO tenant_roles (id, tenant_id, name)
VALUES ('5c200000-0000-0000-0000-000000000001','5c000000-0000-0000-0000-0000000000a0','SC Package Viewer');
INSERT INTO tenant_role_permissions (role_id, area, level)
SELECT '5c200000-0000-0000-0000-000000000001', a,
       CASE WHEN a = 'packages' THEN 'view'::admin_level ELSE 'none'::admin_level END
  FROM unnest(enum_range(NULL::admin_area)) a;
SELECT pg_temp.mkuser('5c100000-0000-0000-0000-0000000000e1','sc-viewer@test.local',
  '{"full_name":"SC Viewer","role":"tenant_admin","tenant_id":"5c000000-0000-0000-0000-0000000000a0","admin_role_id":"5c200000-0000-0000-0000-000000000001"}');
SELECT pg_temp.mkuser('5c100000-0000-0000-0000-0000000000f1','sc-platform@test.local', '{"full_name":"SC Platform"}');
UPDATE profiles SET role = 'platform_admin' WHERE id = '5c100000-0000-0000-0000-0000000000f1';
SELECT pg_temp.mkuser(('5c100000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'sc-parent' || n || '@test.local',
  jsonb_build_object('full_name','SC Parent ' || n,'role','parent'))
  FROM generate_series(1, 13) n;
UPDATE tenants SET owner_profile_id = '5c100000-0000-0000-0000-0000000000a1' WHERE id = '5c000000-0000-0000-0000-0000000000a0';
UPDATE tenants SET owner_profile_id = '5c100000-0000-0000-0000-0000000000b1' WHERE id = '5c000000-0000-0000-0000-0000000000b0';
UPDATE tenants SET owner_profile_id = '5c100000-0000-0000-0000-0000000000c9' WHERE id = '5c000000-0000-0000-0000-0000000000c0';

CREATE TEMP TABLE ids (k TEXT PRIMARY KEY, v UUID);
GRANT SELECT ON ids TO PUBLIC;
INSERT INTO ids
SELECT 'P' || n, p.id FROM generate_series(1, 13) n
  JOIN profiles pr ON pr.email = 'sc-parent' || n || '@test.local'
  JOIN parents p ON p.profile_id = pr.id;
INSERT INTO ids SELECT 'coach', id FROM coaches WHERE profile_id = '5c100000-0000-0000-0000-0000000000c1';
CREATE OR REPLACE FUNCTION pg_temp.id(p_k TEXT) RETURNS UUID AS $$ SELECT v FROM ids WHERE k = p_k $$ LANGUAGE sql STABLE;

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT pg_temp.id('P' || n), '5c000000-0000-0000-0000-0000000000a0' FROM generate_series(1, 13) n WHERE n <> 4;
INSERT INTO parent_tenants (parent_id, tenant_id) VALUES
  (pg_temp.id('P1'), '5c000000-0000-0000-0000-0000000000b0'),
  (pg_temp.id('P4'), '5c000000-0000-0000-0000-0000000000c0');

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('5c400000-0000-0000-0000-000000000001','5c000000-0000-0000-0000-0000000000a0','SC Group');
INSERT INTO locations (id, tenant_id, name) VALUES
  ('5c800000-0000-0000-0000-000000000001','5c000000-0000-0000-0000-0000000000a0','SC Pool');
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
VALUES ('5c500000-0000-0000-0000-000000000001','5c000000-0000-0000-0000-0000000000a0', pg_temp.id('coach'), 'SC Dolphins',
        'saturday', '09:00', '10:00', '5c800000-0000-0000-0000-000000000001', 30.00, '5c400000-0000-0000-0000-000000000001');

-- Students. s01..s16 at T; s17 (Zed) at T2.
INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id)
SELECT ('5c300000-0000-0000-0000-0000000000' || k)::uuid, 'SC ' || nm, 'assigned', TRUE,
       CASE WHEN k = '17' THEN '5c000000-0000-0000-0000-0000000000b0'::uuid
            WHEN k = '07' THEN '5c000000-0000-0000-0000-0000000000c0'::uuid
            ELSE '5c000000-0000-0000-0000-0000000000a0'::uuid END
  FROM (VALUES ('01','Ava'),('02','Ben'),('03','Cai'),('04','Dee'),('05','Wes'),('06','Eve'),('07','Fay'),('08','Gus'),
               ('09','Kim'),('0a','Lou'),('0b','Mia'),('0c','Nia'),('0d','Oli'),('0e','Pia'),('0f','Qin'),('10','Ray'),
               ('11','Sam'),('12','Tom'),('13','Uma'),('14','Vic'),('15','Xia'),('16','Xia Dup'),('17','Zed')) v(k, nm);
CREATE OR REPLACE FUNCTION pg_temp.kid(p_k TEXT) RETURNS UUID AS $$
  SELECT ('5c300000-0000-0000-0000-0000000000' || p_k)::uuid $$ LANGUAGE sql IMMUTABLE;
GRANT EXECUTE ON FUNCTION pg_temp.kid(TEXT), pg_temp.id(TEXT) TO authenticated;
INSERT INTO parent_students (parent_id, student_id)
SELECT pg_temp.id(p), pg_temp.kid(k) FROM (VALUES
  ('P1','01'),('P1','02'),('P1','17'),('P2','03'),('P2','04'),('P2','05'),('P3','06'),('P4','07'),('P5','08'),
  ('P7','09'),('P7','0a'),('P8','0b'),('P8','0c'),('P9','0d'),('P9','0e'),('P10','0f'),('P10','10'),
  ('P11','11'),('P11','12'),('P12','13'),('P12','14'),('P13','16')) v(p, k);

-- Enrolments in SC Dolphins (noon SGT). Wes, Vic, Sam, Tom, Xia, Xia Dup, Zed, Fay, Gus: none.
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT pg_temp.kid(k), '5c500000-0000-0000-0000-000000000001', (d::timestamp + TIME '12:00') AT TIME ZONE 'Asia/Singapore', TRUE
  FROM f, LATERAL (VALUES ('01', f.d28),('02', f.d28),('03', f.d28),('04', f.d28),('06', f.d21),('09', f.d21),('0a', f.d21),
                          ('0b', f.d42),('0c', f.d42),('0d', f.d42),('0e', f.d42),('0f', f.d42),('10', f.d42),('13', f.d42)) v(k, d);

-- Products. SH = shared, OC = one-child; all-classes, @30, 20 weeks unless noted.
INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count, rate_per_lesson, validity_weeks, single_child) VALUES
  ('5c600000-0000-0000-0000-000000000001','5c000000-0000-0000-0000-0000000000a0','SH2',NULL,2,30.00,20,FALSE),
  ('5c600000-0000-0000-0000-000000000002','5c000000-0000-0000-0000-0000000000a0','SH1',NULL,1,30.00,10,FALSE),
  ('5c600000-0000-0000-0000-000000000003','5c000000-0000-0000-0000-0000000000a0','SHX',NULL,5,30.00,20,FALSE),
  ('5c600000-0000-0000-0000-000000000004','5c000000-0000-0000-0000-0000000000a0','OC2',NULL,2,30.00,20,TRUE),
  ('5c600000-0000-0000-0000-000000000005','5c000000-0000-0000-0000-0000000000a0','OC5',NULL,5,30.00,20,TRUE),
  ('5c600000-0000-0000-0000-000000000006','5c000000-0000-0000-0000-0000000000a0','OC10',NULL,10,30.00,20,TRUE),
  ('5c600000-0000-0000-0000-000000000007','5c000000-0000-0000-0000-0000000000c0','OCT3',NULL,5,30.00,20,TRUE);

CREATE OR REPLACE FUNCTION pg_temp.prod(p_name TEXT) RETURNS UUID AS $$
  SELECT id FROM package_products WHERE name = p_name AND tenant_id IN
    ('5c000000-0000-0000-0000-0000000000a0','5c000000-0000-0000-0000-0000000000c0') $$ LANGUAGE sql STABLE;
GRANT EXECUTE ON FUNCTION pg_temp.prod(TEXT) TO authenticated;
-- A backend sale (as postgres): active, from p_start.
CREATE OR REPLACE FUNCTION pg_temp.sell(p_id UUID, p_parent TEXT, p_product TEXT, p_start DATE, p_kid TEXT) RETURNS VOID AS $$
  INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, start_date, student_id)
  SELECT COALESCE(p_id, gen_random_uuid()), pr.tenant_id, pg_temp.id(p_parent), pr.id, 'active', p_start,
         CASE WHEN p_kid IS NULL THEN NULL ELSE pg_temp.kid(p_kid) END
    FROM package_products pr WHERE pr.id = pg_temp.prod(p_product) $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.s(p_date DATE) RETURNS UUID AS $$
DECLARE v UUID;
BEGIN
  SELECT id INTO v FROM lesson_sessions WHERE class_id = '5c500000-0000-0000-0000-000000000001' AND session_date = p_date;
  IF v IS NULL THEN
    INSERT INTO lesson_sessions (class_id, session_date, start_time, end_time)
    SELECT id, p_date, start_time, end_time FROM classes WHERE id = '5c500000-0000-0000-0000-000000000001' RETURNING id INTO v;
  END IF;
  RETURN v;
END $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION pg_temp.mark(p_date DATE, p_kid TEXT, p_status TEXT) RETURNS VOID AS $$
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
  VALUES (pg_temp.s(p_date), pg_temp.kid(p_kid), p_status::attendance_status, '5c100000-0000-0000-0000-0000000000c1')
  ON CONFLICT (lesson_session_id, student_id) DO UPDATE SET status = EXCLUDED.status $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.drawn(p_date DATE, p_kid TEXT) RETURNS TEXT AS $$
  SELECT COALESCE(string_agg(pa.parent_package_id::text, ','), 'none') FROM package_applications pa
   WHERE pa.lesson_session_id = pg_temp.s(p_date) AND pa.student_id = pg_temp.kid(p_kid) AND pa.reversed_at IS NULL $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.rem(p_pkg UUID) RETURNS NUMERIC AS $$
  SELECT value_remaining FROM parent_packages WHERE id = p_pkg $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(TEXT) TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.parent_uid(p TEXT) RETURNS TEXT AS $$
  SELECT pa.profile_id::text FROM parents pa WHERE pa.id = pg_temp.id(p) $$ LANGUAGE sql STABLE;

-- ══ 1. Catalogue ═══════════════════════════════════════════════════════════════════════════════════════════════
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'create_package_offer' AND pronamespace = 'public'::regnamespace)
          || '/' ||
          (SELECT count(*)::int FROM pg_proc WHERE proname = 'suggest_package_start' AND pronamespace = 'public'::regnamespace),
  '1/1', '1a: one pg_proc row each for create_package_offer and suggest_package_start (RISK 6)');
SELECT is((SELECT COALESCE(string_agg(sig, ', ' ORDER BY sig), '') FROM unnest(ARRAY[
    'public.assert_package_child(uuid,uuid,uuid)', 'public.assert_package_kind_free(uuid,uuid,boolean)',
    'public.reassign_package_child(uuid,uuid)', 'public.create_package_offer(uuid,uuid,date,uuid)',
    'public.suggest_package_start(uuid,uuid,uuid)', 'public.package_renewal_candidates()',
    'public.student_package_coverage()', 'public.package_candidates_for(uuid,uuid)']) sig
   WHERE has_function_privilege('anon', sig, 'EXECUTE')),
  '', '1b: anon holds EXECUTE on none of the new or rewritten callables');
SELECT is((SELECT COALESCE(string_agg(sig, ', ' ORDER BY sig), '') FROM unnest(ARRAY[
    'public.assert_package_child(uuid,uuid,uuid)', 'public.assert_package_kind_free(uuid,uuid,boolean)',
    'public.reassign_package_child(uuid,uuid)', 'public.create_package_offer(uuid,uuid,date,uuid)',
    'public.suggest_package_start(uuid,uuid,uuid)', 'public.package_renewal_candidates()',
    'public.student_package_coverage()']) sig
   WHERE NOT has_function_privilege('authenticated', sig, 'EXECUTE')),
  '', '1c: authenticated holds EXECUTE on every RPC and helper it needs');
SELECT ok(NOT has_function_privilege('authenticated', 'public.package_candidates_for(uuid,uuid)', 'EXECUTE')
      AND NOT has_function_privilege('service_role', 'public.package_candidates_for(uuid,uuid)', 'EXECUTE'),
  '1d: package_candidates_for keeps its owner-only ACL after the DROP + CREATE');
-- RISK 1 census over the catalogue: a function that PICKS from the candidates (LIMIT 1 / EXIT) orders by draw_rank.
-- package_backlog_lessons calls it only inside an EXISTS (no pick), so it is not one.
SELECT is((SELECT COALESCE(string_agg(proname, ', ' ORDER BY proname), '') FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace
              AND prosrc ~ 'package_candidates_for\('
              AND prosrc ~* '\mORDER\s+BY\M'
              AND prosrc ~* '(\mLIMIT\s+1\M|\mEXIT\M)'
              AND prosrc !~ 'draw_rank'),
  '', '1e: every function that picks from package_candidates_for orders by draw_rank (RISK 1)');
SELECT is((SELECT count(*)::int FROM pg_proc
            WHERE pronamespace = 'public'::regnamespace
              AND prosrc ~ 'package_candidates_for\('
              AND prosrc ~* '\mORDER\s+BY\M'
              AND prosrc ~* '(\mLIMIT\s+1\M|\mEXIT\M)'),
  3, '1f: ...and the census is not vacuous — it sees the draw, PK001 and the preview');
SELECT is(pg_get_function_result('public.merge_students(uuid,uuid)'::regprocedure),
  'TABLE(moved_parent_links integer, moved_trial_bookings integer, moved_makeup_bookings integer, moved_settlements integer, moved_claims integer, moved_skill_progress integer, dropped_collisions integer)',
  '1g: merge_students'' RETURNS TABLE is unchanged (RISK 14)');

-- ══ 2. The sale invariant ══════════════════════════════════════════════════════════════════════════════════════
SELECT is((SELECT string_agg(name || '=' || single_child, ',' ORDER BY name) FROM package_products
            WHERE name IN ('OC2','SH2')), 'OC2=true,SH2=false', '2a: precondition — OC2 is one-child, SH2 shared');
SELECT throws_ok($$ SELECT pg_temp.sell(NULL, 'P1', 'OC2', (SELECT d42 FROM f), NULL) $$,
  '23514', 'Choose which child this package is for.', '2b: a one-child product without a child is refused');
SELECT throws_ok($$ SELECT pg_temp.sell(NULL, 'P2', 'SH2', (SELECT d42 FROM f), '03') $$,
  '23514', 'This package is shared — it can''t be tied to one child.', '2c: a shared product with a child is refused');
SELECT pg_temp.as_user(pg_temp.parent_uid('P1'));
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ INSERT INTO parent_packages (tenant_id, parent_id, product_id, student_id)
                    VALUES ('5c000000-0000-0000-0000-0000000000a0', pg_temp.id('P1'), pg_temp.prod('OC5'), pg_temp.kid('03')) $$,
  '23514', 'That child is not in this family.', '2d: a parent naming another family''s child is refused (through RLS)');
SELECT lives_ok($$ INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, student_id)
                   VALUES ('5c700000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000a0', pg_temp.id('P1'),
                           pg_temp.prod('OC5'), pg_temp.kid('01')) $$,
  '2e: a parent''s own valid one-child request succeeds (proves the helpers'' grants, §7.342)');
RESET ROLE;
SELECT is((SELECT status || '/' || student_id FROM parent_packages WHERE id = '5c700000-0000-0000-0000-000000000001'),
  'pending/' || pg_temp.kid('01'), '2f: ...a pending request tied to Ava');
SELECT throws_ok($$ SELECT pg_temp.sell(NULL, 'P1', 'OC5', (SELECT d42 FROM f), '17') $$,
  '23514', 'That child belongs to another business.', '2g: the family''s child at another business is refused');
SELECT throws_ok($$ SELECT pg_temp.sell(NULL, 'P4', 'OCT3', (SELECT d42 FROM f), '07') $$,
  '23514', 'One-child packages need lessons to draw at marking, which this business has switched off.',
  '2h: a one-child package in a flag-off business is refused (D9)');

-- ══ 3. Pins ═════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT pg_temp.as_user(pg_temp.parent_uid('P1'));
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ UPDATE parent_packages SET student_id = pg_temp.kid('02') WHERE id = '5c700000-0000-0000-0000-000000000001' $$,
  '23514', 'Use Change child to move a package to another child.', '3a: the parent cannot move their own package to a sibling (§7.157)');
RESET ROLE;
SELECT pg_temp.as_user('5c100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ UPDATE parent_packages SET student_id = pg_temp.kid('02') WHERE id = '5c700000-0000-0000-0000-000000000001' $$,
  '23514', 'Use Change child to move a package to another child.', '3b: the admin''s direct write is refused too — Change child is the route');
RESET ROLE;
SELECT throws_ok($$ UPDATE parent_packages SET student_id = NULL WHERE id = '5c700000-0000-0000-0000-000000000001' $$,
  '23514', 'Whether a package is shared or for one child is part of the sale and cannot be changed.',
  '3c: one-child → shared is refused for every role, the backend included (D2)');
SELECT is((SELECT student_id FROM parent_packages WHERE id = '5c700000-0000-0000-0000-000000000001'), pg_temp.kid('01'),
  '3d: ...and the row still belongs to Ava');

-- ══ 4. D11 — one kind per family; D2/D6 — a flip affects new sales only ═══════════════════════════════════════════
SELECT pg_temp.sell('5c700000-0000-0000-0000-000000000002', 'P2', 'SH2', (SELECT d42 FROM f), NULL);  -- P2 shared, 2 lessons
SELECT throws_ok($$ SELECT pg_temp.sell(NULL, 'P2', 'OC5', (SELECT d42 FROM f), '03') $$,
  '23514', 'This family already has a shared package that is pending or has lessons left — a one-child package can be bought once it is used up.',
  '4a: a one-child sale to a family holding a live shared package is refused (D11)');
SELECT throws_ok($$ SELECT pg_temp.sell(NULL, 'P1', 'SH2', (SELECT d42 FROM f), NULL) $$,
  '23514', 'This family has a one-child package that is pending or has lessons left — a shared package can be bought once it is used up.',
  '4b: a shared sale to a family holding a pending one-child request is refused (D11)');
SELECT pg_temp.sell('5c700000-0000-0000-0000-000000000003', 'P3', 'SH1', (SELECT d21 FROM f), NULL);
SELECT pg_temp.mark((SELECT d21 FROM f), '06', 'present');
SELECT is(pg_temp.rem('5c700000-0000-0000-0000-000000000003'), 0.00::numeric, '4c: precondition — Eve''s shared package is used up');
SELECT lives_ok($$ SELECT pg_temp.sell(NULL, 'P3', 'OC5', (SELECT d21 FROM f), '06') $$,
  '4d: ...so the family may now switch to a one-child package (D11)');
SELECT pg_temp.as_user(pg_temp.parent_uid('P5'));
SET LOCAL ROLE authenticated;
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id)
VALUES ('5c700000-0000-0000-0000-000000000005', '5c000000-0000-0000-0000-0000000000a0', pg_temp.id('P5'), pg_temp.prod('SHX'));
RESET ROLE;
UPDATE package_products SET single_child = TRUE WHERE name = 'SHX';
SELECT pg_temp.as_user('5c100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ UPDATE parent_packages SET status = 'active' WHERE id = '5c700000-0000-0000-0000-000000000005' $$,
  '4e: a shared request made before the product was flipped to one-child can still be confirmed (RISK 7)');
RESET ROLE;
SELECT is((SELECT status || '/' || COALESCE(student_id::text, 'shared') FROM parent_packages WHERE id = '5c700000-0000-0000-0000-000000000005'),
  'active/shared', '4f: ...and it keeps the terms it was sold under (D2/D6)');

-- ══ 5. P1: the child draws, the sibling is ad-hoc; PK001 per child ════════════════════════════════════════════════
SELECT pg_temp.sell('5c700000-0000-0000-0000-000000000011', 'P1', 'OC2', (SELECT d42 FROM f), '01');  -- OA: Ava, 2 lessons
SELECT is((SELECT status || '/' || start_date || '/' || (expires_on >= (SELECT d14 FROM f)) || '/' || value_remaining
             FROM parent_packages WHERE id = '5c700000-0000-0000-0000-000000000011'),
  'active/2026-08-29/true/60.00', '5a: precondition — Ava''s package is active, covers d14 and holds 2 lessons');
SELECT throws_ok($$ SELECT pg_temp.mark((SELECT d14 FROM f), '01', 'present') $$,
  'PK001', 'Mark 12 Sept first — the package has 2 lessons left. (SC Ava · SC Dolphins) Nothing was saved.',
  '5b: PK001 still fires for the package child''s OWN earlier unmarked lessons (RISK 2 — not failed open)');
SELECT pg_temp.mark(d, '01', 'absent') FROM f, LATERAL (VALUES (f.d28), (f.d21)) v(d);
SELECT lives_ok($$ SELECT pg_temp.mark((SELECT d14 FROM f), '01', 'present') $$,
  '5c: a sibling''s earlier unmarked lessons do NOT block a one-child package (Ben''s d28, d21 are unmarked)');
SELECT is(pg_temp.drawn((SELECT d14 FROM f), '01') || '/' || pg_temp.rem('5c700000-0000-0000-0000-000000000011'),
  '5c700000-0000-0000-0000-000000000011/30.00', '5d: ...and Ava''s lesson drew from her package');
SELECT pg_temp.mark(d, '02', 'absent') FROM f, LATERAL (VALUES (f.d28), (f.d21)) v(d);
SELECT pg_temp.mark((SELECT d14 FROM f), '02', 'present');
SELECT is(pg_temp.drawn((SELECT d14 FROM f), '02') || '/' || pg_temp.rem('5c700000-0000-0000-0000-000000000011'),
  'none/30.00', '5e: Ben''s lesson inside Ava''s package window is ad-hoc — no draw, balance unchanged');
-- Controls on the SHARED family P2 (2 lessons): the sibling counts for PK001, and the sibling draws.
SELECT pg_temp.mark(d, '03', 'absent') FROM f, LATERAL (VALUES (f.d28), (f.d21)) v(d);
SELECT throws_ok($$ SELECT pg_temp.mark((SELECT d14 FROM f), '03', 'present') $$,
  'PK001', 'Mark 12 Sept first — the package has 2 lessons left. (SC Dee · SC Dolphins) Nothing was saved.',
  '5f: control — a SHARED package still counts a sibling''s earlier unmarked lessons');
SELECT pg_temp.mark(d, '04', 'absent') FROM f, LATERAL (VALUES (f.d28), (f.d21)) v(d);
SELECT pg_temp.mark((SELECT d14 FROM f), '04', 'present');
SELECT is(pg_temp.drawn((SELECT d14 FROM f), '04'), '5c700000-0000-0000-0000-000000000002',
  '5g: control — the same sibling lesson DOES draw from a shared package');

-- ══ 6. Backlog and coverage per child ═══════════════════════════════════════════════════════════════════════════
SELECT pg_temp.mark((SELECT d7 FROM f), '01', 'present');   -- Ava draws OA's last lesson
SELECT pg_temp.mark((SELECT d7 FROM f), '02', 'present');   -- Ben ad-hoc
SELECT pg_temp.mark((SELECT d0 FROM f), '01', 'present');   -- Ava ad-hoc (OA used up)
SELECT pg_temp.mark((SELECT d0 FROM f), '02', 'present');   -- Ben ad-hoc
SELECT pg_temp.sell('5c700000-0000-0000-0000-000000000012', 'P1', 'OC5', (SELECT d42 FROM f), '01');  -- OA2: Ava
SELECT is((SELECT string_agg(student_id || '@' || session_date, ',' ORDER BY session_date, student_id)
             FROM package_backlog_lessons('5c700000-0000-0000-0000-000000000012')),
  pg_temp.kid('01') || '@2026-10-10', '6a: the backlog lists only the package child''s undrawn lessons (Ben''s d14, d7, d0 are not)');
SELECT is((SELECT string_agg(c.student_id || ':' || c.coverage || ':' || COALESCE(c.lessons_remaining::text, '-'), ','
                             ORDER BY c.student_id)
             FROM student_package_coverage() c WHERE c.parent_id = pg_temp.id('P1') AND c.student_id IN (pg_temp.kid('01'), pg_temp.kid('02'))),
  pg_temp.kid('01') || ':package:5,' || pg_temp.kid('02') || ':ad_hoc:-',
  '6b: coverage — Ava "Package · 5" (her own), Ben "Ad-hoc"');

-- ══ 7. D5 — own pays first (P7: Kim own + shared, after a reversal) ═══════════════════════════════════════════════
SELECT pg_temp.sell('5c700000-0000-0000-0000-000000000021', 'P7', 'SH1', (SELECT d21 FROM f), NULL);  -- SHk: shared, 1 lesson, 10 wk
SELECT pg_temp.mark((SELECT d21 FROM f), '09', 'present');  -- draws SHk → used up
SELECT pg_temp.mark((SELECT d7 FROM f), '09', 'present');   -- nothing to draw: ad-hoc, undrawn
SELECT pg_temp.sell('5c700000-0000-0000-0000-000000000022', 'P7', 'OC5', (SELECT d21 FROM f), '09');  -- OK: Kim's own, 20 wk
SELECT pg_temp.mark((SELECT d21 FROM f), '09', 'absent');   -- the reversal returns SHk's lesson: both kinds now live
SELECT is((SELECT array_agg(c.package_id ORDER BY c.draw_rank)::text FROM package_candidates_for(pg_temp.s((SELECT d14 FROM f)), pg_temp.kid('09')) c),
  '{5c700000-0000-0000-0000-000000000022,5c700000-0000-0000-0000-000000000021}',
  '7a: precondition — both are candidates for Kim, and her own (later-expiring) package ranks first');
SELECT pg_temp.as_user('5c100000-0000-0000-0000-0000000000a1');
SELECT is((SELECT funding_package_id FROM package_backlog_preview('5c700000-0000-0000-0000-000000000022') WHERE session_date = (SELECT d7 FROM f)),
  '5c700000-0000-0000-0000-000000000022'::uuid, '7b: the backlog preview funds Kim''s lesson from her own package first (D5)');
SELECT is(holiday_covering_package(pg_temp.kid('09'), (SELECT d14 FROM f), '5c400000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000a0')
          || '/' ||
          holiday_covering_package(pg_temp.kid('0a'), (SELECT d14 FROM f), '5c400000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000a0'),
  '5c700000-0000-0000-0000-000000000022/5c700000-0000-0000-0000-000000000021',
  '7c: a holiday extends the package that would have paid — Kim''s own; Lou''s is the shared one');
SELECT lives_ok($$ SELECT pg_temp.mark((SELECT d14 FROM f), '09', 'present') $$,
  '7d: PK001 judges Kim''s own package (Lou''s earlier unmarked d21 would block the shared one)');
SELECT is(pg_temp.drawn((SELECT d14 FROM f), '09'), '5c700000-0000-0000-0000-000000000022',
  '7e: ...and the draw took Kim''s own package before the earlier-expiring shared one (D5)');

-- ══ 8. reassign_package_child (P8: Mia → Nia) ════════════════════════════════════════════════════════════════════
SELECT pg_temp.sell('5c700000-0000-0000-0000-000000000031', 'P8', 'OC5', (SELECT d42 FROM f), '0b');  -- OM: Mia
SELECT pg_temp.mark((SELECT d28 FROM f), '0b', 'holiday');
SELECT is((SELECT holiday_extension_days || '/' || expires_on FROM parent_packages WHERE id = '5c700000-0000-0000-0000-000000000031'),
  '7/2027-01-23', '8a: precondition — Mia''s holiday extended her package by 7 days');
SELECT pg_temp.as_user('5c100000-0000-0000-0000-0000000000c1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT reassign_package_child('5c700000-0000-0000-0000-000000000031', pg_temp.kid('0c')) $$, '42501', NULL, '8b: a coach is refused');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.parent_uid('P8'));
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT reassign_package_child('5c700000-0000-0000-0000-000000000031', pg_temp.kid('0c')) $$, '42501', NULL, '8c: the family''s parent is refused');
RESET ROLE;
SELECT pg_temp.as_user('5c100000-0000-0000-0000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT reassign_package_child('5c700000-0000-0000-0000-000000000031', pg_temp.kid('0c')) $$, '42501', NULL, '8d: another business''s admin is refused');
RESET ROLE;
SELECT pg_temp.as_user('5c100000-0000-0000-0000-0000000000e1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT reassign_package_child('5c700000-0000-0000-0000-000000000031', pg_temp.kid('0c')) $$, '42501', NULL, '8e: a view-only co-admin is refused');
RESET ROLE;
SELECT pg_temp.as_user('5c100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT reassign_package_child('5c700000-0000-0000-0000-000000000031', pg_temp.kid('0c')) $$,
  '8f: the admin moves an unused package from Mia to Nia');
RESET ROLE;
SELECT is((SELECT student_id || '/' || holiday_extension_days || '/' || expires_on
                  || '/' || (SELECT count(*) FROM package_holiday_extensions WHERE parent_package_id = '5c700000-0000-0000-0000-000000000031')
             FROM parent_packages WHERE id = '5c700000-0000-0000-0000-000000000031'),
  pg_temp.kid('0c') || '/0/2027-01-16/0', '8g: Mia''s holiday extension did not follow the package to Nia (RISK 10)');
SELECT is((SELECT (old_value->>'student_id') || '>' || (new_value->>'student_id') FROM audit_log
            WHERE action = 'package_child_reassigned' AND entity_id = '5c700000-0000-0000-0000-000000000031'),
  pg_temp.kid('0b') || '>' || pg_temp.kid('0c'), '8h: an audit row records the old and new child');
SELECT throws_ok($$ SELECT reassign_package_child('5c700000-0000-0000-0000-000000000031', pg_temp.kid('0c')) $$,
  '23514', 'The package is already for that child.', '8i: reassigning to the current child is refused');
SELECT throws_ok($$ SELECT reassign_package_child('5c700000-0000-0000-0000-000000000002', pg_temp.kid('03')) $$,
  '23514', 'This package is shared — it is not tied to one child.', '8j: a shared package cannot be reassigned');
SELECT pg_temp.mark(d, '0c', 'absent') FROM f, LATERAL (VALUES (f.d42), (f.d35), (f.d28), (f.d21), (f.d14)) v(d);
SELECT pg_temp.mark((SELECT d7 FROM f), '0c', 'present');
SELECT is(pg_temp.drawn((SELECT d7 FROM f), '0c'), '5c700000-0000-0000-0000-000000000031', '8k: precondition — Nia''s lesson drew from it');
SELECT throws_ok($$ SELECT reassign_package_child('5c700000-0000-0000-0000-000000000031', pg_temp.kid('0b')) $$,
  '23514', 'A lesson has already drawn from this package — refund it instead.', '8l: refused once any lesson has drawn (D4)');
SELECT pg_temp.mark((SELECT d7 FROM f), '0c', 'absent');
SELECT is(pg_temp.drawn((SELECT d7 FROM f), '0c') || '/' || pg_temp.rem('5c700000-0000-0000-0000-000000000031'),
  'none/150.00', '8m: precondition — the draw was reversed and the balance restored');
SELECT throws_ok($$ SELECT reassign_package_child('5c700000-0000-0000-0000-000000000031', pg_temp.kid('0b')) $$,
  '23514', 'A lesson has already drawn from this package — refund it instead.', '8n: still refused after the draw was reversed — "ever drawn"');

-- ══ 9. Renewal rows and offers per child (D8, RISK 4) ════════════════════════════════════════════════════════════
SELECT pg_temp.sell('5c700000-0000-0000-0000-000000000041', 'P9', 'OC2', (SELECT d42 FROM f), '0d');   -- Oli: 2 → low
SELECT pg_temp.sell('5c700000-0000-0000-0000-000000000042', 'P9', 'OC10', (SELECT d42 FROM f), '0e');  -- Pia: 10
SELECT pg_temp.sell('5c700000-0000-0000-0000-000000000043', 'P10', 'OC2', (SELECT d42 FROM f), '0f');  -- Qin: low
SELECT pg_temp.sell('5c700000-0000-0000-0000-000000000044', 'P10', 'OC2', (SELECT d42 FROM f), '10');  -- Ray: low
SELECT is((SELECT string_agg(c.student_id || ':' || c.low, ',' ORDER BY c.student_id) FROM student_package_coverage() c
            WHERE c.parent_id = pg_temp.id('P9')),
  pg_temp.kid('0d') || ':true,' || pg_temp.kid('0e') || ':false', '9a: precondition — Oli is low on his own package, Pia is not');
SELECT is((SELECT string_agg(COALESCE(r.student_id::text, 'family') || ':' || r.children || ':' || r.lessons_left, ',')
             FROM package_renewal_candidates() r WHERE r.parent_id = pg_temp.id('P9')),
  pg_temp.kid('0d') || ':SC Oli:2', '9b: one renewal row — Oli''s own, naming him (D8)');
SELECT is((SELECT string_agg(r.student_id::text, ',' ORDER BY r.student_id) FROM package_renewal_candidates() r WHERE r.parent_id = pg_temp.id('P10')),
  pg_temp.kid('0f') || ',' || pg_temp.kid('10'), '9c: two children low on their own packages → two rows');
SELECT pg_temp.as_user('5c100000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ SELECT create_package_offer(pg_temp.id('P9'), pg_temp.prod('OC5'), (SELECT n7 FROM f), pg_temp.kid('0d')) $$,
  '9d: an offer for Oli...');
SELECT lives_ok($$ SELECT create_package_offer(pg_temp.id('P9'), pg_temp.prod('OC5'), (SELECT n7 FROM f), pg_temp.kid('0e')) $$,
  '9e: ...and one for Pia can both be open (RISK 4)');
SELECT throws_ok($$ SELECT create_package_offer(pg_temp.id('P9'), pg_temp.prod('OC5'), (SELECT n7 FROM f), pg_temp.kid('0d')) $$,
  '23505', 'An offer is already open for SC Oli — Decline it first.', '9f: a second open offer for Oli is refused');
SELECT create_package_offer(pg_temp.id('P10'), pg_temp.prod('OC2'), (SELECT n7 FROM f), pg_temp.kid('0f'));
SELECT is((SELECT string_agg(r.student_id || ':' || r.has_open_offer, ',') FROM package_renewal_candidates() r WHERE r.parent_id = pg_temp.id('P10')),
  pg_temp.kid('10') || ':false', '9g: Qin''s open offer clears only Qin''s row; Ray''s row shows no offer of its own');
SELECT pg_temp.as_user(pg_temp.parent_uid('P9'));
SET LOCAL ROLE authenticated;
INSERT INTO parent_packages (tenant_id, parent_id, product_id, student_id)
VALUES ('5c000000-0000-0000-0000-0000000000a0', pg_temp.id('P9'), pg_temp.prod('OC5'), pg_temp.kid('0e'));
RESET ROLE;
SELECT is((SELECT string_agg(s.full_name || ':' || pp.status, ',' ORDER BY s.full_name) FROM parent_packages pp JOIN students s ON s.id = pp.student_id
            WHERE pp.parent_id = pg_temp.id('P9') AND pp.offered_by IS NOT NULL),
  'SC Oli:pending,SC Pia:cancelled', '9h: Pia''s request supersedes Pia''s offer, never Oli''s');

-- ══ 10. Referral handoff per audience (RISK 3) ═══════════════════════════════════════════════════════════════════
INSERT INTO referral_rewards (id, tenant_id, parent_id, kind, referral_id, status)
VALUES ('5c900000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000a0', pg_temp.id('P11'), 'manual', NULL, 'available');
SELECT pg_temp.as_user('5c100000-0000-0000-0000-0000000000a1');
CREATE TEMP TABLE sam_offer AS
SELECT create_package_offer(pg_temp.id('P11'), pg_temp.prod('OC5'), (SELECT n7 FROM f), pg_temp.kid('11')) AS id;
GRANT SELECT ON sam_offer TO PUBLIC;
SELECT is((SELECT referral_reward_id || '/' || discount_amount FROM parent_packages WHERE id = (SELECT id FROM sam_offer)),
  '5c900000-0000-0000-0000-000000000001/15.00', '10a: precondition — Sam''s offer holds the family''s reward');
SELECT pg_temp.as_user(pg_temp.parent_uid('P11'));
SET LOCAL ROLE authenticated;
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, student_id)
VALUES ('5c700000-0000-0000-0000-000000000051', '5c000000-0000-0000-0000-0000000000a0', pg_temp.id('P11'), pg_temp.prod('OC5'), pg_temp.kid('12'));
RESET ROLE;
SELECT is((SELECT discount_amount || '/' || COALESCE(referral_reward_id::text, 'none') FROM parent_packages WHERE id = '5c700000-0000-0000-0000-000000000051')
          || '|' || (SELECT status || '/' || referral_reward_id || '/' || discount_amount FROM parent_packages WHERE id = (SELECT id FROM sam_offer))
          || '|' || (SELECT count(*) FROM parent_packages WHERE referral_reward_id = '5c900000-0000-0000-0000-000000000001' AND status <> 'cancelled'),
  '0.00/none|pending/5c900000-0000-0000-0000-000000000001/15.00|1',
  '10b: Tom''s request does not take the reward Sam''s offer holds — no double discount (RISK 3)');
SELECT pg_temp.as_user(pg_temp.parent_uid('P11'));
SET LOCAL ROLE authenticated;
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, student_id)
VALUES ('5c700000-0000-0000-0000-000000000052', '5c000000-0000-0000-0000-0000000000a0', pg_temp.id('P11'), pg_temp.prod('OC5'), pg_temp.kid('11'));
RESET ROLE;
SELECT is((SELECT COALESCE(referral_reward_id::text, 'none') FROM parent_packages WHERE id = '5c700000-0000-0000-0000-000000000052')
          || '|' || (SELECT status FROM parent_packages WHERE id = (SELECT id FROM sam_offer))
          || '|' || (SELECT count(*) FROM parent_packages WHERE referral_reward_id = '5c900000-0000-0000-0000-000000000001' AND status <> 'cancelled'),
  '5c900000-0000-0000-0000-000000000001|cancelled|1', '10c: Sam''s own request still takes over his offer''s reward (§7.165 kept)');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT throws_ok($$ UPDATE parent_packages SET referral_reward_id = '5c900000-0000-0000-0000-000000000001'
                    WHERE id = '5c700000-0000-0000-0000-000000000051' $$,
  '23P01', NULL, '10d: the EXCLUDE constraint refuses a second live package on one reward');

-- ══ 11. Trials ═══════════════════════════════════════════════════════════════════════════════════════════════════
SELECT pg_temp.sell('5c700000-0000-0000-0000-000000000061', 'P12', 'OC5', (SELECT d42 FROM f), '13');  -- Uma's own
SELECT pg_temp.as_user('5c100000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ SELECT book_trial('5c500000-0000-0000-0000-000000000001', (SELECT n7 FROM f), pg_temp.kid('14')) $$,
  '11a: Vic can take a trial although his sister holds a one-child package');
SELECT throws_ok($$ SELECT book_trial('5c500000-0000-0000-0000-000000000001', (SELECT n7 FROM f), pg_temp.kid('05')) $$,
  'P0001', 'that family already has a prepaid package with this business — a trial is for new families',
  '11b: control — Wes is still refused while his family holds a shared package');

-- ══ 12. Merges and cross-business moves ══════════════════════════════════════════════════════════════════════════
SELECT pg_temp.sell('5c700000-0000-0000-0000-000000000071', 'P13', 'OC5', (SELECT d42 FROM f), '16');  -- on the duplicate
SELECT pg_temp.as_user('5c100000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ SELECT * FROM merge_students(pg_temp.kid('15'), pg_temp.kid('16')) $$,
  '12a: merging a duplicate that holds a one-child package succeeds (the RESTRICT FK does not abort it)');
SELECT is((SELECT student_id FROM parent_packages WHERE id = '5c700000-0000-0000-0000-000000000071') || '/'
          || EXISTS (SELECT 1 FROM parent_students WHERE parent_id = pg_temp.id('P13') AND student_id = pg_temp.kid('15')),
  pg_temp.kid('15') || '/true', '12b: ...the package now belongs to the survivor, who is linked to its parent');
SELECT pg_temp.as_user('5c100000-0000-0000-0000-0000000000f1');
SELECT throws_ok($$ SELECT reassign_student_tenant(pg_temp.kid('15'), '5c000000-0000-0000-0000-0000000000b0') $$,
  'P0001', 'This child holds a one-child package — reassign, refund or cancel their package first',
  '12c: a child holding a one-child package cannot be moved to another business');

-- ══ 13. D9 — the flag cannot go off while a one-child package is held ════════════════════════════════════════════
SELECT throws_ok($$ UPDATE tenants SET package_draw_at_marking = FALSE WHERE id = '5c000000-0000-0000-0000-0000000000a0' $$,
  '23514', NULL, '13a: switching draw-at-marking off is refused while one-child packages are held');
SELECT lives_ok($$ UPDATE tenants SET package_draw_at_marking = FALSE WHERE id = '5c000000-0000-0000-0000-0000000000b0' $$,
  '13b: control — a business holding none can still switch it off');

SELECT * FROM finish();
ROLLBACK;
