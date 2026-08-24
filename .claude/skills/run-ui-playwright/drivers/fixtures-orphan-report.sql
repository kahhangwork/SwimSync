-- Fixture for verify-orphan-report.mjs — the standing "recorded after billing"
-- report on the admin Invoices page, and its sidebar badge (Wave 4).
--
-- ⚠ A DEDICATED TENANT, AND THAT IS THE POINT. The report only shows lessons
-- inside a SEALED month, so the fixture must seal one — and sealing a month for
-- the SEED tenant would make verify-invoice-controls' generation flow
-- short-circuit on a hand-run (the sweep resets per driver, but hand-runs
-- share the stack). Everything here lives under 'OrphanRpt Business'
-- (ab000000-…), whose sealed month is visible to nobody else.
--
-- TWO STUDENTS, TWO LINES, AND THE DRIVER SETTLES BOTH DIFFERENTLY:
--   OrphanRpt Two Lessons   2 orphan lessons (d1, d2)  → settled paid_outside
--   OrphanRpt One Lesson    1 orphan lesson (d1)       → written off
-- The second line's survival while the first is settled is the persistence
-- claim — the report is per line, not per screenful.
--
-- ⚠ NOT RE-RUNNABLE BY HAND WITHOUT THE TEARDOWN. The driver's whole act is
-- recording settlements, and a live settlement is exactly what makes a line
-- disappear — a second run finds an empty report and fails its fixture guard
-- (which says so). Apply fixtures-orphan-report-teardown.sql between runs.
-- The sweep resets per driver, so this only bites a hand-run.
--
-- ⚠ DATES ARE DERIVED IN SGT, NEVER CURRENT_DATE (§7.94). The sealed month is
-- LAST month — deliberately inside §8.32's reopened marking window, the same
-- shape as the real trigger case (July billed on 2 August, July lessons still
-- recordable). Attendance inserts here run as superuser, which the window
-- guard exempts, so the backdating needs no ceremony.

-- ---- The business, sealed month included ----
INSERT INTO tenants (id, slug, display_name, join_code, created_at) VALUES
  ('ab000000-0000-0000-0000-000000000001','orphanrpt','OrphanRpt Business','SWIM-ORPH', now())
ON CONFLICT (id) DO NOTHING;

-- Inserting auth.users rows fires handle_new_user, which builds profiles (and
-- the coaches row for the coach) from the metadata.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  ('00000000-0000-0000-0000-000000000000',
   'ab100000-0000-0000-0000-0000000000a1',
   'authenticated', 'authenticated', 'orphan-admin@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"OrphanRpt Admin","role":"tenant_admin","tenant_id":"ab000000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   'ab100000-0000-0000-0000-0000000000c1',
   'authenticated', 'authenticated', 'orphan-coach@swimsync.test',
   crypt('password123', gen_salt('bf')), NOW(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"OrphanRpt Coach","role":"coach","tenant_id":"ab000000-0000-0000-0000-000000000001"}',
   NOW(), NOW(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO class_categories (tenant_id, name)
SELECT 'ab000000-0000-0000-0000-000000000001', 'Default Group'
 WHERE NOT EXISTS (
   SELECT 1 FROM class_categories
    WHERE tenant_id = 'ab000000-0000-0000-0000-000000000001'
      AND lower(trim(name)) = 'default group');

-- The class runs on d1's weekday so the lesson dates are real lesson dates.
-- The location the class sits at (contract: classes.location_id FK).
INSERT INTO locations (id, tenant_id, name) VALUES
  ('ab000000-1111-0000-0000-0000000010c1','ab000000-0000-0000-0000-000000000001','OrphanRpt Pool')
ON CONFLICT (id) DO NOTHING;

INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                     end_time, location_id, price_per_lesson, category_id)
SELECT
  'ab000000-1111-0000-0000-000000000001',
  'ab000000-0000-0000-0000-000000000001',
  (SELECT c.id FROM coaches c
    WHERE c.profile_id = 'ab100000-0000-0000-0000-0000000000c1'),
  'OrphanRpt Lane',
  (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    )[EXTRACT(DOW FROM (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
       - INTERVAL '1 month' + INTERVAL '7 days'))::int + 1]::day_of_week,
  '16:00', '17:00', 'ab000000-1111-0000-0000-0000000010c1', 30,
  (SELECT id FROM class_categories
    WHERE tenant_id = 'ab000000-0000-0000-0000-000000000001'
      AND lower(trim(name)) = 'default group')
ON CONFLICT (id) DO NOTHING;

INSERT INTO students (id, full_name, tenant_id) VALUES
  ('ab500000-0000-0000-0000-000000000001','OrphanRpt Two Lessons','ab000000-0000-0000-0000-000000000001'),
  ('ab500000-0000-0000-0000-000000000002','OrphanRpt One Lesson','ab000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Last month, sealed. This is the row that makes the lessons below ORPHANS
-- rather than month-blockers.
INSERT INTO billing_periods (billing_month, tenant_id, invoices_issued)
SELECT to_char((now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '1 month', 'YYYY-MM'),
       'ab000000-0000-0000-0000-000000000001', 0
ON CONFLICT (tenant_id, billing_month) DO NOTHING;

-- d1 = 8th-ish of last month, d2 = a week later — both behind the seal.
INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time)
SELECT v.id, 'ab000000-1111-0000-0000-000000000001', v.d, '16:00', '17:00'
FROM (VALUES
  ('ab400000-0000-0000-0000-00000000000b'::uuid,
   (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
      - INTERVAL '1 month' + INTERVAL '7 days')::date),
  ('ab400000-0000-0000-0000-00000000000c'::uuid,
   (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
      - INTERVAL '1 month' + INTERVAL '14 days')::date)
) AS v(id, d)
ON CONFLICT (id) DO NOTHING;

INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('ab400000-0000-0000-0000-00000000000b','ab500000-0000-0000-0000-000000000001','present','ab100000-0000-0000-0000-0000000000c1'),
  ('ab400000-0000-0000-0000-00000000000c','ab500000-0000-0000-0000-000000000001','present','ab100000-0000-0000-0000-0000000000c1'),
  ('ab400000-0000-0000-0000-00000000000b','ab500000-0000-0000-0000-000000000002','present','ab100000-0000-0000-0000-0000000000c1')
ON CONFLICT (lesson_session_id, student_id) DO NOTHING;
