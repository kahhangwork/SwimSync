-- Verification scenario for prepaid packages (verify-packages.mjs).
--
-- Shape: one parent with one child in the seed class (Saturday Beginners,
-- $25/lesson). The seed class is categorized "Group". The parent already
-- HOLDS an active 10-lesson @ $25 package confirmed 30 days ago, and the
-- child has ONE present, un-invoiced lesson dated after confirmation — so
-- every live-balance surface must read 9 lessons, not 10. A second product
-- (5 @ $30) exists for the request flow.
--
-- Apply on a fresh `supabase db reset`:
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < drivers/fixtures-packages.sql

-- Parent auth user (handle_new_user creates profiles + parents)
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'c9000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'parent-pkg@swimsync.test',
  crypt('password123', gen_salt('bf')),
  NOW(),  -- clock-real: auth.users stamps are real time
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Paula Package","role":"parent"}',
  NOW(), NOW(), '', '', '', ''  -- clock-real: auth.users stamps are real time
);

-- Joined the seed tenant
INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '70000000-0000-0000-0000-000000000001'
FROM parents p WHERE p.profile_id = 'c9000000-0000-0000-0000-000000000001';

-- One child, assigned to the seed class, enrolled two months back
INSERT INTO students (id, full_name, date_of_birth, assignment_status, is_active, tenant_id)
VALUES ('c5000000-0000-0000-0000-000000000001', 'Pablo Package', '2018-03-03',
        'assigned', true, '70000000-0000-0000-0000-000000000001');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c5000000-0000-0000-0000-000000000001'
FROM parents p WHERE p.profile_id = 'c9000000-0000-0000-0000-000000000001';

INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT 'c5000000-0000-0000-0000-000000000001', c.id, app_now() - interval '60 days', true
FROM classes c WHERE c.title = 'Saturday Beginners';

-- The seed class is a "Group" class
INSERT INTO class_categories (id, tenant_id, name)
VALUES ('cc100000-0000-0000-0000-000000000001',
        '70000000-0000-0000-0000-000000000001', 'Group');
UPDATE classes SET category_id = 'cc100000-0000-0000-0000-000000000001'
 WHERE title = 'Saturday Beginners';

-- Two products: the one already held, and one to request in the driver
INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count,
                              rate_per_lesson, validity_months) VALUES
  ('dd100000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
   '10 Group Lessons', 'cc100000-0000-0000-0000-000000000001', 10, 25.00, 12),
  ('dd100000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001',
   '5 Lesson Starter',  'cc100000-0000-0000-0000-000000000001',  5, 30.00, 6);

-- The held package: active, confirmed 30 days ago (trigger snapshots terms
-- and dates the expiry; the postgres role may set confirmed_at directly)
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, confirmed_at)
SELECT 'ee100000-0000-0000-0000-000000000001',
       '70000000-0000-0000-0000-000000000001', p.id,
       'dd100000-0000-0000-0000-000000000001', 'active', app_now() - interval '30 days'
FROM parents p WHERE p.profile_id = 'c9000000-0000-0000-0000-000000000001';

-- One PRESENT lesson after confirmation, not yet invoiced: a Saturday at
-- least a week back (well inside the 30-day window). Every live-balance
-- surface must therefore read 9 lessons remaining, while the STORED balance
-- stays 250.00 — money moves at invoice time only.
--
-- ⚠ NOT ANY SATURDAY — NEVER ONE OF fixtures-unmarked-lessons.sql's TWO (§7.304).
-- That fixture owns the same seed class's last Saturday of LAST month (L, left
-- deliberately unmarked) and L-7 (marked). This was "most recent Saturday - 7",
-- which equals L-7 from the 1st until the month's first Saturday — a duplicate
-- (class_id, session_date) that broke check-fixture-roundtrip's co-load pass on
-- 2026-10-01 — and equals L for the week after, silently filling the lesson the
-- other driver needs missing. 247 of 730 days in 2026-27. Now: the latest of
-- recent-7/-14/-21 that is not L or L-7 — three consecutive Saturdays against
-- two reserved, so one is always free; 7-27 days back, inside the 30-day
-- window. Proven over every day of 2026-27. SGT, never CURRENT_DATE (§7.94).
WITH t AS (
  SELECT app_today() AS today,
         date_trunc('month', (app_now() AT TIME ZONE 'Asia/Singapore'))::date - 1 AS last_day_prev
), r AS (
  SELECT today - ((EXTRACT(DOW FROM today)::int + 1) % 7) AS recent_sat,           -- most recent Saturday
         last_day_prev - ((EXTRACT(DOW FROM last_day_prev)::int + 1) % 7) AS l     -- unmarked-lessons' L
    FROM t
), sat AS (
  SELECT (SELECT c FROM unnest(ARRAY[recent_sat - 7, recent_sat - 14, recent_sat - 21]) c
           WHERE c NOT IN (l - 7, l) ORDER BY c DESC LIMIT 1) AS d
    FROM r
), sess AS (
  INSERT INTO lesson_sessions (class_id, session_date, status)
  SELECT c.id, sat.d, 'completed'
  FROM classes c, sat WHERE c.title = 'Saturday Beginners'
  RETURNING id
)
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
SELECT sess.id, 'c5000000-0000-0000-0000-000000000001', 'present', pr.id
FROM sess, profiles pr WHERE pr.email = 'coach@swimsync.test';

-- ── The DISCRIMINATING pair (payment-method chip) ──────────────────────────
-- The family's package is scoped to "Group". A second child enrolled ONLY in
-- a "Private" class must read AD-HOC on every child surface, while their
-- sibling reads "Package · 9 left" — the case the old by-parent sum got
-- wrong. The class is fixture-OWNED with a pinned id (§7.73: never pick a
-- class you don't own with an unordered LIMIT 1).
INSERT INTO class_categories (id, tenant_id, name)
VALUES ('cc100000-0000-0000-0000-000000000002',
        '70000000-0000-0000-0000-000000000001', 'Pkg Private');

-- The location the class sits at (contract: classes.location_id FK).
-- coach@swimsync.test is the seed tenant, so the location is seeded there.
INSERT INTO locations (id, tenant_id, name) VALUES
  ('c1100000-0000-0000-0000-0000000010c1','70000000-0000-0000-0000-000000000001','Pkg Pool')
ON CONFLICT (id) DO NOTHING;

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_id, price_per_lesson, category_id)
SELECT 'c1100000-0000-0000-0000-000000000001', co.id, 'Pkg Private Tue',
       'tuesday', '17:00', '17:30', 'c1100000-0000-0000-0000-0000000010c1', 70.00,
       'cc100000-0000-0000-0000-000000000002'
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'coach@swimsync.test';

INSERT INTO students (id, full_name, date_of_birth, assignment_status, is_active, tenant_id)
VALUES ('c5000000-0000-0000-0000-000000000002', 'Pia Package', '2020-04-04',
        'assigned', true, '70000000-0000-0000-0000-000000000001');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c5000000-0000-0000-0000-000000000002'
FROM parents p WHERE p.profile_id = 'c9000000-0000-0000-0000-000000000001';

INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
VALUES ('c5000000-0000-0000-0000-000000000002',
        'c1100000-0000-0000-0000-000000000001', app_now() - interval '30 days', true);
