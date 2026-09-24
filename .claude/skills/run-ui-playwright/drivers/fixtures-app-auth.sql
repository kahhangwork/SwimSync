-- Fixture for verify-app-auth.mjs (the app's auth paths — promoted from the
-- App L-F/G/H fence hand-check, docs/refactor/app-fgh-handchecks-fence.mjs).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-app-auth.sql
--
-- One parent of the SEED tenant (Coach Marcus) with one child ENROLLED in the
-- seed coach's "Saturday Beginners" — the child is what the coach's grade
-- viewer opens, so coach@swimsync.test needs no fixture of its own.
--
-- Idempotent, and RESETS the driver's side effects: the parent's password
-- back to password123 (change/reset password rewrite it; the driver restores
-- it in a finally, this is the belt to that brace) and the invited user the
-- Accept Invite check creates.

BEGIN;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','ac100000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','app-auth-parent@swimsync.test',
   crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"App Auth Parent","role":"parent"}',
   now(), now(), '','','','')
ON CONFLICT (id) DO NOTHING;

-- recovery_sent_at too: GoTrue refuses a second recovery mail inside
-- max_frequency, and a re-run's Forgot Password must actually send.
UPDATE auth.users SET encrypted_password = crypt('password123', gen_salt('bf')),
                      recovery_sent_at = NULL
 WHERE id = 'ac100000-0000-0000-0000-0000000000b1';

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '70000000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id = 'ac100000-0000-0000-0000-0000000000b1'
ON CONFLICT DO NOTHING;

INSERT INTO students (id, full_name, date_of_birth, assignment_status, is_active, tenant_id)
VALUES ('ac100000-0000-0000-0000-0000000000d1','Auth Driver Kid','2018-05-05',
        'assigned', TRUE, '70000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'ac100000-0000-0000-0000-0000000000d1'
  FROM parents p WHERE p.profile_id = 'ac100000-0000-0000-0000-0000000000b1'
ON CONFLICT DO NOTHING;

-- Class resolved by title AND the seed coach, so a same-titled class another
-- fixture might add can never be picked (§7.73). Loud if the seed is missing.
DO $$
DECLARE v_class UUID;
BEGIN
  SELECT c.id INTO v_class
    FROM classes c JOIN coaches co ON co.id = c.coach_id
    JOIN profiles pr ON pr.id = co.profile_id
   WHERE c.title = 'Saturday Beginners' AND pr.email = 'coach@swimsync.test';
  IF v_class IS NULL THEN
    RAISE EXCEPTION 'seed class "Saturday Beginners" (coach@swimsync.test) is missing — is the database seeded?';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM student_class_enrolments
                  WHERE student_id = 'ac100000-0000-0000-0000-0000000000d1' AND is_active) THEN
    INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
    VALUES ('ac100000-0000-0000-0000-0000000000d1', v_class, now() - interval '30 days', TRUE);
  END IF;
END $$;

-- The Accept Invite check invites this exact address; a previous run's user
-- must go or generateLink refuses ("already registered").
DELETE FROM audit_log WHERE actor_id IN
  (SELECT id FROM auth.users WHERE email = 'app-auth-invite@swimsync.test');
DELETE FROM parent_tenants WHERE parent_id IN
  (SELECT p.id FROM parents p JOIN auth.users u ON u.id = p.profile_id
    WHERE u.email = 'app-auth-invite@swimsync.test');
DELETE FROM parents WHERE profile_id IN
  (SELECT id FROM auth.users WHERE email = 'app-auth-invite@swimsync.test');
DELETE FROM profiles WHERE id IN
  (SELECT id FROM auth.users WHERE email = 'app-auth-invite@swimsync.test');
DELETE FROM auth.users WHERE email = 'app-auth-invite@swimsync.test';

COMMIT;
