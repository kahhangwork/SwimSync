-- Fixture for verify-trial-visibility.mjs.
--
-- The situation: a trial is a BOOKING, not an enrolment, so a booked child
-- sits at assignment_status = 'unassigned' with no enrolment row. Three
-- screens used to describe that child as "waiting to be placed in a class",
-- which is false and led the admin straight to Assign — the one action that
-- must not be taken, since an enrolment makes the child expected EVERY week
-- and an unmarked lesson blocks invoicing outright.
--
-- Four children, each pinning a different branch:
--   TRIAL UPCOMING  — the parent's own child. Card must say WHEN.
--   GUEST UPCOMING  — unclaimed, booked ahead. Coach must see them; the admin's
--                     Unassigned list must NOT.
--   TRIAL PAST      — booked, date gone. Must STILL be in Unassigned: that is
--                     the real decision point (did they convert?).
--   PLAIN UNASSIGNED— no trial at all. The control: must always be listed.
--
-- Dates are derived in SGT, never CURRENT_DATE — the server runs UTC and
-- between 00:00 and 08:00 SGT those are different days (the bug that made the
-- package suite fail for eight hours a day).

-- ---- The parent ----
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000','7d000000-0000-0000-0000-0000000000d1',
  'authenticated','authenticated','trialvis-parent@swimsync.test',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Trial Vis Parent","role":"parent"}',
  NOW(), NOW(), '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '70000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = '7d000000-0000-0000-0000-0000000000d1'
ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key DO NOTHING;

-- ---- The four children ----
INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active,
                      provisional_contact_phone)
VALUES
  ('7d099999-0000-0000-0000-000000000001','Trialvis Mine',
   '70000000-0000-0000-0000-000000000001','unassigned', TRUE, '91110001'),
  ('7d099999-0000-0000-0000-000000000002','Trialvis Guest',
   '70000000-0000-0000-0000-000000000001','unassigned', TRUE, '91110002'),
  ('7d099999-0000-0000-0000-000000000003','Trialvis Pasttrial',
   '70000000-0000-0000-0000-000000000001','unassigned', TRUE, '91110003'),
  ('7d099999-0000-0000-0000-000000000004','Trialvis Plain',
   '70000000-0000-0000-0000-000000000001','unassigned', TRUE, '91110004')
ON CONFLICT (id) DO NOTHING;

-- Only the first is the parent's.
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '7d099999-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = '7d000000-0000-0000-0000-0000000000d1'
ON CONFLICT (parent_id, student_id) DO NOTHING;

-- ---- The bookings ----
-- The seed class runs on SATURDAY. Next Saturday strictly AFTER today, and the
-- most recent Saturday strictly BEFORE it, both derived in SGT.
INSERT INTO trial_bookings (tenant_id, student_id, class_id, session_date,
                            category_id, booked_by)
SELECT '70000000-0000-0000-0000-000000000001', v.student_id, c.id, v.d,
       c.category_id, 'c0000000-0000-0000-0000-000000000001'
  FROM classes c,
  LATERAL (VALUES
    ('7d099999-0000-0000-0000-000000000001'::uuid,
     ((now() AT TIME ZONE 'Asia/Singapore')::date
        + (6 - EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Singapore')::date)::int + 7) % 7
        + CASE WHEN EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Singapore')::date)::int = 6
               THEN 7 ELSE 0 END)),
    ('7d099999-0000-0000-0000-000000000002'::uuid,
     ((now() AT TIME ZONE 'Asia/Singapore')::date
        + (6 - EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Singapore')::date)::int + 7) % 7
        + CASE WHEN EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Singapore')::date)::int = 6
               THEN 7 ELSE 0 END)),
    ('7d099999-0000-0000-0000-000000000003'::uuid,
     ((now() AT TIME ZONE 'Asia/Singapore')::date
        - ((EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Singapore')::date)::int + 1) % 7)
        - CASE WHEN EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Singapore')::date)::int = 6
               THEN 7 ELSE 0 END))
  ) AS v(student_id, d)
 WHERE c.title = 'Saturday Beginners'
   AND c.tenant_id = '70000000-0000-0000-0000-000000000001'
ON CONFLICT DO NOTHING;

SELECT s.full_name, tb.session_date,
       CASE WHEN tb.session_date >= (now() AT TIME ZONE 'Asia/Singapore')::date
            THEN 'UPCOMING' ELSE 'PAST' END AS when_
  FROM students s LEFT JOIN trial_bookings tb ON tb.student_id = s.id
 WHERE s.full_name LIKE 'Trialvis%' ORDER BY s.full_name;
