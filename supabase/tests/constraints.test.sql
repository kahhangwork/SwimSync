-- pgTAP: key data-integrity guarantees the billing logic relies on.
-- One invoice per parent per month, one active enrolment per student,
-- positive-only credit applications, and immutable credit notes.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(7);

-- Multi-tenancy scaffolding: coaches and students now require a tenant. This
-- fixture creates its own so the test stays independent of the seed. The rule
-- under test is unchanged — cross-tenant isolation has its own file
-- (tenant_isolation.test.sql).
INSERT INTO tenants (id, slug, display_name, join_code)
VALUES ('99999999-0000-0000-0000-000000000001', 'tap-constraints', 'TAP Constraints', 'SWIM-TC01');

-- ── Seed ────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000c2',
   'authenticated','authenticated','con-coach@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Con Coach","role":"coach","tenant_id":"99999999-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000d2',
   'authenticated','authenticated','con-parent@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Con Parent","role":"parent"}', now(), now(), '', '', '', '');

-- classes.category_id is NOT NULL (20260725000400). A test creates its own
-- tenants inside this transaction, so they have none of the categories the
-- migration backfilled onto pre-existing ones — give every tenant a Default
-- Group to hang classes off. Idempotent, and deliberately tenant-agnostic so
-- this block is identical in every fixture.
INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM class_categories c
    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'b0000000-0000-0000-0000-000000000002', co.id, 'Con Class', 'saturday','10:00','11:00','Pool', 30,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = co.tenant_id
           AND lower(trim(cc.name)) = 'default group')
FROM coaches co WHERE co.profile_id='a0000000-0000-0000-0000-0000000000c2';

INSERT INTO students (id, full_name, assignment_status, tenant_id)
VALUES ('c0000000-0000-0000-0000-000000000002','Con Kid','assigned','99999999-0000-0000-0000-000000000001');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c0000000-0000-0000-0000-000000000002' FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000d2';

INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002', TRUE);

INSERT INTO lesson_sessions (id, class_id, session_date, status)
VALUES ('d0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000002','2026-01-03','completed');

INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT '99999999-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', p.id, '2026-01', 30, 0, 30, 'outstanding'
FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000d2';

INSERT INTO invoice_items (id, invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
VALUES ('f0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000002',
        'c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000003','present',30,'Con Class','2026-01-03');

INSERT INTO credit_notes (tenant_id, id, reference_number, parent_id, student_id, invoice_id, invoice_item_id,
  lesson_session_id, amount, original_status, corrected_status, status)
SELECT '99999999-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001','CN-TEST-0001', p.id,
       'c0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000002',
       'f0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000003',
       30,'present','absent','available'
FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000d2';

-- ── 1. One invoice per parent per billing month ─────────────────────────────
SELECT throws_ok($$
  INSERT INTO invoices (tenant_id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
  SELECT '99999999-0000-0000-0000-000000000001', p.id, '2026-01', 99, 0, 99, 'outstanding' FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000d2'
$$, '23505', NULL, 'a parent cannot have two invoices for the same billing month');

-- ── 2. One active enrolment per student PER CLASS ───────────────────────────
-- Reworded for Wave 2 (20260811000100), and the wording matters: until then the
-- assertion read "a student cannot have two active class enrolments", which is
-- now FALSE — that is the whole feature. The statement below is unchanged and
-- still raises 23505, so this test would have gone on PASSING while describing a
-- rule that no longer exists. Tests 2a and 2b are what actually pin the new one.
SELECT throws_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active)
  VALUES ('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002', TRUE)
$$, '23505', NULL, 'a student cannot be enrolled in the SAME class twice');

-- ── 2a. A SECOND, non-overlapping class is now allowed ──────────────────────
-- The positive half. Con Class is Saturday 10-11; this one is Saturday 14-15,
-- so it shares a weekday and still does not overlap.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'b0000000-0000-0000-0000-00000000000c', co.id, 'Con Class Two', 'saturday','14:00','15:00','Pool', 30,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = co.tenant_id
           AND lower(trim(cc.name)) = 'default group')
FROM coaches co WHERE co.profile_id='a0000000-0000-0000-0000-0000000000c2';

SELECT lives_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active)
  VALUES ('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-00000000000c', TRUE)
$$, 'a student CAN hold a second active enrolment in a different class');

-- ── 2b. …but not one that overlaps a class they are already in ──────────────
-- Saturday 10:30-11:30 straddles Con Class's 10-11. Refused by
-- enforce_enrolment_schedule(), not by an index, so the code is P0001.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'b0000000-0000-0000-0000-00000000000d', co.id, 'Con Class Clash', 'saturday','10:30','11:30','Pool', 30,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = co.tenant_id
           AND lower(trim(cc.name)) = 'default group')
FROM coaches co WHERE co.profile_id='a0000000-0000-0000-0000-0000000000c2';

SELECT throws_ok($$
  INSERT INTO student_class_enrolments (student_id, class_id, is_active)
  VALUES ('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-00000000000d', TRUE)
$$, 'P0001', NULL, 'a student cannot be in two classes at the same time');

-- ── 3. Credit applications must be for a positive amount ─────────────────────
SELECT throws_ok($$
  INSERT INTO credit_applications (credit_note_id, invoice_id, amount)
  VALUES ('0c000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002', 0)
$$, '23514', NULL, 'credit_applications.amount must be > 0');

-- ── 4. Credit notes are immutable to app roles ───────────────────────────────
-- The guarantee is unchanged; what enforces it got stronger, and the OBSERVABLE
-- BEHAVIOUR changed with it, which is why this assertion was rewritten on
-- 2026-08-04 rather than left alone.
--
--   BEFORE 20260804000600: `authenticated` held the blanket `GRANT ALL`, so the
--   privilege check passed and RLS did the work. With no UPDATE policy on
--   credit_notes, RLS makes the statement match zero rows — SILENTLY. The old
--   assertion read the reason back and checked it was still NULL.
--
--   AFTER: the grant is gone too (no UPDATE policy ⇒ no UPDATE grant), so the
--   privilege check fails first and the statement RAISES 42501.
--
-- Loud beats silent: a zero-row UPDATE looks identical to a successful one from
-- the client, which is how a "why didn't my edit save?" bug hides for months.
-- Note this is also why the rewrite is necessary rather than cosmetic — an
-- error aborts the transaction, so the old read-it-back form cannot run at all.
-- (The parent can still SELECT their own note; only the write is refused.)
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
SELECT throws_ok($$
  UPDATE credit_notes SET reason='tampered'
    WHERE id='0c000000-0000-0000-0000-000000000001'
$$, '42501', NULL, 'an authenticated user cannot modify a credit note');

-- The same refusal, aimed at email_sent_at specifically (20260817000100).
-- WHY A SECOND ASSERTION ON THE SAME TABLE. Grants are not column-scoped, so the
-- one above already covers this column — but that is exactly the reasoning the
-- credit-note email feature RELIES on, and a claim relied upon should be pinned
-- where it can go red rather than inferred. The column doubles as the send CLAIM:
-- if a client could ever null it, a tenant member could force a re-email to a
-- parent; if they could set it, they could suppress one. Neither is reachable
-- while credit_notes grants `authenticated` SELECT and nothing else, and this is
-- the line that fails the day someone "fixes" a permission error with a re-grant.
-- (§7.87 · docs/plans/CREDIT_NOTE_EMAIL_PLAN.md)
SELECT throws_ok($$
  UPDATE credit_notes SET email_sent_at=NULL
    WHERE id='0c000000-0000-0000-0000-000000000001'
$$, '42501', NULL,
   'an authenticated user cannot clear a credit note''s email_sent_at claim');

SELECT * FROM finish();
ROLLBACK;
