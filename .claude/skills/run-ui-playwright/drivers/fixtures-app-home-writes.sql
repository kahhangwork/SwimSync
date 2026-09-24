-- Fixture for verify-app-home-writes.mjs (the parent Home writes no other
-- driver reaches — promoted from docs/refactor/app-fgh-handchecks-F.mjs).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-app-home-writes.sql
--
-- One parent of the SEED tenant with one child, plus a DECLINED claim that
-- parent filed on a different child of the same business — the card Home
-- shows until the parent dismisses it (dismiss_student_claim).
--
-- Idempotent, and RESETS the driver's side effects: the claim is un-dismissed
-- and the parent the Register check creates (app-home-register@) is removed.

BEGIN;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','ac200000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','app-home-parent@swimsync.test',
   crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"App Home Parent","role":"parent"}',
   now(), now(), '','','','')
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '70000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = 'ac200000-0000-0000-0000-0000000000b1'
ON CONFLICT DO NOTHING;

INSERT INTO students (id, full_name, date_of_birth, assignment_status, is_active, tenant_id) VALUES
  ('ac200000-0000-0000-0000-0000000000d1','Home Driver Kid','2018-06-06',
   'assigned', TRUE, '70000000-0000-0000-0000-000000000001'),
  -- The child the parent CLAIMED and the coach declined — not theirs.
  ('ac200000-0000-0000-0000-0000000000d2','Zed Claimed','2019-02-02',
   'assigned', TRUE, '70000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'ac200000-0000-0000-0000-0000000000d1'
  FROM parents p WHERE p.profile_id = 'ac200000-0000-0000-0000-0000000000b1'
ON CONFLICT DO NOTHING;

INSERT INTO student_claims (id, tenant_id, student_id, parent_id, claimed_name,
                            certainty, match_reason, status, decided_at)
SELECT 'ac200000-0000-0000-0000-00000000c1a1', '70000000-0000-0000-0000-000000000001',
       'ac200000-0000-0000-0000-0000000000d2', p.id,
       'Zed Claimed', 'confirmed', 'name_only', 'declined', now()
  FROM parents p WHERE p.profile_id = 'ac200000-0000-0000-0000-0000000000b1'
ON CONFLICT (id) DO NOTHING;

UPDATE student_claims SET dismissed_at = NULL
 WHERE id = 'ac200000-0000-0000-0000-00000000c1a1';

-- The Register check signs up this exact address with the seed join code.
DELETE FROM audit_log WHERE actor_id IN
  (SELECT id FROM auth.users WHERE email = 'app-home-register@swimsync.test');
DELETE FROM parent_tenants WHERE parent_id IN
  (SELECT p.id FROM parents p JOIN auth.users u ON u.id = p.profile_id
    WHERE u.email = 'app-home-register@swimsync.test');
DELETE FROM parents WHERE profile_id IN
  (SELECT id FROM auth.users WHERE email = 'app-home-register@swimsync.test');
DELETE FROM profiles WHERE id IN
  (SELECT id FROM auth.users WHERE email = 'app-home-register@swimsync.test');
DELETE FROM auth.users WHERE email = 'app-home-register@swimsync.test';

COMMIT;
