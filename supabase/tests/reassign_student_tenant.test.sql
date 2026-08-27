-- pgTAP: reassign_student_tenant() closes its two silent ends (Piece 3).
--
-- ⚠ THESE ARE RED AGAINST THE PRE-FIX BODY, by construction (§7.25). Verified
-- by running this file against the pre-fix schema before landing it: tests
-- 1, 2, 3, 8, 11, 13 fail (6 of 13).
--   • tests 1/2/3 — moving a LEVELLED student THROWS on the old function
--     (trg_student_level_tenant raises 'That level belongs to a different
--     business.' because the old body never cleared level_id), so it never
--     lands at B and never lands unlevelled. The cleanest proof in the wave.
--   • tests 8/11/13 — the old body never wrote the parent's membership at B, so
--     the two-parent write, the count, and the reactivation all fail.
-- (Tests 4 and 7 also PASS on the old body: 4 because P1 was already at B, and
-- 7 because an unlevelled move does not throw — it just writes no membership.)
--
-- Its own tenants/users, so nothing here depends on another fixture's state.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(13);

-- ── Two businesses, and a level ladder that belongs only to A ────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('8d000000-0000-0000-0000-000000000001','rsa-home','Reassign Home Swim','SWIM-RSAH'),
  ('8d000000-0000-0000-0000-000000000002','rsa-dest','Reassign Dest Swim','SWIM-RSAD');

INSERT INTO tenant_levels (id, tenant_id, label, sort_order) VALUES
  ('90000000-0000-0000-0000-0000000000a1','8d000000-0000-0000-0000-000000000001','Seahorse',1);

-- ── Parents (auth.users → profile + parents row, by trigger) + platform admin ─
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','7d000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','rsa-p1@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}', '{"full_name":"RSA Parent One","role":"parent"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','7d000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','rsa-p2@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}', '{"full_name":"RSA Parent Two","role":"parent"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','7d000000-0000-0000-0000-000000000003',
   'authenticated','authenticated','rsa-p3@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}', '{"full_name":"RSA Parent Three","role":"parent"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','7d000000-0000-0000-0000-000000000004',
   'authenticated','authenticated','rsa-p4@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}', '{"full_name":"RSA Parent Four","role":"parent"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','7d000000-0000-0000-0000-0000000000ff',
   'authenticated','authenticated','rsa-plat@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}', '{"full_name":"RSA Platform","role":"platform_admin"}', now(), now(), '','','','');

-- ── Students at A ────────────────────────────────────────────────────────────
-- S1 is LEVELLED (the production bug); S2 has TWO parents; S3 has NONE
-- (admin-created); S4's parent is already at B but INACTIVE (a rejoin).
INSERT INTO students (id, full_name, assignment_status, tenant_id, is_active, level_id) VALUES
  ('5d000000-0000-0000-0000-000000000001','RSA Levelled Child','unassigned','8d000000-0000-0000-0000-000000000001',TRUE,'90000000-0000-0000-0000-0000000000a1'),
  ('5d000000-0000-0000-0000-000000000002','RSA TwoParent Child','unassigned','8d000000-0000-0000-0000-000000000001',TRUE,NULL),
  ('5d000000-0000-0000-0000-000000000003','RSA Orphan Child','unassigned','8d000000-0000-0000-0000-000000000001',TRUE,NULL),
  ('5d000000-0000-0000-0000-000000000004','RSA Rejoin Child','unassigned','8d000000-0000-0000-0000-000000000001',TRUE,NULL);

-- parent_students links
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '5d000000-0000-0000-0000-000000000001' FROM parents p WHERE p.profile_id='7d000000-0000-0000-0000-000000000001';
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '5d000000-0000-0000-0000-000000000002' FROM parents p WHERE p.profile_id IN ('7d000000-0000-0000-0000-000000000002','7d000000-0000-0000-0000-000000000003');
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '5d000000-0000-0000-0000-000000000004' FROM parents p WHERE p.profile_id='7d000000-0000-0000-0000-000000000004';

-- Memberships. P1 is already ACTIVE at BOTH A and B (the no-op case). P4 is at A
-- and has an INACTIVE membership at B (the reactivation case).
INSERT INTO parent_tenants (parent_id, tenant_id, is_active)
SELECT p.id, '8d000000-0000-0000-0000-000000000001', TRUE FROM parents p
 WHERE p.profile_id IN ('7d000000-0000-0000-0000-000000000001','7d000000-0000-0000-0000-000000000002','7d000000-0000-0000-0000-000000000003','7d000000-0000-0000-0000-000000000004');
INSERT INTO parent_tenants (parent_id, tenant_id, is_active)
SELECT p.id, '8d000000-0000-0000-0000-000000000002', TRUE FROM parents p WHERE p.profile_id='7d000000-0000-0000-0000-000000000001';
INSERT INTO parent_tenants (parent_id, tenant_id, is_active)
SELECT p.id, '8d000000-0000-0000-0000-000000000002', FALSE FROM parents p WHERE p.profile_id='7d000000-0000-0000-0000-000000000004';

-- ── Act as the platform admin (the RPC's own guard is is_platform_admin()) ────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"7d000000-0000-0000-0000-0000000000ff","role":"authenticated"}';

-- 1. THE PRODUCTION BUG. Old body throws 23514 here; the fix nulls level_id in
--    the same UPDATE so the level trigger passes.
SELECT lives_ok($$
  SELECT reassign_student_tenant('5d000000-0000-0000-0000-000000000001','8d000000-0000-0000-0000-000000000002')
$$, 'a LEVELLED student can be moved (the old body threw on the level trigger)');

-- 2/3. It landed at B, and UNLEVELLED (A''s ladder means nothing at B).
SELECT is((SELECT tenant_id FROM students WHERE id='5d000000-0000-0000-0000-000000000001'),
  '8d000000-0000-0000-0000-000000000002'::uuid, 'the levelled child is now at business B');
SELECT is((SELECT level_id FROM students WHERE id='5d000000-0000-0000-0000-000000000001'),
  NULL, 'the moved child lands UNLEVELLED — B''s admin re-levels them');

-- 4/5. P1 was already at B: the move is a no-op there, not a duplicate, and the
--      membership stays active.
SELECT is((SELECT count(*) FROM parent_tenants pt JOIN parents p ON p.id=pt.parent_id
  WHERE p.profile_id='7d000000-0000-0000-0000-000000000001' AND pt.tenant_id='8d000000-0000-0000-0000-000000000002'),
  1::bigint, 'an already-joined parent gets no duplicate membership at B');
SELECT is((SELECT bool_and(pt.is_active) FROM parent_tenants pt JOIN parents p ON p.id=pt.parent_id
  WHERE p.profile_id='7d000000-0000-0000-0000-000000000001' AND pt.tenant_id='8d000000-0000-0000-0000-000000000002'),
  TRUE, 'the already-joined membership at B stays active');

-- 6. Isolation at A intact: moving the child did not touch the parent''s A row.
SELECT ok((SELECT EXISTS(SELECT 1 FROM parent_tenants pt JOIN parents p ON p.id=pt.parent_id
  WHERE p.profile_id='7d000000-0000-0000-0000-000000000001'
    AND pt.tenant_id='8d000000-0000-0000-0000-000000000001' AND pt.is_active)),
  'the parent''s membership at the OLD business A is left intact');

-- 7/8. Two-parent child: BOTH parents get an active membership at B.
SELECT lives_ok($$
  SELECT reassign_student_tenant('5d000000-0000-0000-0000-000000000002','8d000000-0000-0000-0000-000000000002')
$$, 'a two-parent child moves without error');
SELECT is((SELECT count(*) FROM parent_tenants pt JOIN parents p ON p.id=pt.parent_id
  WHERE p.profile_id IN ('7d000000-0000-0000-0000-000000000002','7d000000-0000-0000-0000-000000000003')
    AND pt.tenant_id='8d000000-0000-0000-0000-000000000002' AND pt.is_active),
  2::bigint, 'both linked parents get an active membership at B');

-- 9/10. Zero-parent child: the move succeeds and lands at B (no membership row).
SELECT lives_ok($$
  SELECT reassign_student_tenant('5d000000-0000-0000-0000-000000000003','8d000000-0000-0000-0000-000000000002')
$$, 'an admin-created child with NO parent moves cleanly (no membership to write)');
SELECT is((SELECT tenant_id FROM students WHERE id='5d000000-0000-0000-0000-000000000003'),
  '8d000000-0000-0000-0000-000000000002'::uuid, 'the parentless child is now at B');

-- 11. Exactly the four expected memberships at B (P1,P2,P3,P4) — the orphan
--     added none.
SELECT is((SELECT count(*) FROM parent_tenants WHERE tenant_id='8d000000-0000-0000-0000-000000000002'),
  4::bigint, 'B has exactly four memberships — the parentless move created none');

-- 12/13. Rejoin: P4''s pre-existing INACTIVE membership at B is REACTIVATED.
SELECT lives_ok($$
  SELECT reassign_student_tenant('5d000000-0000-0000-0000-000000000004','8d000000-0000-0000-0000-000000000002')
$$, 'a child whose parent was previously offboarded at B moves');
SELECT is((SELECT pt.is_active FROM parent_tenants pt JOIN parents p ON p.id=pt.parent_id
  WHERE p.profile_id='7d000000-0000-0000-0000-000000000004' AND pt.tenant_id='8d000000-0000-0000-0000-000000000002'),
  TRUE, 'a previously-offboarded membership at B is REACTIVATED on move');

SELECT * FROM finish();
ROLLBACK;
