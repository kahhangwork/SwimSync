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
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Paula Package","role":"parent"}',
  NOW(), NOW(), '', '', '', ''
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
SELECT 'c5000000-0000-0000-0000-000000000001', c.id, NOW() - interval '60 days', true
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
       'dd100000-0000-0000-0000-000000000001', 'active', NOW() - interval '30 days'
FROM parents p WHERE p.profile_id = 'c9000000-0000-0000-0000-000000000001';

-- One PRESENT lesson after confirmation, not yet invoiced: a Saturday at
-- least a week back (well inside the 30-day window). Every live-balance
-- surface must therefore read 9 lessons remaining, while the STORED balance
-- stays 250.00 — money moves at invoice time only.
WITH sat AS (
  SELECT (CURRENT_DATE
          - ((EXTRACT(DOW FROM CURRENT_DATE)::int + 1) % 7)  -- most recent Saturday
          - 7)::date AS d                                     -- ...a week before that
), sess AS (
  INSERT INTO lesson_sessions (class_id, session_date, status)
  SELECT c.id, sat.d, 'completed'
  FROM classes c, sat WHERE c.title = 'Saturday Beginners'
  RETURNING id
)
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
SELECT sess.id, 'c5000000-0000-0000-0000-000000000001', 'present', pr.id
FROM sess, profiles pr WHERE pr.email = 'coach@swimsync.test';
