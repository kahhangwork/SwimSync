-- Fixture for verify-carried-over-package.mjs — carried-over packages (docs/plans/CARRIED_OVER_PACKAGES_PLAN.md,
-- 20261118000200). Prefix cop / ids c0a00000-.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-carried-over-package.sql
--
-- ONE business, "COP Swim", owner cop-owner@swimsync.test (tenant admin AND coach).
--   Product "COP Ten" — shared, 10 × $30, 10 weeks.
--   COP Parent — Ava Cop, in "COP Dolphins" (TODAY's weekday) from T−42. NO package: the driver brings one in.
--   COP Referred — no child, no package; joined with COP Parent's REF- code: a PENDING referral + its unused
--     referee_first reward. Bringing in their package is REFUSED until the admin voids the referral
--     (docs/plans/CARRIED_OVER_REFERRAL_BLOCK_PLAN.md, 20261118000400). COP Parent is then a REFERRER — still allowed.
--
-- Dates: every one derived from app_today() (§7.94, §7.305). T−42 is an enrolment/package start only — no lesson
-- before today is marked, so markable_floor never matters here.
-- IDEMPOTENT: it begins with the teardown's own block. Teardown: fixtures-carried-over-package-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

-- ── Clean slate (same block as the teardown) ────────────────────────────────────────────────────────────────
DELETE FROM attendance            WHERE student_id::text LIKE 'c0a00000-%';
DELETE FROM package_applications  WHERE parent_package_id IN (SELECT id FROM parent_packages WHERE tenant_id::text LIKE 'c0a00000-%');
DELETE FROM package_refunds       WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM package_holiday_extensions WHERE parent_package_id IN (SELECT id FROM parent_packages WHERE tenant_id::text LIKE 'c0a00000-%');
DELETE FROM package_cancel_extensions  WHERE parent_package_id IN (SELECT id FROM parent_packages WHERE tenant_id::text LIKE 'c0a00000-%');
DELETE FROM package_extension_events   WHERE parent_package_id IN (SELECT id FROM parent_packages WHERE tenant_id::text LIKE 'c0a00000-%');
DELETE FROM lesson_sessions       WHERE class_id::text LIKE 'c0a00000-%';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'c0a00000-%';
DELETE FROM referral_rewards      WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM referrals             WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM parent_packages       WHERE tenant_id::text LIKE 'c0a00000-%';
UPDATE tenants SET owner_profile_id = NULL, default_package_product_id = NULL WHERE id::text LIKE 'c0a00000-%';
DELETE FROM package_products      WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM parent_students       WHERE student_id::text LIKE 'c0a00000-%';
DELETE FROM students              WHERE id::text LIKE 'c0a00000-%';
DELETE FROM classes               WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM locations             WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM class_categories      WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM parent_tenant_balances WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM parent_tenants        WHERE tenant_id::text LIKE 'c0a00000-%';
DELETE FROM audit_log             WHERE tenant_id::text LIKE 'c0a00000-%' OR actor_id::text LIKE 'c0a00000-%';
DELETE FROM coaches               WHERE profile_id::text LIKE 'c0a00000-%';
DELETE FROM parents               WHERE profile_id::text LIKE 'c0a00000-%';
DELETE FROM profiles              WHERE id::text LIKE 'c0a00000-%';
DELETE FROM auth.users            WHERE id::text LIKE 'c0a00000-%';
DELETE FROM tenants               WHERE id::text LIKE 'c0a00000-%';

CREATE TEMP TABLE _cop ON COMMIT DROP AS SELECT app_today() AS t;
CREATE FUNCTION pg_temp.wd(d date) RETURNS day_of_week LANGUAGE sql IMMUTABLE AS $$
  SELECT ((ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])
          [EXTRACT(DOW FROM d)::int + 1])::day_of_week
$$;
CREATE FUNCTION pg_temp.sgt(d date) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT d::timestamp AT TIME ZONE 'Asia/Singapore'
$$;

-- ── The business and its people ─────────────────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('c0a00000-0000-0000-0000-000000000001', 'cop-swim', 'COP Swim', 'SWIM-COPS');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email,
       crypt('password123', gen_salt('bf')), now(),  -- clock-real: auth.users stamps are real time
       '{"provider":"email","providers":["email"]}', u.meta::jsonb, now(), now(), '', '', '', ''  -- clock-real: auth.users stamps are real time
  FROM (VALUES
    ('c0a00000-0000-0000-0000-0000000000a1', 'cop-owner@swimsync.test',
     '{"full_name":"COP Owner","role":"tenant_admin","is_coach":true,"tenant_id":"c0a00000-0000-0000-0000-000000000001"}'),
    ('c0a00000-0000-0000-0000-0000000000f1', 'cop-parent@swimsync.test', '{"full_name":"COP Parent","role":"parent"}'),
    ('c0a00000-0000-0000-0000-0000000000f2', 'cop-referred@swimsync.test', '{"full_name":"COP Referred","role":"parent"}')
  ) AS u(id, email, meta);
UPDATE tenants SET owner_profile_id = 'c0a00000-0000-0000-0000-0000000000a1' WHERE id = 'c0a00000-0000-0000-0000-000000000001';

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'c0a00000-0000-0000-0000-000000000001' FROM parents p WHERE p.profile_id::text LIKE 'c0a00000-%';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('c0a00000-0000-0000-0000-00000000c001', 'c0a00000-0000-0000-0000-000000000001', 'COP Group');
INSERT INTO locations (id, tenant_id, name) VALUES
  ('c0a00000-0000-0000-0000-0000000010c1', 'c0a00000-0000-0000-0000-000000000001', 'COP Pool');
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time, location_id,
                     price_per_lesson, category_id)
SELECT 'c0a00000-0000-0000-0000-00000000c1a0', 'c0a00000-0000-0000-0000-000000000001', co.id, 'COP Dolphins',
       pg_temp.wd(_cop.t), '06:00', '06:45', 'c0a00000-0000-0000-0000-0000000010c1', 40.00,
       'c0a00000-0000-0000-0000-00000000c001'
  FROM _cop, coaches co WHERE co.profile_id = 'c0a00000-0000-0000-0000-0000000000a1';

INSERT INTO students (id, full_name, date_of_birth, assignment_status, is_active, tenant_id) VALUES
  ('c0a00000-0000-0000-0000-0000000005a0', 'Ava Cop', (app_today() - INTERVAL '8 years')::date, 'assigned', true,
   'c0a00000-0000-0000-0000-000000000001');
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c0a00000-0000-0000-0000-0000000005a0' FROM parents p WHERE p.profile_id = 'c0a00000-0000-0000-0000-0000000000f1';
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT 'c0a00000-0000-0000-0000-0000000005a0', 'c0a00000-0000-0000-0000-00000000c1a0', pg_temp.sgt(_cop.t - 42), true FROM _cop;

INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count, rate_per_lesson,
                              validity_months, validity_weeks, single_child) VALUES
  ('c0a00000-0000-0000-0000-00000000d0a0', 'c0a00000-0000-0000-0000-000000000001', 'COP Ten', NULL, 10, 30.00, 3, 10, false);

-- ── The starting state the driver relies on — refuse to load anything else ──────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM parent_packages WHERE tenant_id = 'c0a00000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'cop fixture: a package already exists';
  END IF;
END $$;

-- COP Referred joined with COP Parent's code → a PENDING referral + the unused first-package reward.
INSERT INTO referrals (id, tenant_id, referrer_parent_id, referee_parent_id, code_used)
SELECT 'c0a00000-0000-0000-0000-0000000004e1', 'c0a00000-0000-0000-0000-000000000001', r.id, e.id, 'REF-COPXX'
  FROM parents r, parents e
 WHERE r.profile_id = 'c0a00000-0000-0000-0000-0000000000f1' AND e.profile_id = 'c0a00000-0000-0000-0000-0000000000f2';
INSERT INTO referral_rewards (tenant_id, parent_id, kind, referral_id)
SELECT 'c0a00000-0000-0000-0000-000000000001', e.id, 'referee_first', 'c0a00000-0000-0000-0000-0000000004e1'
  FROM parents e WHERE e.profile_id = 'c0a00000-0000-0000-0000-0000000000f2';

COMMIT;
