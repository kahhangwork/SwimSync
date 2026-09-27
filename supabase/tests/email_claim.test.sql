-- pgTAP: crash-safe email claim (20260927000100, CRASH_SAFE_EMAIL_CLAIM_PLAN.md).
--
-- Covers: the five delivery states and their boundaries (0, 15 min, 24 h);
-- the claim RPCs (UNSENT/RETRYABLE claim, SENDING refuses, MAY_HAVE_SENT only
-- when manual, SENT never); a re-issued credit note clears its claim and its
-- sent stamp while an ordinary settle does not; the pin on the invoice email
-- columns against a tenant admin; the grant posture (claims service_role only,
-- state columns readable by authenticated). Rolled back.
--
-- Lease ages are written directly (`now() - interval …`): a literal kill between
-- claim and send is untestable, the lease expiry is what these exercise (plan §5).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(26);

-- ── Fixture: one tenant, admin + coach + parent, one invoice, one credit note ─
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('99999999-0000-0000-0000-0000000000ec', 'tap-email-claim', 'TAP Email Claim', 'SWIM-EC01');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','ec000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','tap-ec-admin@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"EC Admin","role":"tenant_admin","tenant_id":"99999999-0000-0000-0000-0000000000ec"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','ec000000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','tap-ec-coach@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"EC Coach","role":"coach","tenant_id":"99999999-0000-0000-0000-0000000000ec"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','ec000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','tap-ec-parent@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"EC Parent","role":"parent"}',
   now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT '99999999-0000-0000-0000-0000000000ec', 'Default Group'
 WHERE NOT EXISTS (SELECT 1 FROM class_categories c
                    WHERE c.tenant_id = '99999999-0000-0000-0000-0000000000ec'
                      AND lower(trim(c.name)) = 'default group');

INSERT INTO locations (tenant_id, name)
SELECT '99999999-0000-0000-0000-0000000000ec', 'Default location'
 WHERE NOT EXISTS (SELECT 1 FROM locations l
                    WHERE l.tenant_id = '99999999-0000-0000-0000-0000000000ec'
                      AND lower(trim(l.name)) = 'default location');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT 'ec100000-0000-0000-0000-000000000001', co.id, 'EC Class', 'saturday', '10:00', '11:00',
       (SELECT l.id FROM locations l WHERE l.tenant_id = co.tenant_id AND lower(trim(l.name)) = 'default location'),
       30.00,
       (SELECT cc.id FROM class_categories cc WHERE cc.tenant_id = co.tenant_id AND lower(trim(cc.name)) = 'default group')
FROM coaches co WHERE co.profile_id = 'ec000000-0000-0000-0000-0000000000c1';

INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id)
VALUES ('ec200000-0000-0000-0000-000000000001', 'EC Kid', 'assigned', TRUE, '99999999-0000-0000-0000-0000000000ec');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'ec200000-0000-0000-0000-000000000001'
FROM parents p WHERE p.profile_id = 'ec000000-0000-0000-0000-0000000000b1';

INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('ec200000-0000-0000-0000-000000000001', 'ec100000-0000-0000-0000-000000000001', TRUE);

INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('ec300000-0000-0000-0000-000000000001', 'ec100000-0000-0000-0000-000000000001', '2026-02-07', 'completed');

INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT '99999999-0000-0000-0000-0000000000ec', 'ec400000-0000-0000-0000-000000000001', p.id, '2026-02',
       30.00, 0.00, 30.00, 'outstanding'
FROM parents p WHERE p.profile_id = 'ec000000-0000-0000-0000-0000000000b1';

INSERT INTO invoice_items (id, invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
VALUES ('ec500000-0000-0000-0000-000000000001', 'ec400000-0000-0000-0000-000000000001',
        'ec200000-0000-0000-0000-000000000001', 'ec300000-0000-0000-0000-000000000001',
        'present', 30.00, 'EC Class', '2026-02-07');

INSERT INTO credit_notes (id, reference_number, parent_id, student_id, student_name, invoice_id,
  invoice_item_id, lesson_session_id, amount, original_status, corrected_status, status, tenant_id, issued_at)
SELECT 'ec600000-0000-0000-0000-000000000001', 'CN-EC1', p.id, 'ec200000-0000-0000-0000-000000000001', 'EC Kid',
       'ec400000-0000-0000-0000-000000000001', 'ec500000-0000-0000-0000-000000000001',
       'ec300000-0000-0000-0000-000000000001', 30.00, 'present', 'absent', 'available',
       '99999999-0000-0000-0000-0000000000ec', now() - interval '1 hour'
FROM parents p WHERE p.profile_id = 'ec000000-0000-0000-0000-0000000000b1';

CREATE OR REPLACE FUNCTION pg_temp.set_inv(p_sent TIMESTAMPTZ, p_claimed TIMESTAMPTZ) RETURNS VOID AS $$
  UPDATE invoices SET invoice_email_sent_at = p_sent, invoice_email_claimed_at = p_claimed
   WHERE id = 'ec400000-0000-0000-0000-000000000001' $$ LANGUAGE sql;

-- ── 1. The five states and their boundaries ─────────────────────────────────
SELECT is(email_delivery_state(now(), now()),                            'SENT',          'sent_at set → SENT, whatever the claim');
SELECT is(email_delivery_state(NULL, NULL),                              'UNSENT',        'never claimed → UNSENT');
SELECT is(email_delivery_state(NULL, now() - interval '14 minutes'),     'SENDING',       'claimed 14 min ago → SENDING');
SELECT is(email_delivery_state(NULL, now() - interval '15 minutes'),     'RETRYABLE',     'claimed exactly 15 min ago → RETRYABLE');
SELECT is(email_delivery_state(NULL, now() - interval '24 hours'),       'RETRYABLE',     'claimed exactly 24 h ago → still RETRYABLE');
SELECT is(email_delivery_state(NULL, now() - interval '24 hours 1 second'), 'MAY_HAVE_SENT', 'claimed just over 24 h ago → MAY_HAVE_SENT');
SELECT is(email_delivery_state(NULL, now() - interval '3 days'),         'MAY_HAVE_SENT', 'claimed days ago → MAY_HAVE_SENT');

-- ── 2. Invoice claim ────────────────────────────────────────────────────────
SELECT is(
  (SELECT prior_state FROM claim_invoice_email('ec400000-0000-0000-0000-000000000001')),
  'UNSENT', 'an UNSENT invoice email is claimed');
SELECT is(
  (SELECT invoice_email_claimed_at FROM invoices WHERE id = 'ec400000-0000-0000-0000-000000000001'),
  now(), 'the claim stamps invoice_email_claimed_at');
SELECT is(
  (SELECT count(*)::int FROM claim_invoice_email('ec400000-0000-0000-0000-000000000001')),
  0, 'a fresh claim (SENDING) refuses a second claimer');
SELECT is(
  (SELECT count(*)::int FROM claim_invoice_email('ec400000-0000-0000-0000-000000000001', TRUE)),
  0, 'SENDING refuses even a manual resend — a double-clicked Resend sends once');

SELECT pg_temp.set_inv(NULL, now() - interval '20 minutes');
SELECT is(
  (SELECT prior_state FROM claim_invoice_email('ec400000-0000-0000-0000-000000000001')),
  'RETRYABLE', 'an expired lease (20 min) is re-claimed automatically');

SELECT pg_temp.set_inv(NULL, now() - interval '2 days');
SELECT is(
  (SELECT count(*)::int FROM claim_invoice_email('ec400000-0000-0000-0000-000000000001')),
  0, 'MAY_HAVE_SENT is NEVER claimed by the automatic path');
SELECT is(
  (SELECT prior_state FROM claim_invoice_email('ec400000-0000-0000-0000-000000000001', TRUE)),
  'MAY_HAVE_SENT', 'MAY_HAVE_SENT is claimed by a manual resend, which reports it (→ new key)');

SELECT pg_temp.set_inv(now(), NULL);
SELECT is(
  (SELECT count(*)::int FROM claim_invoice_email('ec400000-0000-0000-0000-000000000001', TRUE)),
  0, 'a SENT invoice email is never claimed, even manually');

-- ── 3. Credit note claim + re-issue ─────────────────────────────────────────
SELECT is(
  (SELECT issued_at FROM claim_credit_note_email('ec600000-0000-0000-0000-000000000001')),
  (SELECT issued_at FROM credit_notes WHERE id = 'ec600000-0000-0000-0000-000000000001'),
  'a credit-note claim returns issued_at (versions the Idempotency-Key)');
SELECT is(
  (SELECT count(*)::int FROM claim_credit_note_email('ec600000-0000-0000-0000-000000000001')),
  0, 'a fresh credit-note claim refuses a second claimer');

-- An ordinary settle does NOT fire the re-issue reset.
UPDATE credit_notes SET email_sent_at = now(), email_claimed_at = NULL
 WHERE id = 'ec600000-0000-0000-0000-000000000001';
SELECT isnt(
  (SELECT email_sent_at FROM credit_notes WHERE id = 'ec600000-0000-0000-0000-000000000001'),
  NULL, 'a settle that leaves issued_at alone keeps email_sent_at');

-- A re-issue (new issued_at on the same row) is a new, unsent email.
UPDATE credit_notes SET email_claimed_at = now() - interval '5 minutes'
 WHERE id = 'ec600000-0000-0000-0000-000000000001';
UPDATE credit_notes SET issued_at = now()
 WHERE id = 'ec600000-0000-0000-0000-000000000001';
SELECT ok(
  (SELECT email_claimed_at IS NULL AND email_sent_at IS NULL
     FROM credit_notes WHERE id = 'ec600000-0000-0000-0000-000000000001'),
  're-issue clears email_claimed_at AND email_sent_at');
SELECT is(
  (SELECT credit_note_email_state(c) FROM credit_notes c WHERE id = 'ec600000-0000-0000-0000-000000000001'),
  'UNSENT', 'a re-issued note reads UNSENT through the computed column');

-- ── 4. Grants ───────────────────────────────────────────────────────────────
SELECT ok(
  has_function_privilege('service_role', 'public.claim_invoice_email(uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.claim_invoice_email(uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.claim_invoice_email(uuid,boolean)', 'EXECUTE'),
  'claim_invoice_email is callable by service_role ONLY');
SELECT ok(
  has_function_privilege('service_role', 'public.claim_credit_note_email(uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.claim_credit_note_email(uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.claim_credit_note_email(uuid,boolean)', 'EXECUTE'),
  'claim_credit_note_email is callable by service_role ONLY');
SELECT ok(
  has_function_privilege('authenticated', 'public.invoice_email_state(public.invoices)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.credit_note_email_state(public.credit_notes)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.invoice_email_state(public.invoices)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.credit_note_email_state(public.credit_notes)', 'EXECUTE'),
  'the state computed columns are readable by authenticated, not anon');

-- ── 5. The pin: a tenant admin cannot write invoice email state ─────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ec000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT throws_ok(
  $$ UPDATE invoices SET invoice_email_sent_at = NULL
      WHERE id = 'ec400000-0000-0000-0000-000000000001' $$,
  '23514', NULL,
  'invoice_email_sent_at is pinned against client writes');
SELECT throws_ok(
  $$ UPDATE invoices SET invoice_email_claimed_at = now()
      WHERE id = 'ec400000-0000-0000-0000-000000000001' $$,
  '23514', NULL,
  'invoice_email_claimed_at is pinned against client writes');
SELECT is(
  (SELECT invoice_email_state(i) FROM invoices i WHERE id = 'ec400000-0000-0000-0000-000000000001'),
  'SENT', 'the tenant admin reads the invoice email state through RLS');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
