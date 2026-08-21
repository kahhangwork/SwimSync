-- pgTAP: an ADVANCE-CANCELLED lesson extends the covering prepaid package by the
-- tenant's holiday_extension_days (20260821000800), the twin of the public-holiday
-- extension (20260818000700). Cancel adds, restore retracts, deduped per (package,
-- date), reversal reads applied_days from state, config 0 writes nothing, no
-- cascade past the nominal window — and, the coverage decision, NO enrolment
-- trigger, so a family that joins AFTER a cancel is never retro-extended.
--
-- DATES ARE RELATIVE TO today_sg() (§7.7, §7.33): cancel refuses today/past, so
-- every cancelled date is a FUTURE lesson day, and it must fall inside the
-- package's NOMINAL window for coverage — so the package starts today, 10 weeks
-- (nominal end today+70). Class A runs on TODAY's weekday, so today+7/+14/+21/+28
-- are all lesson days; Class Z runs on tomorrow's, and today+8 is its lesson day.
--
-- MEASURED (§7.25): against the schema at 20260821000700 this file dies at the
-- baseline (parent_packages.cancel_extension_days does not exist). With the column
-- + state table but WITHOUT apply_cancel_reconcile wired into the trigger,
-- assertion 2 goes red (a cancel changes nothing). With apply_holiday_reconcile
-- NOT passing pp.cancel_extension_days, assertion 5 (coexistence) goes red — the
-- holiday reconcile clobbers the cancel extension out of expires_on.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(17);

-- ── Fixture ─────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, slug, display_name, join_code, holiday_extension_days) VALUES
  ('ca000000-0000-0000-0000-000000000001','cpx','Cancel Ext','SWIM-CPX1', 7);

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','ca100000-0000-0000-0000-000000000001',
   'authenticated','authenticated','cpx-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"CPX Admin","role":"tenant_admin","is_coach":true,"tenant_id":"ca000000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ca200000-0000-0000-0000-000000000001',
   'authenticated','authenticated','cpx-parent1@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"CPX Parent1","role":"parent"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ca200000-0000-0000-0000-000000000002',
   'authenticated','authenticated','cpx-parent2@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"CPX Parent2","role":"parent"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','ca200000-0000-0000-0000-000000000003',
   'authenticated','authenticated','cpx-parent3@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}','{"full_name":"CPX Parent3","role":"parent"}',
   now(), now(), '','','','');

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'ca000000-0000-0000-0000-000000000001'
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
WHERE pr.email IN ('cpx-parent1@test.local','cpx-parent2@test.local','cpx-parent3@test.local');

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('ca300000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','G');

-- Class A on TODAY's weekday; Class Z on TOMORROW's. 00:00–00:01 times mirror the
-- sibling advance-cancel file (badge logic is irrelevant to this file).
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time,
                     location_name, price_per_lesson, category_id)
SELECT x.id, co.id, x.title, x.dow::day_of_week, '00:00', '00:01', 'Pool', 50.00,
       'ca300000-0000-0000-0000-000000000001'
FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
CROSS JOIN (VALUES
  ('ca400000-0000-0000-0000-00000000000a'::uuid, 'Class A',
   (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[EXTRACT(DOW FROM today_sg())::int + 1]),
  -- Class A2 also runs TODAY's weekday: a SECOND lesson on the same dates, used to
  -- prove an unrelated same-date cancel does not perturb Class A's snapshot (§ finding 1).
  ('ca400000-0000-0000-0000-00000000000c'::uuid, 'Class A2',
   (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[EXTRACT(DOW FROM today_sg())::int + 1]),
  ('ca400000-0000-0000-0000-00000000000f'::uuid, 'Class Z',
   (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[EXTRACT(DOW FROM today_sg() + 1)::int + 1])
) AS x(id, title, dow)
WHERE pr.email = 'cpx-admin@test.local';

-- Parent1's two siblings, both enrolled in Class A from today (the dedup case).
-- Parent2's one child, NOT enrolled anywhere yet (the snapshot case).
INSERT INTO students (id, full_name, date_of_birth, assignment_status, tenant_id, created_by) VALUES
  ('ca500000-0000-0000-0000-0000000000a1','CPX Kid1a','2018-05-05','assigned',
   'ca000000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001'),
  ('ca500000-0000-0000-0000-0000000000a2','CPX Kid1b','2019-06-06','assigned',
   'ca000000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001'),
  ('ca500000-0000-0000-0000-0000000000b1','CPX Kid2','2019-07-07','assigned',
   'ca000000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001'),
  ('ca500000-0000-0000-0000-0000000000c1','CPX Kid3','2019-08-08','assigned',
   'ca000000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, m.sid
FROM parents p JOIN profiles pr ON pr.id = p.profile_id
JOIN (VALUES
  ('cpx-parent1@test.local','ca500000-0000-0000-0000-0000000000a1'::uuid),
  ('cpx-parent1@test.local','ca500000-0000-0000-0000-0000000000a2'::uuid),
  ('cpx-parent2@test.local','ca500000-0000-0000-0000-0000000000b1'::uuid),
  ('cpx-parent3@test.local','ca500000-0000-0000-0000-0000000000c1'::uuid)
) AS m(email, sid) ON m.email = pr.email;

-- Kid1a/Kid1b in Class A from today. Kid3 in Class A too, but its package is
-- PENDING (the late-activation case). Kid2 is enrolled nowhere yet (snapshot case).
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at) VALUES
  ('ca500000-0000-0000-0000-0000000000a1','ca400000-0000-0000-0000-00000000000a', true, today_sg()),
  ('ca500000-0000-0000-0000-0000000000a2','ca400000-0000-0000-0000-00000000000a', true, today_sg()),
  ('ca500000-0000-0000-0000-0000000000c1','ca400000-0000-0000-0000-00000000000a', true, today_sg());

-- All-classes (category NULL) products, 10 weeks. P1/P2 active, start today, so
-- their nominal window is [today, today+70). P3 is PENDING (not yet confirmed).
INSERT INTO package_products (id, tenant_id, name, lesson_count, rate_per_lesson, validity_weeks) VALUES
  ('ca600000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001','P1 20', 20, 30.00, 10),
  ('ca600000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000001','P2 20', 20, 30.00, 10),
  ('ca600000-0000-0000-0000-000000000003','ca000000-0000-0000-0000-000000000001','P3 20', 20, 30.00, 10);
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, start_date)
SELECT 'ca700000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000001',
       p.id,'ca600000-0000-0000-0000-000000000001','active', today_sg()
FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='cpx-parent1@test.local';
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, start_date)
SELECT 'ca700000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000001',
       p.id,'ca600000-0000-0000-0000-000000000002','active', today_sg()
FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='cpx-parent2@test.local';
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status)
SELECT 'ca700000-0000-0000-0000-000000000003','ca000000-0000-0000-0000-000000000001',
       p.id,'ca600000-0000-0000-0000-000000000003','pending'
FROM parents p JOIN profiles pr ON pr.id=p.profile_id WHERE pr.email='cpx-parent3@test.local';

-- Shorthands for the admin's JWT context.
-- (each SET LOCAL below re-asserts the claim after a RESET ROLE.)

-- ── 1. Baseline: no cancels ⇒ expiry is the nominal end, accumulator 0 ────────
SELECT is(
  (SELECT expires_on::text || '/' || cancel_extension_days::text
     FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000001'),
  (today_sg() + 70)::text || '/0',
  '1. baseline P1: expiry is the nominal end, cancel accumulator 0');

-- ── 2-4. Cancel today+7 ⇒ +7, deduped across the two siblings to ONE row ─────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT isnt(cancel_lesson('ca400000-0000-0000-0000-00000000000a', today_sg() + 7, 'rain'),
  NULL, '2-pre. admin cancels today+7');
RESET ROLE;
SELECT is((SELECT cancel_extension_days FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000001'),
  7, '2. a cancel covered by the package ⇒ +7 days');
SELECT is((SELECT expires_on FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000001'),
  today_sg() + 77, '3. expiry pushed 7 days');
SELECT is((SELECT count(*)::int FROM package_cancel_extensions WHERE parent_package_id='ca700000-0000-0000-0000-000000000001'),
  1, '4. two siblings sharing one package on ONE cancelled lesson ⇒ exactly ONE state row (dedup per lesson)');

-- ── 5. COEXISTENCE: a holiday on another covered date SUMS, never clobbers ────
-- Mark today+14 a holiday: holiday_extension_days becomes 7, and the holiday
-- reconcile must preserve the +7 cancel extension already in expires_on.
INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
VALUES ('ca000000-0000-0000-0000-000000000001', today_sg() + 14, 'CPX Holiday');
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT mark_day_holiday('ca000000-0000-0000-0000-000000000001', today_sg() + 14);
RESET ROLE;
SELECT is(
  (SELECT holiday_extension_days::text || '/' || cancel_extension_days::text || '/' || expires_on::text
     FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000001'),
  '7/7/' || (today_sg() + 84)::text,
  '5. holiday (+7) and cancel (+7) SUM in expires_on — neither reconcile clobbers the other');

-- ── 6. A second distinct cancelled date accumulates (+7 more = 14) ───────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT cancel_lesson('ca400000-0000-0000-0000-00000000000a', today_sg() + 21, 'coach away');
RESET ROLE;
SELECT is((SELECT cancel_extension_days FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000001'),
  14, '6. a second distinct cancelled date ⇒ +7 more (per-date accumulation)');

-- ── 7. NO CASCADE: a cancel OUTSIDE the nominal window draws no package ───────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT cancel_lesson('ca400000-0000-0000-0000-00000000000a', today_sg() + 77, 'rain');  -- >= today+70
RESET ROLE;
SELECT is((SELECT cancel_extension_days FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000001'),
  14, '7. a cancel after the nominal end extends nothing (no cascade)');

-- ── 8. REVERSAL is exact: restore today+21 ⇒ back to 7 ───────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT restore_lesson('ca400000-0000-0000-0000-00000000000a', today_sg() + 21);
RESET ROLE;
SELECT is((SELECT cancel_extension_days::text || '/' || expires_on::text
             FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000001'),
  '7/' || (today_sg() + 84)::text, '8. restoring a cancelled lesson retracts exactly its days (holiday +7 remains)');

-- ── 9. CONFIGURABLE: raise to 10, a NEW cancel adds 10 ───────────────────────
UPDATE tenants SET holiday_extension_days = 10 WHERE id='ca000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT cancel_lesson('ca400000-0000-0000-0000-00000000000a', today_sg() + 28, 'rain');
RESET ROLE;
SELECT is((SELECT cancel_extension_days FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000001'),
  17, '9. a new cancel uses the CURRENT setting (7 already applied + 10 = 17)');

-- ── 10. RISK-3 reversal reads applied_days from STATE, not the live setting ──
-- The today+7 row was applied at 7. Set the tenant to 0, restore today+7: it must
-- remove exactly 7 (the stored value), never the current 0, never a re-derivation.
UPDATE tenants SET holiday_extension_days = 0 WHERE id='ca000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT restore_lesson('ca400000-0000-0000-0000-00000000000a', today_sg() + 7);
RESET ROLE;
SELECT is((SELECT cancel_extension_days FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000001'),
  10, '10. restoring a row applied at 7 removes 7 even after the setting changed to 0');

-- ── 11. CONFIG 0 writes no state row ─────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT cancel_lesson('ca400000-0000-0000-0000-00000000000a', today_sg() + 35, 'rain');
RESET ROLE;
SELECT is(
  (SELECT cancel_extension_days FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000001')::text
  || '/' ||
  (SELECT count(*)::text FROM package_cancel_extensions
     WHERE parent_package_id='ca700000-0000-0000-0000-000000000001' AND session_date = today_sg() + 35),
  '10/0', '11. a cancel under a 0-day setting extends nothing and writes no state row');

-- ── 12-13. SNAPSHOT (the coverage decision): a LATE joiner is not retro-extended
-- Restore the setting to 7. Cancel Class Z today+8 while Kid2 is NOT enrolled ⇒
-- P2 gets nothing. Then enrol Kid2 (covering that date): with NO enrolment
-- trigger, P2 stays at 0 — the family joined after the cancel and is not owed it.
UPDATE tenants SET holiday_extension_days = 7 WHERE id='ca000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT cancel_lesson('ca400000-0000-0000-0000-00000000000f', today_sg() + 8, 'rain');
RESET ROLE;
SELECT is((SELECT cancel_extension_days FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000002'),
  0, '12. cancelling a lesson with NO covered enrolment extends nothing');

INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
VALUES ('ca500000-0000-0000-0000-0000000000b1','ca400000-0000-0000-0000-00000000000f', true, today_sg());
SELECT is((SELECT cancel_extension_days FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000002'),
  0, '13. a family enrolling AFTER the cancel is NOT retro-extended (snapshot — no enrolment trigger)');

-- ── 14. FINDING 1: an unrelated same-date cancel does not perturb another
-- lesson's snapshot. Enrol Kid2 (P2) LATE into Class A, whose today+28 lesson was
-- cancelled back in test 9. Then cancel Class A2's today+28 lesson (Kid2 is NOT in
-- A2). A per-DATE reconcile would reprocess Class A against the now-later
-- enrolment and retro-extend P2; the per-LESSON reconcile touches only A2, so P2
-- stays 0. (This is the red-first assertion for the snapshot redesign.)
INSERT INTO student_class_enrolments (student_id, class_id, is_active, enrolled_at)
VALUES ('ca500000-0000-0000-0000-0000000000b1','ca400000-0000-0000-0000-00000000000a', true, today_sg());
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT cancel_lesson('ca400000-0000-0000-0000-00000000000c', today_sg() + 28, 'rain');
RESET ROLE;
SELECT is((SELECT cancel_extension_days FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000002'),
  0, '14. FINDING 1: an unrelated same-date cancel does NOT retro-extend a late joiner in another already-cancelled class');

-- ── 15. DELETE arm: a raw delete of a cancelled session retracts its days.
-- P1's only cancel row is (Class A, today+28)=10. sessions_write is FOR ALL and
-- guard_session_date does not fire on DELETE, so a raw delete is reachable; the
-- AFTER DELETE trigger must retract or the +10 strands forever.
DELETE FROM lesson_sessions
 WHERE class_id = 'ca400000-0000-0000-0000-00000000000a' AND session_date = today_sg() + 28;
SELECT is((SELECT cancel_extension_days FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000001'),
  0, '15. deleting a cancelled session raw retracts its extension (the DELETE arm)');

-- ── 16. LATE ACTIVATION is NOT retro-extended (documented snapshot decision).
-- P3 is PENDING; Kid3 is enrolled in Class A. Cancel Class A today+42: P3 draws no
-- extension (holiday_covering_package resolves active packages only). Confirm P3
-- afterwards — nothing re-fires the lesson's reconcile, so P3 gets nothing.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"ca100000-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT cancel_lesson('ca400000-0000-0000-0000-00000000000a', today_sg() + 42, 'rain');
RESET ROLE;
UPDATE parent_packages SET status = 'active' WHERE id = 'ca700000-0000-0000-0000-000000000003';
SELECT is((SELECT cancel_extension_days FROM parent_packages WHERE id='ca700000-0000-0000-0000-000000000003'),
  0, '16. a package activated AFTER a cancel is NOT retro-extended (snapshot excludes late activation)');

SELECT * FROM finish();
ROLLBACK;
