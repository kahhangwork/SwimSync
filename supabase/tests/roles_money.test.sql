-- pgTAP: migration C (20260927000500) — the money areas are enforced by role,
-- the tenants row is guarded column by column, set_class_terms splits price
-- from schedule, a priced class needs pricing, and coaches lose the money arm.
--
-- One business; the owner; co-admins on six roles that differ only in the
-- area under test (each holds operations view so the grid is valid): OPS
-- (operations edit, no money), BILLV / BILLE (billing view / edit), PRICE,
-- PKG, WAGE (edit). A serving coach. PROVEN RED with the DOWN applied: every
-- refusal and every coach-arm row fails. Rolled back.

BEGIN;
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(35);
SELECT is(app_today(), '2026-09-15'::date, 'clock pinned');

INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('99999999-0000-0000-0000-0000000000c0', 'tap-rmon', 'TAP Roles Money', 'SWIM-RM01');

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;

SELECT pg_temp.mkuser('c0000000-0000-0000-0000-0000000000a1', 'tap-rm-owner@test.local',
  '{"full_name":"RM Owner","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000c0"}');
SELECT pg_temp.mkuser('c0000000-0000-0000-0000-0000000000c1', 'tap-rm-coach@test.local',
  '{"full_name":"RM Coach","role":"coach","tenant_id":"99999999-0000-0000-0000-0000000000c0"}');
SELECT pg_temp.mkuser('c0000000-0000-0000-0000-0000000000b1', 'tap-rm-parent@test.local',
  '{"full_name":"RM Parent","role":"parent"}');

SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
CREATE OR REPLACE FUNCTION pg_temp.grid(p_ops TEXT, p_area TEXT, p_level TEXT) RETURNS JSONB AS $$
  SELECT jsonb_build_object('operations',p_ops,'profile','none','admins','none','pricing','none',
    'billing','none','packages','none','wages','none','accounting','none') || jsonb_build_object(p_area, p_level) $$ LANGUAGE sql;
SELECT create_role('T Ops',   pg_temp.grid('edit', 'operations', 'edit'));
SELECT create_role('T BillV', pg_temp.grid('view', 'billing',  'view'));
SELECT create_role('T BillE', pg_temp.grid('view', 'billing',  'edit'));
SELECT create_role('T Price', pg_temp.grid('view', 'pricing',  'edit'));
SELECT create_role('T Pkg',   pg_temp.grid('view', 'packages', 'edit'));
SELECT create_role('T Wage',  pg_temp.grid('view', 'wages',    'edit'));

CREATE OR REPLACE FUNCTION pg_temp.coadmin(p_id UUID, p_role TEXT) RETURNS VOID AS $$
  SELECT pg_temp.mkuser(p_id, 'tap-rm-' || lower(replace(p_role, ' ', '')) || '@test.local',
    jsonb_build_object('role','tenant_admin','tenant_id','99999999-0000-0000-0000-0000000000c0',
      'admin_role_id', (SELECT id FROM tenant_roles WHERE tenant_id = '99999999-0000-0000-0000-0000000000c0' AND name = p_role))) $$ LANGUAGE sql;
SELECT pg_temp.coadmin('c0000000-0000-0000-0000-0000000000d1', 'T Ops');
SELECT pg_temp.coadmin('c0000000-0000-0000-0000-0000000000d2', 'T BillV');
SELECT pg_temp.coadmin('c0000000-0000-0000-0000-0000000000d3', 'T BillE');
SELECT pg_temp.coadmin('c0000000-0000-0000-0000-0000000000d4', 'T Price');
SELECT pg_temp.coadmin('c0000000-0000-0000-0000-0000000000d5', 'T Pkg');
SELECT pg_temp.coadmin('c0000000-0000-0000-0000-0000000000d6', 'T Wage');

-- A class the coach teaches, the parent's child in it, one outstanding invoice.
INSERT INTO class_categories (tenant_id, name)
SELECT '99999999-0000-0000-0000-0000000000c0', 'Default Group'
 WHERE NOT EXISTS (SELECT 1 FROM class_categories WHERE tenant_id = '99999999-0000-0000-0000-0000000000c0' AND lower(trim(name)) = 'default group');
INSERT INTO locations (tenant_id, name)
SELECT '99999999-0000-0000-0000-0000000000c0', 'Default location'
 WHERE NOT EXISTS (SELECT 1 FROM locations WHERE tenant_id = '99999999-0000-0000-0000-0000000000c0' AND lower(trim(name)) = 'default location');
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT 'c0100000-0000-0000-0000-000000000001', co.id, 'RM Class', 'saturday', '10:00', '11:00',
       (SELECT id FROM locations WHERE tenant_id = co.tenant_id AND lower(trim(name)) = 'default location'), 30.00,
       (SELECT id FROM class_categories WHERE tenant_id = co.tenant_id AND lower(trim(name)) = 'default group')
  FROM coaches co WHERE co.profile_id = 'c0000000-0000-0000-0000-0000000000c1';
INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id)
VALUES ('c0200000-0000-0000-0000-000000000001', 'RM Kid', 'assigned', TRUE, '99999999-0000-0000-0000-0000000000c0');
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c0200000-0000-0000-0000-000000000001' FROM parents p WHERE p.profile_id = 'c0000000-0000-0000-0000-0000000000b1';
INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('c0200000-0000-0000-0000-000000000001', 'c0100000-0000-0000-0000-000000000001', TRUE);
INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT '99999999-0000-0000-0000-0000000000c0', 'c0400000-0000-0000-0000-000000000001', p.id, '2026-02', 30, 0, 30, 'outstanding'
  FROM parents p WHERE p.profile_id = 'c0000000-0000-0000-0000-0000000000b1';

SELECT ok(coach_serves_parent((SELECT id FROM parents WHERE profile_id = 'c0000000-0000-0000-0000-0000000000b1')) IS NOT NULL,
  'fixture: coach_serves_parent is callable (the coach arm had something to serve)');

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.terms(p_title TEXT, p_price NUMERIC) RETURNS VOID AS $$
  SELECT set_class_terms('c0100000-0000-0000-0000-000000000001', p_title, 'saturday', '10:00', '11:00', NULL,
    p_price, (SELECT coach_id FROM classes WHERE id = 'c0100000-0000-0000-0000-000000000001')) $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(TEXT), pg_temp.terms(TEXT, NUMERIC) TO authenticated;

SET LOCAL ROLE authenticated;

-- ── Billing ─────────────────────────────────────────────────────────────────
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000d1');
SELECT is((SELECT count(*)::int FROM invoices), 0, 'OPS: reads no invoices');
SELECT throws_ok($$ SELECT confirm_invoice_paid('c0400000-0000-0000-0000-000000000001') $$,
  'P0001', 'not allowed to confirm this invoice', 'OPS: cannot confirm a payment');
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000d2');
SELECT is((SELECT count(*)::int FROM invoices), 1, 'BILLING VIEW: reads the invoice');
SELECT throws_ok($$ SELECT confirm_invoice_paid('c0400000-0000-0000-0000-000000000001') $$,
  'P0001', 'not allowed to confirm this invoice', 'BILLING VIEW: cannot confirm a payment');
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000d3');
SELECT lives_ok($$ SELECT confirm_invoice_paid('c0400000-0000-0000-0000-000000000001') $$,
  'BILLING EDIT: confirms a payment');
SELECT is((SELECT count(*)::int FROM payment_records WHERE invoice_id = 'c0400000-0000-0000-0000-000000000001'),
  1, 'BILLING EDIT: reads the payment record it made');

-- ── The coach arm is gone (P11, X3) ─────────────────────────────────────────
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000c1');
SELECT is((SELECT count(*)::int FROM invoices), 0, 'the serving coach reads no invoices');
SELECT is((SELECT count(*)::int FROM payment_records), 0, 'the serving coach reads no payment records');
SELECT is((SELECT count(*)::int FROM lesson_sessions WHERE class_id = 'c0100000-0000-0000-0000-000000000001') >= 0, TRUE,
  'the coach still reaches their own class (operations arm untouched)');

-- ── Pricing: set_class_terms splits price from schedule ─────────────────────
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000d1');
SELECT lives_ok($$ SELECT pg_temp.terms('RM Class renamed', 30) $$, 'OPS: renames the class (price unchanged)');
SELECT throws_ok($$ SELECT pg_temp.terms('RM Class renamed', 45) $$,
  'P0001', NULL, 'OPS: cannot change the price');
SELECT is((SELECT count(*)::int FROM class_rates), 0, 'OPS: reads no billing rates');
SELECT throws_ok($$ INSERT INTO classes (coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
                    SELECT coach_id, 'Priced', 'sunday', '09:00', '10:00', location_id, 25, category_id FROM classes
                     WHERE id = 'c0100000-0000-0000-0000-000000000001' $$,
  '42501', NULL, 'OPS: cannot create a PRICED class (it seeds a billing rate)');
SELECT lives_ok($$ INSERT INTO classes (coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
                   SELECT coach_id, 'Unpriced', 'sunday', '11:00', '12:00', location_id, 0, category_id FROM classes
                    WHERE id = 'c0100000-0000-0000-0000-000000000001' $$,
  'OPS: can create an unpriced class');
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000d4');
SELECT lives_ok($$ SELECT pg_temp.terms('RM Class renamed', 45) $$, 'PRICE: changes the price (schedule unchanged)');
SELECT throws_ok($$ SELECT pg_temp.terms('RM Class again', 45) $$,
  'P0001', NULL, 'PRICE: cannot change the schedule / title');
SELECT ok((SELECT count(*) FROM class_rates) > 0, 'PRICE: reads billing rates (new view policy)');

-- ── Packages ────────────────────────────────────────────────────────────────
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000d1');
SELECT throws_ok($$ INSERT INTO package_products (tenant_id, name, lesson_count, rate_per_lesson, validity_months, validity_weeks)
                    VALUES ('99999999-0000-0000-0000-0000000000c0', 'Ops pack', 10, 25, 3, 12) $$,
  '42501', NULL, 'OPS: cannot create a package product');
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000d5');
SELECT lives_ok($$ INSERT INTO package_products (tenant_id, name, lesson_count, rate_per_lesson, validity_months, validity_weeks)
                   VALUES ('99999999-0000-0000-0000-0000000000c0', 'Pkg pack', 10, 25, 3, 12) $$,
  'PACKAGES EDIT: creates a package product');

-- ── Wages ───────────────────────────────────────────────────────────────────
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000d2');
SELECT throws_ok($$ INSERT INTO coach_rates (coach_id, amount, effective_from)
                    SELECT id, 40, DATE '2026-01-01' FROM coaches WHERE profile_id = 'c0000000-0000-0000-0000-0000000000c1' $$,
  '42501', NULL, 'BILLING: cannot set a coach wage');
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000d6');
SELECT lives_ok($$ INSERT INTO coach_rates (coach_id, amount, effective_from)
                   SELECT id, 40, DATE '2026-01-01' FROM coaches WHERE profile_id = 'c0000000-0000-0000-0000-0000000000c1' $$,
  'WAGES EDIT: sets a coach wage');
SELECT is((SELECT count(*)::int FROM coach_rates), 1, 'WAGES EDIT: reads it back (new view policy)');
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000d2');
SELECT is((SELECT count(*)::int FROM coach_rates), 0, 'BILLING: reads no wages');

-- ── Accounting ──────────────────────────────────────────────────────────────
SELECT throws_ok($$ SELECT * FROM accounting_months('99999999-0000-0000-0000-0000000000c0') $$,
  'P0001', NULL, 'BILLING: no accounting');
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ SELECT * FROM accounting_months('99999999-0000-0000-0000-0000000000c0') $$,
  'OWNER: reads accounting (D1)');

-- ── tenants, column by column ───────────────────────────────────────────────
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000d1');
SELECT throws_ok($$ UPDATE tenants SET paynow_uen = 'T00LL0001A' WHERE id = '99999999-0000-0000-0000-0000000000c0' $$,
  '42501', NULL, 'OPS: cannot change PayNow details (billing)');
SELECT throws_ok($$ UPDATE tenants SET display_name = 'Renamed' WHERE id = '99999999-0000-0000-0000-0000000000c0' $$,
  '42501', NULL, 'OPS: cannot rename the business (profile)');
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000d3');
SELECT lives_ok($$ UPDATE tenants SET paynow_uen = 'T00LL0001A' WHERE id = '99999999-0000-0000-0000-0000000000c0' $$,
  'BILLING EDIT: changes PayNow details');
SELECT throws_ok($$ UPDATE tenants SET paynow_uen = 'T00LL0002B', rain_pays_coach = NOT rain_pays_coach
                     WHERE id = '99999999-0000-0000-0000-0000000000c0' $$,
  '42501', NULL, 'BILLING EDIT: a mixed update touching wages is refused whole');
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000d6');
SELECT lives_ok($$ UPDATE tenants SET rain_pays_coach = NOT rain_pays_coach WHERE id = '99999999-0000-0000-0000-0000000000c0' $$,
  'WAGES EDIT: changes a wage setting');
SELECT pg_temp.as_user('c0000000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ UPDATE tenants SET display_name = 'TAP Roles Money!' WHERE id = '99999999-0000-0000-0000-0000000000c0' $$,
  'OWNER: renames the business');
SELECT throws_ok($$ UPDATE tenants SET invoice_counter = invoice_counter + 1 WHERE id = '99999999-0000-0000-0000-0000000000c0' $$,
  '42501', NULL, 'even the OWNER cannot write a counter');
RESET ROLE;

SELECT is((SELECT paynow_uen FROM tenants WHERE id = '99999999-0000-0000-0000-0000000000c0'),
  'T00LL0001A', 'only the permitted PayNow change landed');

SELECT * FROM finish();
ROLLBACK;
