-- pgTAP: payment collection Phase 0 (docs/design/PAYMENT_COLLECTION_DESIGN.md).
--
-- What is pinned here, in order of blast radius:
--   • RISK 1's engine tripwire: an INSERT into invoices under a
--     service_role-shaped context — the engine's exact code path — succeeds
--     and comes back with reference + token assigned by the trigger. If the
--     DEFINER hop on assign_invoice_public_fields() is ever flattened, THIS
--     is the assertion that goes red before production billing does.
--   • Reference semantics: INV-YYYY-NNNN where YYYY is the invoice's OWN
--     billing_month year (§7.7 — never the clock), numbering per tenant
--     (both tenants start at 0001; a shared counter would leak volume).
--   • The pin: reference_number / public_token are not client-writable, even
--     by the tenant admin — they identify the invoice to banks and to the
--     public page. reminded_at deliberately IS writable by the admin.
--   • RLS both sides (§7.59): a parent reads their own invoice's token, and
--     counts ZERO on another family's.
--   • next_invoice_ref is callable by NOBODY external — asserted for
--     authenticated (meaningful locally because the REVOKE is explicit;
--     the anon layer is §7.39's remote grant dump, deliberately not
--     asserted here where it would be vacuous).
--
-- Runs on its own tenants; self-contained; rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(23);

-- ── Fixtures ────────────────────────────────────────────────────────────────

INSERT INTO tenants (id, slug, display_name, join_code, paynow_mobile) VALUES
  ('fa000000-0000-0000-0000-00000000000a','pay-a','Pay Swim A','SWIM-PAYA','91234567'),
  ('fa000000-0000-0000-0000-00000000000b','pay-b','Pay Swim B','SWIM-PAYB',NULL);

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','fd000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','pay-admin-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Pay Admin A","role":"tenant_admin","tenant_id":"fa000000-0000-0000-0000-00000000000a"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','fd000000-0000-0000-0000-000000000002',
   'authenticated','authenticated','pay-parent-a@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Pay Parent A","role":"parent"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','fd000000-0000-0000-0000-000000000003',
   'authenticated','authenticated','pay-parent-b@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Pay Parent B","role":"parent"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','fd000000-0000-0000-0000-000000000004',
   'authenticated','authenticated','pay-coach-serving@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Pay Serving Coach","role":"coach","tenant_id":"fa000000-0000-0000-0000-00000000000a"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','fd000000-0000-0000-0000-000000000005',
   'authenticated','authenticated','pay-coach-other@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Pay Unrelated Coach","role":"coach","tenant_id":"fa000000-0000-0000-0000-00000000000a"}',
   now(), now(), '','','','');

-- The serving coach's class, with Pay Parent A's child enrolled — what makes
-- coach_serves_parent() true for exactly one of the two coaches.
INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM class_categories c
    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'f3000000-0000-0000-0000-000000000001', c.id, 'Pay Class', 'sunday','10:00','11:00','Pool P', 30,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = 'fa000000-0000-0000-0000-00000000000a'
           AND lower(trim(cc.name)) = 'default group')
  FROM coaches c WHERE c.profile_id = 'fd000000-0000-0000-0000-000000000004';

INSERT INTO students (id, full_name, assignment_status, tenant_id) VALUES
  ('f4000000-0000-0000-0000-000000000001','Pay Kid','assigned','fa000000-0000-0000-0000-00000000000a');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'f4000000-0000-0000-0000-000000000001' FROM parents p
 WHERE p.profile_id = 'fd000000-0000-0000-0000-000000000002';

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'fa000000-0000-0000-0000-00000000000a' FROM parents p
 WHERE p.profile_id = 'fd000000-0000-0000-0000-000000000002';

INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
  ('f4000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001', TRUE);

-- ── RISK 1 tripwire: the engine's insert shape, as service_role ─────────────
-- Three invoices: tenant A ×2 (different months and YEARS), tenant B ×1.

SET LOCAL ROLE service_role;

INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount, net_amount)
SELECT 'f5000000-0000-0000-0000-0000000000a1', p.id,
       'fa000000-0000-0000-0000-00000000000a','2026-06', 100, 100
  FROM parents p WHERE p.profile_id='fd000000-0000-0000-0000-000000000002';

INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount, net_amount)
SELECT 'f5000000-0000-0000-0000-0000000000a2', p.id,
       'fa000000-0000-0000-0000-00000000000a','2025-12', 80, 80
  FROM parents p WHERE p.profile_id='fd000000-0000-0000-0000-000000000002';

INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount, net_amount)
SELECT 'f5000000-0000-0000-0000-0000000000b1', p.id,
       'fa000000-0000-0000-0000-00000000000b','2026-06', 40, 40
  FROM parents p WHERE p.profile_id='fd000000-0000-0000-0000-000000000003';

INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount, net_amount)
SELECT 'f5000000-0000-0000-0000-0000000000a4', p.id,
       'fa000000-0000-0000-0000-00000000000a','2026-05', 60, 60
  FROM parents p WHERE p.profile_id='fd000000-0000-0000-0000-000000000002';

RESET ROLE;

SELECT is(
  (SELECT reference_number FROM invoices WHERE id='f5000000-0000-0000-0000-0000000000a1'),
  'INV-2026-0001',
  'service_role insert gets a reference assigned by the trigger (RISK 1 tripwire)');

SELECT matches(
  (SELECT public_token FROM invoices WHERE id='f5000000-0000-0000-0000-0000000000a1'),
  '^[0-9a-f]{32}$',
  'public_token is 32 hex chars (128 bits)');

SELECT is(
  (SELECT reference_number FROM invoices WHERE id='f5000000-0000-0000-0000-0000000000b1'),
  'INV-2026-0001',
  'each tenant numbers from 0001 — counters are per tenant');

SELECT is(
  (SELECT reference_number FROM invoices WHERE id='f5000000-0000-0000-0000-0000000000a2'),
  'INV-2025-0002',
  'year comes from the invoice''s own billing_month, never the clock (§7.7); counter continues within the tenant');

-- ── The pin: not client-writable, even for the tenant admin ─────────────────

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"fd000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT throws_ok(
  $$ UPDATE invoices SET reference_number = 'INV-2026-9999'
      WHERE id='f5000000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL,
  'reference_number is pinned against client writes');

SELECT throws_ok(
  $$ UPDATE invoices SET public_token = repeat('0', 32)
      WHERE id='f5000000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL,
  'public_token is pinned against client writes');

-- reminded_at is deliberately NOT pinned: stamping the click-through is the
-- admin's normal write path (design RISK 7 governs only the UI copy).
UPDATE invoices SET reminded_at = now()
 WHERE id='f5000000-0000-0000-0000-0000000000a1';

SELECT isnt(
  (SELECT reminded_at FROM invoices WHERE id='f5000000-0000-0000-0000-0000000000a1'),
  NULL,
  'tenant admin stamps reminded_at by direct UPDATE');

RESET ROLE;

-- ── RLS both sides (§7.59) ──────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"fd000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM invoices
    WHERE id='f5000000-0000-0000-0000-0000000000a1' AND public_token IS NOT NULL),
  1,
  'a parent reads their own invoice''s token');

SELECT is(
  (SELECT count(*)::int FROM invoices
    WHERE id='f5000000-0000-0000-0000-0000000000b1'),
  0,
  'a parent counts ZERO on another family''s invoice — counted as the same role');

-- ── Nobody external calls the counter draw ──────────────────────────────────

SELECT throws_ok(
  $$ SELECT next_invoice_ref('fa000000-0000-0000-0000-00000000000a', '2026') $$,
  '42501', NULL,
  'authenticated has no EXECUTE on next_invoice_ref — only the DEFINER trigger reaches it');

RESET ROLE;

-- ── Phase 3: the claim, and the ONE mark-paid path (RISK 5 role matrix) ─────
-- Gate source of truth: the invoices_update policy. Every role that can mark
-- paid today must confirm OK; everyone else must be refused — both sides
-- counted (§7.59).

-- Parent A claims their own invoice.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"fd000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT isnt(
  claim_invoice_paid('f5000000-0000-0000-0000-0000000000a1'),
  NULL,
  'a parent claims their own invoice — timestamp returned');

SELECT is(
  claim_invoice_paid('f5000000-0000-0000-0000-0000000000a1'),
  (SELECT paid_claimed_at FROM invoices WHERE id='f5000000-0000-0000-0000-0000000000a1'),
  'claiming twice keeps the FIRST timestamp — when the parent first said paid is the fact');

RESET ROLE;

-- Parent B cannot claim A's invoice — refused as not-found, no oracle.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"fd000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT claim_invoice_paid('f5000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'invoice not found',
  'another family''s claim is refused — and reads exactly like a missing invoice');

RESET ROLE;

-- The tenant admin confirms: status + paid_at + paid_marked_by AND the
-- payment_records audit row, atomically — the half the admin panel used to skip.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"fd000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT lives_ok(
  $$ SELECT confirm_invoice_paid('f5000000-0000-0000-0000-0000000000a1', 'bank checked') $$,
  'the tenant admin confirms a claimed invoice');

SELECT is(
  (SELECT status::text FROM invoices WHERE id='f5000000-0000-0000-0000-0000000000a1'),
  'paid', 'confirm flips status to paid');

SELECT is(
  (SELECT paid_marked_by FROM invoices WHERE id='f5000000-0000-0000-0000-0000000000a1'),
  'fd000000-0000-0000-0000-000000000001'::uuid,
  'confirm records WHO confirmed');

SELECT is(
  (SELECT count(*)::int FROM payment_records
    WHERE invoice_id='f5000000-0000-0000-0000-0000000000a1'
      AND marked_by='fd000000-0000-0000-0000-000000000001'),
  1, 'confirm leaves exactly one payment_records audit row');

SELECT throws_ok(
  $$ SELECT confirm_invoice_paid('f5000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'invoice is already paid',
  'confirming twice is refused — a second audit row would claim a second payment');

RESET ROLE;

-- The SERVING coach (their class, this parent's child) may confirm — the
-- same reach invoices_update gives them today.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"fd000000-0000-0000-0000-000000000004","role":"authenticated"}';

SELECT lives_ok(
  $$ SELECT confirm_invoice_paid('f5000000-0000-0000-0000-0000000000a2') $$,
  'the serving coach confirms');

SELECT is(
  (SELECT count(*)::int FROM payment_records
    WHERE invoice_id='f5000000-0000-0000-0000-0000000000a2'
      AND marked_by='fd000000-0000-0000-0000-000000000004'),
  1, 'the coach''s confirmation carries the same audit row');

RESET ROLE;

-- A paid invoice with NO prior claim can no longer be claimed. (a1 would be
-- wrong here: its claim predates the confirm, and idempotency deliberately
-- keeps returning that first timestamp.)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"fd000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT claim_invoice_paid('f5000000-0000-0000-0000-0000000000a2') $$,
  'P0001', 'invoice is not outstanding',
  'a paid, never-claimed invoice cannot be claimed');

RESET ROLE;

-- An UNRELATED coach (same tenant, no class serving this family) is refused.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"fd000000-0000-0000-0000-000000000005","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT confirm_invoice_paid('f5000000-0000-0000-0000-0000000000a4') $$,
  'P0001', 'not allowed to confirm this invoice',
  'a coach who does not serve the family cannot confirm — counted as the same role that CAN');

RESET ROLE;

-- A parent cannot confirm — claiming is the family's ceiling.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"fd000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT confirm_invoice_paid('f5000000-0000-0000-0000-0000000000a4') $$,
  'P0001', 'not allowed to confirm this invoice',
  'a parent cannot confirm their own invoice paid');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
