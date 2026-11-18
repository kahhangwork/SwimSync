-- pgTAP: an admin corrects a family's details after the parent has an account (20261118000100).
--
-- WHY. User feedback 2026-11-18: "Once a parent is linked to a child, if key information is entered wrongly, we may
-- need to delete the whole child record and recreate it." This file pins the three admin paths that close that:
--   • set_parent_contact          — name + phone on the parent's profile; own business's family only; not the email;
--                                   not under a pending claim; audited against the business
--   • unlink_parent_from_student  — removes one link; REFUSED once invoiced or package-drawn for that pair; a
--                                   claim-made link is routed through undo_student_claim
--   • set_student_date_of_birth   — sets / clears; refuses a future date, a duplicate, a pending claim; audited
--   and that each refuses another business's admin, a view-only role, a coach and a parent.
--
-- METHOD (§7.16): every probe runs under SET LOCAL ROLE authenticated with an explicit jwt sub.
--
-- RED FIRST (§7.25): against the schema BEFORE 20261118000100 the file fails at 1 — none of the three functions
-- exist. MUTATION PROOFS are listed at the end of the file.

BEGIN;
SELECT set_config('swimsync.now', '2026-11-18 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(34);
SELECT is(app_today(), '2026-11-18'::date, 'clock pinned');

INSERT INTO tenants (id, slug, display_name, join_code, created_at) VALUES
  ('7f000000-0000-0000-0000-0000000000a0','fd-a','FD A','SWIM-FDAA', app_now() - INTERVAL '200 days'),
  ('7f000000-0000-0000-0000-0000000000b0','fd-b','FD B','SWIM-FDBB', app_now() - INTERVAL '200 days');

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;

-- a1 owner A · b1 owner B · c1 coach A · e1 view-only admin A · d1 parent (A) · d2 parent (B only) · d3 parent (A)
SELECT pg_temp.mkuser('7f100000-0000-0000-0000-0000000000a1','fd-owner@test.local',
  '{"full_name":"FD Owner","role":"tenant_admin","tenant_id":"7f000000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('7f100000-0000-0000-0000-0000000000b1','fd-owner2@test.local',
  '{"full_name":"FD Owner2","role":"tenant_admin","tenant_id":"7f000000-0000-0000-0000-0000000000b0"}');
SELECT pg_temp.mkuser('7f100000-0000-0000-0000-0000000000c1','fd-coach@test.local',
  '{"full_name":"FD Coach","role":"coach","tenant_id":"7f000000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('7f100000-0000-0000-0000-0000000000d1','fd-parent@test.local',
  '{"full_name":"FD Parnet","role":"parent"}');
SELECT pg_temp.mkuser('7f100000-0000-0000-0000-0000000000d2','fd-parent2@test.local',
  '{"full_name":"FD Elsewhere","role":"parent"}');
SELECT pg_temp.mkuser('7f100000-0000-0000-0000-0000000000d3','fd-parent3@test.local',
  '{"full_name":"FD Claimer","role":"parent"}');
INSERT INTO tenant_roles (id, tenant_id, name)
VALUES ('7f200000-0000-0000-0000-000000000001','7f000000-0000-0000-0000-0000000000a0','FD Viewer');
INSERT INTO tenant_role_permissions (role_id, area, level)
SELECT '7f200000-0000-0000-0000-000000000001', a, 'view'::admin_level FROM unnest(enum_range(NULL::admin_area)) a;
SELECT pg_temp.mkuser('7f100000-0000-0000-0000-0000000000e1','fd-viewer@test.local',
  '{"full_name":"FD Viewer","role":"tenant_admin","tenant_id":"7f000000-0000-0000-0000-0000000000a0","admin_role_id":"7f200000-0000-0000-0000-000000000001"}');
UPDATE tenants SET owner_profile_id = '7f100000-0000-0000-0000-0000000000a1' WHERE id = '7f000000-0000-0000-0000-0000000000a0';
UPDATE tenants SET owner_profile_id = '7f100000-0000-0000-0000-0000000000b1' WHERE id = '7f000000-0000-0000-0000-0000000000b0';
UPDATE profiles SET phone = '9123 456' WHERE id = '7f100000-0000-0000-0000-0000000000d1';

CREATE TEMP TABLE pid (k TEXT PRIMARY KEY, v UUID);
GRANT ALL ON pid TO PUBLIC;
INSERT INTO pid SELECT 'd1', id FROM parents WHERE profile_id = '7f100000-0000-0000-0000-0000000000d1';
INSERT INTO pid SELECT 'd2', id FROM parents WHERE profile_id = '7f100000-0000-0000-0000-0000000000d2';
INSERT INTO pid SELECT 'd3', id FROM parents WHERE profile_id = '7f100000-0000-0000-0000-0000000000d3';
INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT v, '7f000000-0000-0000-0000-0000000000a0' FROM pid WHERE k IN ('d1','d3') ON CONFLICT DO NOTHING;
INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT v, '7f000000-0000-0000-0000-0000000000b0' FROM pid WHERE k = 'd2' ON CONFLICT DO NOTHING;

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('7f400000-0000-0000-0000-000000000001','7f000000-0000-0000-0000-0000000000a0','FD Group');
INSERT INTO locations (id, tenant_id, name) VALUES
  ('7f800000-0000-0000-0000-000000000001','7f000000-0000-0000-0000-0000000000a0','FD Pool');
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT '7f500000-0000-0000-0000-000000000001','7f000000-0000-0000-0000-0000000000a0', c.id, 'FD Dolphins',
       'saturday', '09:00', '10:00', '7f800000-0000-0000-0000-000000000001', 30.00, '7f400000-0000-0000-0000-000000000001'
  FROM coaches c WHERE c.profile_id = '7f100000-0000-0000-0000-0000000000c1';

-- k1 linked d1, unbilled · k2 linked d1, INVOICED · k3 linked d1, PACKAGE-DRAWN · k4 linked d3 by an APPROVED claim
-- that filled its DOB · k5 under a PENDING claim by d3 · k6 a same-name twin of k1 (for the duplicate probe)
INSERT INTO students (id, full_name, date_of_birth, assignment_status, is_active, tenant_id) VALUES
  ('7f300000-0000-0000-0000-000000000001','FD Kid',     NULL,         'assigned', TRUE, '7f000000-0000-0000-0000-0000000000a0'),
  ('7f300000-0000-0000-0000-000000000002','FD Billed',  '2018-01-01', 'assigned', TRUE, '7f000000-0000-0000-0000-0000000000a0'),
  ('7f300000-0000-0000-0000-000000000003','FD Packaged','2018-01-01', 'assigned', TRUE, '7f000000-0000-0000-0000-0000000000a0'),
  ('7f300000-0000-0000-0000-000000000004','FD Claimed', '2019-05-05', 'assigned', TRUE, '7f000000-0000-0000-0000-0000000000a0'),
  ('7f300000-0000-0000-0000-000000000005','FD Pending', NULL,         'assigned', TRUE, '7f000000-0000-0000-0000-0000000000a0'),
  ('7f300000-0000-0000-0000-000000000006','FD Kid',     '2017-03-03', 'assigned', TRUE, '7f000000-0000-0000-0000-0000000000a0');
INSERT INTO parent_students (parent_id, student_id)
SELECT (SELECT v FROM pid WHERE k = 'd1'), s FROM unnest(ARRAY[
  '7f300000-0000-0000-0000-000000000001','7f300000-0000-0000-0000-000000000002',
  '7f300000-0000-0000-0000-000000000003']::uuid[]) s;
INSERT INTO parent_students (parent_id, student_id)
SELECT v, '7f300000-0000-0000-0000-000000000004' FROM pid WHERE k = 'd3';
INSERT INTO student_claims (tenant_id, student_id, parent_id, claimed_name, claimed_dob, certainty, match_reason,
                            status, decided_at, filled_dob)
SELECT '7f000000-0000-0000-0000-0000000000a0','7f300000-0000-0000-0000-000000000004', v, 'FD Claimed', '2019-05-05',
       'unsure', 'name', 'approved', app_now(), TRUE FROM pid WHERE k = 'd3';
INSERT INTO student_claims (tenant_id, student_id, parent_id, claimed_name, certainty, match_reason)
SELECT '7f000000-0000-0000-0000-0000000000a0','7f300000-0000-0000-0000-000000000005', v, 'FD Pending',
       'unsure', 'name' FROM pid WHERE k = 'd3';

-- k2: one invoiced lesson.
INSERT INTO lesson_sessions (id, class_id, session_date, status) VALUES
  ('7f600000-0000-0000-0000-000000000001','7f500000-0000-0000-0000-000000000001','2026-10-03','completed'),
  ('7f600000-0000-0000-0000-000000000002','7f500000-0000-0000-0000-000000000001','2026-10-10','completed');
INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT '7f000000-0000-0000-0000-0000000000a0','7f700000-0000-0000-0000-000000000001', v,
       '2026-10', 30.00, 0.00, 30.00, 'outstanding' FROM pid WHERE k = 'd1';
INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
VALUES ('7f700000-0000-0000-0000-000000000001','7f300000-0000-0000-0000-000000000002',
        '7f600000-0000-0000-0000-000000000001','present', 30.00, 'FD Dolphins', '2026-10-03');
-- k3: one lesson drawn from d1's package (no invoice line).
INSERT INTO package_products (id, tenant_id, name, lesson_count, rate_per_lesson, validity_months)
VALUES ('7f900000-0000-0000-0000-000000000001','7f000000-0000-0000-0000-0000000000a0','FD 10-pack', 10, 30.00, 12);
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, confirmed_at)
SELECT '7fa00000-0000-0000-0000-000000000001','7f000000-0000-0000-0000-0000000000a0', v,
       '7f900000-0000-0000-0000-000000000001', 'active', app_now() - INTERVAL '30 days' FROM pid WHERE k = 'd1';
INSERT INTO package_applications (parent_package_id, amount, lesson_session_id, student_id, lesson_date)
VALUES ('7fa00000-0000-0000-0000-000000000001', 30.00, '7f600000-0000-0000-0000-000000000002',
        '7f300000-0000-0000-0000-000000000003', '2026-10-10');

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(TEXT) TO authenticated;

-- ══ 1. Catalogue ═══════════════════════════════════════════════════════════════════════════════════════════════
SELECT is((SELECT COALESCE(string_agg(sig, ', ' ORDER BY sig), '') FROM unnest(ARRAY[
    'public.set_parent_contact(uuid,text,text)',
    'public.unlink_parent_from_student(uuid,uuid)',
    'public.set_student_date_of_birth(uuid,date)']) sig
   WHERE to_regprocedure(sig) IS NULL
      OR has_function_privilege('anon', sig, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', sig, 'EXECUTE')),
  '', '1: all three exist, callable by authenticated, none by anon');

-- ══ 2. set_parent_contact ══════════════════════════════════════════════════════════════════════════════════════
SELECT pg_temp.as_user('7f100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT set_parent_contact((SELECT v FROM pid WHERE k = 'd1'), '  FD Parent ', ' 9123 4567 ') $$,
  '2: the admin of the parent''s business corrects the name and phone');
RESET ROLE;
SELECT is((SELECT full_name || '|' || phone FROM profiles WHERE id = '7f100000-0000-0000-0000-0000000000d1'),
  'FD Parent|9123 4567', '3: both are stored on the parent''s profile, trimmed');
SELECT is((SELECT email FROM profiles WHERE id = '7f100000-0000-0000-0000-0000000000d1'),
  'fd-parent@test.local', '4: the email (the login) is untouched');
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE action = 'parent_contact_corrected'
                    AND entity_id = (SELECT v FROM pid WHERE k = 'd1')
                    AND tenant_id = '7f000000-0000-0000-0000-0000000000a0'
                    AND actor_id = '7f100000-0000-0000-0000-0000000000a1'
                    AND old_value->>'full_name' = 'FD Parnet' AND new_value->>'phone' = '9123 4567'),
  '5: audited against the business, old and new values');

SELECT pg_temp.as_user('7f100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT set_parent_contact((SELECT v FROM pid WHERE k = 'd1'), 'FD Parent', '') $$,
  '6: an empty phone clears it');
RESET ROLE;
SELECT is((SELECT phone FROM profiles WHERE id = '7f100000-0000-0000-0000-0000000000d1'), NULL, '7: phone is NULL');

SELECT pg_temp.as_user('7f100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT set_parent_contact((SELECT v FROM pid WHERE k = 'd1'), '  ', '91234567') $$,
  '23514', 'a name is required', '8: a blank name is refused');
SELECT throws_ok($$ SELECT set_parent_contact((SELECT v FROM pid WHERE k = 'd2'), 'Hijack', '91234567') $$,
  'P0001', 'this parent is not a family of your business', '9: another business''s parent is refused');
SELECT throws_ok($$ SELECT set_parent_contact((SELECT v FROM pid WHERE k = 'd3'), 'FD Claimer', '81234567') $$,
  'P0001', 'This parent has a claim waiting in Parent Requests. Approve or decline it first.',
  '10: a parent with a pending claim is locked');
RESET ROLE;

SELECT pg_temp.as_user('7f100000-0000-0000-0000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT set_parent_contact((SELECT v FROM pid WHERE k = 'd1'), 'Hijack', NULL) $$,
  'P0001', 'this parent is not a family of your business', '11: business B''s admin cannot edit A''s parent');
RESET ROLE;
SELECT pg_temp.as_user('7f100000-0000-0000-0000-0000000000e1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT set_parent_contact((SELECT v FROM pid WHERE k = 'd1'), 'Hijack', NULL) $$,
  'P0001', 'only a business''s admin may correct a parent''s details', '12: a view-only admin is refused');
RESET ROLE;
SELECT pg_temp.as_user('7f100000-0000-0000-0000-0000000000c1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT set_parent_contact((SELECT v FROM pid WHERE k = 'd1'), 'Hijack', NULL) $$,
  'P0001', 'only a business''s admin may correct a parent''s details', '13: a coach is refused');
RESET ROLE;
SELECT pg_temp.as_user('7f100000-0000-0000-0000-0000000000d1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT set_parent_contact((SELECT v FROM pid WHERE k = 'd1'), 'Hijack', NULL) $$,
  'P0001', 'only a business''s admin may correct a parent''s details', '14: a parent cannot use the admin path');
RESET ROLE;
SELECT is((SELECT full_name FROM profiles WHERE id = '7f100000-0000-0000-0000-0000000000d1'), 'FD Parent',
  '15: no refused call changed the name');

-- ══ 3. unlink_parent_from_student ══════════════════════════════════════════════════════════════════════════════
SELECT pg_temp.as_user('7f100000-0000-0000-0000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT unlink_parent_from_student((SELECT v FROM pid WHERE k = 'd1'), '7f300000-0000-0000-0000-000000000001') $$,
  'P0001', 'only this business''s admin may unlink a parent', '16: business B''s admin cannot unlink A''s child');
RESET ROLE;
SELECT pg_temp.as_user('7f100000-0000-0000-0000-0000000000e1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT unlink_parent_from_student((SELECT v FROM pid WHERE k = 'd1'), '7f300000-0000-0000-0000-000000000001') $$,
  'P0001', 'only this business''s admin may unlink a parent', '17: a view-only admin cannot unlink');
RESET ROLE;

SELECT pg_temp.as_user('7f100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT unlink_parent_from_student((SELECT v FROM pid WHERE k = 'd1'), '7f300000-0000-0000-0000-000000000002') $$,
  'P0001', 'This link cannot be removed: FD Billed has already been billed to this parent (2026-10). Issue a credit note instead.',
  '18: an INVOICED link is refused');
SELECT throws_ok($$ SELECT unlink_parent_from_student((SELECT v FROM pid WHERE k = 'd1'), '7f300000-0000-0000-0000-000000000003') $$,
  'P0001', NULL, '19: a PACKAGE-DRAWN link is refused');
SELECT throws_ok($$ SELECT unlink_parent_from_student((SELECT v FROM pid WHERE k = 'd2'), '7f300000-0000-0000-0000-000000000001') $$,
  'P0001', 'this parent is not linked to this child', '20: a link that does not exist is refused');
SELECT lives_ok($$ SELECT unlink_parent_from_student((SELECT v FROM pid WHERE k = 'd1'), '7f300000-0000-0000-0000-000000000001') $$,
  '21: an unbilled link is removed');
SELECT lives_ok($$ SELECT unlink_parent_from_student((SELECT v FROM pid WHERE k = 'd3'), '7f300000-0000-0000-0000-000000000004') $$,
  '22: a claim-made link is removed');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM parent_students
            WHERE student_id IN ('7f300000-0000-0000-0000-000000000001','7f300000-0000-0000-0000-000000000004')),
  0, '23: both links are gone');
SELECT is((SELECT count(*)::int FROM parent_students
            WHERE student_id IN ('7f300000-0000-0000-0000-000000000002','7f300000-0000-0000-0000-000000000003')),
  2, '24: the refused links are intact');
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE action = 'parent_unlinked'
                    AND entity_id = '7f300000-0000-0000-0000-000000000001'
                    AND tenant_id = '7f000000-0000-0000-0000-0000000000a0'
                    AND old_value->>'parent_id' = (SELECT v FROM pid WHERE k = 'd1')::text),
  '25: the plain unlink is audited');
SELECT is((SELECT sc.status::text || '|' || (s.date_of_birth IS NULL)::text FROM student_claims sc
             JOIN students s ON s.id = sc.student_id WHERE sc.student_id = '7f300000-0000-0000-0000-000000000004'),
  'declined|true', '26: the claim-made link went through undo_student_claim (claim declined, filled DOB reverted)');

-- ══ 4. set_student_date_of_birth ═══════════════════════════════════════════════════════════════════════════════
SELECT pg_temp.as_user('7f100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT set_student_date_of_birth('7f300000-0000-0000-0000-000000000002', '2018-02-02') $$,
  '27: the admin sets a DOB');
SELECT throws_ok($$ SELECT set_student_date_of_birth('7f300000-0000-0000-0000-000000000002', '2026-11-19') $$,
  '23514', 'a date of birth cannot be in the future', '28: a future DOB is refused (app_today)');
SELECT throws_ok($$ SELECT set_student_date_of_birth('7f300000-0000-0000-0000-000000000001', '2017-03-03') $$,
  '23505', NULL, '29: a DOB that makes two active children identical is refused');
SELECT throws_ok($$ SELECT set_student_date_of_birth('7f300000-0000-0000-0000-000000000005', '2019-01-01') $$,
  'P0001', 'A parent is claiming this child in Parent Requests. Approve or decline it first.',
  '30: a child under a pending claim is locked');
RESET ROLE;
SELECT pg_temp.as_user('7f100000-0000-0000-0000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT set_student_date_of_birth('7f300000-0000-0000-0000-000000000002', '2010-01-01') $$,
  'P0001', 'only this business''s admin may change a child''s date of birth', '31: another business''s admin is refused');
RESET ROLE;
SELECT is((SELECT date_of_birth FROM students WHERE id = '7f300000-0000-0000-0000-000000000002'), '2018-02-02'::date,
  '32: only the permitted change landed');
SELECT ok(EXISTS (SELECT 1 FROM audit_log WHERE entity_id = '7f300000-0000-0000-0000-000000000002'
                    AND actor_id = '7f100000-0000-0000-0000-0000000000a1'
                    AND new_value->>'date_of_birth' = '2018-02-02'),
  '33: the DOB change is in the audit log, against the admin');

SELECT * FROM finish();
ROLLBACK;

-- MUTATION PROOFS (each function body mutated and re-applied, the file re-run, 2026-11-18; numbers are the probe LABELS):
--   1. set_parent_contact's family-of-this-business check → `IF false`   → RED 9, 11, 15
--   2. unlink's package_applications probe removed                          → RED 19, 24
--   3. unlink's invoice probe removed                                       → RED 18, 24
--   4. set_student_date_of_birth's has_admin_area check → `IF false`       → RED 31, 32
