-- Fixture for verify-parent-claim.mjs.
--
-- The situation this whole slice exists for: a coach has put a child on the
-- roster and marked a lesson for them, and the parent has since registered on
-- their own. Nothing connects the two, and the parent is about to type that
-- child's name into Add Child and create a second record with none of the
-- attendance.
--
-- Ethan deliberately has NO DATE OF BIRTH. That is the usual shape for a
-- poolside walk-in, and it is exactly why students_identity_uniq — which is
-- (tenant, lower(trim(name)), date_of_birth) and exempts NULL — lets the
-- duplicate through without a murmur.
--
-- Idempotent: safe to re-run without a db reset between driver runs.

-- ── The parent, registered but connected to nothing ────────────────────────
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'c1a00000-0000-0000-0000-00000000d001',
  'authenticated', 'authenticated', 'claimparent@swimsync.test',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Claim Parent","role":"parent"}',
  NOW(), NOW(), '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- The phone the coach also wrote on the poolside form, in the OTHER format:
-- the parent registers with +65, the coach writes 8 digits. normalize_phone()
-- compares the last 8 so these match — before that fix they did not, and the
-- strongest non-name signal in the system never fired.
UPDATE profiles SET phone = '+65 9123 4567'
 WHERE id = 'c1a00000-0000-0000-0000-00000000d001';

-- They have joined the business with its code, which is the only thing that
-- makes them able to see any candidate at all.
INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '70000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = 'c1a00000-0000-0000-0000-00000000d001'
ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key DO NOTHING;

-- ── The child the coach already added ──────────────────────────────────────
INSERT INTO students (
  id, full_name, date_of_birth, tenant_id, assignment_status, is_active,
  provisional_contact_name, provisional_contact_phone
) VALUES (
  'c1a00000-0000-0000-0000-00000000e001',
  'Ethan Tan Wei Ming', NULL,
  '70000000-0000-0000-0000-000000000001', 'unassigned', TRUE,
  'Claim Parent', '91234567'
) ON CONFLICT (id) DO NOTHING;

-- ...and the lesson the coach marked for them, on the most recent Saturday
-- (the seed class is Saturday). Derived in SGT, never CURRENT_DATE: the server
-- runs UTC and between 00:00 and 08:00 SGT those are different days — the
-- fixture bug that made the package suite fail for eight hours a day.
INSERT INTO lesson_sessions (id, class_id, session_date)
SELECT 'c1a00000-0000-0000-0000-00000000f001',
       c.id,
       (now() AT TIME ZONE 'Asia/Singapore')::date
         - ((EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Singapore')::date)::int + 1) % 7)
  FROM classes c
 WHERE c.title = 'Saturday Beginners'
   AND c.tenant_id = '70000000-0000-0000-0000-000000000001'
ON CONFLICT (id) DO NOTHING;

INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('c1a00000-0000-0000-0000-00000000f001',
        'c1a00000-0000-0000-0000-00000000e001',
        'trial_free', 'c0000000-0000-0000-0000-000000000001')
ON CONFLICT (lesson_session_id, student_id) DO NOTHING;

SELECT 'fixture ready: Ethan Tan Wei Ming is unclaimed with 1 lesson marked' AS status;
