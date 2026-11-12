-- pgTAP: 20261112000100 — invoice due dates, is_overdue, change_invoice_due_date (docs/plans/OVERDUE_INVOICES_PLAN.md).
--
-- Business A (default 14 days) with an owner, a billing-VIEW and a billing-EDIT co-admin, and a parent. Business B
-- (7 days) with its own owner. PROVEN RED (commit message): UTC formula → the 00:30 boundary; pin block dropped →
-- the direct UPDATE; v_map entry dropped → the tenants save; service_role grant dropped → the privilege row;
-- `>` → `>=` in is_overdue → the due-day row. Rolled back.

BEGIN;
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(49);
SELECT is(app_today(), '2026-09-15'::date, 'clock pinned');

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('99999999-0000-0000-0000-0000000000d0', 'tap-due-a', 'TAP Due A', 'SWIM-DUA1'),
  ('99999999-0000-0000-0000-0000000000d1', 'tap-due-b', 'TAP Due B', 'SWIM-DUB1');

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;

SELECT pg_temp.mkuser('d0000000-0000-0000-0000-0000000000a1', 'tap-due-owner-a@test.local',
  '{"full_name":"Due Owner A","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000d0"}');
SELECT pg_temp.mkuser('d0000000-0000-0000-0000-0000000000a2', 'tap-due-owner-b@test.local',
  '{"full_name":"Due Owner B","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000d1"}');
SELECT pg_temp.mkuser('d0000000-0000-0000-0000-0000000000b1', 'tap-due-parent@test.local',
  '{"full_name":"Due Parent","role":"parent"}');

SELECT set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
CREATE OR REPLACE FUNCTION pg_temp.grid(p_area TEXT, p_level TEXT) RETURNS JSONB AS $$
  SELECT jsonb_build_object('operations','view','profile','none','admins','none','pricing','none',
    'billing','none','packages','none','wages','none','accounting','none') || jsonb_build_object(p_area, p_level) $$ LANGUAGE sql;
SELECT create_role('T BillV', pg_temp.grid('billing', 'view'));
SELECT create_role('T BillE', pg_temp.grid('billing', 'edit'));

CREATE OR REPLACE FUNCTION pg_temp.coadmin(p_id UUID, p_role TEXT) RETURNS VOID AS $$
  SELECT pg_temp.mkuser(p_id, 'tap-due-' || lower(replace(p_role, ' ', '')) || '@test.local',
    jsonb_build_object('role','tenant_admin','tenant_id','99999999-0000-0000-0000-0000000000d0',
      'admin_role_id', (SELECT id FROM tenant_roles WHERE tenant_id = '99999999-0000-0000-0000-0000000000d0' AND name = p_role))) $$ LANGUAGE sql;
SELECT pg_temp.coadmin('d0000000-0000-0000-0000-0000000000d2', 'T BillV');
SELECT pg_temp.coadmin('d0000000-0000-0000-0000-0000000000d3', 'T BillE');
SELECT set_config('request.jwt.claims', '', true);

-- ── Fixture invoices (as postgres) ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.inv(p_id UUID, p_tenant UUID, p_month TEXT, p_gen TIMESTAMPTZ, p_status TEXT,
                                       p_due DATE DEFAULT NULL) RETURNS VOID AS $$
  INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status,
                        generated_at, due_date)
  SELECT p_tenant, p_id, p.id, p_month, 30, 0, 30, p_status::invoice_status, p_gen, p_due
    FROM parents p WHERE p.profile_id = 'd0000000-0000-0000-0000-0000000000b1' $$ LANGUAGE sql;

SELECT is((SELECT invoice_payment_days FROM tenants WHERE id = '99999999-0000-0000-0000-0000000000d0'), 14,
  'a new tenant pays in 14 days by default');

-- SGT boundary: 00:30+08 is 16:30Z the PREVIOUS day — a UTC formula lands one day early.
SELECT pg_temp.inv('d0400000-0000-0000-0000-000000000001', '99999999-0000-0000-0000-0000000000d0', '2026-01',
                   '2026-12-01 00:30+08', 'outstanding');
SELECT is((SELECT due_date FROM invoices WHERE id = 'd0400000-0000-0000-0000-000000000001'), '2026-12-15'::date,
  'generated 2026-12-01 00:30 SGT (= 11-30 UTC) → due 2026-12-15 (the SGT date + 14)');
SELECT pg_temp.inv('d0400000-0000-0000-0000-000000000002', '99999999-0000-0000-0000-0000000000d0', '2026-02',
                   '2026-11-30 23:30+08', 'outstanding');
SELECT is((SELECT due_date FROM invoices WHERE id = 'd0400000-0000-0000-0000-000000000002'), '2026-12-14'::date,
  'generated 2026-11-30 23:30 SGT → due 2026-12-14');

UPDATE tenants SET invoice_payment_days = 7 WHERE id = '99999999-0000-0000-0000-0000000000d1';
SELECT pg_temp.inv('d0400000-0000-0000-0000-000000000003', '99999999-0000-0000-0000-0000000000d1', '2026-03',
                   '2026-09-15 10:00+08', 'outstanding');
SELECT is((SELECT due_date FROM invoices WHERE id = 'd0400000-0000-0000-0000-000000000003'), '2026-09-22'::date,
  'a tenant on 7 days: generated 09-15 → due 09-22');

SELECT pg_temp.inv('d0400000-0000-0000-0000-000000000004', '99999999-0000-0000-0000-0000000000d0', '2026-04',
                   '2026-09-15 10:00+08', 'outstanding', '2027-01-01');
SELECT is((SELECT due_date FROM invoices WHERE id = 'd0400000-0000-0000-0000-000000000004'), '2027-01-01'::date,
  'an explicit due_date at insert is kept');

SELECT is((SELECT count(*)::int FROM invoices
            WHERE id IN ('d0400000-0000-0000-0000-000000000001', 'd0400000-0000-0000-0000-000000000002',
                         'd0400000-0000-0000-0000-000000000003')
              AND due_date = invoice_due_date_for(generated_at, tenant_id)), 3,
  'the backfill formula gives exactly the trigger''s date');

UPDATE tenants SET invoice_payment_days = 30 WHERE id = '99999999-0000-0000-0000-0000000000d0';
SELECT is((SELECT due_date FROM invoices WHERE id = 'd0400000-0000-0000-0000-000000000001'), '2026-12-15'::date,
  'changing the tenant''s days leaves a stored due date alone (D2)');
UPDATE tenants SET invoice_payment_days = 14 WHERE id = '99999999-0000-0000-0000-0000000000d0';

UPDATE invoices SET gross_amount = 31 WHERE id = 'd0400000-0000-0000-0000-000000000001';
SELECT is((SELECT due_date FROM invoices WHERE id = 'd0400000-0000-0000-0000-000000000001'), '2026-12-15'::date,
  'an UPDATE of another column never re-derives the due date');

-- ── is_overdue: due 2026-09-15 ─────────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.inv('d0400000-0000-0000-0000-000000000005', '99999999-0000-0000-0000-0000000000d0', '2026-05',
                   '2026-09-01 10:00+08', 'outstanding');
SELECT pg_temp.inv('d0400000-0000-0000-0000-000000000006', '99999999-0000-0000-0000-0000000000d0', '2026-06',
                   '2026-09-01 10:00+08', 'paid');
SELECT set_config('swimsync.now', '2026-09-15 23:59+08', true);
SELECT is((SELECT is_overdue(i) FROM invoices i WHERE id = 'd0400000-0000-0000-0000-000000000005'), FALSE,
  'on the due day itself (23:59 SGT) → not overdue');
SELECT set_config('swimsync.now', '2026-09-16 00:00+08', true);
SELECT is((SELECT is_overdue(i) FROM invoices i WHERE id = 'd0400000-0000-0000-0000-000000000005'), TRUE,
  'the day after (00:00 SGT) → overdue');
SELECT is((SELECT is_overdue(i) FROM invoices i WHERE id = 'd0400000-0000-0000-0000-000000000006'), FALSE,
  'a paid invoice past its due date is never overdue');

-- ── Grants, by name ────────────────────────────────────────────────────────────────────────────────────────────
SELECT ok(has_function_privilege('service_role', 'public.is_overdue(public.invoices)', 'EXECUTE'),
  'service_role may read is_overdue (public-invoice reads with it — a miss 404s every payment link)');
SELECT ok(has_function_privilege('authenticated', 'public.is_overdue(public.invoices)', 'EXECUTE'),
  'authenticated may read is_overdue');
SELECT ok(NOT has_function_privilege('anon', 'public.is_overdue(public.invoices)', 'EXECUTE'),
  'anon may not read is_overdue');
SELECT ok(NOT has_function_privilege('anon', 'public.change_invoice_due_date(uuid,date,text)', 'EXECUTE')
      AND NOT has_function_privilege('service_role', 'public.change_invoice_due_date(uuid,date,text)', 'EXECUTE'),
  'change_invoice_due_date: not anon, not service_role');
SELECT ok(has_function_privilege('authenticated', 'public.change_invoice_due_date(uuid,date,text)', 'EXECUTE'),
  'change_invoice_due_date: authenticated');
SELECT ok(NOT (has_function_privilege('anon', 'public.invoice_due_date_for(timestamptz,uuid)', 'EXECUTE')
            OR has_function_privilege('authenticated', 'public.invoice_due_date_for(timestamptz,uuid)', 'EXECUTE')
            OR has_function_privilege('service_role', 'public.invoice_due_date_for(timestamptz,uuid)', 'EXECUTE')),
  'invoice_due_date_for: no client role');

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(TEXT) TO authenticated;

SET LOCAL ROLE authenticated;

-- ── Reads through RLS ──────────────────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.as_user('d0000000-0000-0000-0000-0000000000b1');
SELECT is((SELECT is_overdue(i) FROM invoices i WHERE id = 'd0400000-0000-0000-0000-000000000005'), TRUE,
  'PARENT: reads is_overdue on their own invoice');
SELECT pg_temp.as_user('d0000000-0000-0000-0000-0000000000d2');
SELECT is((SELECT is_overdue(i) FROM invoices i WHERE id = 'd0400000-0000-0000-0000-000000000005'), TRUE,
  'BILLING VIEW: reads is_overdue');

-- ── change_invoice_due_date refusals ───────────────────────────────────────────────────────────────────────────
SELECT pg_temp.as_user('d0000000-0000-0000-0000-0000000000d3');
SELECT throws_ok($$ SELECT change_invoice_due_date('d0400000-0000-0000-0000-000000000005', '2026-09-10') $$,
  'P0001', 'the new due date must be after the current one (2026-09-15)', 'BILLING EDIT: an earlier date is refused');
SELECT throws_ok($$ SELECT change_invoice_due_date('d0400000-0000-0000-0000-000000000005', '2026-09-15') $$,
  'P0001', 'the new due date must be after the current one (2026-09-15)', 'BILLING EDIT: the same date is refused');
SELECT throws_ok($$ SELECT change_invoice_due_date('d0400000-0000-0000-0000-000000000005', '2027-09-16') $$,
  'P0001', 'the new due date can be at most a year after the current one', 'BILLING EDIT: +366 days is refused');
SELECT throws_ok($$ SELECT change_invoice_due_date('d0400000-0000-0000-0000-000000000005', NULL) $$,
  'P0001', NULL, 'BILLING EDIT: a NULL date is refused');
SELECT throws_ok($$ SELECT change_invoice_due_date('d0400000-0000-0000-0000-000000000006', '2026-10-30') $$,
  'P0001', 'only an outstanding invoice''s due date can change', 'BILLING EDIT: a paid invoice is refused');
SELECT pg_temp.as_user('d0000000-0000-0000-0000-0000000000d2');
SELECT throws_ok($$ SELECT change_invoice_due_date('d0400000-0000-0000-0000-000000000005', '2026-09-30') $$,
  'P0001', 'not allowed to change this invoice''s due date', 'BILLING VIEW: refused');
SELECT pg_temp.as_user('d0000000-0000-0000-0000-0000000000a2');
SELECT throws_ok($$ SELECT change_invoice_due_date('d0400000-0000-0000-0000-000000000005', '2026-09-30') $$,
  'P0001', 'not allowed to change this invoice''s due date', 'another business''s owner: refused');
SELECT pg_temp.as_user('d0000000-0000-0000-0000-0000000000b1');
SELECT throws_ok($$ SELECT change_invoice_due_date('d0400000-0000-0000-0000-000000000005', '2026-09-30') $$,
  'P0001', 'not allowed to change this invoice''s due date', 'PARENT: refused');
SELECT set_config('request.jwt.claims', '', true);
SELECT throws_ok($$ SELECT change_invoice_due_date('d0400000-0000-0000-0000-000000000005', '2026-09-30') $$,
  'P0001', 'not authenticated', 'no session: refused');

-- ── change_invoice_due_date success ────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.as_user('d0000000-0000-0000-0000-0000000000d3');
SELECT is(change_invoice_due_date('d0400000-0000-0000-0000-000000000005', '2026-09-30', '  family asked  '),
  '2026-09-30'::date, 'BILLING EDIT: moves the due date later and returns it');
SELECT results_eq($$ SELECT old_due_date, new_due_date, reason, changed_by FROM invoice_due_date_changes
                     WHERE invoice_id = 'd0400000-0000-0000-0000-000000000005' $$,
  $$ VALUES ('2026-09-15'::date, '2026-09-30'::date, 'family asked'::text, 'd0000000-0000-0000-0000-0000000000d3'::uuid) $$,
  'exactly one audit row: old, new, trimmed reason, who');
SELECT is((SELECT due_date FROM invoices WHERE id = 'd0400000-0000-0000-0000-000000000005'), '2026-09-30'::date,
  'the invoice carries the new date');
SELECT is((SELECT is_overdue(i) FROM invoices i WHERE id = 'd0400000-0000-0000-0000-000000000005'), FALSE,
  'and is no longer overdue');

-- ── The direct path is closed; the other client writes still work ──────────────────────────────────────────────
SELECT throws_ok($$ UPDATE invoices SET due_date = due_date + 30 WHERE id = 'd0400000-0000-0000-0000-000000000005' $$,
  '23514', NULL, 'BILLING EDIT: a direct UPDATE of due_date is refused');
SELECT lives_ok($$ UPDATE invoices SET reminded_at = app_now() WHERE id = 'd0400000-0000-0000-0000-000000000005' $$,
  'BILLING EDIT: reminded_at still saves directly (the WhatsApp queue)');
SELECT throws_ok($$ UPDATE invoices SET reference_number = 'INV-X' WHERE id = 'd0400000-0000-0000-0000-000000000005' $$,
  '23514', NULL, 'the reference/token pin survived the re-body');
SELECT throws_ok($$ UPDATE invoices SET invoice_email_sent_at = app_now() WHERE id = 'd0400000-0000-0000-0000-000000000005' $$,
  '23514', NULL, 'the email-claim pin survived the re-body');
SELECT lives_ok($$ SELECT confirm_invoice_paid('d0400000-0000-0000-0000-000000000001') $$,
  'confirm_invoice_paid still works');

-- ── Days to pay on the tenant ──────────────────────────────────────────────────────────────────────────────────
SELECT lives_ok($$ UPDATE tenants SET invoice_payment_days = 21 WHERE id = '99999999-0000-0000-0000-0000000000d0' $$,
  'BILLING EDIT: saves Days to pay (guard_tenant_columns maps it to billing)');
SELECT throws_ok($$ UPDATE tenants SET invoice_payment_days = 0 WHERE id = '99999999-0000-0000-0000-0000000000d0' $$,
  '23514', NULL, 'Days to pay 0 fails the CHECK');
SELECT throws_ok($$ UPDATE tenants SET invoice_payment_days = 91 WHERE id = '99999999-0000-0000-0000-0000000000d0' $$,
  '23514', NULL, 'Days to pay 91 fails the CHECK');
SELECT pg_temp.as_user('d0000000-0000-0000-0000-0000000000d2');
SELECT throws_ok($$ UPDATE tenants SET invoice_payment_days = 10 WHERE id = '99999999-0000-0000-0000-0000000000d0' $$,
  '42501', NULL, 'BILLING VIEW: cannot change Days to pay');

-- ── The audit table's reach ────────────────────────────────────────────────────────────────────────────────────
SELECT is((SELECT count(*)::int FROM invoice_due_date_changes), 1, 'BILLING VIEW: sees its business''s change');
SELECT pg_temp.as_user('d0000000-0000-0000-0000-0000000000a2');
SELECT is((SELECT count(*)::int FROM invoice_due_date_changes), 0, 'another business''s owner sees none');
SELECT pg_temp.as_user('d0000000-0000-0000-0000-0000000000b1');
SELECT is((SELECT count(*)::int FROM invoice_due_date_changes), 0, 'PARENT sees none');
SELECT throws_ok($$ INSERT INTO invoice_due_date_changes (tenant_id, invoice_id, old_due_date, new_due_date, changed_by)
                    VALUES ('99999999-0000-0000-0000-0000000000d0', 'd0400000-0000-0000-0000-000000000005',
                            '2026-09-30', '2026-12-30', 'd0000000-0000-0000-0000-0000000000b1') $$,
  '42501', NULL, 'no client may write the audit table directly');

RESET ROLE;
SELECT is((SELECT invoice_payment_days FROM tenants WHERE id = '99999999-0000-0000-0000-0000000000d0'), 21,
  'the billing-edit save actually stored 21');
DELETE FROM invoices WHERE id = 'd0400000-0000-0000-0000-000000000005';
SELECT is((SELECT count(*)::int FROM invoice_due_date_changes WHERE invoice_id = 'd0400000-0000-0000-0000-000000000005'),
  0, 'deleting the invoice deletes its audit rows (teardowns keep working)');
SELECT is((SELECT count(*)::int FROM invoices WHERE due_date IS NULL), 0, 'no invoice anywhere lacks a due date');

SELECT * FROM finish();
ROLLBACK;
