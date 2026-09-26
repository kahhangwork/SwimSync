-- Fixture for verify-invoice-admin.mjs — the Invoices-page settings actions no
-- other driver presses (BACKLOG → Foundations; docs/plans/DRIVER_BACKLOG_PLAN.md U6).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-invoice-admin.sql
--
-- ITS OWN BUSINESS ("InvAdm Swim", prefix d3000000-). The driver rewrites the
-- PayNow UEN / mobile and the invoice run day — TENANT-level settings the seed
-- tenant's billing drivers read (plan rule 12). Everything here is owned.
--
-- The shapes, each for one check:
--   InvAdm Owner    tenant admin (also coaches the class) — the login.
--   InvAdm Leaver   parent with a PENDING DEBIT of S$40.00: credit note
--                   CN-IA-0001 (a rain correction on INV-IA-0001) was drawn in
--                   full onto INV-IA-0002, then reversed after that invoice
--                   was PAID — so the S$40 came back as a debit
--                   (credit_applications.debited_at set, not folded, not
--                   written off). write_off_parent_balance reconciles the
--                   stamped applications against debit_balance, so the two
--                   must agree: they do, 40 = 40.
--   InvAdm Stayer   parent with one OUTSTANDING invoice (INV-IA-0003).
--   Three invoices  INV-IA-0001 (two months ago, paid), -0002 (last month,
--                   paid, credit 40), -0003 (last month, outstanding) — the
--                   real rows the driver's page.route repeats to 1000 for the
--                   CSV cap banner (NO 1000 seeded rows: plan RISK 5).
--   Settings        paynow_uen / paynow_mobile NULL, invoice_run_day 7,
--                   auto_invoice_enabled TRUE.
--
-- IDEMPOTENT AND RESETTING: re-loading undoes every write the driver makes
-- (the PayNow values, the run day, the write-off and its audit row), so a
-- re-run without `supabase db reset` starts from the same state.
-- Teardown: fixtures-invoice-admin-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

-- ── The business and its people ─────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('d3000000-0000-0000-0000-000000000001','invoice-admin','InvAdm Swim','SWIM-INVA')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
 ('00000000-0000-0000-0000-000000000000','d3000000-0000-0000-0000-0000000000a1',
  'authenticated','authenticated','invoice-admin-owner@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"InvAdm Owner","role":"tenant_admin","is_coach":true,"tenant_id":"d3000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','d3000000-0000-0000-0000-0000000000f1',
  'authenticated','authenticated','invoice-admin-leaver@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"InvAdm Leaver","role":"parent"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','d3000000-0000-0000-0000-0000000000f2',
  'authenticated','authenticated','invoice-admin-stayer@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"InvAdm Stayer","role":"parent"}',
  now(), now(), '','','','')
ON CONFLICT (id) DO NOTHING;

-- Reset the tenant-level settings the driver writes (rule 12: these are ours).
UPDATE tenants
   SET owner_profile_id = 'd3000000-0000-0000-0000-0000000000a1',
       paynow_uen = NULL, paynow_mobile = NULL,
       invoice_run_day = 7, auto_invoice_enabled = TRUE
 WHERE id = 'd3000000-0000-0000-0000-000000000001';

INSERT INTO class_categories (id, tenant_id, name)
VALUES ('d3000000-0000-0000-0000-00000000cc01','d3000000-0000-0000-0000-000000000001','InvAdm Group')
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, tenant_id, name)
VALUES ('d3000000-0000-0000-0000-0000000010c1','d3000000-0000-0000-0000-000000000001','InvAdm Pool')
ON CONFLICT (id) DO NOTHING;

-- ── Reset the driver's side effects FIRST ───────────────────────────────────
DELETE FROM audit_log WHERE tenant_id = 'd3000000-0000-0000-0000-000000000001';

-- ── Everything keyed on a random parents.id / coaches.id ────────────────────
DO $$
DECLARE
  t      CONSTANT uuid := 'd3000000-0000-0000-0000-000000000001';
  v_p1   uuid;
  v_p2   uuid;
  v_co   uuid;
  v_sg   date := (now() AT TIME ZONE 'Asia/Singapore')::date;
  v_last date;      -- the 10th of LAST month (SGT)
  v_prev date;      -- four weeks earlier: same weekday, the month before
BEGIN
  SELECT id INTO v_p1 FROM parents WHERE profile_id = 'd3000000-0000-0000-0000-0000000000f1';
  SELECT id INTO v_p2 FROM parents WHERE profile_id = 'd3000000-0000-0000-0000-0000000000f2';
  SELECT id INTO v_co FROM coaches WHERE profile_id = 'd3000000-0000-0000-0000-0000000000a1';
  IF v_p1 IS NULL OR v_p2 IS NULL OR v_co IS NULL THEN
    RAISE EXCEPTION 'fixture: parents/coach rows were not created by the auth trigger';
  END IF;
  v_last := (date_trunc('month', v_sg) - interval '1 month')::date + 9;
  v_prev := v_last - 28;

  -- The class runs on the lessons' weekday (re-asserted: the date moves monthly).
  INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                       end_time, location_id, price_per_lesson, category_id, is_active)
  VALUES ('d3000000-0000-0000-0000-0000000000c1', t, v_co, 'InvAdm Squad',
          lower(trim(to_char(v_last, 'FMDay')))::day_of_week, '10:00', '11:00',
          'd3000000-0000-0000-0000-0000000010c1', 40.00,
          'd3000000-0000-0000-0000-00000000cc01', TRUE)
  ON CONFLICT (id) DO UPDATE SET day_of_week = EXCLUDED.day_of_week, is_active = TRUE;

  INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active)
  VALUES ('d3000000-0000-0000-0000-0000000000d1','InvAdm Leaverkid', t,'assigned',TRUE),
         ('d3000000-0000-0000-0000-0000000000d2','InvAdm Stayerkid', t,'assigned',TRUE)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO parent_students (parent_id, student_id)
  SELECT v.p, v.s FROM (VALUES (v_p1, 'd3000000-0000-0000-0000-0000000000d1'::uuid),
                               (v_p2, 'd3000000-0000-0000-0000-0000000000d2'::uuid)) AS v(p, s)
   WHERE NOT EXISTS (SELECT 1 FROM parent_students ps WHERE ps.parent_id = v.p AND ps.student_id = v.s);

  INSERT INTO parent_tenants (parent_id, tenant_id)
  VALUES (v_p1, t), (v_p2, t)
  ON CONFLICT (parent_id, tenant_id) DO UPDATE SET is_active = TRUE;

  INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
  SELECT v.s, 'd3000000-0000-0000-0000-0000000000c1', TRUE, v_prev - 60
    FROM (VALUES ('d3000000-0000-0000-0000-0000000000d1'::uuid),
                 ('d3000000-0000-0000-0000-0000000000d2'::uuid)) AS v(s)
   WHERE NOT EXISTS (SELECT 1 FROM student_class_enrolments e
                      WHERE e.student_id = v.s AND e.class_id = 'd3000000-0000-0000-0000-0000000000c1'
                        AND e.is_active);

  -- Two MARKED lessons: two months ago (Leaverkid) and last month (both).
  INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time, status)
  VALUES ('d3000000-0000-0000-0000-0000000000e1','d3000000-0000-0000-0000-0000000000c1',
          v_prev, '10:00', '11:00', 'completed'),
         ('d3000000-0000-0000-0000-0000000000e2','d3000000-0000-0000-0000-0000000000c1',
          v_last, '10:00', '11:00', 'completed')
  ON CONFLICT (id) DO UPDATE SET session_date = EXCLUDED.session_date;

  INSERT INTO attendance (id, lesson_session_id, student_id, status, marked_by)
  VALUES ('d3000000-0000-0000-0000-0000000000f5','d3000000-0000-0000-0000-0000000000e1',
          'd3000000-0000-0000-0000-0000000000d1','present','d3000000-0000-0000-0000-0000000000a1'),
         ('d3000000-0000-0000-0000-0000000000f6','d3000000-0000-0000-0000-0000000000e2',
          'd3000000-0000-0000-0000-0000000000d1','present','d3000000-0000-0000-0000-0000000000a1'),
         ('d3000000-0000-0000-0000-0000000000f7','d3000000-0000-0000-0000-0000000000e2',
          'd3000000-0000-0000-0000-0000000000d2','present','d3000000-0000-0000-0000-0000000000a1')
  ON CONFLICT (id) DO NOTHING;

  -- ── Three invoices ───────────────────────────────────────────────────────
  INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount,
                        credit_applied, net_amount, status, reference_number)
  VALUES ('d3000000-0000-0000-0000-0000000000b1', v_p1, t, to_char(v_prev, 'YYYY-MM'), 40.00, 0,     40.00, 'paid',        'INV-IA-0001'),
         ('d3000000-0000-0000-0000-0000000000b2', v_p1, t, to_char(v_last, 'YYYY-MM'), 40.00, 40.00, 0.00,  'paid',        'INV-IA-0002'),
         ('d3000000-0000-0000-0000-0000000000b3', v_p2, t, to_char(v_last, 'YYYY-MM'), 40.00, 0,     40.00, 'outstanding', 'INV-IA-0003')
  ON CONFLICT (id) DO UPDATE SET billing_month = EXCLUDED.billing_month,
                                 gross_amount = EXCLUDED.gross_amount,
                                 credit_applied = EXCLUDED.credit_applied,
                                 net_amount = EXCLUDED.net_amount,
                                 status = EXCLUDED.status,
                                 paid_at = NULL, paid_marked_by = NULL, paid_claimed_at = NULL;

  INSERT INTO invoice_items (id, invoice_id, student_id, lesson_session_id,
                             attendance_status, amount, class_title, session_date, student_name)
  VALUES ('d3000000-0000-0000-0000-0000000001b1','d3000000-0000-0000-0000-0000000000b1',
          'd3000000-0000-0000-0000-0000000000d1','d3000000-0000-0000-0000-0000000000e1',
          'present', 40.00, 'InvAdm Squad', v_prev, 'InvAdm Leaverkid'),
         ('d3000000-0000-0000-0000-0000000001b2','d3000000-0000-0000-0000-0000000000b2',
          'd3000000-0000-0000-0000-0000000000d1','d3000000-0000-0000-0000-0000000000e2',
          'present', 40.00, 'InvAdm Squad', v_last, 'InvAdm Leaverkid'),
         ('d3000000-0000-0000-0000-0000000001b3','d3000000-0000-0000-0000-0000000000b3',
          'd3000000-0000-0000-0000-0000000000d2','d3000000-0000-0000-0000-0000000000e2',
          'present', 40.00, 'InvAdm Squad', v_last, 'InvAdm Stayerkid')
  ON CONFLICT (id) DO UPDATE SET session_date = EXCLUDED.session_date;

  -- ── The pending debit: CN-IA-0001 drawn onto INV-IA-0002, reversed after it
  -- was paid, so the application is DEBITED (not folded, not written off).
  INSERT INTO credit_notes (id, reference_number, parent_id, student_id, invoice_id,
                            invoice_item_id, lesson_session_id, amount, original_status,
                            corrected_status, reason, tenant_id, student_name, status,
                            applied_to_invoice_id, applied_at, email_sent_at,
                            reversed_at, reversed_by)
  VALUES ('d3000000-0000-0000-0000-0000000002a1','CN-IA-0001', v_p1,
          'd3000000-0000-0000-0000-0000000000d1','d3000000-0000-0000-0000-0000000000b1',
          'd3000000-0000-0000-0000-0000000001b1','d3000000-0000-0000-0000-0000000000e1',
          40.00,'present','cancelled_rain','InvAdm rain correction', t,
          'InvAdm Leaverkid','reversed','d3000000-0000-0000-0000-0000000000b2', now(), now(),
          now(), 'd3000000-0000-0000-0000-0000000000a1')
  ON CONFLICT (id) DO UPDATE SET status = 'reversed';

  INSERT INTO credit_applications (id, credit_note_id, invoice_id, amount, debited_at, debited_by)
  VALUES ('d3000000-0000-0000-0000-0000000002b1','d3000000-0000-0000-0000-0000000002a1',
          'd3000000-0000-0000-0000-0000000000b2', 40.00, now(), 'd3000000-0000-0000-0000-0000000000a1')
  ON CONFLICT (id) DO UPDATE SET reversed_at = NULL, reversed_by = NULL,
                                 debited_at = COALESCE(credit_applications.debited_at, now()),
                                 debited_by = 'd3000000-0000-0000-0000-0000000000a1',
                                 folded_at = NULL, folded_invoice_id = NULL,
                                 written_off_at = NULL, written_off_by = NULL;

  INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance, debit_balance)
  VALUES (v_p1, t, 0, 40.00), (v_p2, t, 0, 0)
  ON CONFLICT (parent_id, tenant_id) DO UPDATE
    SET credit_balance = EXCLUDED.credit_balance, debit_balance = EXCLUDED.debit_balance;
END $$;

-- ── Postconditions — fail at load time, not twenty checks later ────────────
DO $$
DECLARE v_inv int; v_debit numeric; v_open numeric; v_set text;
BEGIN
  SELECT count(*) INTO v_inv FROM invoices WHERE tenant_id = 'd3000000-0000-0000-0000-000000000001';
  SELECT sum(debit_balance) INTO v_debit FROM parent_tenant_balances
   WHERE tenant_id = 'd3000000-0000-0000-0000-000000000001';
  SELECT coalesce(sum(amount), 0) INTO v_open FROM credit_applications
   WHERE id = 'd3000000-0000-0000-0000-0000000002b1'
     AND debited_at IS NOT NULL AND folded_at IS NULL AND written_off_at IS NULL;
  SELECT coalesce(paynow_uen,'∅') || '/' || coalesce(paynow_mobile,'∅') || '/' || invoice_run_day
    INTO v_set FROM tenants WHERE id = 'd3000000-0000-0000-0000-000000000001';
  IF v_inv <> 3 OR v_debit <> 40 OR v_open <> 40 OR v_set <> '∅/∅/7' THEN
    RAISE EXCEPTION 'fixture: expected invoices 3 / debit 40 / open application 40 / settings ∅/∅/7, got % / % / % / %',
      v_inv, v_debit, v_open, v_set;
  END IF;
END $$;

COMMIT;
