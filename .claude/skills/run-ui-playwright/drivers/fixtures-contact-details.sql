-- Fixture for verify-contact-details.mjs.
--
-- Four children, one per branch of the contact-details modal:
--
--   Wanda Unclaimed    — nobody has claimed her. EDITABLE. Carries `964` as a
--                        phone, which is the value a real child on production
--                        actually holds: normalize_phone() refuses anything
--                        under 8 digits, so that child can never be matched by
--                        phone and nobody was ever told.
--   Xavier Claimedkid  — claimed AND enrolled. READ-ONLY, showing the parent's
--                        own profiles row.
--   Yolanda Noclass    — claimed and NOT enrolled anywhere, belonging to a
--                        DIFFERENT parent who has no other children. This is
--                        the load-bearing one: tenant_serves_parent() keys off
--                        students.tenant_id rather than enrolment, and if it
--                        did not, this parent's contact details would be
--                        invisible to their own business. Giving her a parent
--                        of her own is what stops the check passing vacuously
--                        through Xavier's enrolment.
--   Zane Pendingclaim  — unclaimed, with a PENDING claim against him. LOCKED:
--                        student_claims.match_reason is snapshotted at claim
--                        time, so editing the contact details underneath it
--                        would leave the admin approving on a stale reason.
--
-- Names deliberately share no tokens: findDuplicatePairs() matches on the first
-- token or any two, so a common prefix would bury the page in false duplicates.
--
-- ADDITIVE AND IDEMPOTENT — safe to re-run, and it never resets anything. The
-- other worktree (../SwimSync-attendance-window) owns supabase/ and is the only
-- one that may `supabase db reset`. The mutable fields are force-reset below so
-- a second run starts from the same place the first did.

\set tenant '''70000000-0000-0000-0000-000000000001'''

-- ── Parent A: has a child WITH an enrolment ────────────────────────────────
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'cd000000-0000-0000-0000-0000000000a1',
  'authenticated', 'authenticated', 'cdparenta@swimsync.test',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Priya Raman","role":"parent"}',
  NOW(), NOW(), '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- ── Parent B: has a child with NO enrolment, and nothing else ──────────────
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'cd000000-0000-0000-0000-0000000000b1',
  'authenticated', 'authenticated', 'cdparentb@swimsync.test',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Marcus Chen","role":"parent"}',
  NOW(), NOW(), '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- ── Parent C: the SECOND parent of Xavier ──────────────────────────────────
-- parent_students is many-to-many because a child has two parents, and "show
-- me the mother's number rather than the father's" is the ordinary reason an
-- admin opens this screen. Taking parent_students[0] answers with whichever
-- row happened to come back first.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'cd000000-0000-0000-0000-0000000000c1',
  'authenticated', 'authenticated', 'cdparentc@swimsync.test',
  crypt('password123', gen_salt('bf')), NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Devi Raman","role":"parent"}',
  NOW(), NOW(), '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

UPDATE profiles SET full_name = 'Devi Raman', phone = '8222 3333'
 WHERE id = 'cd000000-0000-0000-0000-0000000000c1';

-- Forced, not defaulted: these exact strings are what the driver asserts on
-- screen, and a blank here would make the read-path check pass vacuously.
UPDATE profiles SET full_name = 'Priya Raman', phone = '+65 8123 4567'
 WHERE id = 'cd000000-0000-0000-0000-0000000000a1';
UPDATE profiles SET full_name = 'Marcus Chen', phone = '9876 5432'
 WHERE id = 'cd000000-0000-0000-0000-0000000000b1';

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, :tenant FROM parents p
 WHERE p.profile_id IN ('cd000000-0000-0000-0000-0000000000a1',
                        'cd000000-0000-0000-0000-0000000000b1')
ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key DO NOTHING;

-- ── The four children ──────────────────────────────────────────────────────
INSERT INTO students (id, full_name, date_of_birth, tenant_id, assignment_status, is_active)
VALUES
  ('cd000000-0000-0000-0000-000000000011', 'Wanda Unclaimed',   '2017-03-04', :tenant, 'unassigned', TRUE),
  ('cd000000-0000-0000-0000-000000000022', 'Xavier Claimedkid', '2016-05-06', :tenant, 'assigned',   TRUE),
  ('cd000000-0000-0000-0000-000000000033', 'Yolanda Noclass',   '2018-07-08', :tenant, 'unassigned', TRUE),
  ('cd000000-0000-0000-0000-000000000044', 'Zane Pendingclaim', '2015-09-10', :tenant, 'unassigned', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Force-reset the mutable fields so a re-run starts where the first run did —
-- the driver EDITS Wanda's, so without this a second run asserts against
-- whatever the last one typed.
UPDATE students SET
  provisional_contact_name  = 'Old Contact Name',
  provisional_contact_phone = '964',            -- the production value
  provisional_contact_email = 'old@example.com'
 WHERE id = 'cd000000-0000-0000-0000-000000000011';

UPDATE students SET
  provisional_contact_name  = 'Locked Contact',
  provisional_contact_phone = '91110000',
  provisional_contact_email = 'locked@example.com'
 WHERE id = 'cd000000-0000-0000-0000-000000000044';

-- ── Who belongs to whom ────────────────────────────────────────────────────
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'cd000000-0000-0000-0000-000000000022'
  FROM parents p WHERE p.profile_id = 'cd000000-0000-0000-0000-0000000000a1'
ON CONFLICT DO NOTHING;

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'cd000000-0000-0000-0000-000000000033'
  FROM parents p WHERE p.profile_id = 'cd000000-0000-0000-0000-0000000000b1'
ON CONFLICT DO NOTHING;

-- Xavier's second parent.
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'cd000000-0000-0000-0000-000000000022'
  FROM parents p WHERE p.profile_id = 'cd000000-0000-0000-0000-0000000000c1'
ON CONFLICT DO NOTHING;

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, :tenant FROM parents p
 WHERE p.profile_id = 'cd000000-0000-0000-0000-0000000000c1'
ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key DO NOTHING;

-- Xavier is enrolled; Yolanda deliberately is NOT — see the header.
INSERT INTO student_class_enrolments (student_id, class_id)
SELECT 'cd000000-0000-0000-0000-000000000022', c.id
  FROM classes c
 WHERE c.title = 'Saturday Beginners' AND c.tenant_id = :tenant
ON CONFLICT DO NOTHING;

-- ── The pending claim that locks Zane's details ────────────────────────────
-- Deleted then re-inserted rather than ON CONFLICT: the uniqueness that governs
-- this is a PARTIAL index (pending only), which ON CONFLICT cannot name without
-- restating its predicate.
DELETE FROM student_claims WHERE student_id = 'cd000000-0000-0000-0000-000000000044';

INSERT INTO student_claims (
  tenant_id, student_id, parent_id, claimed_name, claimed_dob,
  certainty, match_reason, status
)
SELECT :tenant, 'cd000000-0000-0000-0000-000000000044', p.id,
       'Zane Pendingclaim', '2015-09-10', 'confirmed', 'phone', 'pending'
  FROM parents p WHERE p.profile_id = 'cd000000-0000-0000-0000-0000000000b1';

SELECT 'fixture ready: Wanda (editable, phone 964) · Xavier (claimed+enrolled) · Yolanda (claimed, no class, own parent) · Zane (pending claim)' AS status;
