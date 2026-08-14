-- pgTAP: find_roster_duplicates() — the admin's Add-student duplicate warning.
-- (ADD_STUDENT_DUP_WARNING_PLAN.md step 2.)
--
-- WHAT THIS PINS, and why each is load-bearing:
--   • The GATE (RISK 5): a coach, a foreign-tenant admin, and anon are all
--     refused — this is a SECURITY DEFINER disclosure surface returning UNMASKED
--     names, safe only because it is admin-only.
--   • TENANT SCOPING (RISK 5): a parent claiming children in two businesses must
--     not leak the OTHER business's child when their phone is entered here.
--   • INACTIVE INCLUDED (RISK 1): the returning-family duplicate is the silent
--     one this feature exists to catch; excluding inactive would miss it.
--   • The SIGNALS: phone-via-child, phone-via-parent-account, name-only, and the
--     DOB-conflict disqualifier on a name-only match.
--   • ORDER (RISK 3): phone before name, so the admin reads the strong evidence
--     first and does not train themselves to click through.
--
-- METHOD (§7.16): every probe runs inside SET LOCAL ROLE with an explicit jwt
-- sub, or the session stays superuser and every refusal "passes".

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(14);

-- ── Tenants ──────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('d0b11111-0000-0000-0000-000000000001','dup-a','DUP Business A','SWIM-DUPA'),
  ('d0b11111-0000-0000-0000-000000000002','dup-b','DUP Business B','SWIM-DUPB');

-- ── Users (the auth trigger creates profiles + parent/coach rows from metadata) ─
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','d0a00000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','dup-admin-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"DUP Admin A","role":"tenant_admin","tenant_id":"d0b11111-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','d0a00000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','dup-admin-b@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"DUP Admin B","role":"tenant_admin","tenant_id":"d0b11111-0000-0000-0000-000000000002"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','d0a00000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','dup-coach-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"DUP Coach A","role":"coach","tenant_id":"d0b11111-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','d0a00000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','dup-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"DUP Parent P","role":"parent"}', now(), now(), '', '', '', '');

-- Parent P's ACCOUNT phone — the phone-via-parent-account signal reads this.
UPDATE profiles SET phone = '93334444' WHERE email = 'dup-parent@test.local';

-- ── The children ─────────────────────────────────────────────────────────────
-- Tenant A. provisional_contact_phone is the child's own contact number.
INSERT INTO students (id, full_name, date_of_birth, tenant_id, assignment_status, is_active,
                      provisional_contact_phone) VALUES
  -- phone-via-child; name deliberately does NOT match "Anya".
  ('d0999999-0000-0000-0000-000000000001','Alpha One',      NULL,             'd0b11111-0000-0000-0000-000000000001','unassigned', TRUE,  '91112222'),
  -- claimed by P; matches on P's account phone AND on the name "Anya".
  ('d0999999-0000-0000-0000-000000000002','Anya Gundecha',  NULL,             'd0b11111-0000-0000-0000-000000000001','unassigned', TRUE,  NULL),
  -- name-only match, no phone.
  ('d0999999-0000-0000-0000-000000000003','Anya',           NULL,             'd0b11111-0000-0000-0000-000000000001','unassigned', TRUE,  NULL),
  -- name matches "Ethan Tan" but a KNOWN different DOB must disqualify it.
  ('d0999999-0000-0000-0000-000000000004','Ethan Tan',      DATE '2020-01-01','d0b11111-0000-0000-0000-000000000001','unassigned', TRUE,  NULL),
  -- INACTIVE returning-family record — must still be flagged.
  ('d0999999-0000-0000-0000-000000000005','Return Kid',     NULL,             'd0b11111-0000-0000-0000-000000000001','unassigned', FALSE, NULL),
  -- control: matches nothing.
  ('d0999999-0000-0000-0000-000000000006','Zzz Nobody',     NULL,             'd0b11111-0000-0000-0000-000000000001','unassigned', TRUE,  NULL),
  -- Tenant B, claimed by the SAME parent P — the cross-tenant leak probe.
  ('d0999999-0000-0000-0000-00000000000b','Cross Child',    NULL,             'd0b11111-0000-0000-0000-000000000002','unassigned', TRUE,  NULL);

-- P claims one child in EACH business.
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.id
  FROM parents p JOIN profiles pr ON pr.id = p.profile_id
  CROSS JOIN (VALUES
    ('d0999999-0000-0000-0000-000000000002'::uuid),
    ('d0999999-0000-0000-0000-00000000000b'::uuid)) AS s(id)
 WHERE pr.email = 'dup-parent@test.local';

-- ══ Refusals ══════════════════════════════════════════════════════════════════
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT * FROM find_roster_duplicates('d0b11111-0000-0000-0000-000000000001','Anya') $$,
  '42501', NULL, 'anon has no EXECUTE on find_roster_duplicates');
RESET ROLE;

SET LOCAL ROLE authenticated;

-- 2. A COACH is refused — the gate is is_tenant_admin, false for a coach (RISK 2/5).
SET LOCAL "request.jwt.claims" TO '{"sub":"d0a00000-0000-0000-0000-0000000000c1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM find_roster_duplicates('d0b11111-0000-0000-0000-000000000001','Anya') $$,
  'not an admin of this business',
  'a COACH caller is refused — do not wire this into the coach path');

-- 3. A FOREIGN-tenant admin is refused (RISK 5).
SET LOCAL "request.jwt.claims" TO '{"sub":"d0a00000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM find_roster_duplicates('d0b11111-0000-0000-0000-000000000001','Anya') $$,
  'not an admin of this business',
  'another business''s admin cannot probe this business''s roster');

-- ── This business's admin (A) from here on ───────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"d0a00000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 4. phone-via-child: the entered phone matches a child's provisional number.
SELECT is(
  (SELECT reason FROM find_roster_duplicates(
     'd0b11111-0000-0000-0000-000000000001','Someone Else','91112222')
    WHERE student_id = 'd0999999-0000-0000-0000-000000000001'),
  'phone', 'a matching child provisional_contact_phone fires reason=phone');

-- 5. phone-via-parent-account: the entered phone matches a CLAIMING parent's account.
SELECT is(
  (SELECT reason FROM find_roster_duplicates(
     'd0b11111-0000-0000-0000-000000000001','Someone Else','93334444')
    WHERE student_id = 'd0999999-0000-0000-0000-000000000002'),
  'phone', 'a claiming parent''s account phone fires reason=phone');

-- 6. ⚠ RISK 5: that SAME parent phone must NOT surface their child in tenant B.
--    Remove `WHERE s.tenant_id = p_tenant_id` from the roster CTE and this fails.
SELECT is(
  (SELECT count(*)::INT FROM find_roster_duplicates(
     'd0b11111-0000-0000-0000-000000000001','Someone Else','93334444')
    WHERE student_id = 'd0999999-0000-0000-0000-00000000000b'),
  0, 'a two-tenant parent''s OTHER-business child is not leaked across the tenant');

-- 7. name-only: no phone, the name matches.
SELECT is(
  (SELECT reason FROM find_roster_duplicates(
     'd0b11111-0000-0000-0000-000000000001','Anya')
    WHERE student_id = 'd0999999-0000-0000-0000-000000000003'),
  'name', 'a name match with no phone fires reason=name');

-- 8. a CLAIMED child is included, and carries the claiming parent's name.
SELECT is(
  (SELECT parent_name FROM find_roster_duplicates(
     'd0b11111-0000-0000-0000-000000000001','Anya')
    WHERE student_id = 'd0999999-0000-0000-0000-000000000002'),
  'DUP Parent P', 'a claimed match is returned with the claiming parent''s name');

-- 9. ⚠ RISK 1: an INACTIVE same-name record is returned, flagged inactive.
--    Add `AND s.is_active` to the roster CTE and this fails.
SELECT is(
  (SELECT is_active FROM find_roster_duplicates(
     'd0b11111-0000-0000-0000-000000000001','Return Kid')
    WHERE student_id = 'd0999999-0000-0000-0000-000000000005'),
  FALSE, 'an inactive returning-family record is still flagged (is_active=false)');

-- 10. ⚠ RISK 3: a KNOWN different DOB disqualifies a name-only match.
--     Remove the DOB clause and this row comes back.
SELECT is(
  (SELECT count(*)::INT FROM find_roster_duplicates(
     'd0b11111-0000-0000-0000-000000000001','Ethan Tan', NULL, DATE '2019-02-02')
    WHERE student_id = 'd0999999-0000-0000-0000-000000000004'),
  0, 'a name match with a conflicting DOB is disqualified');

-- 11. …and the DOB clause is the ONLY reason: same name, no DOB given, it returns.
SELECT is(
  (SELECT reason FROM find_roster_duplicates(
     'd0b11111-0000-0000-0000-000000000001','Ethan Tan')
    WHERE student_id = 'd0999999-0000-0000-0000-000000000004'),
  'name', 'the same name with no DOB given still matches (isolates the DOB clause)');

-- 12. ⚠ RISK 3: phone sorts before name. Entering both a child-phone hit and a
--     name hit, the first row is the phone match.
SELECT is(
  (SELECT reason FROM find_roster_duplicates(
     'd0b11111-0000-0000-0000-000000000001','Anya','91112222') LIMIT 1),
  'phone', 'phone matches sort before name matches');

-- 13. the control child never matches.
SELECT is(
  (SELECT count(*)::INT FROM find_roster_duplicates(
     'd0b11111-0000-0000-0000-000000000001','Anya','91112222')
    WHERE student_id = 'd0999999-0000-0000-0000-000000000006'),
  0, 'a child matching neither name nor phone is never returned');

-- 14. an unclaimed match returns a NULL parent_name (not an error).
SELECT is(
  (SELECT parent_name FROM find_roster_duplicates(
     'd0b11111-0000-0000-0000-000000000001','Anya')
    WHERE student_id = 'd0999999-0000-0000-0000-000000000003'),
  NULL, 'an unclaimed match has a NULL parent_name');

SELECT * FROM finish();
ROLLBACK;
