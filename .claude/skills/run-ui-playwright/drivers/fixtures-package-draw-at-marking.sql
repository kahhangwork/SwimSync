-- Fixture for verify-package-draw-at-marking.mjs — Wave 6: package lessons draw AT MARKING
-- (docs/plans/WAVE6_PACKAGE_DRAW_AT_MARKING_PLAN.md §1.5). Prefix w6pd_ / ids e6d00000-.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-package-draw-at-marking.sql
--
-- TWO OWNED BUSINESSES, switch ON (the column's default since migration B — asserted below, never assumed):
--
--   W6PD Swim (…0001)  owner w6pd-owner@swimsync.test — tenant admin AND coach, so one login drives both apps.
--     Each family has its OWN class on its OWN weekday, so no two scenarios share a lesson date or a backlog row.
--     T = today in SGT. A class's weekday is T−k's, and the child is enrolled from its first lesson, which
--     fixes exactly which lessons are "expected" (class_unmarked_lesson_pairs: floor..today on the weekday).
--
--     Ava  "W6PD Draw"     10 × $30, active from T−14. T−8 marked present AFTER the package → drawn (9 left).
--                          T−1 left UNMARKED: the coach marks it (→ 8), then flips it absent (→ 9, returned).
--     Ben  "W6PD Backdate" T−10, T−3 marked present BEFORE any package (nothing to draw them). A PENDING
--                          10 × $30 package starting T−14 — the admin confirms it → D5 dialog → Draw (→ 8).
--     Cara "W6PD Keep"     same shape as Ben → Keep as ad-hoc (stays 10, nothing drawn).
--     Dan  "W6PD Guard"    2 × $30, active from T−20. T−16 present → drawn → 1 LEFT. T−9 and T−2 UNMARKED: the
--                          coach marks T−2 first → PK001 ("Mark <T−9> first — …"); T−9 then saves.
--
--   W6PD Months (…0002)  owner w6pd-months@swimsync.test. One child, enrolled for LAST month only, every lesson
--     of last month marked present after a 10-lesson package → all drawn, none waiting, none unmarked → the
--     Billing months card reads "Nothing to bill". A separate business because W6PD Swim's last month cannot be
--     made clean on every day of the month (Dan's T−9/T−16 fall into it in the first fortnight).
--
-- Dates: every one derived from now() in SGT (§7.94, §7.305 — no literals). The earliest, T−20, is a package
-- START date only; the earliest LESSON, T−16, is always ≥ the 1st of last month = markable_floor for a business
-- created today (§7.319), so no write here meets the date guard.
--
-- IDEMPOTENT: it begins with the teardown's own block, so a re-load rebuilds from nothing.
-- Teardown: fixtures-package-draw-at-marking-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

-- ── Clean slate (same block as the teardown — attendance first, so returns find their package) ─────────────
DELETE FROM attendance            WHERE student_id::text LIKE 'e6d00000-%';
DELETE FROM package_applications  WHERE parent_package_id::text LIKE 'e6d00000-%';
DELETE FROM lesson_sessions       WHERE class_id::text LIKE 'e6d00000-%';
DELETE FROM student_class_enrolments WHERE student_id::text LIKE 'e6d00000-%';
DELETE FROM invoices              WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM billing_runs          WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM billing_periods       WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM parent_packages       WHERE tenant_id::text LIKE 'e6d00000-%';
UPDATE tenants SET owner_profile_id = NULL WHERE id::text LIKE 'e6d00000-%';
DELETE FROM package_products      WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM parent_students       WHERE student_id::text LIKE 'e6d00000-%';
DELETE FROM students              WHERE id::text LIKE 'e6d00000-%';
DELETE FROM classes               WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM locations             WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM class_categories      WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM parent_tenant_balances WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM parent_tenants        WHERE tenant_id::text LIKE 'e6d00000-%';
DELETE FROM audit_log             WHERE tenant_id::text LIKE 'e6d00000-%' OR actor_id::text LIKE 'e6d00000-%';
DELETE FROM coaches               WHERE profile_id::text LIKE 'e6d00000-%';
DELETE FROM parents               WHERE profile_id::text LIKE 'e6d00000-%';
DELETE FROM profiles              WHERE id::text LIKE 'e6d00000-%';
DELETE FROM auth.users            WHERE id::text LIKE 'e6d00000-%';
DELETE FROM tenants               WHERE id::text LIKE 'e6d00000-%';

-- ── The clock: T = today in SGT, M1 = the 1st of last month ─────────────────────────────────────────────────
CREATE TEMP TABLE _w6 ON COMMIT DROP AS
SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS t,
       (date_trunc('month', now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '1 month')::date AS m1,
       date_trunc('month', now() AT TIME ZONE 'Asia/Singapore')::date AS m0;

CREATE FUNCTION pg_temp.wd(d date) RETURNS day_of_week LANGUAGE sql IMMUTABLE AS $$
  SELECT ((ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])
          [EXTRACT(DOW FROM d)::int + 1])::day_of_week
$$;
-- Midnight SGT of a date, as a timestamptz (enrolment spans are compared on their SGT date).
CREATE FUNCTION pg_temp.sgt(d date) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT d::timestamp AT TIME ZONE 'Asia/Singapore'
$$;

-- ── The businesses and their people ─────────────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('e6d00000-0000-0000-0000-000000000001', 'w6pd-swim',   'W6PD Swim',   'SWIM-W6PD'),
  ('e6d00000-0000-0000-0000-000000000002', 'w6pd-months', 'W6PD Months', 'SWIM-W6PM');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenants WHERE id::text LIKE 'e6d00000-%' AND NOT package_draw_at_marking) THEN
    RAISE EXCEPTION 'w6pd fixture: a new business does not draw at marking — migration B (default ON) is not applied';
  END IF;
END $$;

-- handle_new_user (trusts metadata for a postgres session) builds profiles, coaches and parents. The first
-- tenant_admin of a business becomes its owner; is_coach also makes them its coach.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email,
       crypt('password123', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', u.meta::jsonb, now(), now(), '', '', '', ''
  FROM (VALUES
    ('e6d00000-0000-0000-0000-0000000000a1', 'w6pd-owner@swimsync.test',
     '{"full_name":"W6PD Owner","role":"tenant_admin","is_coach":true,"tenant_id":"e6d00000-0000-0000-0000-000000000001"}'),
    ('e6d00000-0000-0000-0000-0000000000a2', 'w6pd-months@swimsync.test',
     '{"full_name":"W6PD Months Owner","role":"tenant_admin","is_coach":true,"tenant_id":"e6d00000-0000-0000-0000-000000000002"}'),
    ('e6d00000-0000-0000-0000-0000000000fa', 'w6pd-parent-ava@swimsync.test',  '{"full_name":"W6PD Ava Parent","role":"parent"}'),
    ('e6d00000-0000-0000-0000-0000000000fb', 'w6pd-parent-ben@swimsync.test',  '{"full_name":"W6PD Ben Parent","role":"parent"}'),
    ('e6d00000-0000-0000-0000-0000000000fc', 'w6pd-parent-cara@swimsync.test', '{"full_name":"W6PD Cara Parent","role":"parent"}'),
    ('e6d00000-0000-0000-0000-0000000000fd', 'w6pd-parent-dan@swimsync.test',  '{"full_name":"W6PD Dan Parent","role":"parent"}'),
    ('e6d00000-0000-0000-0000-0000000000fe', 'w6pd-parent-eve@swimsync.test',  '{"full_name":"W6PD Eve Parent","role":"parent"}')
  ) AS u(id, email, meta);

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, CASE WHEN p.profile_id = 'e6d00000-0000-0000-0000-0000000000fe'
                  THEN 'e6d00000-0000-0000-0000-000000000002'::uuid
                  ELSE 'e6d00000-0000-0000-0000-000000000001'::uuid END
  FROM parents p WHERE p.profile_id::text LIKE 'e6d00000-%';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('e6d00000-0000-0000-0000-00000000c001', 'e6d00000-0000-0000-0000-000000000001', 'W6PD Group'),
  ('e6d00000-0000-0000-0000-00000000c002', 'e6d00000-0000-0000-0000-000000000002', 'W6PD Group');
INSERT INTO locations (id, tenant_id, name) VALUES
  ('e6d00000-0000-0000-0000-0000000010c1', 'e6d00000-0000-0000-0000-000000000001', 'W6PD Pool'),
  ('e6d00000-0000-0000-0000-0000000010c2', 'e6d00000-0000-0000-0000-000000000002', 'W6PD Pool');

-- ── Classes: one per scenario, each on its own weekday ──────────────────────────────────────────────────────
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time, location_id,
                     price_per_lesson, category_id)
SELECT c.id::uuid, c.tenant::uuid, co.id, c.title, pg_temp.wd(c.d), '16:00', '16:45', c.loc::uuid, 30.00, c.cat::uuid
  FROM _w6, LATERAL (VALUES
    ('e6d00000-0000-0000-0000-00000000c1a0', 'W6PD Draw',     _w6.t - 1,  '01', 'a1'),
    ('e6d00000-0000-0000-0000-00000000c1b0', 'W6PD Backdate', _w6.t - 3,  '01', 'a1'),
    ('e6d00000-0000-0000-0000-00000000c1c0', 'W6PD Keep',     _w6.t - 4,  '01', 'a1'),
    ('e6d00000-0000-0000-0000-00000000c1d0', 'W6PD Guard',    _w6.t - 2,  '01', 'a1'),
    ('e6d00000-0000-0000-0000-00000000c1e0', 'W6PD Months',   _w6.m1 + 2, '02', 'a2')
  ) AS v(id, title, d, tn, owner)
  CROSS JOIN LATERAL (SELECT v.id, v.title, v.d,
                             'e6d00000-0000-0000-0000-0000000000' || v.tn AS tenant,
                             'e6d00000-0000-0000-0000-0000000010c' || right(v.tn, 1) AS loc,
                             'e6d00000-0000-0000-0000-00000000c00' || right(v.tn, 1) AS cat,
                             'e6d00000-0000-0000-0000-0000000000' || v.owner AS owner_id) c
  JOIN coaches co ON co.profile_id = c.owner_id::uuid;

-- ── Children ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO students (id, full_name, date_of_birth, assignment_status, is_active, tenant_id)
SELECT s.id::uuid, s.name, (now() - INTERVAL '8 years')::date, 'assigned', true, s.tenant::uuid
  FROM (VALUES
    ('e6d00000-0000-0000-0000-0000000005a0', 'Ava W6pd',  'e6d00000-0000-0000-0000-000000000001', 'fa'),
    ('e6d00000-0000-0000-0000-0000000005b0', 'Ben W6pd',  'e6d00000-0000-0000-0000-000000000001', 'fb'),
    ('e6d00000-0000-0000-0000-0000000005c0', 'Cara W6pd', 'e6d00000-0000-0000-0000-000000000001', 'fc'),
    ('e6d00000-0000-0000-0000-0000000005d0', 'Dan W6pd',  'e6d00000-0000-0000-0000-000000000001', 'fd'),
    ('e6d00000-0000-0000-0000-0000000005e0', 'Eve W6pd',  'e6d00000-0000-0000-0000-000000000002', 'fe')
  ) AS s(id, name, tenant, parent);

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.sid::uuid
  FROM (VALUES ('fa','5a'),('fb','5b'),('fc','5c'),('fd','5d'),('fe','5e')) AS x(par, kid)
  CROSS JOIN LATERAL (SELECT 'e6d00000-0000-0000-0000-0000000000' || x.par AS pid,
                             'e6d00000-0000-0000-0000-000000000' || x.kid || '0' AS sid) s
  JOIN parents p ON p.profile_id = s.pid::uuid;

-- Enrolled from each class's FIRST lesson — that is what fixes the expected lessons.
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, unenrolled_at, is_active)
SELECT e.sid::uuid, e.cid::uuid, pg_temp.sgt(e.d_from), e.d_to, e.d_to IS NULL
  FROM _w6, LATERAL (VALUES
    ('e6d00000-0000-0000-0000-0000000005a0', 'e6d00000-0000-0000-0000-00000000c1a0', _w6.t - 8,  NULL::timestamptz),
    ('e6d00000-0000-0000-0000-0000000005b0', 'e6d00000-0000-0000-0000-00000000c1b0', _w6.t - 10, NULL),
    ('e6d00000-0000-0000-0000-0000000005c0', 'e6d00000-0000-0000-0000-00000000c1c0', _w6.t - 11, NULL),
    ('e6d00000-0000-0000-0000-0000000005d0', 'e6d00000-0000-0000-0000-00000000c1d0', _w6.t - 16, NULL),
    -- Eve: last month only. Unenrolled on its last day, so no lesson of THIS month is expected of her.
    ('e6d00000-0000-0000-0000-0000000005e0', 'e6d00000-0000-0000-0000-00000000c1e0', _w6.m1,
     pg_temp.sgt(_w6.m0 - 1))
  ) AS e(sid, cid, d_from, d_to);

-- ── Products ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count, rate_per_lesson,
                              validity_months, validity_weeks) VALUES
  ('e6d00000-0000-0000-0000-00000000d0a0', 'e6d00000-0000-0000-0000-000000000001', 'W6PD Ten',
   'e6d00000-0000-0000-0000-00000000c001', 10, 30.00, 6, 26),
  ('e6d00000-0000-0000-0000-00000000d0d0', 'e6d00000-0000-0000-0000-000000000001', 'W6PD Two',
   'e6d00000-0000-0000-0000-00000000c001',  2, 30.00, 6, 26),
  ('e6d00000-0000-0000-0000-00000000d0e0', 'e6d00000-0000-0000-0000-000000000002', 'W6PD Months Ten',
   'e6d00000-0000-0000-0000-00000000c002', 10, 30.00, 6, 26);

-- A marked lesson: its session row, then the attendance row (the Wave 6 trigger draws if a package covers it).
CREATE FUNCTION pg_temp.mark(p_class uuid, p_student uuid, p_date date, p_marker uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO lesson_sessions (class_id, session_date, status)
  VALUES (p_class, p_date, 'completed')
  ON CONFLICT (class_id, session_date) DO NOTHING;
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
  SELECT ls.id, p_student, 'present', p_marker
    FROM lesson_sessions ls WHERE ls.class_id = p_class AND ls.session_date = p_date;
$$;

-- ── Ava: package first, then T−8 → DRAWN (10 → 9). T−1 stays unmarked for the coach. ───────────────────────
INSERT INTO parent_packages (id, parent_id, product_id, status, start_date, confirmed_at)
SELECT 'e6d00000-0000-0000-0000-00000000e0a0', p.id, 'e6d00000-0000-0000-0000-00000000d0a0', 'active',
       _w6.t - 14, pg_temp.sgt(_w6.t - 14)
  FROM parents p, _w6 WHERE p.profile_id = 'e6d00000-0000-0000-0000-0000000000fa';
SELECT pg_temp.mark('e6d00000-0000-0000-0000-00000000c1a0', 'e6d00000-0000-0000-0000-0000000005a0',
                    _w6.t - 8, 'e6d00000-0000-0000-0000-0000000000a1') FROM _w6;

-- ── Ben / Cara: lessons marked BEFORE any package (nothing draws), then a PENDING package from T−14 ─────────
SELECT pg_temp.mark(x.cid::uuid, x.sid::uuid, _w6.t - x.k, 'e6d00000-0000-0000-0000-0000000000a1')
  FROM _w6, (VALUES
    ('e6d00000-0000-0000-0000-00000000c1b0', 'e6d00000-0000-0000-0000-0000000005b0', 10),
    ('e6d00000-0000-0000-0000-00000000c1b0', 'e6d00000-0000-0000-0000-0000000005b0', 3),
    ('e6d00000-0000-0000-0000-00000000c1c0', 'e6d00000-0000-0000-0000-0000000005c0', 11),
    ('e6d00000-0000-0000-0000-00000000c1c0', 'e6d00000-0000-0000-0000-0000000005c0', 4)
  ) AS x(cid, sid, k)
 ORDER BY x.cid, x.k DESC;

-- A superuser insert keeps the start date on a pending row (the lifecycle trigger blanks it for `authenticated`
-- only), so the confirm dialog opens on T−14 — before both marked lessons.
INSERT INTO parent_packages (id, parent_id, product_id, status, start_date)
SELECT x.id::uuid, p.id, 'e6d00000-0000-0000-0000-00000000d0a0', 'pending', _w6.t - 14
  FROM _w6, (VALUES ('e6d00000-0000-0000-0000-00000000e0b0', 'e6d00000-0000-0000-0000-0000000000fb'),
                    ('e6d00000-0000-0000-0000-00000000e0c0', 'e6d00000-0000-0000-0000-0000000000fc')) AS x(id, par)
  JOIN parents p ON p.profile_id = x.par::uuid;

-- ── Dan: a 2-lesson package from T−20; T−16 → DRAWN → 1 LEFT. T−9 and T−2 stay unmarked. ───────────────────
INSERT INTO parent_packages (id, parent_id, product_id, status, start_date, confirmed_at)
SELECT 'e6d00000-0000-0000-0000-00000000e0d0', p.id, 'e6d00000-0000-0000-0000-00000000d0d0', 'active',
       _w6.t - 20, pg_temp.sgt(_w6.t - 20)
  FROM parents p, _w6 WHERE p.profile_id = 'e6d00000-0000-0000-0000-0000000000fd';
SELECT pg_temp.mark('e6d00000-0000-0000-0000-00000000c1d0', 'e6d00000-0000-0000-0000-0000000005d0',
                    _w6.t - 16, 'e6d00000-0000-0000-0000-0000000000a1') FROM _w6;

-- ── Eve (W6PD Months): package from M1, then EVERY lesson of last month on the class weekday, oldest first ──
INSERT INTO parent_packages (id, parent_id, product_id, status, start_date, confirmed_at)
SELECT 'e6d00000-0000-0000-0000-00000000e0e0', p.id, 'e6d00000-0000-0000-0000-00000000d0e0', 'active',
       _w6.m1, pg_temp.sgt(_w6.m1)
  FROM parents p, _w6 WHERE p.profile_id = 'e6d00000-0000-0000-0000-0000000000fe';
SELECT pg_temp.mark('e6d00000-0000-0000-0000-00000000c1e0', 'e6d00000-0000-0000-0000-0000000005e0',
                    d::date, 'e6d00000-0000-0000-0000-0000000000a2')
  FROM _w6, generate_series(_w6.m1, _w6.m0 - 1, INTERVAL '1 day') AS d
 WHERE pg_temp.wd(d::date) = pg_temp.wd(_w6.m1 + 2)
 ORDER BY d;

-- ── The starting state the driver relies on — refuse to load anything else ──────────────────────────────────
DO $$
DECLARE
  v RECORD;
BEGIN
  SELECT
    (SELECT value_remaining FROM parent_packages WHERE id = 'e6d00000-0000-0000-0000-00000000e0a0') AS ava,
    (SELECT value_remaining FROM parent_packages WHERE id = 'e6d00000-0000-0000-0000-00000000e0d0') AS dan,
    (SELECT status FROM parent_packages WHERE id = 'e6d00000-0000-0000-0000-00000000e0b0')          AS ben_status,
    (SELECT count(*) FROM package_applications pa
       JOIN parent_packages pp ON pp.id = pa.parent_package_id
      WHERE pp.id = 'e6d00000-0000-0000-0000-00000000e0e0' AND pa.reversed_at IS NULL)               AS eve_drawn,
    (SELECT count(*) FROM attendance WHERE student_id = 'e6d00000-0000-0000-0000-0000000005e0')    AS eve_marked
    INTO v;
  IF v.ava <> 270 OR v.dan <> 30 OR v.ben_status <> 'pending' OR v.eve_drawn = 0 OR v.eve_drawn <> v.eve_marked THEN
    RAISE EXCEPTION 'w6pd fixture: unexpected starting state %', row_to_json(v);
  END IF;
END $$;

COMMIT;
