-- pgTAP: OWNER TRANSFER — platform-admin only (20260813000100, Wave 5 chunk 1).
--
-- WHAT EACH BLOCK PROVES:
--   1. Fixture controls: profiles built, each tenant's first admin owns it.
--   2. The gate: EVERY non-platform caller is refused on the transfer RPC —
--      including the tenant's own OWNER, which is the decision (no self-service,
--      WAVE_5_PLAN.md decision 2), and the dropdown feed returns them 0 rows.
--   3. As the platform admin: the dropdown reports owner/disabled flags; the
--      transfer moves the column; the audit row lands with entity 'Tenant' and
--      a tenant_id (the new audit_log_tenant_of arm — without it the INSERT
--      itself RAISES, §7.37); re-running is a silent no-op with no second row.
--   4. Refused targets: cross-tenant admin, deactivated admin, non-admin.
--   5. The LOST-OWNER case: owner_profile_id NULL (auth-layer delete → ON
--      DELETE SET NULL) is recoverable through the same RPC, no special arm.
--   6. platform_tenant_overview() follows the column — the same keying
--      resend-invite uses, asserted at the SQL layer.
--   7. anon holds EXECUTE on neither function.
--
-- NOTE ON METHOD (§7.16): probes run inside this transaction after SET LOCAL
-- ROLE; the fixture-control assertions are the positive control against a
-- silently-superuser run. The fixture DISABLES one co-admin by direct UPDATE
-- while still postgres — the guard trigger only refuses current_user =
-- 'authenticated', which is also why the RPC's own definer write passes.
--
-- PROVEN RED (§7.25), four measured sabotages, all run 2026-08-13:
--   • audit_log_tenant_of reverted to its pre-migration body (no 'Tenant'
--     arm): 8/24 fail — 12-17, 22, 23. The transfer RPC itself dies on its
--     audit INSERT, which is §7.37's design doing its job.
--   • is_platform_admin() gate stripped from platform_reassign_owner: 5/24
--     fail — 4/6/7/8 directly (the forbidden transfers LAND), and 10 downstream
--     because assertion 4's unauthorized transfer moved the owner early. That
--     cascade is the takeover path the gate closes.
--   • WITH me gate stripped from platform_tenant_admins: exactly 5 fails —
--     the owner reads the admin list.
--   • the disabled-target refusal disabled (IF FALSE): exactly 19 fails.
--
-- Post-review additions (same day): every throws_ok pins the refusal MESSAGE
-- (message-blind 'P0001' checks pass on the WRONG refusal — a typo'd fixture id
-- raising 'no such business' would have satisfied test 4); and block 7 (25-27)
-- extends the dropdown-feed gate probe to co-admin/coach/parent. APPENDED, not
-- inlined, so the assertion numbers the sabotage records cite stay true.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(27);

-- ── Fixture: two businesses; owner + live co-admin + disabled co-admin + coach
-- ── + parent in A; an admin in B; a platform admin ───────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('0e000000-0000-0000-0000-000000000001','ot-school','Owner Transfer School','SWIM-OTRA'),
  ('0f000000-0000-0000-0000-000000000001','ot-other','Owner Transfer Other','SWIM-OTRB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','0e000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','ot-owner@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Owner Wanda","role":"tenant_admin","tenant_id":"0e000000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','0e000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','ot-coadmin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Coadmin Casey","role":"tenant_admin","tenant_id":"0e000000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','0e000000-0000-0000-0000-0000000000a3',
   'authenticated','authenticated','ot-disabled@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Disabled Dana","role":"tenant_admin","tenant_id":"0e000000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','0e000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','ot-coach@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Coach Cal","role":"coach","tenant_id":"0e000000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','0e000000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','ot-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','0f000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','ot-other-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Other Ollie","role":"tenant_admin","tenant_id":"0f000000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','0e000000-0000-0000-0000-0000000000e1',
   'authenticated','authenticated','ot-platform@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Platform Pat","role":"platform_admin"}', now(), now(), '', '', '', '');

-- Disable Dana while still postgres (the guard refuses only 'authenticated').
UPDATE profiles SET admin_disabled_at = now()
 WHERE id = '0e000000-0000-0000-0000-0000000000a3';

-- ============================================================
-- 1. FIXTURE CONTROLS
-- ============================================================

-- 1. The trigger built the profiles — the fixture is real.
SELECT is(
  (SELECT COUNT(*) FROM profiles WHERE id IN
    ('0e000000-0000-0000-0000-0000000000a1','0e000000-0000-0000-0000-0000000000e1'))::int,
  2, 'control: handle_new_user built the fixture profiles');

-- 2. A's first admin owns A.
SELECT is(
  (SELECT owner_profile_id FROM tenants WHERE id = '0e000000-0000-0000-0000-000000000001'),
  '0e000000-0000-0000-0000-0000000000a1'::uuid,
  'control: the first tenant_admin claimed ownership of A');

-- 3. B's first admin owns B.
SELECT is(
  (SELECT owner_profile_id FROM tenants WHERE id = '0f000000-0000-0000-0000-000000000001'),
  '0f000000-0000-0000-0000-0000000000b1'::uuid,
  'control: B is owned by its own first admin');

-- ============================================================
-- 2. THE GATE — every non-platform caller refused
-- ============================================================

-- 4. The OWNER cannot transfer their own business — no self-service, by decision.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"0e000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT platform_reassign_owner('0e000000-0000-0000-0000-000000000001',
                                    '0e000000-0000-0000-0000-0000000000a2') $$,
  'P0001', 'only the platform admin may reassign a business''s owner',
  'the tenant OWNER is refused — owner transfer is platform-admin only');

-- 5. The dropdown feed returns the owner NOTHING (gate is empty-set, not error).
SELECT is(
  (SELECT COUNT(*) FROM platform_tenant_admins('0e000000-0000-0000-0000-000000000001'))::int,
  0, 'platform_tenant_admins returns 0 rows to a tenant owner');

-- 6. A co-admin is refused.
SET LOCAL "request.jwt.claims" TO '{"sub":"0e000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT platform_reassign_owner('0e000000-0000-0000-0000-000000000001',
                                    '0e000000-0000-0000-0000-0000000000a2') $$,
  'P0001', 'only the platform admin may reassign a business''s owner',
  'a co-admin cannot make themselves owner');

-- 7. A coach is refused.
SET LOCAL "request.jwt.claims" TO '{"sub":"0e000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT platform_reassign_owner('0e000000-0000-0000-0000-000000000001',
                                    '0e000000-0000-0000-0000-0000000000a2') $$,
  'P0001', 'only the platform admin may reassign a business''s owner',
  'a coach is refused');

-- 8. A parent is refused.
SET LOCAL "request.jwt.claims" TO '{"sub":"0e000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT platform_reassign_owner('0e000000-0000-0000-0000-000000000001',
                                    '0e000000-0000-0000-0000-0000000000a2') $$,
  'P0001', 'only the platform admin may reassign a business''s owner',
  'a parent is refused');

-- ============================================================
-- 3. AS THE PLATFORM ADMIN — dropdown, transfer, audit, idempotency
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub":"0e000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- 9. The dropdown sees all three of A's admins (this is also the positive
--    control that the platform session is real).
SELECT is(
  (SELECT COUNT(*) FROM platform_tenant_admins('0e000000-0000-0000-0000-000000000001'))::int,
  3, 'the platform admin sees all three admin accounts of A');

-- 10. is_owner marks exactly the owner.
SELECT is(
  (SELECT array_agg(profile_id ORDER BY profile_id)
     FROM platform_tenant_admins('0e000000-0000-0000-0000-000000000001')
    WHERE is_owner),
  ARRAY['0e000000-0000-0000-0000-0000000000a1']::uuid[],
  'is_owner is true for exactly the current owner');

-- 11. is_disabled marks exactly Dana.
SELECT is(
  (SELECT array_agg(profile_id ORDER BY profile_id)
     FROM platform_tenant_admins('0e000000-0000-0000-0000-000000000001')
    WHERE is_disabled),
  ARRAY['0e000000-0000-0000-0000-0000000000a3']::uuid[],
  'is_disabled is true for exactly the deactivated co-admin');

-- 12. THE TRANSFER: A's owner becomes the live co-admin.
SELECT lives_ok(
  $$ SELECT platform_reassign_owner('0e000000-0000-0000-0000-000000000001',
                                    '0e000000-0000-0000-0000-0000000000a2') $$,
  'the platform admin can reassign ownership to a live co-admin');

-- 13. The column moved.
SELECT is(
  (SELECT owner_profile_id FROM tenants WHERE id = '0e000000-0000-0000-0000-000000000001'),
  '0e000000-0000-0000-0000-0000000000a2'::uuid,
  'owner_profile_id now names the co-admin');

-- 14. The audit row landed, tenant-stamped by the NEW 'Tenant' arm — the
--     INSERT reaching the table at all proves the arm exists (§7.37); the
--     tenant_id value proves it derived correctly.
SELECT is(
  (SELECT COUNT(*) FROM audit_log
    WHERE action = 'owner_reassigned'
      AND entity_type = 'Tenant'
      AND entity_id = '0e000000-0000-0000-0000-000000000001'
      AND tenant_id = '0e000000-0000-0000-0000-000000000001')::int,
  1, 'one owner_reassigned audit row, tenant-stamped by the Tenant arm');

-- 15. The audit row records both parties.
SELECT is(
  (SELECT (old_value->>'owner_profile_id') || '→' || (new_value->>'owner_profile_id')
     FROM audit_log WHERE action = 'owner_reassigned'
    ORDER BY created_at DESC LIMIT 1),
  '0e000000-0000-0000-0000-0000000000a1→0e000000-0000-0000-0000-0000000000a2',
  'the audit row names the old and new owner');

-- 16. Idempotent: transferring to the CURRENT owner is a silent no-op…
SELECT lives_ok(
  $$ SELECT platform_reassign_owner('0e000000-0000-0000-0000-000000000001',
                                    '0e000000-0000-0000-0000-0000000000a2') $$,
  're-running the transfer to the same owner succeeds as a no-op');

-- 17. …that writes NO second audit row.
SELECT is(
  (SELECT COUNT(*) FROM audit_log WHERE action = 'owner_reassigned')::int,
  1, 'the idempotent re-run wrote no second audit row');

-- ============================================================
-- 4. REFUSED TARGETS
-- ============================================================

-- 18. An admin of ANOTHER business.
SELECT throws_ok(
  $$ SELECT platform_reassign_owner('0e000000-0000-0000-0000-000000000001',
                                    '0f000000-0000-0000-0000-0000000000b1') $$,
  'P0001', 'the new owner must be an admin of that business',
  'a cross-tenant admin is refused as target');

-- 19. A deactivated admin of the SAME business.
SELECT throws_ok(
  $$ SELECT platform_reassign_owner('0e000000-0000-0000-0000-000000000001',
                                    '0e000000-0000-0000-0000-0000000000a3') $$,
  'P0001', 'that admin is deactivated — reactivate them before making them owner',
  'a deactivated co-admin is refused as target');

-- 20. A non-admin (the parent's profile).
SELECT throws_ok(
  $$ SELECT platform_reassign_owner('0e000000-0000-0000-0000-000000000001',
                                    '0e000000-0000-0000-0000-0000000000d1') $$,
  'P0001', 'the new owner must be an admin of that business',
  'a non-admin profile is refused as target');

-- 21. A tenant that does not exist.
SELECT throws_ok(
  $$ SELECT platform_reassign_owner('00000000-0000-0000-0000-00000000dead',
                                    '0e000000-0000-0000-0000-0000000000a2') $$,
  'P0001', 'no such business',
  'an unknown tenant is refused');

-- ============================================================
-- 5. THE LOST-OWNER CASE + THE OVERVIEW FOLLOWS THE COLUMN
-- ============================================================
RESET ROLE;
-- Simulate the owner's auth account being deleted: ON DELETE SET NULL leaves
-- the column NULL. (Direct UPDATE as postgres — the guard permits it.)
UPDATE tenants SET owner_profile_id = NULL
 WHERE id = '0e000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"0e000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- 22. A NULL owner is recoverable through the same RPC — no special arm.
SELECT lives_ok(
  $$ SELECT platform_reassign_owner('0e000000-0000-0000-0000-000000000001',
                                    '0e000000-0000-0000-0000-0000000000a2') $$,
  'a lost owner (NULL column) is recoverable by the platform admin');

-- 23. The overview reports the recovered owner's email — the same column
--     resend-invite keys on, so this pins the downstream effects too.
SELECT is(
  (SELECT admin_email FROM platform_tenant_overview()
    WHERE tenant_id = '0e000000-0000-0000-0000-000000000001'),
  'ot-coadmin@test.local',
  'platform_tenant_overview reports the new owner''s email');

-- ============================================================
-- 6. ANON HOLDS NOTHING
-- ============================================================

-- 24. Neither function is executable by anon (§7.82).
SELECT is(
  (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('platform_reassign_owner','platform_tenant_admins')),
  FALSE, 'anon holds EXECUTE on neither new function');

-- ============================================================
-- 7. THE DROPDOWN GATE, REMAINING ROLES (appended — see header note)
-- ============================================================

-- 25. A co-admin gets 0 rows from the dropdown feed.
SET LOCAL "request.jwt.claims" TO '{"sub":"0e000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT is(
  (SELECT COUNT(*) FROM platform_tenant_admins('0e000000-0000-0000-0000-000000000001'))::int,
  0, 'platform_tenant_admins returns 0 rows to a co-admin');

-- 26. A coach gets 0 rows.
SET LOCAL "request.jwt.claims" TO '{"sub":"0e000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
SELECT is(
  (SELECT COUNT(*) FROM platform_tenant_admins('0e000000-0000-0000-0000-000000000001'))::int,
  0, 'platform_tenant_admins returns 0 rows to a coach');

-- 27. A parent gets 0 rows.
SET LOCAL "request.jwt.claims" TO '{"sub":"0e000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT is(
  (SELECT COUNT(*) FROM platform_tenant_admins('0e000000-0000-0000-0000-000000000001'))::int,
  0, 'platform_tenant_admins returns 0 rows to a parent');

SELECT * FROM finish();
ROLLBACK;
