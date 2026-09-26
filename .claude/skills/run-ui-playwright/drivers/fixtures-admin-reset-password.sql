-- Fixture for verify-admin-reset-password.mjs — the admin panel's password
-- RECOVERY path, driven through a real GoTrue recovery link (BACKLOG →
-- Foundations; docs/plans/DRIVER_BACKLOG_PLAN.md U9).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-admin-reset-password.sql
--
-- ITS OWN BUSINESS AND ITS OWN ADMIN (prefix d6000000-). The driver CHANGES the
-- admin's password; the hand-check it promotes (batch-e-handchecks.mjs, the
-- former check 7) changed the SEED admin's, and every other driver's
-- `loginAdmin` depends on that one (plan rule 12). Nothing the seed owns is
-- touched, so nothing needs restoring.
--
-- IDEMPOTENT AND RESETTING: `ON CONFLICT … DO UPDATE SET encrypted_password`
-- puts `password123` back on every load. The driver sets a PER-RUN password
-- and asserts it is REFUSED before the reset — together these stop a re-run
-- (no `db reset`) passing "the new password signs in" on a leftover
-- (plan ⚠ RISK 4).
-- Teardown: fixtures-admin-reset-password-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('d6000000-0000-0000-0000-000000000001','admin-reset','AdmReset Swim','SWIM-ARST')
ON CONFLICT (id) DO NOTHING;

-- handle_new_user makes the profile (tenant_admin of AdmReset Swim) on INSERT.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('00000000-0000-0000-0000-000000000000','d6000000-0000-0000-0000-0000000000a1',
  'authenticated','authenticated','admin-reset-owner@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"AdmReset Owner","role":"tenant_admin","tenant_id":"d6000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','','')
ON CONFLICT (id) DO UPDATE
   SET encrypted_password = crypt('password123', gen_salt('bf')),
       recovery_token     = '',
       updated_at         = now();

UPDATE tenants SET owner_profile_id = 'd6000000-0000-0000-0000-0000000000a1'
 WHERE id = 'd6000000-0000-0000-0000-000000000001'
   AND owner_profile_id IS DISTINCT FROM 'd6000000-0000-0000-0000-0000000000a1';

-- Postcondition: the admin exists, is a tenant_admin of its own business, and
-- holds password123 — whatever a previous run set.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u JOIN profiles p ON p.id = u.id
     WHERE u.id = 'd6000000-0000-0000-0000-0000000000a1'
       AND u.encrypted_password = crypt('password123', u.encrypted_password)
       AND p.role = 'tenant_admin'
       AND p.tenant_id = 'd6000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'fixtures-admin-reset-password: admin-reset-owner is not a tenant_admin holding password123';
  END IF;
END $$;

COMMIT;
