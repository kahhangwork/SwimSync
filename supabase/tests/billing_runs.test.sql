-- pgTAP: billing_runs — the generation run log (20260922000100).
-- Plan: docs/plans/BILLING_MONTHS_PLAN.md §4.
--
-- WHAT THIS FILE PROTECTS.
--   ⚠ RISK 1 — service_role can INSERT. Its default privileges on new tables
--     were revoked (20260814000300) and the engine's write is best-effort, so a
--     missing grant is a SILENT no-op in every environment. table_grants.test.sql
--     does not cover service_role, so this file is the only guard.
--   ⚠ RISK 2 — deleting an admin who ran billing still works (ran_by SET NULL),
--     or delete-admin's auth.users → profiles cascade breaks.
--   The audience — the business's admins and the platform admin; nobody else.
--
-- METHOD (§7.16): probes run under SET LOCAL ROLE authenticated with JWT claims;
-- fixture writes happen as superuser between probes via RESET ROLE.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(14);

-- ── Grants (⚠ RISK 1) ───────────────────────────────────────────────────────
SELECT ok(has_table_privilege('service_role','public.billing_runs','INSERT'),
  'service_role can INSERT a run (RISK 1 — not inherited from default privileges)');
SELECT ok(has_table_privilege('service_role','public.billing_runs','SELECT'),
  'service_role can SELECT runs');
SELECT ok(NOT has_table_privilege('service_role','public.billing_runs','UPDATE'),
  'service_role cannot UPDATE — the log is append-only');
SELECT ok(NOT has_table_privilege('service_role','public.billing_runs','DELETE'),
  'service_role cannot DELETE — the log is append-only');
SELECT ok(NOT has_table_privilege('authenticated','public.billing_runs','INSERT'),
  'authenticated cannot INSERT — only the engine writes');
SELECT ok(NOT has_table_privilege('anon','public.billing_runs','SELECT'),
  'anon holds nothing');

-- ── Two businesses ──────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code, created_at) VALUES
  ('86000000-0000-0000-0000-0000000000a0','runsa','Runs Business A','SWIM-RUNA', now()),
  ('86000000-0000-0000-0000-0000000000b0','runsb','Runs Business B','SWIM-RUNB', now());

-- Owner first, in its own statement (handle_new_user claims ownership only
-- while owner_profile_id IS NULL), then the rest.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','86100000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','runs-owner-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Runs Owner A","role":"tenant_admin","tenant_id":"86000000-0000-0000-0000-0000000000a0"}', now(), now(), '', '', '', '');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','86100000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','runs-coadmin-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Runs CoAdmin A","role":"tenant_admin","tenant_id":"86000000-0000-0000-0000-0000000000a0"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','86100000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','runs-owner-b@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Runs Owner B","role":"tenant_admin","tenant_id":"86000000-0000-0000-0000-0000000000b0"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','86100000-0000-0000-0000-000000000ca1',
   'authenticated','authenticated','runs-coach-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Runs Coach A","role":"coach","tenant_id":"86000000-0000-0000-0000-0000000000a0"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','86100000-0000-0000-0000-00000000009f',
   'authenticated','authenticated','runs-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Runs Parent","role":"parent"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','86100000-0000-0000-0000-0000000000da',
   'authenticated','authenticated','runs-platform@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Runs Platform","role":"platform_admin"}', now(), now(), '', '', '', '');

-- Two runs for A (one by the co-admin — RISK 2 deletes them below), one for B.
INSERT INTO billing_runs (tenant_id, billing_month, ran_by, mode, status, unclaimed_billable, unclaimed_students) VALUES
  ('86000000-0000-0000-0000-0000000000a0','2026-08','86100000-0000-0000-0000-0000000000a1','manual',
   'open — 1 billable lesson(s) have no parent account to bill', 1,
   '[{"student_id":"x","student_name":"Walk In","lessons":1}]'),
  ('86000000-0000-0000-0000-0000000000a0','2026-08','86100000-0000-0000-0000-0000000000a2','manual',
   'incomplete_attendance', 0, NULL),
  ('86000000-0000-0000-0000-0000000000b0','2026-08','86100000-0000-0000-0000-0000000000b1','manual',
   'complete — billing month sealed', 0, NULL);

-- ── Audience ────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;

SET LOCAL "request.jwt.claims" TO '{"sub":"86100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM billing_runs), 2, 'the OWNER reads exactly their own business''s 2 runs');

SET LOCAL "request.jwt.claims" TO '{"sub":"86100000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM billing_runs), 2, 'a CO-ADMIN reads their business''s 2 runs (D5)');

SET LOCAL "request.jwt.claims" TO '{"sub":"86100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM billing_runs
            WHERE tenant_id = '86000000-0000-0000-0000-0000000000a0'), 0,
  'another business''s owner reads none of A''s runs');

SET LOCAL "request.jwt.claims" TO '{"sub":"86100000-0000-0000-0000-000000000ca1","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM billing_runs), 0, 'a COACH reads no runs');

SET LOCAL "request.jwt.claims" TO '{"sub":"86100000-0000-0000-0000-00000000009f","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM billing_runs), 0, 'a PARENT reads no runs (they name children)');

SET LOCAL "request.jwt.claims" TO '{"sub":"86100000-0000-0000-0000-0000000000da","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM billing_runs
            WHERE tenant_id IN ('86000000-0000-0000-0000-0000000000a0','86000000-0000-0000-0000-0000000000b0')), 3,
  'the PLATFORM admin reads every business''s runs');

RESET ROLE;

-- ── ⚠ RISK 2: deleting an admin who ran billing still works ──────────────────
-- delete-admin deletes the auth user; profiles cascade from auth.users. A plain
-- (RESTRICT) FK from billing_runs.ran_by would make this statement fail.
SELECT lives_ok(
  $$ DELETE FROM auth.users WHERE id = '86100000-0000-0000-0000-0000000000a2' $$,
  'deleting a co-admin who ran billing succeeds (ran_by is ON DELETE SET NULL)');
SELECT is((SELECT count(*)::int FROM billing_runs
            WHERE tenant_id = '86000000-0000-0000-0000-0000000000a0' AND ran_by IS NULL), 1,
  'their run survives with ran_by NULL — the record outlives the account');

SELECT * FROM finish();
ROLLBACK;
