-- pgTAP: rename_student() — the admin's guarded path to setting a child's name.
-- (STUDENT_RENAME_PLAN.md step 1 / step 5.)
--
-- WHY THE COLLISION CASES ARE THE HEART OF THIS FILE. students_identity_uniq is
-- (tenant_id, lower(trim(full_name)), date_of_birth) and a NULL DOB is EXEMPT.
-- So a rename that only trusts the index would let two active NULL-DOB children
-- of the same business share a name — the exact duplicate the claim/merge
-- subsystem exists to prevent, and the one a coach cannot tell apart on the
-- roster. Assertion 8 proves the probe refuses it (remove the probe and it goes
-- green — i.e. the bug returns). Assertion 13 pins the snapshot boundary: a
-- rename must NOT rewrite an already-issued invoice line.
--
-- METHOD (§7.16): every probe runs inside SET LOCAL ROLE with an explicit jwt
-- sub, or the session stays superuser and every refusal "passes".

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(13);

-- ── Tenants ────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('4eb11111-0000-0000-0000-000000000001','rename-a','RENAME Business A','SWIM-RNMA'),
  ('4eb11111-0000-0000-0000-000000000002','rename-b','RENAME Business B','SWIM-RNMB');

-- ── Users (the auth trigger creates profiles + parent/coach rows from metadata) ─
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','4eb00000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','rename-admin-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"RENAME Admin A","role":"tenant_admin","tenant_id":"4eb11111-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','4eb00000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','rename-admin-b@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"RENAME Admin B","role":"tenant_admin","tenant_id":"4eb11111-0000-0000-0000-000000000002"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','4eb00000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','rename-coach-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"RENAME Coach A","role":"coach","tenant_id":"4eb11111-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','4eb00000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','rename-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"RENAME Parent","role":"parent"}', now(), now(), '', '', '', '');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, '4eb11111-0000-0000-0000-000000000001'
  FROM parents p JOIN profiles pr ON pr.id = p.profile_id
 WHERE pr.email = 'rename-parent@test.local';

-- ── A class + one lesson, only so an invoice line can exist (assertion 13) ───
INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('4ebcccc0-0000-0000-0000-000000000001','4eb11111-0000-0000-0000-000000000001','Default Group');

-- classes.location_id is NOT NULL since the location contract migration
-- (20260824000200). Give every tenant one location to hang classes off,
-- tenant-agnostic and idempotent (mirrors the Default Group category block).
INSERT INTO locations (tenant_id, name)
SELECT t.id, 'Default location' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM locations l
    WHERE l.tenant_id = t.id AND lower(trim(l.name)) = 'default location');

INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time,
                     location_id, price_per_lesson, category_id)
VALUES ('4eb55555-0000-0000-0000-000000000001','4eb11111-0000-0000-0000-000000000001',
  (SELECT id FROM coaches WHERE profile_id='4eb00000-0000-0000-0000-0000000000c1'),
  'RENAME Class A','saturday','10:00','11:00',
  (SELECT l.id FROM locations l WHERE l.tenant_id = '4eb11111-0000-0000-0000-000000000001'
      AND lower(trim(l.name)) = 'default location'), 30,
  '4ebcccc0-0000-0000-0000-000000000001');

INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time, status)
VALUES ('4eb77777-0000-0000-0000-000000000001','4eb55555-0000-0000-0000-000000000001',
        '2026-07-04','10:00','11:00','completed');

-- ── The children ─────────────────────────────────────────────────────────────
-- S1 is the target: a coach-added placeholder with NO date of birth, parent-linked.
INSERT INTO students (id, full_name, date_of_birth, tenant_id, assignment_status, is_active) VALUES
  ('4eb99999-0000-0000-0000-000000000001','Anya (big)',   NULL,         '4eb11111-0000-0000-0000-000000000001','unassigned', TRUE),
  ('4eb99999-0000-0000-0000-000000000002','Existing Kid', NULL,         '4eb11111-0000-0000-0000-000000000001','unassigned', TRUE),
  ('4eb99999-0000-0000-0000-000000000008','Temp NullA',   NULL,         '4eb11111-0000-0000-0000-000000000001','unassigned', TRUE),
  ('4eb99999-0000-0000-0000-000000000004','Dated Twin',   DATE '2020-01-01','4eb11111-0000-0000-0000-000000000001','unassigned', TRUE),
  ('4eb99999-0000-0000-0000-000000000005','Mover',        DATE '2020-01-01','4eb11111-0000-0000-0000-000000000001','unassigned', TRUE),
  ('4eb99999-0000-0000-0000-000000000009','Ghost',        DATE '2019-05-05','4eb11111-0000-0000-0000-000000000001','unassigned', FALSE),
  ('4eb99999-0000-0000-0000-000000000010','Ghost Mover',  DATE '2019-05-05','4eb11111-0000-0000-0000-000000000001','unassigned', TRUE),
  ('4eb99999-0000-0000-0000-000000000006','Flex Kid',     DATE '2018-03-03','4eb11111-0000-0000-0000-000000000001','unassigned', TRUE),
  ('4eb99999-0000-0000-0000-000000000007','Flex Mover',   DATE '2017-04-04','4eb11111-0000-0000-0000-000000000001','unassigned', TRUE);

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, '4eb99999-0000-0000-0000-000000000001'
  FROM parents p JOIN profiles pr ON pr.id = p.profile_id
 WHERE pr.email = 'rename-parent@test.local';

-- An issued invoice line for S1, snapshotting the name it was billed under.
INSERT INTO invoices (id, parent_id, billing_month, gross_amount, credit_applied, net_amount, tenant_id)
SELECT '4ebffff0-0000-0000-0000-000000000001', p.id, '2026-07', 30, 0, 30,
       '4eb11111-0000-0000-0000-000000000001'
  FROM parents p JOIN profiles pr ON pr.id = p.profile_id
 WHERE pr.email = 'rename-parent@test.local';

INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status,
                           amount, class_title, session_date, student_name)
VALUES ('4ebffff0-0000-0000-0000-000000000001','4eb99999-0000-0000-0000-000000000001',
        '4eb77777-0000-0000-0000-000000000001','present', 30,'RENAME Class A','2026-07-04',
        'Anya (big)');

-- ══ Refusals ══════════════════════════════════════════════════════════════
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT rename_student('4eb99999-0000-0000-0000-000000000001','Whoever') $$,
  '42501', NULL, 'anon has no EXECUTE on rename_student');
RESET ROLE;

SET LOCAL ROLE authenticated;

-- 2. A PARENT cannot rename their own child — the guard is is_tenant_admin (RISK 6).
SET LOCAL "request.jwt.claims" TO '{"sub":"4eb00000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT rename_student('4eb99999-0000-0000-0000-000000000001','Anya Rahman') $$,
  'only this business''s admin may rename a child',
  'a PARENT cannot rename their own child');

-- 3. Nor can another business's admin.
SET LOCAL "request.jwt.claims" TO '{"sub":"4eb00000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT rename_student('4eb99999-0000-0000-0000-000000000001','Anya Rahman') $$,
  'only this business''s admin may rename a child',
  'another business''s admin cannot rename this business''s child');

-- ── This business's admin from here on ──────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"4eb00000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 4. An empty name is refused.
SELECT throws_ok(
  $$ SELECT rename_student('4eb99999-0000-0000-0000-000000000001','   ') $$,
  '23514', NULL, 'an empty name is refused');

-- 5. The happy path.
SELECT lives_ok(
  $$ SELECT rename_student('4eb99999-0000-0000-0000-000000000001','Anya Rahman') $$,
  'the admin can set the parent-provided name');

-- 6. The name changed.
SELECT is(
  (SELECT full_name FROM students WHERE id = '4eb99999-0000-0000-0000-000000000001'),
  'Anya Rahman', 'the child now carries the real name');

-- 7. The rename was audited (read as postgres — the fact is the write, not RLS).
RESET ROLE;
SELECT is(
  (SELECT count(*)::INT FROM audit_log
    WHERE entity_id = '4eb99999-0000-0000-0000-000000000001' AND action = 'student_updated'),
  1, 'the rename wrote exactly one student_updated audit row');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"4eb00000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 8. ⚠ RISK 2: renaming into a same-name NULL-DOB active child is REFUSED, even
--    though the unique index cannot see it. Remove the probe and this goes green.
SELECT throws_ok(
  $$ SELECT rename_student('4eb99999-0000-0000-0000-000000000008','Existing Kid') $$,
  '23505', NULL, 'a NULL-DOB same-name collision is refused (the probe, not the index)');

-- 9. …and it did not sneak a second "Existing Kid" in.
SELECT is(
  (SELECT count(*)::INT FROM students
    WHERE tenant_id = '4eb11111-0000-0000-0000-000000000001'
      AND is_active AND lower(btrim(full_name)) = 'existing kid'),
  1, 'the refused rename left exactly one active "Existing Kid"');

-- 10. A non-NULL (name, DOB) collision between two ACTIVE children is refused.
SELECT throws_ok(
  $$ SELECT rename_student('4eb99999-0000-0000-0000-000000000005','Dated Twin') $$,
  '23505', NULL, 'a same name + same DOB collision is refused');

-- 11. The index is the backstop: colliding with an INACTIVE row still refuses.
SELECT throws_ok(
  $$ SELECT rename_student('4eb99999-0000-0000-0000-000000000010','Ghost') $$,
  '23505', NULL, 'colliding with an inactive same name+DOB row is refused by the index backstop');

-- 12. Two children may share a name when their DOBs differ — the index allows it,
--     so the rename must too.
SELECT lives_ok(
  $$ SELECT rename_student('4eb99999-0000-0000-0000-000000000007','Flex Kid') $$,
  'a same-name child with a DIFFERENT DOB is allowed');

-- 13. ⚠ RISK 4: the rename in assertion 5 did NOT rewrite the issued invoice line.
SELECT is(
  (SELECT student_name FROM invoice_items
    WHERE student_id = '4eb99999-0000-0000-0000-000000000001'),
  'Anya (big)', 'the issued invoice line keeps the name it was billed under');

SELECT * FROM finish();
ROLLBACK;
