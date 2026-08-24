-- Fixture for verify-multi-class.mjs — a child in TWO classes (Wave 2,
-- 20260811000100).
--
-- THE POINT IS ONE CHILD WITH TWO ACTIVE ENROLMENTS, a state that was
-- impossible until this wave. Everything else here exists to make the
-- assertions discriminating rather than merely true:
--
--   MultiCls Amelia  Mon 5pm AND Wed 5pm   → two chips, two parent-card blocks
--   MultiCls Ben     Mon 5pm only          → the single-class control; proves
--                                            the two-class rendering is not
--                                            just "whatever every row does"
--   MultiCls Clash   Mon 5pm, unenrolled   → a class that OVERLAPS Mon 5pm,
--                                            used to prove the trigger refuses
--
-- ⚠ THIS RUNS AGAINST A STACK OTHER WORKTREES MAY BE SHARING. Everything is
-- namespaced 'MultiCls ', keyed on fixed UUIDs, and guarded so re-running is a
-- no-op rather than a second set of rows. Do NOT add a TRUNCATE, and do NOT
-- reach for `supabase db reset` to clean up — the teardown removes exactly
-- these rows.
--
-- ⚠ ON CONFLICT DO NOTHING IS NOT ENOUGH FOR THE ENROLMENTS (§7.53). The unique
-- index is PARTIAL — one_active_enrolment_per_student_class, WHERE is_active —
-- so an inactive row conflicts with nothing and re-inserts on every run. The
-- NOT EXISTS below is keyed on (student, class), which is what "already
-- seeded" means here.
--
-- ⚠ THE TWO CLASSES MUST NOT OVERLAP. enforce_enrolment_schedule() refuses a
-- clashing enrolment, so a fixture that put both on Monday at 5pm would abort
-- and take every assertion with it. Mon and Wed, deliberately.

-- ---- The classes. Own classes, so no other fixture's children can land in
-- ---- them and change what the chips say.
-- The location all three classes sit at (contract: classes.location_id FK).
INSERT INTO locations (id, tenant_id, name) VALUES
  ('c6000000-0000-0000-0000-0000000010c1','70000000-0000-0000-0000-000000000001','MultiCls Pool')
ON CONFLICT (id) DO NOTHING;

INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                     end_time, location_id, price_per_lesson, category_id,
                     is_active)
SELECT v.id, '70000000-0000-0000-0000-000000000001', co.id, v.title,
       v.dow::day_of_week, v.st::time, v.et::time, 'c6000000-0000-0000-0000-0000000010c1', 40.00,
       '7c000000-0000-0000-0000-000000000002', TRUE
  FROM (VALUES
    ('c6000000-0000-0000-0000-00000000000a'::uuid,'MultiCls Monday','monday','17:00','18:00'),
    ('c6000000-0000-0000-0000-00000000000b'::uuid,'MultiCls Wednesday','wednesday','17:00','18:00'),
    -- Overlaps MultiCls Monday. Nobody is enrolled in it; the driver tries to
    -- add it and asserts the refusal.
    ('c6000000-0000-0000-0000-00000000000c'::uuid,'MultiCls Clash','monday','17:30','18:30')
  ) AS v(id, title, dow, st, et)
 CROSS JOIN coaches co
 WHERE co.profile_id = 'c0000000-0000-0000-0000-000000000001'
ON CONFLICT (id) DO NOTHING;

-- ---- The parent, so the parent app has something to render ----
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'c6000000-0000-0000-0000-00000000000d',
  'authenticated', 'authenticated', 'multicls-parent@swimsync.test',
  crypt('password123', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"MultiCls Parent","role":"parent"}',
  NOW(), NOW(), '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '70000000-0000-0000-0000-000000000001'
  FROM parents p
 WHERE p.profile_id = 'c6000000-0000-0000-0000-00000000000d'
ON CONFLICT DO NOTHING;

-- ---- The children ----
INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active)
VALUES
  ('c6000000-0000-0000-0000-00000000000e'::uuid,'MultiCls Amelia',
   '70000000-0000-0000-0000-000000000001','assigned', TRUE),
  ('c6000000-0000-0000-0000-00000000000f'::uuid,'MultiCls Ben',
   '70000000-0000-0000-0000-000000000001','assigned', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, v.sid
  FROM (VALUES
    ('c6000000-0000-0000-0000-00000000000e'::uuid),
    ('c6000000-0000-0000-0000-00000000000f'::uuid)
  ) AS v(sid)
 CROSS JOIN parents p
 WHERE p.profile_id = 'c6000000-0000-0000-0000-00000000000d'
ON CONFLICT DO NOTHING;

-- ---- The enrolments: Amelia in TWO, Ben in one ----
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT v.student_id, v.class_id, v.enrolled_at, TRUE
  FROM (VALUES
    ('c6000000-0000-0000-0000-00000000000e'::uuid,
     'c6000000-0000-0000-0000-00000000000a'::uuid,
     '2026-05-04 12:00:00+08'::timestamptz),
    ('c6000000-0000-0000-0000-00000000000e'::uuid,
     'c6000000-0000-0000-0000-00000000000b'::uuid,
     '2026-05-06 12:00:00+08'::timestamptz),
    ('c6000000-0000-0000-0000-00000000000f'::uuid,
     'c6000000-0000-0000-0000-00000000000a'::uuid,
     '2026-05-04 12:00:00+08'::timestamptz)
  ) AS v(student_id, class_id, enrolled_at)
 WHERE NOT EXISTS (
   SELECT 1 FROM student_class_enrolments e
    WHERE e.student_id = v.student_id AND e.class_id = v.class_id
 );

SELECT s.full_name, count(*) AS active_classes
  FROM student_class_enrolments e
  JOIN students s ON s.id = e.student_id
 WHERE e.is_active AND s.full_name LIKE 'MultiCls %'
 GROUP BY s.full_name ORDER BY 1;
