-- pgTAP: Row Level Security isolation. Seeds two parents and asserts each can
-- read only their own billing data, while the superadmin sees everyone's.
-- Directly guards the "RLS returns nothing / returns too much" bug class.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(5);

-- ── Seed two parents, each with a student + an invoice (as the superuser) ────
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','rls-parentA@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Parent A","role":"parent"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','rls-parentB@test.local', crypt('x', gen_salt('bf')),
   now(), '{"provider":"email"}','{"full_name":"Parent B","role":"parent"}', now(), now(), '', '', '', '');

INSERT INTO students (id, full_name, assignment_status) VALUES
  ('c0000000-0000-0000-0000-0000000000a1','Kid A','assigned'),
  ('c0000000-0000-0000-0000-0000000000b1','Kid B','assigned');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c0000000-0000-0000-0000-0000000000a1' FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000a1';
INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'c0000000-0000-0000-0000-0000000000b1' FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000b1';

INSERT INTO invoices (id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT 'e0000000-0000-0000-0000-0000000000a1', p.id, '2026-01', 30, 0, 30, 'outstanding' FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000a1';
INSERT INTO invoices (id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT 'e0000000-0000-0000-0000-0000000000b1', p.id, '2026-01', 30, 0, 30, 'outstanding' FROM parents p WHERE p.profile_id='a0000000-0000-0000-0000-0000000000b1';

-- ── As Parent A (authenticated) ─────────────────────────────────────────────
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM invoices WHERE id='e0000000-0000-0000-0000-0000000000a1'),
  1, 'Parent A can see their own invoice');
SELECT is((SELECT count(*)::int FROM invoices WHERE id='e0000000-0000-0000-0000-0000000000b1'),
  0, 'Parent A cannot see Parent B''s invoice');
SELECT is((SELECT count(*)::int FROM students WHERE id='c0000000-0000-0000-0000-0000000000b1'),
  0, 'Parent A cannot see Parent B''s child');

-- ── As Parent B ─────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM invoices WHERE id='e0000000-0000-0000-0000-0000000000a1'),
  0, 'Parent B cannot see Parent A''s invoice');

-- ── As the superadmin (from seed.sql) ───────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM invoices
           WHERE id IN ('e0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-0000000000b1')),
  2, 'Superadmin sees both parents'' invoices');

SELECT * FROM finish();
ROLLBACK;
