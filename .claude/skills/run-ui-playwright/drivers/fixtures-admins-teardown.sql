-- Teardown for fixtures-admins.sql.
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-admins-teardown.sql
--
-- Run this instead of `supabase db reset` — one database serves every worktree
-- (§7.55).
--
-- THE DRIVER CREATES MORE THAN THE FIXTURE DOES: it invites
-- driver-invited@swimsync.test through the UI (a RANDOM auth uuid — the one
-- deletion here keyed by exact email rather than exact id, because the id does
-- not exist until the run), deactivates/reactivates co-admins (audit rows
-- whose ACTOR is the surviving seed owner but whose ENTITY is ours), demotes
-- or deletes others. Audit rows go before auth users: actor_id is a NOT NULL
-- FK with no cascade.

BEGIN;

-- The LITERAL ids, not a lookup through profiles: the driver hard-deletes
-- admindelete@ (a003), so by teardown time its profile is gone — but its
-- admin_deleted audit row (entity_id = a003, actor = the surviving owner) is
-- not, and a lookup-based list missed exactly that row on the first run.
CREATE TEMP TABLE _admins_profiles ON COMMIT DROP AS
SELECT unnest(ARRAY[
  'ad100000-0000-0000-0000-00000000a001',
  'ad100000-0000-0000-0000-00000000a002',
  'ad100000-0000-0000-0000-00000000a003',
  'ad100000-0000-0000-0000-00000000a004'
]::uuid[]) AS id
UNION
SELECT id FROM profiles WHERE email = 'driver-invited@swimsync.test';

-- Rows the driver's RPC calls wrote ABOUT these profiles (actor = seed owner,
-- who survives) and any rows written BY them.
DELETE FROM audit_log
 WHERE (entity_type = 'Profile' AND entity_id IN (SELECT id FROM _admins_profiles))
    OR actor_id IN (SELECT id FROM _admins_profiles);

-- auth.users → profiles → coaches all cascade from this one delete.
DELETE FROM auth.users WHERE id IN (SELECT id FROM _admins_profiles);

COMMIT;

-- Expect: four zeros, then 1 — the seed tenant's OWNER (coach@swimsync.test)
-- must survive this teardown untouched; owner_profile_id is ON DELETE SET
-- NULL, so a wrongly-widened delete above would read as owner 0 here.
SELECT
  (SELECT count(*) FROM auth.users
    WHERE id::text LIKE 'ad100000-%')                              AS fixture_users,
  (SELECT count(*) FROM auth.users
    WHERE email = 'driver-invited@swimsync.test')                  AS driver_invited,
  (SELECT count(*) FROM coaches
    WHERE profile_id::text LIKE 'ad100000-%')                      AS fixture_coaches,
  (SELECT count(*) FROM audit_log
    WHERE entity_type = 'Profile'
      AND entity_id::text LIKE 'ad100000-%')                       AS profile_audit_rows,
  (SELECT count(*) FROM tenants
    WHERE id = '70000000-0000-0000-0000-000000000001'
      AND owner_profile_id IS NOT NULL)                            AS seed_owner_survives;
