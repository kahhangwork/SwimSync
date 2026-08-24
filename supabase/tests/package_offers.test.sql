-- pgTAP: package renewal OFFERS — the admin-created pending row + public token,
-- the supersede rule, one-open-offer, and the extended coverage/candidates.
-- Plan: docs/plans/PACKAGE_RENEWAL_AUTOMATION_PLAN.md — RISKS 1, 2, 4, 12.
--
-- METHOD (§7.16): every client probe runs under SET LOCAL ROLE authenticated +
-- request.jwt.claims. Outside a role, SET LOCAL ROLE is a no-op and RLS is
-- bypassed, so a "passing" assertion proves nothing. Each scenario owns its
-- own family so the one-open-offer constraint never crosses scenarios.
-- Self-contained; rolls back. Runs under pg_prove (no psql backslash commands).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(21);

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code, low_package_lessons,
                     package_expiry_warning_days) VALUES
  ('c1000000-0000-0000-0000-000000000001','po-a','Offer Swim A','SWIM-POA', 2, 14),
  ('c1000000-0000-0000-0000-000000000002','po-b','Offer Swim B','SWIM-POB', 2, 14);

-- Admin (private-coach shape so the tenant can own a class) + eight parents,
-- one family per scenario.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','c1d00000-0000-0000-0000-000000000001',
   'authenticated','authenticated','po-admin-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"PO Admin A","role":"tenant_admin","is_coach":true,"tenant_id":"c1000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','c1b00000-0000-0000-0000-000000000001',
   'authenticated','authenticated','po-p1@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"PO P1","role":"parent","phone":"91230001"}', now(), now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','c1b00000-0000-0000-0000-000000000002',
   'authenticated','authenticated','po-p2@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"PO P2","role":"parent","phone":"91230002"}', now(), now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','c1b00000-0000-0000-0000-000000000003',
   'authenticated','authenticated','po-p3@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"PO P3","role":"parent","phone":"91230003"}', now(), now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','c1b00000-0000-0000-0000-000000000004',
   'authenticated','authenticated','po-p4@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"PO P4","role":"parent","phone":"91230004"}', now(), now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','c1b00000-0000-0000-0000-000000000005',
   'authenticated','authenticated','po-p5@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"PO P5","role":"parent","phone":"91230005"}', now(), now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','c1b00000-0000-0000-0000-000000000006',
   'authenticated','authenticated','po-p6@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"PO P6","role":"parent","phone":"91230006"}', now(), now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','c1b00000-0000-0000-0000-000000000007',
   'authenticated','authenticated','po-p7@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"PO P7","role":"parent","phone":"91230007"}', now(), now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','c1b00000-0000-0000-0000-000000000008',
   'authenticated','authenticated','po-p8@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"PO P8","role":"parent","phone":"91230008"}', now(), now(),'','','','');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'c1000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email LIKE 'po-p_@test.local';

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('c1c00000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','PO Group');

INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count,
                              rate_per_lesson, validity_months, validity_weeks, is_active) VALUES
  ('c1e00000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',
   'PO 8 Group', 'c1c00000-0000-0000-0000-000000000001', 8, 40.00, 12, 4, true),
  ('c1e00000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001',
   'PO Retired', 'c1c00000-0000-0000-0000-000000000001', 8, 40.00, 12, 4, false),
  ('c1e00000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000002',
   'PO B Product', NULL, 8, 40.00, 12, 4, true);

-- A class in PO Group so a child can be enrolled (RISK 2 candidate scenario).
-- classes.location_id is NOT NULL since the location contract migration
-- (20260824000200). Give every tenant one location to hang classes off,
-- tenant-agnostic and idempotent (mirrors the Default Group category block).
INSERT INTO locations (tenant_id, name)
SELECT t.id, 'Default location' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM locations l
    WHERE l.tenant_id = t.id AND lower(trim(l.name)) = 'default location');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_id, price_per_lesson, category_id)
SELECT 'c1f00000-0000-0000-0000-000000000001', co.id, 'PO Group Sat', 'saturday',
       '10:00','11:00',(SELECT l.id FROM locations l WHERE l.tenant_id = co.tenant_id AND lower(trim(l.name)) = 'default location'), 40.00, 'c1c00000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
WHERE pr.email = 'po-admin-a@test.local';

CREATE TEMP TABLE po_pid AS
  SELECT pr.email, p.id AS parent_id
  FROM parents p JOIN profiles pr ON pr.id = p.profile_id
  WHERE pr.email LIKE 'po-p_@test.local';
GRANT SELECT ON po_pid TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- RISK 4 — the public token is DEFINER-minted, unconditional, non-spoofable.
-- P1 inserts a request trying to plant a token AND admin provenance.
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"c1b00000-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, public_token,
                             offered_by, offered_at)
SELECT 'c1700000-0000-0000-0000-000000000001',
       'c1000000-0000-0000-0000-000000000001', parent_id,
       'c1e00000-0000-0000-0000-000000000001',
       'deadbeefdeadbeefdeadbeefdeadbeef',
       'c1d00000-0000-0000-0000-000000000001', now()
FROM po_pid WHERE email = 'po-p1@test.local';
RESET ROLE;

SELECT isnt(
  (SELECT public_token FROM parent_packages WHERE id='c1700000-0000-0000-0000-000000000001'),
  'deadbeefdeadbeefdeadbeefdeadbeef',
  'RISK 4: a parent-supplied public_token is discarded and re-minted');
SELECT matches(
  (SELECT public_token FROM parent_packages WHERE id='c1700000-0000-0000-0000-000000000001'),
  '^[0-9a-f]{32}$',
  'RISK 4: the minted token is 32 hex chars');
SELECT is(
  (SELECT offered_by FROM parent_packages WHERE id='c1700000-0000-0000-0000-000000000001'),
  NULL,
  'RISK 4: a parent cannot forge offered_by ("your coach prepared this")');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"c1b00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_ok($$UPDATE parent_packages SET public_token='ffffffffffffffffffffffffffffffff' WHERE id='c1700000-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'RISK 4: parent cannot UPDATE public_token');
SELECT throws_ok($$UPDATE parent_packages SET paid_claimed_at=now() WHERE id='c1700000-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'RISK 4: parent cannot UPDATE paid_claimed_at');
SELECT throws_ok($$UPDATE parent_packages SET offered_by='c1d00000-0000-0000-0000-000000000001' WHERE id='c1700000-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'RISK 4: parent cannot UPDATE offered_by');
SELECT throws_ok($$UPDATE parent_packages SET offered_at=now() WHERE id='c1700000-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'RISK 4: parent cannot UPDATE offered_at');
SELECT throws_ok($$UPDATE parent_packages SET superseded_by='c1700000-0000-0000-0000-000000000001' WHERE id='c1700000-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'RISK 4: parent cannot UPDATE superseded_by');
RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- RISK 12 — one open offer per family; create_package_offer is the only path.
-- P2 for the happy/second/decline path; P3 for the guard rejections.
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"c1d00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT lives_ok($$SELECT create_package_offer(
  (SELECT parent_id FROM po_pid WHERE email='po-p2@test.local'),
  'c1e00000-0000-0000-0000-000000000001', CURRENT_DATE)$$,
  'RISK 12: first offer for a family succeeds');
SELECT throws_ok($$SELECT create_package_offer(
  (SELECT parent_id FROM po_pid WHERE email='po-p2@test.local'),
  'c1e00000-0000-0000-0000-000000000001', CURRENT_DATE)$$,
  '23505', NULL, 'RISK 12: a second open offer for the same family raises');
SELECT throws_ok($$SELECT create_package_offer(
  (SELECT parent_id FROM po_pid WHERE email='po-p3@test.local'),
  'c1e00000-0000-0000-0000-000000000002', CURRENT_DATE)$$,
  '23514', NULL, 'create_package_offer rejects a retired product');
SELECT throws_ok($$SELECT create_package_offer(
  (SELECT parent_id FROM po_pid WHERE email='po-p3@test.local'),
  'c1e00000-0000-0000-0000-000000000003', CURRENT_DATE)$$,
  '42501', NULL, 'create_package_offer rejects a product in a business I do not admin');
-- Decline P2's open offer, then a fresh one succeeds.
UPDATE parent_packages SET status='cancelled'
 WHERE parent_id=(SELECT parent_id FROM po_pid WHERE email='po-p2@test.local')
   AND status='pending' AND offered_by IS NOT NULL;
SELECT lives_ok($$SELECT create_package_offer(
  (SELECT parent_id FROM po_pid WHERE email='po-p2@test.local'),
  'c1e00000-0000-0000-0000-000000000001', CURRENT_DATE)$$,
  'RISK 12: after Decline, a fresh offer succeeds');
RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- RISK 1 — supersede cancels ONLY an open UNCLAIMED offer.
-- ════════════════════════════════════════════════════════════════════════════
-- (a) P4: a PAID offer survives a new parent request.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"c1d00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT create_package_offer(
  (SELECT parent_id FROM po_pid WHERE email='po-p4@test.local'),
  'c1e00000-0000-0000-0000-000000000001', CURRENT_DATE);
RESET ROLE;
-- service/postgres stamps the claim (bypasses the client pin).
UPDATE parent_packages SET paid_claimed_at = now()
 WHERE parent_id=(SELECT parent_id FROM po_pid WHERE email='po-p4@test.local')
   AND offered_by IS NOT NULL AND status='pending';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"c1b00000-0000-0000-0000-000000000004","role":"authenticated"}';
INSERT INTO parent_packages (tenant_id, parent_id, product_id)
SELECT 'c1000000-0000-0000-0000-000000000001', parent_id, 'c1e00000-0000-0000-0000-000000000001'
FROM po_pid WHERE email='po-p4@test.local';
RESET ROLE;
SELECT is(
  (SELECT status FROM parent_packages
    WHERE parent_id=(SELECT parent_id FROM po_pid WHERE email='po-p4@test.local')
      AND paid_claimed_at IS NOT NULL),
  'pending',
  'RISK 1(a): a PAID offer is never auto-cancelled by a new request');

-- (b) P5: AS THE PARENT ROLE, a new request cancels the unclaimed offer,
--     stamping superseded_by = the new row (proves the DEFINER hop past the pins).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"c1d00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT create_package_offer(
  (SELECT parent_id FROM po_pid WHERE email='po-p5@test.local'),
  'c1e00000-0000-0000-0000-000000000001', CURRENT_DATE);
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"c1b00000-0000-0000-0000-000000000005","role":"authenticated"}';
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id)
SELECT 'c1700000-0000-0000-0000-000000000005',
       'c1000000-0000-0000-0000-000000000001', parent_id, 'c1e00000-0000-0000-0000-000000000001'
FROM po_pid WHERE email='po-p5@test.local';
RESET ROLE;
SELECT is(
  (SELECT status || ':' || (superseded_by = 'c1700000-0000-0000-0000-000000000005')::text
     FROM parent_packages
    WHERE parent_id=(SELECT parent_id FROM po_pid WHERE email='po-p5@test.local')
      AND offered_by IS NOT NULL),
  'cancelled:true',
  'RISK 1(b): a parent-role request cancels the unclaimed offer, superseded_by=new id');

-- (c) P6: an admin ACTIVE insert (recordSale) cancels the family's unclaimed offer.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"c1d00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT create_package_offer(
  (SELECT parent_id FROM po_pid WHERE email='po-p6@test.local'),
  'c1e00000-0000-0000-0000-000000000001', CURRENT_DATE);
INSERT INTO parent_packages (tenant_id, parent_id, product_id, status, start_date)
SELECT 'c1000000-0000-0000-0000-000000000001', parent_id,
       'c1e00000-0000-0000-0000-000000000001', 'active', CURRENT_DATE
FROM po_pid WHERE email='po-p6@test.local';
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM parent_packages
    WHERE parent_id=(SELECT parent_id FROM po_pid WHERE email='po-p6@test.local')
      AND status='pending' AND offered_by IS NOT NULL AND paid_claimed_at IS NULL),
  0,
  'RISK 1(c): an admin active sale cancels the family''s unclaimed offer');

-- (d) P7: a parent's OWN pending request is untouched by an admin offer insert.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"c1b00000-0000-0000-0000-000000000007","role":"authenticated"}';
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id)
SELECT 'c1700000-0000-0000-0000-000000000007',
       'c1000000-0000-0000-0000-000000000001', parent_id, 'c1e00000-0000-0000-0000-000000000001'
FROM po_pid WHERE email='po-p7@test.local';
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"c1d00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT create_package_offer(
  (SELECT parent_id FROM po_pid WHERE email='po-p7@test.local'),
  'c1e00000-0000-0000-0000-000000000001', CURRENT_DATE);
RESET ROLE;
SELECT is(
  (SELECT status FROM parent_packages WHERE id='c1700000-0000-0000-0000-000000000007'),
  'pending',
  'RISK 1(d): a parent''s own request is not cancelled by an admin offer');

-- ════════════════════════════════════════════════════════════════════════════
-- RISK 2 — candidate/low. P8: a package expiring within the warning window is
-- low; once an open pending row exists the family drops out of candidates.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by) VALUES
  ('c1500000-0000-0000-0000-000000000008','PO Kid 8','2018-08-08','assigned',
   'c1000000-0000-0000-0000-000000000001','c1d00000-0000-0000-0000-000000000001');
INSERT INTO parent_students (parent_id, student_id)
SELECT parent_id, 'c1500000-0000-0000-0000-000000000008'
FROM po_pid WHERE email='po-p8@test.local';
INSERT INTO student_class_enrolments (student_id, class_id) VALUES
  ('c1500000-0000-0000-0000-000000000008','c1f00000-0000-0000-0000-000000000001');
-- Active package that STARTED 21 days ago; 4-week validity => expires in ~7 days.
INSERT INTO parent_packages (tenant_id, parent_id, product_id, status, start_date)
SELECT 'c1000000-0000-0000-0000-000000000001', parent_id,
       'c1e00000-0000-0000-0000-000000000001', 'active', CURRENT_DATE - 21
FROM po_pid WHERE email='po-p8@test.local';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"c1d00000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM package_renewal_candidates()
    WHERE parent_id=(SELECT parent_id FROM po_pid WHERE email='po-p8@test.local')),
  1,
  'RISK 2: a family expiring within the warning window IS a renewal candidate');
-- Now open an offer for them; they must drop out of candidates.
SELECT create_package_offer(
  (SELECT parent_id FROM po_pid WHERE email='po-p8@test.local'),
  'c1e00000-0000-0000-0000-000000000001', CURRENT_DATE);
SELECT is(
  (SELECT count(*)::int FROM package_renewal_candidates()
    WHERE parent_id=(SELECT parent_id FROM po_pid WHERE email='po-p8@test.local')),
  0,
  'RISK 2: a family with an open pending row is no longer a candidate');
RESET ROLE;

-- ── Grants: anon holds EXECUTE on neither new callable (§7.39/§7.82) ─────────
SELECT is(has_function_privilege('anon','create_package_offer(uuid,uuid,date)','EXECUTE'),
  false, 'anon has no EXECUTE on create_package_offer');
SELECT is(has_function_privilege('anon','package_renewal_candidates()','EXECUTE'),
  false, 'anon has no EXECUTE on package_renewal_candidates');

SELECT * FROM finish();
ROLLBACK;
