-- pgTAP: active/inactive for families and children (phases 1–2).
--
-- Covers the family consequence in both directions, the ONE-WAY property that
-- stops reactivation undoing itself, the tenant boundary, and the fact that
-- deactivating a child neither loses their billing history nor blocks billing.
--
-- Its own tenants, so nothing here depends on another fixture's state.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(20);

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('89000000-0000-0000-0000-000000000001','act-a','Active Swim A','SWIM-ACTA'),
  ('89000000-0000-0000-0000-000000000002','act-b','Active Swim B','SWIM-ACTB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','7a000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','act-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Act Admin","role":"tenant_admin","tenant_id":"89000000-0000-0000-0000-000000000001"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','7a000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','act-coach@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Act Coach","role":"coach","tenant_id":"89000000-0000-0000-0000-000000000001"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','7a000000-0000-0000-0000-000000000003',
   'authenticated','authenticated','act-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Act Parent","role":"parent"}', now(), now(), '','','','');

-- Two children at business A, one at business B — same family. This is the
-- case the whole per-business model exists for.
INSERT INTO students (id, full_name, assignment_status, tenant_id, is_active) VALUES
  ('5a000000-0000-0000-0000-000000000001','Ethan Tan','assigned','89000000-0000-0000-0000-000000000001', TRUE),
  ('5a000000-0000-0000-0000-000000000002','Maya Tan','assigned','89000000-0000-0000-0000-000000000001', TRUE),
  ('5a000000-0000-0000-0000-000000000003','Noah Tan','assigned','89000000-0000-0000-0000-000000000002', TRUE);
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, s.id FROM parents p, students s
 WHERE p.profile_id='7a000000-0000-0000-0000-000000000003'
   AND s.id IN ('5a000000-0000-0000-0000-000000000001',
                '5a000000-0000-0000-0000-000000000002',
                '5a000000-0000-0000-0000-000000000003');
INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, t.id FROM parents p, tenants t
 WHERE p.profile_id='7a000000-0000-0000-0000-000000000003'
   AND t.id IN ('89000000-0000-0000-0000-000000000001','89000000-0000-0000-0000-000000000002');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, tenant_id)
SELECT '6a000000-0000-0000-0000-000000000001', c.id, 'Act Class', 'saturday','09:00','10:00','Pool', 30,
       '89000000-0000-0000-0000-000000000001'
  FROM coaches c WHERE c.profile_id='7a000000-0000-0000-0000-000000000002';
INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
  ('5a000000-0000-0000-0000-000000000001','6a000000-0000-0000-0000-000000000001', TRUE),
  ('5a000000-0000-0000-0000-000000000002','6a000000-0000-0000-0000-000000000001', TRUE);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"7a000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ── The prompt's data source ────────────────────────────────────────────────
SELECT is((SELECT count(*)::INT FROM family_active_children('5a000000-0000-0000-0000-000000000001')),
          2, 'family_active_children lists the child and their sibling AT THIS BUSINESS');
SELECT is((SELECT count(*)::INT FROM family_active_children('5a000000-0000-0000-0000-000000000001')
            WHERE full_name = 'Noah Tan'),
          0, 'and NOT the sibling at another business — that admin''s concern, not this one''s');
SELECT is((SELECT is_self FROM family_active_children('5a000000-0000-0000-0000-000000000001')
            WHERE student_id='5a000000-0000-0000-0000-000000000001'),
          TRUE, 'the child asked about is flagged is_self');

-- ── Deactivating ONE of two children: family stays active ───────────────────
SELECT lives_ok(
  $$ SELECT set_students_active(ARRAY['5a000000-0000-0000-0000-000000000001'::UUID], FALSE) $$,
  'a single child can be marked inactive');
SELECT is((SELECT is_active FROM students WHERE id='5a000000-0000-0000-0000-000000000001'),
          FALSE, 'the child is inactive');
SELECT isnt((SELECT inactivated_at FROM students WHERE id='5a000000-0000-0000-0000-000000000001'),
          NULL, 'and the date is recorded — the question behind every reconciliation');
SELECT is((SELECT count(*)::INT FROM student_class_enrolments
            WHERE student_id='5a000000-0000-0000-0000-000000000001' AND is_active),
          0, 'their enrolment is closed, so they cannot block invoicing forever (PRD §7.7)');
SELECT is((SELECT assignment_status FROM students WHERE id='5a000000-0000-0000-0000-000000000001')::TEXT,
          'unassigned', 'assignment reads "unassigned", NOT "inactive" — one spelling only');
SELECT is((SELECT pt.is_active FROM parent_tenants pt JOIN parents p ON p.id=pt.parent_id
            WHERE p.profile_id='7a000000-0000-0000-0000-000000000003'
              AND pt.tenant_id='89000000-0000-0000-0000-000000000001'),
          TRUE, 'the FAMILY stays active while a sibling is still attending');

-- ── Deactivating the last one: the family follows, as a consequence ─────────
SELECT lives_ok(
  $$ SELECT set_students_active(ARRAY['5a000000-0000-0000-0000-000000000002'::UUID], FALSE) $$,
  'the last active child can be marked inactive');
SELECT is((SELECT pt.is_active FROM parent_tenants pt JOIN parents p ON p.id=pt.parent_id
            WHERE p.profile_id='7a000000-0000-0000-0000-000000000003'
              AND pt.tenant_id='89000000-0000-0000-0000-000000000001'),
          FALSE, 'with no active children left, the family goes inactive AT THIS BUSINESS');
-- Asserted with RLS OFF, deliberately. As tenant A's admin this row is
-- invisible (parent_tenants_select hides another business's membership — which
-- is itself correct), so asserting from that role would read NULL and pass or
-- fail for the wrong reason. The claim here is about the DATA.
RESET ROLE;
SELECT is((SELECT pt.is_active FROM parent_tenants pt JOIN parents p ON p.id=pt.parent_id
            WHERE p.profile_id='7a000000-0000-0000-0000-000000000003'
              AND pt.tenant_id='89000000-0000-0000-0000-000000000002'),
          TRUE, 'THE OTHER BUSINESS IS UNTOUCHED — the whole point of per-business activity');
SELECT is((SELECT is_active FROM students WHERE id='5a000000-0000-0000-0000-000000000003'),
          TRUE, 'and their child at the other business is still active');

-- ── Reactivation by join code, and the ONE-WAY property ─────────────────────
-- The trap this pins: if the family flip were an equivalence rather than a
-- one-way consequence, rejoining would be undone instantly, because a
-- reactivated family deliberately has ZERO active children.
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"7a000000-0000-0000-0000-000000000003","role":"authenticated"}';
SELECT lives_ok(
  $$ SELECT display_name FROM join_tenant_by_code('SWIM-ACTA') $$,
  'a departed family can rejoin with the business''s code');

RESET ROLE;
SELECT is((SELECT pt.is_active FROM parent_tenants pt JOIN parents p ON p.id=pt.parent_id
            WHERE p.profile_id='7a000000-0000-0000-0000-000000000003'
              AND pt.tenant_id='89000000-0000-0000-0000-000000000001'),
          TRUE, 'rejoining reactivates the family — and is NOT undone by their having no active children');
SELECT is((SELECT count(*)::INT FROM parent_tenants pt JOIN parents p ON p.id=pt.parent_id
            WHERE p.profile_id='7a000000-0000-0000-0000-000000000003'
              AND pt.tenant_id='89000000-0000-0000-0000-000000000001'),
          1, 'and rejoining updates the existing row rather than colliding on the unique constraint');
SELECT is((SELECT count(*)::INT FROM students
            WHERE id IN ('5a000000-0000-0000-0000-000000000001','5a000000-0000-0000-0000-000000000002')
              AND is_active),
          0, 'children stay inactive — status only; the admin reassigns them deliberately');

-- ── Reactivating a child brings the family with them ────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"7a000000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT lives_ok(
  $$ SELECT set_students_active(ARRAY['5a000000-0000-0000-0000-000000000001'::UUID], TRUE) $$,
  'a child can be reactivated');
SELECT is((SELECT inactivated_at FROM students WHERE id='5a000000-0000-0000-0000-000000000001'),
          NULL, 'reactivating clears the inactive date');
SELECT is((SELECT count(*)::INT FROM student_class_enrolments
            WHERE student_id='5a000000-0000-0000-0000-000000000001' AND is_active),
          0, 'but does NOT re-enrol them — guessing the class is how you get a wrong roster');

SELECT * FROM finish();
ROLLBACK;
