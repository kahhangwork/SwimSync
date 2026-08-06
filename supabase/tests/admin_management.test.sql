-- pgTAP: CO-ADMIN MANAGEMENT — ownership, deactivation, the guards, the RPCs.
--
-- Pins 20260806000100. One business, one owner, co-admins with identical
-- authorization; the owner alone manages them, and can never be a target.
--
-- WHAT EACH BLOCK PROVES:
--   1. The FIRST tenant_admin claims tenants.owner_profile_id; a later one
--      does not steal it — and a plain parent signup (empty metadata) still
--      works, because handle_new_user fires on EVERY signup and a defect there
--      bricks registration platform-wide.
--   2. The escalation guards: profiles.role / tenant_id / admin_disabled_at
--      and tenants.owner_profile_id are not client-writable, while ordinary
--      profile edits (full_name) still are. Without the guards, ANY co-admin
--      could promote themselves or re-enable their own suspension via
--      profiles_update, which permits every tenant admin to update every
--      tenant profile.
--   3. Deactivation: is_tenant_admin() goes false, admin writes hit 0 rows,
--      admin-gated reads (audit_log) go dark — while a deactivated
--      coach-admin's COACH access (current_coach_id) survives untouched.
--      DELIBERATE, DOCUMENTED LIMITATION (RISK 4 of the plan): membership
--      reads keyed on current_tenant_id() — here, the tenants row — persist
--      for a deactivated admin. That clause serves the coach app; asserting
--      the read SUCCEEDS pins the limitation as chosen, not overlooked.
--   4. RPC gates: owner-only, tenant-scoped, owner-immune; deactivate/
--      reactivate are IDEMPOTENT (the API route re-runs them on retry after a
--      half-failed auth ban — a refusal would strand the pair half-applied);
--      remove_admin_role demotes ONLY coach-admins; prepare_admin_delete
--      refuses coach-admins and referenced admins via the CATALOGUE-DERIVED
--      reference map (which must see students.created_by — the reference used
--      here), purges the target's audit rows, and writes an admin_deleted row
--      whose tenant_id proves the audit_log_tenant_of 'Profile' arm.
--   5. anon holds EXECUTE on none of the four RPCs.
--   6. platform_tenant_overview reports the OWNER column, not the
--      earliest-created admin.
--
-- NOTE ON METHOD (§7.16): every probe runs inside this transaction after
-- SET LOCAL ROLE; assertion 1 is the positive control against a silently-
-- superuser run. Bans are auth-layer state and are covered by
-- verify-admins.mjs, not here.
--
-- PROVEN RED (§7.25), all three runs performed 2026-08-06:
--   • Whole file, schema without 20260806000100: aborts at assertion 3
--     (`owner_profile_id` does not exist) and poisons the transaction — not
--     one assertion after the fixture evaluates.
--   • Guard triggers dropped: 14 of 38 fail — 6/7/8 directly (the forbidden
--     UPDATEs succeed), and the cascade is the demonstration: assertion 6's
--     self-promotion to platform_admin actually LANDS, after which the
--     "admin" no longer matches the RPCs' role checks and 13/14/15/17/20/23/
--     26/27/30/31/32 fall over downstream. That corruption is the escalation
--     path the guards close.
--   • Pre-migration is_tenant_admin body restored: 16/17/19/22 fail — a
--     deactivated admin keeps their identity, keeps writing, keeps reading.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(38);

-- ── Two businesses, an owner, two co-admins, a stranger admin, a parent ──────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('ca000000-0000-0000-0000-000000000001','coadmin-school','Coadmin Test School','SWIM-CADM'),
  ('cb000000-0000-0000-0000-000000000001','coadmin-other','Coadmin Other School','SWIM-CADX');

-- The owner MUST be inserted first: the claim is first-come. The co-admins
-- follow in the same statement order Postgres executes row by row.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','ca000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','coadmin-owner@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Owner Olivia","role":"tenant_admin","tenant_id":"ca000000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','ca000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','coadmin-pure@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Pure Percy","role":"tenant_admin","tenant_id":"ca000000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','ca000000-0000-0000-0000-0000000000a3',
   'authenticated','authenticated','coadmin-coachadmin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Coachadmin Cora","role":"tenant_admin","tenant_id":"ca000000-0000-0000-0000-000000000001","is_coach":true}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','cb000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','coadmin-other-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Other Otto","role":"tenant_admin","tenant_id":"cb000000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','ca000000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','coadmin-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','ca000000-0000-0000-0000-0000000000e1',
   'authenticated','authenticated','coadmin-platform@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Platform Pat","role":"platform_admin"}', now(), now(), '', '', '', '');

-- ============================================================
-- 1. OWNERSHIP CLAIM + THE EVERY-SIGNUP CONTROL
-- ============================================================

-- 1. Control: the fixture is real — the trigger built the owner's profile.
SELECT is(
  (SELECT COUNT(*) FROM profiles WHERE id = 'ca000000-0000-0000-0000-0000000000a1')::int,
  1, 'control: handle_new_user built the owner profile');

-- 2. RISK 5 control: a signup with EMPTY metadata still becomes a parent.
SELECT is(
  (SELECT COUNT(*) FROM parents WHERE profile_id = 'ca000000-0000-0000-0000-0000000000d1')::int,
  1, 'a plain parent signup (empty metadata) still creates the parents row');

-- 3. The FIRST admin claimed ownership — not the second, not the third.
SELECT is(
  (SELECT owner_profile_id FROM tenants WHERE id = 'ca000000-0000-0000-0000-000000000001'),
  'ca000000-0000-0000-0000-0000000000a1'::uuid,
  'the first tenant_admin is the owner; later co-admins did not steal it');

-- 4. Same claim, other tenant — proves per-tenant, not global-first.
SELECT is(
  (SELECT owner_profile_id FROM tenants WHERE id = 'cb000000-0000-0000-0000-000000000001'),
  'cb000000-0000-0000-0000-0000000000b1'::uuid,
  'each tenant''s own first admin owns it');

-- ============================================================
-- 2. THE ESCALATION GUARDS — as the ACTIVE pure co-admin
-- ============================================================
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- 5. Positive control: the session is real and admin authority is LIVE — an
--    admin-gated write succeeds before deactivation, so the 0-rows later is a
--    denial, not a broken session.
WITH attempted AS (
  UPDATE tenants SET display_name = 'Coadmin Test School'
   WHERE id = 'ca000000-0000-0000-0000-000000000001'
  RETURNING 1
)
SELECT is((SELECT COUNT(*) FROM attempted)::int, 1,
          'control: an ACTIVE co-admin can perform admin writes');

-- 6. Self-promotion is refused by the guard trigger, not merely unlinked.
SELECT throws_ok(
  $$ UPDATE profiles SET role = 'platform_admin'
      WHERE id = 'ca000000-0000-0000-0000-0000000000a2' $$,
  'P0001', NULL,
  'a co-admin cannot change any profile''s role (their own included)');

-- 7. Nor can they suspend a peer directly, bypassing the owner-only RPC.
SELECT throws_ok(
  $$ UPDATE profiles SET admin_disabled_at = now()
      WHERE id = 'ca000000-0000-0000-0000-0000000000a3' $$,
  'P0001', NULL,
  'admin_disabled_at is not client-writable');

-- 8. Nor take ownership of the business.
SELECT throws_ok(
  $$ UPDATE tenants SET owner_profile_id = 'ca000000-0000-0000-0000-0000000000a2'
      WHERE id = 'ca000000-0000-0000-0000-000000000001' $$,
  'P0001', NULL,
  'owner_profile_id is not client-writable');

-- 9. Ordinary edits pass the guard untouched — it pins three columns, not the
--    table.
WITH attempted AS (
  UPDATE profiles SET full_name = 'Percy Renamed'
   WHERE id = 'ca000000-0000-0000-0000-0000000000a2'
  RETURNING 1
)
SELECT is((SELECT COUNT(*) FROM attempted)::int, 1,
          'a profile''s ordinary columns (full_name) remain editable');

-- 10. The RPCs are owner-gated: a mere co-admin is refused.
SELECT throws_ok(
  $$ SELECT deactivate_admin('ca000000-0000-0000-0000-0000000000a3') $$,
  'P0001', NULL,
  'a non-owner admin cannot deactivate anyone');

-- ============================================================
-- 3+4. THE OWNER MANAGES; DEACTIVATION BITES; COACH ACCESS SURVIVES
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub":"ca000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 11. The owner is immune — even from themselves.
SELECT throws_ok(
  $$ SELECT deactivate_admin('ca000000-0000-0000-0000-0000000000a1') $$,
  'P0001', NULL, 'the owner cannot be deactivated');

-- 12. Tenant-scoped: another business's admin is not theirs to touch.
SELECT throws_ok(
  $$ SELECT deactivate_admin('cb000000-0000-0000-0000-0000000000b1') $$,
  'P0001', NULL, 'cross-tenant deactivation is refused');

-- 13. The real thing.
SELECT lives_ok(
  $$ SELECT deactivate_admin('ca000000-0000-0000-0000-0000000000a2') $$,
  'the owner deactivates the pure co-admin');

-- 14. IDEMPOTENT: the second call is a success no-op, because the API route's
--     retry after a half-failed auth ban must be able to re-run it.
SELECT lives_ok(
  $$ SELECT deactivate_admin('ca000000-0000-0000-0000-0000000000a2') $$,
  'deactivating an already-deactivated admin succeeds as a no-op');

-- 15. And the state stuck.
SELECT ok(
  (SELECT admin_disabled_at IS NOT NULL FROM profiles
    WHERE id = 'ca000000-0000-0000-0000-0000000000a2'),
  'admin_disabled_at is set');

-- The deactivated co-admin's own view of the world:
SET LOCAL "request.jwt.claims" TO '{"sub":"ca000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- 16. Their admin identity is gone…
SELECT ok(NOT is_tenant_admin('ca000000-0000-0000-0000-000000000001'),
          'is_tenant_admin() is false while deactivated');

-- 17. …so the write that succeeded at assertion 5 now touches nothing.
WITH attempted AS (
  UPDATE tenants SET display_name = 'HIJACKED'
   WHERE id = 'ca000000-0000-0000-0000-000000000001'
  RETURNING 1
)
SELECT is((SELECT COUNT(*) FROM attempted)::int, 0,
          'a deactivated admin''s admin writes hit 0 rows');

-- 18. DOCUMENTED LIMITATION, pinned as chosen: the tenants row remains
--     readable via the current_tenant_id() membership clause, which the coach
--     app depends on. This is the RISK 4 residue; the auth-layer ban (route,
--     driver-verified) is what ends it within one token lifetime.
SELECT is(
  (SELECT COUNT(*) FROM tenants WHERE id = 'ca000000-0000-0000-0000-000000000001')::int,
  1, 'membership reads persist for a deactivated admin — deliberate, see header');

-- 19. But the admin-gated read is dark: the audit trail their deactivation
--     wrote is invisible to them.
SELECT is(
  (SELECT COUNT(*) FROM audit_log
    WHERE tenant_id = 'ca000000-0000-0000-0000-000000000001')::int,
  0, 'audit_log (is_tenant_admin-gated) is unreadable while deactivated');

-- The coach-admin: deactivation must not touch the coaching half.
SET LOCAL "request.jwt.claims" TO '{"sub":"ca000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 20.
SELECT lives_ok(
  $$ SELECT deactivate_admin('ca000000-0000-0000-0000-0000000000a3') $$,
  'the owner deactivates the coach-admin');

SET LOCAL "request.jwt.claims" TO '{"sub":"ca000000-0000-0000-0000-0000000000a3","role":"authenticated"}';

-- 21. Coach access derives from the coaches ROW, not the role — still there.
SELECT ok(current_coach_id() IS NOT NULL,
          'a deactivated coach-admin keeps their coach identity');

-- 22. While the admin half is gone.
SELECT ok(NOT is_tenant_admin('ca000000-0000-0000-0000-000000000001'),
          'a deactivated coach-admin holds no admin authority');

-- ============================================================
-- 4b. REACTIVATE, DEMOTE, DELETE
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub":"ca000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 23.
SELECT lives_ok(
  $$ SELECT reactivate_admin('ca000000-0000-0000-0000-0000000000a2') $$,
  'the owner reactivates the pure co-admin');

-- 24.
SELECT ok(
  (SELECT admin_disabled_at IS NULL FROM profiles
    WHERE id = 'ca000000-0000-0000-0000-0000000000a2'),
  'reactivation clears admin_disabled_at');

-- 25. A coach-admin is never hard-deleted — the delete path refuses them.
SELECT throws_ok(
  $$ SELECT prepare_admin_delete('ca000000-0000-0000-0000-0000000000a3') $$,
  'P0001', NULL,
  'prepare_admin_delete refuses an admin who is also a coach');

-- 26. Their "delete" is demotion: admin role gone, coach kept.
SELECT lives_ok(
  $$ SELECT remove_admin_role('ca000000-0000-0000-0000-0000000000a3') $$,
  'remove_admin_role demotes the coach-admin');

-- 27.
SELECT ok(
  (SELECT role = 'coach' FROM profiles WHERE id = 'ca000000-0000-0000-0000-0000000000a3')
  AND EXISTS (SELECT 1 FROM coaches WHERE profile_id = 'ca000000-0000-0000-0000-0000000000a3'),
  'the demoted admin is a coach with their coaches row intact');

-- 28. And the mirror refusal: a PURE admin cannot be "demoted" to a coach they
--     never were.
SELECT throws_ok(
  $$ SELECT remove_admin_role('ca000000-0000-0000-0000-0000000000a2') $$,
  'P0001', NULL,
  'remove_admin_role refuses a pure admin — that account is deleted, not demoted');

-- 29. A referenced pure admin cannot be deleted. The reference is
--     students.created_by — one of the two columns the first draft of the
--     migration MISSED, which is why the map is catalogue-derived (RISK 1).
RESET ROLE;
INSERT INTO students (id, full_name, date_of_birth, tenant_id, created_by) VALUES
  ('ca000000-0000-0000-0000-00000000c001','Reference Child','2019-01-01',
   'ca000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-0000000000a2');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT prepare_admin_delete('ca000000-0000-0000-0000-0000000000a2') $$,
  'P0001', NULL,
  'an admin with recorded activity (students.created_by) cannot be deleted');

-- 30. Clean, the delete proceeds. Seed one audit row AS the target first, so
--     the purge has something real to purge.
RESET ROLE;
DELETE FROM students WHERE id = 'ca000000-0000-0000-0000-00000000c001';
INSERT INTO audit_log (actor_id, action, entity_type, entity_id)
VALUES ('ca000000-0000-0000-0000-0000000000a2', 'seed_for_purge_test', 'Profile',
        'ca000000-0000-0000-0000-0000000000a3');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT lives_ok(
  $$ SELECT prepare_admin_delete('ca000000-0000-0000-0000-0000000000a2') $$,
  'an unreferenced pure admin can be prepared for deletion');

RESET ROLE;

-- 31. The purge the UI warned about happened.
SELECT is(
  (SELECT COUNT(*) FROM audit_log
    WHERE actor_id = 'ca000000-0000-0000-0000-0000000000a2')::int,
  0, 'the deleted admin''s audit rows are purged');

-- 32. The deletion itself is on record, attributed to the OWNER, stamped with
--     the right business — which proves audit_log_tenant_of's 'Profile' arm.
SELECT is(
  (SELECT COUNT(*) FROM audit_log
    WHERE action = 'admin_deleted'
      AND entity_id = 'ca000000-0000-0000-0000-0000000000a2'
      AND actor_id  = 'ca000000-0000-0000-0000-0000000000a1'
      AND tenant_id = 'ca000000-0000-0000-0000-000000000001')::int,
  1, 'the admin_deleted audit row exists, owner-attributed, tenant-stamped');

-- 33. The profile itself survives the RPC — deleting the auth user (and the
--     cascade to profiles) is the API route's half, deliberately not done here.
SELECT is(
  (SELECT COUNT(*) FROM profiles WHERE id = 'ca000000-0000-0000-0000-0000000000a2')::int,
  1, 'prepare_admin_delete leaves the profile for the auth-user cascade');

-- ============================================================
-- 5. ANON HOLDS NONE OF THIS
-- ============================================================
SET LOCAL ROLE anon;

-- 34–37.
SELECT throws_ok(
  $$ SELECT deactivate_admin('ca000000-0000-0000-0000-0000000000a2') $$,
  '42501', NULL, 'anon cannot execute deactivate_admin');
SELECT throws_ok(
  $$ SELECT reactivate_admin('ca000000-0000-0000-0000-0000000000a2') $$,
  '42501', NULL, 'anon cannot execute reactivate_admin');
SELECT throws_ok(
  $$ SELECT remove_admin_role('ca000000-0000-0000-0000-0000000000a2') $$,
  '42501', NULL, 'anon cannot execute remove_admin_role');
SELECT throws_ok(
  $$ SELECT prepare_admin_delete('ca000000-0000-0000-0000-0000000000a2') $$,
  '42501', NULL, 'anon cannot execute prepare_admin_delete');

RESET ROLE;

-- ============================================================
-- 6. THE OVERVIEW FOLLOWS THE OWNER COLUMN, NOT CREATION ORDER
-- ============================================================
-- Re-point ownership (as superuser — the guard pins only client writes) to a
-- LATER-created profile. If the function still ordered by created_at it would
-- keep reporting the first admin; following the column is the fix under test.
UPDATE tenants SET owner_profile_id = 'ca000000-0000-0000-0000-0000000000a3'
 WHERE id = 'ca000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- 38.
SELECT is(
  (SELECT admin_email FROM platform_tenant_overview()
    WHERE tenant_id = 'ca000000-0000-0000-0000-000000000001'),
  'coadmin-coachadmin@test.local',
  'platform_tenant_overview reports the owner column, not the oldest admin');

SELECT * FROM finish();
ROLLBACK;
