-- pgTAP: THE ORPHAN-LESSON REPORT — unbilled_sealed_lessons() (20260812000400).
--
-- WHAT THIS FILE EXISTS TO PROTECT. Sealing is final and the completeness gate
-- only guards lessons that exist AT GENERATION TIME. A lesson recorded into a
-- sealed month afterwards (backdated enrolment, backdated make-up/trial,
-- absent→present correction) is billable, unbillable, and — before this
-- function — invisible. The report is the whole defence, and its failure mode
-- is the same silence it exists to break: a predicate bug does not error, it
-- just returns fewer rows. So every clause of the WHERE is pinned by an
-- assertion a sabotage of that clause turns red (§7.25).
--
-- THE FIXTURE SEALS LAST MONTH, deliberately inside §8.32's reopened marking
-- window — the same shape as the real trigger case (July billed on 2 August,
-- July still markable). All orphan dates live in that one sealed month; the
-- unsealed-exclusion case uses the 1st of THIS month, which is never in the
-- future on any run date (§7.33 — every date derives from the SGT clock).
--
-- METHOD (§7.16): probes run inside this transaction under SET LOCAL ROLE with
-- JWT claims; fixture writes happen as superuser between probes via RESET ROLE
-- (guard triggers exempt non-authenticated roles, so backdated fixture rows
-- insert freely — the same exemption the engine relies on).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(18);

-- ── The dates, from one anchor ──────────────────────────────────────────────
--   m_seal  last month, 'YYYY-MM'   the month tenant A has SEALED
--   d0      1st of last month       a BILLED lesson date (invoice_items row)
--   d1      d0 + 7                  orphan date, shared by three students
--   d2      d0 + 14                 orphan date, s2 only
--   dN      1st of THIS month       unsealed-month lesson; never in the future
CREATE TEMP TABLE f AS
SELECT
  to_char((now() AT TIME ZONE 'Asia/Singapore') - INTERVAL '1 month',
          'YYYY-MM')                                               AS m_seal,
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '1 month')::date                                   AS d0,
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '1 month' + INTERVAL '7 days')::date               AS d1,
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '1 month' + INTERVAL '14 days')::date              AS d2,
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')))::date AS dN;
GRANT SELECT ON f TO PUBLIC;

-- ── Two businesses: A seals a month; B seals nothing ────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code, created_at) VALUES
  ('84777777-0000-0000-0000-000000000001','wv4a','WV4 Business A','SWIM-WV4A', now()),
  ('84777777-0000-0000-0000-000000000002','wv4b','WV4 Business B','SWIM-WV4B', now());

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','84100000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','wv4-admin-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"WV4 Admin A","role":"tenant_admin","tenant_id":"84777777-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','84100000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','wv4-coach-a@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"WV4 Coach A","role":"coach","tenant_id":"84777777-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','84100000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','wv4-admin-b@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"WV4 Admin B","role":"tenant_admin","tenant_id":"84777777-0000-0000-0000-000000000002"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','84100000-0000-0000-0000-0000000000c2',
   'authenticated','authenticated','wv4-coach-b@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"WV4 Coach B","role":"coach","tenant_id":"84777777-0000-0000-0000-000000000002"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','84100000-0000-0000-0000-000000000091',
   'authenticated','authenticated','wv4-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"WV4 Parent","role":"parent"}', now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE t.id IN ('84777777-0000-0000-0000-000000000001',
                '84777777-0000-0000-0000-000000000002')
   AND NOT EXISTS (
     SELECT 1 FROM class_categories c
      WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

-- classes.location_id is NOT NULL since the location contract migration
-- (20260824000200). Give every tenant one location to hang classes off,
-- tenant-agnostic and idempotent (mirrors the Default Group category block).
INSERT INTO locations (tenant_id, name)
SELECT t.id, 'Default location' FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM locations l
    WHERE l.tenant_id = t.id AND lower(trim(l.name)) = 'default location');

INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time,
                     end_time, location_id, price_per_lesson, category_id)
SELECT
  v.id, v.tenant, (SELECT id FROM coaches WHERE profile_id = v.coach),
  v.title,
  (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    )[EXTRACT(DOW FROM (SELECT d1 FROM f))::int + 1]::day_of_week,
  '10:00','11:00',(SELECT l.id FROM locations l WHERE l.tenant_id = v.tenant AND lower(trim(l.name)) = 'default location'), 30,
  (SELECT id FROM class_categories
    WHERE tenant_id = v.tenant AND lower(trim(name)) = 'default group')
FROM (VALUES
  ('84777777-1111-0000-0000-000000000001'::UUID,
   '84777777-0000-0000-0000-000000000001'::UUID,
   '84100000-0000-0000-0000-0000000000c1'::UUID, 'WV4 Class A'),
  ('84777777-1111-0000-0000-000000000002'::UUID,
   '84777777-0000-0000-0000-000000000002'::UUID,
   '84100000-0000-0000-0000-0000000000c2'::UUID, 'WV4 Class B')
) AS v(id, tenant, coach, title);

INSERT INTO students (id, full_name, tenant_id) VALUES
  ('84500000-0000-0000-0000-000000000001','WV4 Billed Child','84777777-0000-0000-0000-000000000001'),
  ('84500000-0000-0000-0000-000000000002','WV4 Backdated Child','84777777-0000-0000-0000-000000000001'),
  ('84500000-0000-0000-0000-000000000003','WV4 Trial Child','84777777-0000-0000-0000-000000000001'),
  ('84500000-0000-0000-0000-000000000004','WV4 Unsealed Child','84777777-0000-0000-0000-000000000002');

INSERT INTO lesson_sessions (id, class_id, session_date, start_time, end_time)
SELECT v.id, v.class_id, v.d, '10:00', '11:00'
FROM f, (VALUES
  ('84400000-0000-0000-0000-00000000000a'::UUID,'84777777-1111-0000-0000-000000000001'::UUID,'d0'),
  ('84400000-0000-0000-0000-00000000000b'::UUID,'84777777-1111-0000-0000-000000000001'::UUID,'d1'),
  ('84400000-0000-0000-0000-00000000000c'::UUID,'84777777-1111-0000-0000-000000000001'::UUID,'d2'),
  ('84400000-0000-0000-0000-00000000000d'::UUID,'84777777-1111-0000-0000-000000000001'::UUID,'dN'),
  ('84400000-0000-0000-0000-00000000000e'::UUID,'84777777-1111-0000-0000-000000000002'::UUID,'d1')
) AS w(id, class_id, key)
CROSS JOIN LATERAL (
  SELECT w.id, w.class_id,
         CASE w.key WHEN 'd0' THEN f.d0 WHEN 'd1' THEN f.d1
                    WHEN 'd2' THEN f.d2 ELSE f.dN END AS d
) v;

-- Tenant A seals last month; tenant B seals nothing.
INSERT INTO billing_periods (billing_month, tenant_id, invoices_issued)
SELECT f.m_seal, '84777777-0000-0000-0000-000000000001', 1 FROM f;

-- s1 was billed for d0's lesson — the invoice line is what excludes it.
INSERT INTO invoices (id, parent_id, billing_month, gross_amount, credit_applied,
                      net_amount, status, tenant_id, reference_number, public_token)
SELECT '84600000-0000-0000-0000-000000000001',
       (SELECT id FROM parents WHERE profile_id = '84100000-0000-0000-0000-000000000091'),
       f.m_seal, 30, 0, 30, 'outstanding',
       '84777777-0000-0000-0000-000000000001', 'INV-8400-0001', 'wv4-test-token-0001'
FROM f;

INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id,
                           attendance_status, amount, class_title, session_date)
SELECT '84600000-0000-0000-0000-000000000001',
       '84500000-0000-0000-0000-000000000001',
       '84400000-0000-0000-0000-00000000000a', 'present', 30, 'WV4 Class A', f.d0
FROM f;

-- Attendance. Every combination one WHERE clause must include or exclude:
--   s1: d0 present (BILLED — excluded), d1 present (orphan)
--   s2: d0 absent (non-billable), d1+d2 present (orphans), dN present (unsealed)
--   s3: d1 trial_paid (billable kind #2 — orphan)
--   s4: d1 present, tenant B (no seal — excluded)
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('84400000-0000-0000-0000-00000000000a','84500000-0000-0000-0000-000000000001','present','84100000-0000-0000-0000-0000000000c1'),
  ('84400000-0000-0000-0000-00000000000b','84500000-0000-0000-0000-000000000001','present','84100000-0000-0000-0000-0000000000c1'),
  ('84400000-0000-0000-0000-00000000000a','84500000-0000-0000-0000-000000000002','absent','84100000-0000-0000-0000-0000000000c1'),
  ('84400000-0000-0000-0000-00000000000b','84500000-0000-0000-0000-000000000002','present','84100000-0000-0000-0000-0000000000c1'),
  ('84400000-0000-0000-0000-00000000000c','84500000-0000-0000-0000-000000000002','present','84100000-0000-0000-0000-0000000000c1'),
  ('84400000-0000-0000-0000-00000000000d','84500000-0000-0000-0000-000000000002','present','84100000-0000-0000-0000-0000000000c1'),
  ('84400000-0000-0000-0000-00000000000b','84500000-0000-0000-0000-000000000003','trial_paid','84100000-0000-0000-0000-0000000000c1'),
  ('84400000-0000-0000-0000-00000000000e','84500000-0000-0000-0000-000000000004','present','84100000-0000-0000-0000-0000000000c2');

-- ── 1–2. The grant surface (§7.87): authenticated yes, anon never ───────────
SELECT ok(
  has_function_privilege('authenticated','public.unbilled_sealed_lessons(uuid)','EXECUTE'),
  'authenticated holds EXECUTE on unbilled_sealed_lessons');
SELECT ok(
  NOT has_function_privilege('anon','public.unbilled_sealed_lessons(uuid)','EXECUTE'),
  'anon holds no EXECUTE on unbilled_sealed_lessons');

-- ── 3–4. Authorisation: a coach and another business''s admin are refused ───
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"84100000-0000-0000-0000-0000000000c1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001') $$,
  'not authorised to read this business''s billing reports',
  'a coach cannot read the orphan-lesson report');

SET LOCAL "request.jwt.claims" TO '{"sub":"84100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT * FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001') $$,
  'not authorised to read this business''s billing reports',
  'another business''s admin cannot read tenant A''s report');

-- ── 5–11. The report, as tenant A's admin ───────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"84100000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT is(
  (SELECT count(*) FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001'))::int,
  3, 'three students have orphan lessons — billed absent + unsealed rows never appear');

SELECT is(
  (SELECT lessons FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001')
    WHERE student_id = '84500000-0000-0000-0000-000000000002'),
  2::bigint, 's2: two orphan lessons — the absent d0 and the unsealed dN both excluded');

SELECT is(
  (SELECT earliest_session_date FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001')
    WHERE student_id = '84500000-0000-0000-0000-000000000002'),
  (SELECT d1 FROM f), 's2: earliest orphan is d1');

SELECT is(
  (SELECT latest_session_date FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001')
    WHERE student_id = '84500000-0000-0000-0000-000000000002'),
  (SELECT d2 FROM f), 's2: latest orphan is d2');

SELECT is(
  (SELECT lessons FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001')
    WHERE student_id = '84500000-0000-0000-0000-000000000001'),
  1::bigint,
  's1 (billed for d0): only the extra d1 lesson reports — invoice_items matches per (student, lesson), not per invoice');

SELECT is(
  (SELECT lessons FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001')
    WHERE student_id = '84500000-0000-0000-0000-000000000003'),
  1::bigint, 's3: trial_paid is billable and reports');

SELECT is(
  (SELECT DISTINCT billing_month FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001')),
  (SELECT m_seal FROM f), 'every line names the sealed month it sits in');

-- ── 12. Tenant B, nothing sealed: an empty report, not an error ─────────────
SET LOCAL "request.jwt.claims" TO '{"sub":"84100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT is(
  (SELECT count(*) FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000002'))::int,
  0, 'a business that has sealed nothing has no orphans — s4''s lesson holds its month open instead');

-- ── 13–18. Settlement clears the line, partially, and reversal restores it ──
RESET ROLE;
INSERT INTO student_settlements (id, tenant_id, student_id, settled_through,
                                 kind, amount, recorded_by)
SELECT '84700000-0000-0000-0000-000000000001',
       '84777777-0000-0000-0000-000000000001',
       '84500000-0000-0000-0000-000000000002', f.d2, 'paid_outside', 60,
       '84100000-0000-0000-0000-0000000000a1'
FROM f;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"84100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is(
  (SELECT count(*) FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001')
    WHERE student_id = '84500000-0000-0000-0000-000000000002')::int,
  0, 'a settlement through d2 clears s2''s line entirely');
SELECT is(
  (SELECT count(*) FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001'))::int,
  2, 'the other students'' lines survive s2''s settlement');

RESET ROLE;
UPDATE student_settlements
   SET settled_through = (SELECT d1 FROM f)
 WHERE id = '84700000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"84100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is(
  (SELECT lessons FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001')
    WHERE student_id = '84500000-0000-0000-0000-000000000002'),
  1::bigint, 'a settlement through d1 is PARTIAL: d2''s lesson still reports (effective-dating, §8.15 idiom)');
SELECT is(
  (SELECT earliest_session_date FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001')
    WHERE student_id = '84500000-0000-0000-0000-000000000002'),
  (SELECT d2 FROM f), 'the surviving orphan is d2, not d1');

RESET ROLE;
UPDATE student_settlements
   SET settled_through = (SELECT d2 FROM f),
       reversed_at = now(), reversed_by = '84100000-0000-0000-0000-0000000000a1'
 WHERE id = '84700000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"84100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is(
  (SELECT lessons FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001')
    WHERE student_id = '84500000-0000-0000-0000-000000000002'),
  2::bigint, 'a REVERSED settlement stops covering: both orphans return');
SELECT is(
  (SELECT count(*) FROM unbilled_sealed_lessons('84777777-0000-0000-0000-000000000001'))::int,
  3, 'the report is back to three lines after the reversal');

SELECT * FROM finish();
ROLLBACK;
