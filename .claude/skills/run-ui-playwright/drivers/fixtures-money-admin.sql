-- Fixture for verify-money-admin.mjs — the Credit Notes / Referrals / Wages
-- actions no other driver presses (BACKLOG → Foundations;
-- docs/plans/DRIVER_BACKLOG_PLAN.md U4).
--
--   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < .claude/skills/run-ui-playwright/drivers/fixtures-money-admin.sql
--
-- ITS OWN BUSINESS ("MoneyAdm Swim", prefix c4000000-). The driver flips the
-- rain-pays toggle, clamps the wage run day and rewrites the referral
-- programme — all TENANT-level settings that the seed tenant's drivers read
-- (plan rule 12). Everything here is owned, so nothing a sibling reads moves.
--
-- The shapes, each for one check:
--   MoneyAdm Owner        tenant admin, NOT a coach — the login.
--   MoneyAdm Coach        a staff coach with a TEACHING rate (S$40/60) AND a
--                         SHADOW rate (S$15/60), both from 2000-01-01 — the
--                         only shape on which the Shadow re-prefill is visible.
--   MoneyAdm Squad        60-min class taught by the coach, one ATTENDED lesson
--                         in LAST month (§7.226) — Calculate payroll for that
--                         month gives a one-line payout to expand.
--   MoneyAdm Parent One   note CN-MA-0001 (S$40, on last month's invoice)
--                         DRAWN in full onto this month's outstanding invoice
--                         INV-MA-0003 (gross 60, credit 40, net 20) — Void must
--                         reopen it (credit 0, net 60). Status 'applied'.
--   MoneyAdm Parent Two   note CN-MA-0002 (S$40) AVAILABLE, not emailed (so a
--                         Resend button is ON the page — the driver asserts it
--                         is never pressed); balance S$40. Referred by Parent
--                         One; holds an AVAILABLE "friend's first" reward.
--   Programme             referrals ON, percent 10, reward expiry 30 days.
--   Policy                rain_pays_coach FALSE, wage_run_day 15.
--
-- IDEMPOTENT AND RESETTING: re-loading undoes every write the driver makes
-- (the void, code toggles, a granted reward, a voided reward, a saved shadow
-- rate, a payroll run, the settings), so a re-run without `supabase db reset`
-- starts from the same state.
-- Teardown: fixtures-money-admin-teardown.sql.

\set ON_ERROR_STOP on
BEGIN;

-- ── The business and its people ─────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('c4000000-0000-0000-0000-000000000001','money-admin','MoneyAdm Swim','SWIM-MNYA')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
 ('00000000-0000-0000-0000-000000000000','c4000000-0000-0000-0000-0000000000a1',
  'authenticated','authenticated','money-admin-owner@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"MoneyAdm Owner","role":"tenant_admin","is_coach":false,"tenant_id":"c4000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','c4000000-0000-0000-0000-0000000000a2',
  'authenticated','authenticated','money-admin-coach@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"MoneyAdm Coach","role":"coach","tenant_id":"c4000000-0000-0000-0000-000000000001"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','c4000000-0000-0000-0000-0000000000f1',
  'authenticated','authenticated','money-admin-parent1@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"MoneyAdm Parent One","role":"parent"}',
  now(), now(), '','','',''),
 ('00000000-0000-0000-0000-000000000000','c4000000-0000-0000-0000-0000000000f2',
  'authenticated','authenticated','money-admin-parent2@swimsync.test',
  crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"MoneyAdm Parent Two","role":"parent"}',
  now(), now(), '','','','')
ON CONFLICT (id) DO NOTHING;

-- Reset the tenant-level settings the driver writes (rule 12: these are ours).
UPDATE tenants
   SET owner_profile_id = 'c4000000-0000-0000-0000-0000000000a1',
       rain_pays_coach = FALSE, wage_run_day = 15,
       referral_enabled = TRUE, referral_discount_type = 'percent',
       referral_discount_value = 10, referral_reward_expiry_days = 30
 WHERE id = 'c4000000-0000-0000-0000-000000000001';

INSERT INTO class_categories (id, tenant_id, name)
VALUES ('c4000000-0000-0000-0000-00000000cc01','c4000000-0000-0000-0000-000000000001','MoneyAdm Group')
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, tenant_id, name)
VALUES ('c4000000-0000-0000-0000-0000000010c1','c4000000-0000-0000-0000-000000000001','MoneyAdm Pool')
ON CONFLICT (id) DO NOTHING;

-- ── Reset the driver's side effects FIRST ───────────────────────────────────
DELETE FROM coach_payouts   WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
DELETE FROM referral_rewards WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001'
                               AND id <> 'c4000000-0000-0000-0000-0000000004b1';
DELETE FROM coach_rates     WHERE coach_id IN
  (SELECT id FROM coaches WHERE profile_id = 'c4000000-0000-0000-0000-0000000000a2')
  AND id NOT IN ('c4000000-0000-0000-0000-0000000003a1','c4000000-0000-0000-0000-0000000003a2');
DELETE FROM audit_log       WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';

-- ── Everything keyed on a random parents.id / coaches.id ────────────────────
DO $$
DECLARE
  t      CONSTANT uuid := 'c4000000-0000-0000-0000-000000000001';
  v_p1   uuid;
  v_p2   uuid;
  v_co   uuid;
  v_sg   date := (now() AT TIME ZONE 'Asia/Singapore')::date;
  v_last date;      -- the lesson: the 10th of LAST month (SGT)
  v_lm   char(7);   -- last month, YYYY-MM
  v_tm   char(7);   -- this month, YYYY-MM
  v_code text;
BEGIN
  SELECT id INTO v_p1 FROM parents WHERE profile_id = 'c4000000-0000-0000-0000-0000000000f1';
  SELECT id INTO v_p2 FROM parents WHERE profile_id = 'c4000000-0000-0000-0000-0000000000f2';
  SELECT id INTO v_co FROM coaches WHERE profile_id = 'c4000000-0000-0000-0000-0000000000a2';
  v_last := (date_trunc('month', v_sg) - interval '1 month')::date + 9;
  v_lm   := to_char(v_last, 'YYYY-MM');
  v_tm   := to_char(v_sg, 'YYYY-MM');

  -- Rates: teaching S$40/60 and shadow S$15/60, both long in force.
  INSERT INTO coach_rates (id, coach_id, amount, unit_minutes, effective_from, role)
  VALUES ('c4000000-0000-0000-0000-0000000003a1', v_co, 40.00, 60, DATE '2000-01-01', 'main'),
         ('c4000000-0000-0000-0000-0000000003a2', v_co, 15.00, 60, DATE '2000-01-01', 'shadow')
  ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount, unit_minutes = EXCLUDED.unit_minutes;

  -- The class runs on the lesson's weekday (re-asserted: the date moves monthly).
  INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                       end_time, location_id, price_per_lesson, category_id, is_active)
  VALUES ('c4000000-0000-0000-0000-0000000000c1', t, v_co, 'MoneyAdm Squad',
          lower(trim(to_char(v_last, 'FMDay')))::day_of_week, '10:00', '11:00',
          'c4000000-0000-0000-0000-0000000010c1', 40.00,
          'c4000000-0000-0000-0000-00000000cc01', TRUE)
  ON CONFLICT (id) DO UPDATE SET day_of_week = EXCLUDED.day_of_week, is_active = TRUE;

  INSERT INTO students (id, full_name, tenant_id, assignment_status, is_active)
  VALUES ('c4000000-0000-0000-0000-0000000000d1','MoneyAdm Drawnkid', t,'assigned',TRUE),
         ('c4000000-0000-0000-0000-0000000000d2','MoneyAdm Availkid', t,'assigned',TRUE)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO parent_students (parent_id, student_id)
  SELECT v.p, v.s FROM (VALUES (v_p1, 'c4000000-0000-0000-0000-0000000000d1'::uuid),
                               (v_p2, 'c4000000-0000-0000-0000-0000000000d2'::uuid)) AS v(p, s)
   WHERE NOT EXISTS (SELECT 1 FROM parent_students ps WHERE ps.parent_id = v.p AND ps.student_id = v.s);

  INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
  SELECT v.s, 'c4000000-0000-0000-0000-0000000000c1', TRUE, v_last - 60
    FROM (VALUES ('c4000000-0000-0000-0000-0000000000d1'::uuid),
                 ('c4000000-0000-0000-0000-0000000000d2'::uuid)) AS v(s)
   WHERE NOT EXISTS (SELECT 1 FROM student_class_enrolments e
                      WHERE e.student_id = v.s AND e.class_id = 'c4000000-0000-0000-0000-0000000000c1'
                        AND e.is_active);

  -- LAST month's lesson, both children present — the payroll line.
  INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time, status)
  VALUES ('c4000000-0000-0000-0000-0000000000e1', 'c4000000-0000-0000-0000-0000000000c1',
          v_last, '10:00', '11:00', 'completed')
  ON CONFLICT (id) DO UPDATE SET session_date = EXCLUDED.session_date;

  INSERT INTO attendance (id, lesson_session_id, student_id, status, marked_by)
  VALUES ('c4000000-0000-0000-0000-0000000000e2','c4000000-0000-0000-0000-0000000000e1',
          'c4000000-0000-0000-0000-0000000000d1','present','c4000000-0000-0000-0000-0000000000a2'),
         ('c4000000-0000-0000-0000-0000000000e3','c4000000-0000-0000-0000-0000000000e1',
          'c4000000-0000-0000-0000-0000000000d2','present','c4000000-0000-0000-0000-0000000000a2')
  ON CONFLICT (id) DO NOTHING;

  -- ── Invoices: last month's (one per family, paid) and this month's drawn one
  INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount,
                        credit_applied, net_amount, status, reference_number)
  VALUES ('c4000000-0000-0000-0000-0000000000b1', v_p1, t, v_lm, 40.00, 0, 40.00, 'paid',        'INV-MA-0001'),
         ('c4000000-0000-0000-0000-0000000000b2', v_p2, t, v_lm, 40.00, 0, 40.00, 'paid',        'INV-MA-0002'),
         ('c4000000-0000-0000-0000-0000000000b3', v_p1, t, v_tm, 60.00, 40.00, 20.00, 'outstanding', 'INV-MA-0003')
  ON CONFLICT (id) DO UPDATE SET billing_month = EXCLUDED.billing_month,
                                 gross_amount = EXCLUDED.gross_amount,
                                 credit_applied = EXCLUDED.credit_applied,
                                 net_amount = EXCLUDED.net_amount,
                                 status = EXCLUDED.status,
                                 paid_at = NULL, paid_marked_by = NULL, paid_claimed_at = NULL;

  INSERT INTO invoice_items (id, invoice_id, student_id, lesson_session_id,
                             attendance_status, amount, class_title, session_date, student_name)
  VALUES ('c4000000-0000-0000-0000-0000000001b1','c4000000-0000-0000-0000-0000000000b1',
          'c4000000-0000-0000-0000-0000000000d1','c4000000-0000-0000-0000-0000000000e1',
          'present', 40.00, 'MoneyAdm Squad', v_last, 'MoneyAdm Drawnkid'),
         ('c4000000-0000-0000-0000-0000000001b2','c4000000-0000-0000-0000-0000000000b2',
          'c4000000-0000-0000-0000-0000000000d2','c4000000-0000-0000-0000-0000000000e1',
          'present', 40.00, 'MoneyAdm Squad', v_last, 'MoneyAdm Availkid')
  ON CONFLICT (id) DO UPDATE SET session_date = EXCLUDED.session_date;

  -- ── Credit notes: one DRAWN (applied to INV-MA-0003), one AVAILABLE ──────
  INSERT INTO credit_notes (id, reference_number, parent_id, student_id, invoice_id,
                            invoice_item_id, lesson_session_id, amount, original_status,
                            corrected_status, reason, tenant_id, student_name, status,
                            applied_to_invoice_id, applied_at, email_sent_at)
  VALUES ('c4000000-0000-0000-0000-0000000002a1','CN-MA-0001', v_p1,
          'c4000000-0000-0000-0000-0000000000d1','c4000000-0000-0000-0000-0000000000b1',
          'c4000000-0000-0000-0000-0000000001b1','c4000000-0000-0000-0000-0000000000e1',
          40.00,'present','cancelled_rain','MoneyAdm rain correction', t,
          'MoneyAdm Drawnkid','applied','c4000000-0000-0000-0000-0000000000b3', now(), now()),
         ('c4000000-0000-0000-0000-0000000002a2','CN-MA-0002', v_p2,
          'c4000000-0000-0000-0000-0000000000d2','c4000000-0000-0000-0000-0000000000b2',
          'c4000000-0000-0000-0000-0000000001b2','c4000000-0000-0000-0000-0000000000e1',
          40.00,'present','cancelled_rain','MoneyAdm rain correction', t,
          'MoneyAdm Availkid','available', NULL, NULL, NULL)
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status,
                                 applied_to_invoice_id = EXCLUDED.applied_to_invoice_id,
                                 applied_at = EXCLUDED.applied_at,
                                 email_sent_at = EXCLUDED.email_sent_at,
                                 reversed_at = NULL, reversed_by = NULL;

  INSERT INTO credit_applications (id, credit_note_id, invoice_id, amount)
  VALUES ('c4000000-0000-0000-0000-0000000002b1','c4000000-0000-0000-0000-0000000002a1',
          'c4000000-0000-0000-0000-0000000000b3', 40.00)
  ON CONFLICT (id) DO UPDATE SET reversed_at = NULL, reversed_by = NULL,
                                 debited_at = NULL, debited_by = NULL;

  INSERT INTO parent_tenant_balances (parent_id, tenant_id, credit_balance, debit_balance)
  VALUES (v_p1, t, 0, 0), (v_p2, t, 40.00, 0)
  ON CONFLICT (parent_id, tenant_id) DO UPDATE
    SET credit_balance = EXCLUDED.credit_balance, debit_balance = 0;

  -- ── Referrals: both families are members (codes minted by the trigger) ────
  INSERT INTO parent_tenants (parent_id, tenant_id)
  VALUES (v_p1, t), (v_p2, t)
  ON CONFLICT (parent_id, tenant_id) DO UPDATE
    SET is_active = TRUE, referral_code_disabled_at = NULL;
  SELECT referral_code INTO v_code FROM parent_tenants WHERE parent_id = v_p1 AND tenant_id = t;

  INSERT INTO referrals (id, tenant_id, referrer_parent_id, referee_parent_id, code_used, status)
  VALUES ('c4000000-0000-0000-0000-0000000004a1', t, v_p1, v_p2, v_code, 'pending')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO referral_rewards (id, tenant_id, parent_id, kind, referral_id, status)
  VALUES ('c4000000-0000-0000-0000-0000000004b1', t, v_p2, 'referee_first',
          'c4000000-0000-0000-0000-0000000004a1', 'available')
  ON CONFLICT (id) DO UPDATE SET status = 'available', voided_by = NULL,
                                 voided_at = NULL, void_reason = NULL;
END $$;

-- ── Postconditions — fail at load time, not twenty checks later ────────────
DO $$
DECLARE v_notes text; v_inv text; v_rates int; v_codes int; v_rw text; v_set text;
BEGIN
  SELECT string_agg(reference_number || ':' || status, ',' ORDER BY reference_number) INTO v_notes
    FROM credit_notes WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
  SELECT credit_applied || '/' || net_amount || '/' || status INTO v_inv
    FROM invoices WHERE id = 'c4000000-0000-0000-0000-0000000000b3';
  SELECT count(*) INTO v_rates FROM coach_rates r JOIN coaches c ON c.id = r.coach_id
   WHERE c.profile_id = 'c4000000-0000-0000-0000-0000000000a2';
  SELECT count(*) INTO v_codes FROM parent_tenants
   WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001'
     AND referral_code IS NOT NULL AND referral_code_disabled_at IS NULL;
  SELECT string_agg(kind || ':' || status, ',') INTO v_rw FROM referral_rewards
   WHERE tenant_id = 'c4000000-0000-0000-0000-000000000001';
  SELECT rain_pays_coach || '/' || wage_run_day || '/' || referral_discount_type INTO v_set
    FROM tenants WHERE id = 'c4000000-0000-0000-0000-000000000001';
  IF v_notes IS DISTINCT FROM 'CN-MA-0001:applied,CN-MA-0002:available'
     OR v_inv IS DISTINCT FROM '40.00/20.00/outstanding'
     OR v_rates <> 2 OR v_codes <> 2
     OR v_rw IS DISTINCT FROM 'referee_first:available'
     OR v_set IS DISTINCT FROM 'false/15/percent' THEN
    RAISE EXCEPTION 'fixture: notes % / drawn invoice % / rates % / codes % / rewards % / settings %',
      v_notes, v_inv, v_rates, v_codes, v_rw, v_set;
  END IF;
END $$;

COMMIT;
