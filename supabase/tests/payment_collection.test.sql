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
SELECT plan(10);

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
   now(), now(), '','','','');

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

SELECT * FROM finish();
ROLLBACK;
