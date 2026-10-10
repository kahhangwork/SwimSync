-- Fixture for verify-single-child-packages.mjs — single-child packages (docs/plans/SINGLE_CHILD_PACKAGES_PLAN.md,
-- 20261010000100). Prefix scp / ids a5c00000-.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-single-child-packages.sql
--
-- ONE business, "SCP Swim" (switch ON — asserted), owner scp-owner@swimsync.test (tenant admin AND coach).
--   Products: "SCP One Child" (one child only, 5 × $30) and "SCP Shared" (shared, 5 × $30).
--   SCP Parent — Ava and Ben, both in "SCP Dolphins" (weekday T−1) from T−8. Ava holds her OWN "SCP One Child"
--     package from T−14. T−8 is marked present for BOTH: Ava's draws (5 → 4), Ben's is ad-hoc (a sibling).
--   SCP Solo Parent — Cai, their only child here, no package (the admin's one-child sale, D7 auto-pick).
--
-- Dates: every one derived from app_today() (§7.94, §7.305). T−14 is a package START only; the earliest LESSON,
-- T−8, is ≥ markable_floor for a business created today (the 1st of last month, §7.319).
-- IDEMPOTENT: it begins with the teardown's own block. Teardown: fixtures-single-child-packages-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

-- ── Clean slate (same block as the teardown) ────────────────────────────────────────────────────────────────
DELETE FROM attendance            WHERE student_id::text LIKE 'a5c00000-%';
DELETE FROM package_applications  WHERE parent_package_id IN (SELECT id FROM parent_packages WHERE tenant_id::text LIKE 'a5c00000-%');
DELETE FROM lesson_sessions       WHERE class_id::text LIKE 'a5c00000-%';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'a5c00000-%';
DELETE FROM parent_packages       WHERE tenant_id::text LIKE 'a5c00000-%';
UPDATE tenants SET owner_profile_id = NULL, default_package_product_id = NULL WHERE id::text LIKE 'a5c00000-%';
DELETE FROM package_products      WHERE tenant_id::text LIKE 'a5c00000-%';
DELETE FROM parent_students       WHERE student_id::text LIKE 'a5c00000-%';
DELETE FROM students              WHERE id::text LIKE 'a5c00000-%';
DELETE FROM classes               WHERE tenant_id::text LIKE 'a5c00000-%';
DELETE FROM locations             WHERE tenant_id::text LIKE 'a5c00000-%';
DELETE FROM class_categories      WHERE tenant_id::text LIKE 'a5c00000-%';
DELETE FROM parent_tenant_balances WHERE tenant_id::text LIKE 'a5c00000-%';
DELETE FROM parent_tenants        WHERE tenant_id::text LIKE 'a5c00000-%';
DELETE FROM audit_log             WHERE tenant_id::text LIKE 'a5c00000-%' OR actor_id::text LIKE 'a5c00000-%';
DELETE FROM coaches               WHERE profile_id::text LIKE 'a5c00000-%';
DELETE FROM parents               WHERE profile_id::text LIKE 'a5c00000-%';
DELETE FROM profiles              WHERE id::text LIKE 'a5c00000-%';
DELETE FROM auth.users            WHERE id::text LIKE 'a5c00000-%';
DELETE FROM tenants               WHERE id::text LIKE 'a5c00000-%';


CREATE TEMP TABLE _scp ON COMMIT DROP AS SELECT app_today() AS t;
CREATE FUNCTION pg_temp.wd(d date) RETURNS day_of_week LANGUAGE sql IMMUTABLE AS $$
  SELECT ((ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])
          [EXTRACT(DOW FROM d)::int + 1])::day_of_week
$$;
CREATE FUNCTION pg_temp.sgt(d date) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT d::timestamp AT TIME ZONE 'Asia/Singapore'
$$;

-- ── The business and its people ─────────────────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('a5c00000-0000-0000-0000-000000000001', 'scp-swim', 'SCP Swim', 'SWIM-SCPS');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenants WHERE id = 'a5c00000-0000-0000-0000-000000000001' AND NOT package_draw_at_marking) THEN
    RAISE EXCEPTION 'scp fixture: the business does not draw at marking — one-child packages are refused there (D9)';
  END IF;
END $$;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email,
       crypt('password123', gen_salt('bf')), now(),  -- clock-real: auth.users stamps are real time
       '{"provider":"email","providers":["email"]}', u.meta::jsonb, now(), now(), '', '', '', ''  -- clock-real: auth.users stamps are real time
  FROM (VALUES
    ('a5c00000-0000-0000-0000-0000000000a1', 'scp-owner@swimsync.test',
     '{"full_name":"SCP Owner","role":"tenant_admin","is_coach":true,"tenant_id":"a5c00000-0000-0000-0000-000000000001"}'),
    ('a5c00000-0000-0000-0000-0000000000f1', 'scp-parent@swimsync.test', '{"full_name":"SCP Parent","role":"parent"}'),
    ('a5c00000-0000-0000-0000-0000000000f2', 'scp-solo@swimsync.test',   '{"full_name":"SCP Solo Parent","role":"parent"}')
  ) AS u(id, email, meta);

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'a5c00000-0000-0000-0000-000000000001' FROM parents p WHERE p.profile_id::text LIKE 'a5c00000-%';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('a5c00000-0000-0000-0000-00000000c001', 'a5c00000-0000-0000-0000-000000000001', 'SCP Group');
INSERT INTO locations (id, tenant_id, name) VALUES
  ('a5c00000-0000-0000-0000-0000000010c1', 'a5c00000-0000-0000-0000-000000000001', 'SCP Pool');
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time, location_id,
                     price_per_lesson, category_id)
SELECT 'a5c00000-0000-0000-0000-00000000c1a0', 'a5c00000-0000-0000-0000-000000000001', co.id, 'SCP Dolphins',
       pg_temp.wd(_scp.t - 1), '16:00', '16:45', 'a5c00000-0000-0000-0000-0000000010c1', 30.00,
       'a5c00000-0000-0000-0000-00000000c001'
  FROM _scp, coaches co WHERE co.profile_id = 'a5c00000-0000-0000-0000-0000000000a1';

INSERT INTO students (id, full_name, date_of_birth, assignment_status, is_active, tenant_id)
SELECT s.id::uuid, s.name, (app_now() - INTERVAL '8 years')::date, 'assigned', true, 'a5c00000-0000-0000-0000-000000000001'
  FROM (VALUES ('a5c00000-0000-0000-0000-0000000005a0', 'Ava Scp'),
               ('a5c00000-0000-0000-0000-0000000005b0', 'Ben Scp'),
               ('a5c00000-0000-0000-0000-0000000005c0', 'Cai Scp')) AS s(id, name);
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, x.sid::uuid
  FROM (VALUES ('a5c00000-0000-0000-0000-0000000000f1', 'a5c00000-0000-0000-0000-0000000005a0'),
               ('a5c00000-0000-0000-0000-0000000000f1', 'a5c00000-0000-0000-0000-0000000005b0'),
               ('a5c00000-0000-0000-0000-0000000000f2', 'a5c00000-0000-0000-0000-0000000005c0')) AS x(par, sid)
  JOIN parents p ON p.profile_id = x.par::uuid;
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT x.sid::uuid, 'a5c00000-0000-0000-0000-00000000c1a0', pg_temp.sgt(_scp.t - 8), true
  FROM _scp, (VALUES ('a5c00000-0000-0000-0000-0000000005a0'), ('a5c00000-0000-0000-0000-0000000005b0')) AS x(sid);

-- ── Products and Ava's own package ──────────────────────────────────────────────────────────────────────────
INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count, rate_per_lesson,
                              validity_months, validity_weeks, single_child) VALUES
  ('a5c00000-0000-0000-0000-00000000d0a0', 'a5c00000-0000-0000-0000-000000000001', 'SCP One Child', NULL, 5, 30.00, 6, 26, true),
  ('a5c00000-0000-0000-0000-00000000d0b0', 'a5c00000-0000-0000-0000-000000000001', 'SCP Shared',    NULL, 5, 30.00, 6, 26, false);
INSERT INTO parent_packages (id, parent_id, product_id, status, start_date, confirmed_at, student_id)
SELECT 'a5c00000-0000-0000-0000-00000000e0a0', p.id, 'a5c00000-0000-0000-0000-00000000d0a0', 'active',
       _scp.t - 14, pg_temp.sgt(_scp.t - 14), 'a5c00000-0000-0000-0000-0000000005a0'
  FROM parents p, _scp WHERE p.profile_id = 'a5c00000-0000-0000-0000-0000000000f1';

-- ── T−8: both siblings present. Ava's draws from her package; Ben's is ad-hoc. ──────────────────────────────
INSERT INTO lesson_sessions (class_id, session_date, status)
SELECT 'a5c00000-0000-0000-0000-00000000c1a0', _scp.t - 8, 'completed' FROM _scp;
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
SELECT ls.id, x.sid::uuid, 'present', 'a5c00000-0000-0000-0000-0000000000a1'
  FROM _scp, lesson_sessions ls,
       (VALUES ('a5c00000-0000-0000-0000-0000000005a0'), ('a5c00000-0000-0000-0000-0000000005b0')) AS x(sid)
 WHERE ls.class_id = 'a5c00000-0000-0000-0000-00000000c1a0' AND ls.session_date = _scp.t - 8;

-- ── The starting state the driver relies on — refuse to load anything else ──────────────────────────────────
DO $$
DECLARE v RECORD;
BEGIN
  SELECT (SELECT value_remaining FROM parent_packages WHERE id = 'a5c00000-0000-0000-0000-00000000e0a0') AS ava,
         (SELECT count(*) FROM package_applications WHERE student_id = 'a5c00000-0000-0000-0000-0000000005b0') AS ben_draws
    INTO v;
  IF v.ava <> 120 OR v.ben_draws <> 0 THEN
    RAISE EXCEPTION 'scp fixture: unexpected starting state %', row_to_json(v);
  END IF;
END $$;

COMMIT;
