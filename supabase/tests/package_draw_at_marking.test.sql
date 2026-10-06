-- pgTAP: PACKAGE LESSONS DRAW AT MARKING — Wave 6, migration A (20261006000100).
-- docs/plans/WAVE6_PACKAGE_DRAW_AT_MARKING_PLAN.md (reviewed; decisions D1–D7 are the user's).
--
-- WHAT THIS FILE PROTECTS.
--   (1) the switch: off → nothing draws; it is refused to a client (RISK 1/7);
--   (2) draw / return / re-draw on a REAL crossing only — an unchanged re-upsert writes nothing (§7.323, D4);
--   (3) a lesson is funded at most once — invoiced never drawn; drawn never invoiced (PK002); one live draw (RISK 1);
--   (4) the matcher: FIFO by expiry, category (make-up snapshot), window, exhaustion, settlement, family, tenant;
--   (5) the D6 guard (PK001): siblings counted as the coach, absent never blocked, re-save allowed, below-floor,
--       deactivated and cancelled lessons not counted, FAILS OPEN (§7.324);
--   (6) returns: on delete, on a holiday void, onto a cancelled package; un-voiding still works (CASCADE);
--   (7) backlog preview = backlog draw, idempotent, refused while the switch is off (D5, RISK 8);
--   (8) readers: live = stored when on; unbilled_sealed_lessons excludes a drawn lesson; month funding counts;
--   (9) package_usage caller shapes; grants (§7.87); FK delete actions (§7.327).
--
-- FIXTURE (prefix f6…). Tenant T (switch flipped ON in case 2), tenant T2 (switch OFF). T created 200 days
-- ago and never billed, so its floor is its creation date (§7.319) and every dN below is markable. Classes run
-- on TODAY's weekday; dN = N days ago. Families: P (Ava, Ben), Q (Cai), R (Dee, Eli), S (Fay), B (Gus).

BEGIN;
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(62);
SELECT is(app_today(), '2026-09-15'::date, 'clock pinned');

-- Wave 7: literals = the former derivation evaluated at the pinned clock (2026-09-15 10:00+08).
CREATE TEMP TABLE f AS
SELECT
  '2026-09-15'::date AS d0,
  '2026-09-08'::date AS d7,
  '2026-09-01'::date AS d14,
  '2026-08-25'::date AS d21,
  '2026-08-18'::date AS d28,
  '2026-08-11'::date AS d35,
  '2026-08-04'::date AS d42,
  '2026-07-28'::date AS d49,
  '2026-08-01'::date AS sws,
  'tuesday'::text    AS dow;
-- X: the latest class day BEFORE session_window_start() (so in the month before it); Y = X + 7 (≥ sws).
ALTER TABLE f ADD COLUMN x DATE;
UPDATE f SET x = sws - 1 - ((EXTRACT(DOW FROM sws - 1)::int - EXTRACT(DOW FROM d0)::int + 7) % 7);
GRANT SELECT ON f TO PUBLIC;

-- The switch is set EXPLICITLY (off): since migration B the column DEFAULT is on.
INSERT INTO tenants (id, slug, display_name, join_code, created_at, package_draw_at_marking) VALUES
  ('f6000000-0000-0000-0000-0000000000a0','w6-t','W6 T','SWIM-W6TT', app_now() - INTERVAL '200 days', FALSE),
  ('f6000000-0000-0000-0000-0000000000b0','w6-t2','W6 T2','SWIM-W6T2', app_now() - INTERVAL '200 days', FALSE);

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;

SELECT pg_temp.mkuser('f6100000-0000-0000-0000-0000000000a1','w6-owner@test.local',
  '{"full_name":"W6 Owner","role":"tenant_admin","tenant_id":"f6000000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('f6100000-0000-0000-0000-0000000000b1','w6-owner2@test.local',
  '{"full_name":"W6 Owner2","role":"tenant_admin","tenant_id":"f6000000-0000-0000-0000-0000000000b0"}');
SELECT pg_temp.mkuser('f6100000-0000-0000-0000-0000000000c1','w6-coach1@test.local',
  '{"full_name":"W6 Coach1","role":"coach","tenant_id":"f6000000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('f6100000-0000-0000-0000-0000000000c2','w6-coach2@test.local',
  '{"full_name":"W6 Coach2","role":"coach","tenant_id":"f6000000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('f6100000-0000-0000-0000-0000000000e1','w6-frontdesk@test.local',
  jsonb_build_object('role','tenant_admin','tenant_id','f6000000-0000-0000-0000-0000000000a0','admin_role_id',
    (SELECT id FROM tenant_roles WHERE tenant_id='f6000000-0000-0000-0000-0000000000a0' AND standard_key='front_desk')));
SELECT pg_temp.mkuser(('f6100000-0000-0000-0000-0000000000d' || n)::uuid, 'w6-parent' || n || '@test.local',
  jsonb_build_object('full_name','W6 Parent ' || n,'role','parent'))
  FROM generate_series(1, 5) n;
UPDATE tenants SET owner_profile_id = 'f6100000-0000-0000-0000-0000000000a1' WHERE id = 'f6000000-0000-0000-0000-0000000000a0';
UPDATE tenants SET owner_profile_id = 'f6100000-0000-0000-0000-0000000000b1' WHERE id = 'f6000000-0000-0000-0000-0000000000b0';

-- Named ids, readable as `authenticated` too.
CREATE TEMP TABLE ids (k TEXT PRIMARY KEY, v UUID);
GRANT SELECT ON ids TO PUBLIC;
INSERT INTO ids
SELECT 'P' || n, p.id FROM generate_series(1, 5) n
  JOIN profiles pr ON pr.email = 'w6-parent' || n || '@test.local'
  JOIN parents p ON p.profile_id = pr.id;
INSERT INTO ids SELECT 'coach1', id FROM coaches WHERE profile_id = 'f6100000-0000-0000-0000-0000000000c1';
INSERT INTO ids SELECT 'coach2', id FROM coaches WHERE profile_id = 'f6100000-0000-0000-0000-0000000000c2';
CREATE OR REPLACE FUNCTION pg_temp.id(p_k TEXT) RETURNS UUID AS $$ SELECT v FROM ids WHERE k = p_k $$ LANGUAGE sql STABLE;

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT pg_temp.id('P' || n), 'f6000000-0000-0000-0000-0000000000a0' FROM generate_series(1, 5) n;
INSERT INTO parent_tenants (parent_id, tenant_id) VALUES (pg_temp.id('P1'), 'f6000000-0000-0000-0000-0000000000b0');

INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('f6400000-0000-0000-0000-000000000001','f6000000-0000-0000-0000-0000000000a0','W6 Group'),
  ('f6400000-0000-0000-0000-000000000002','f6000000-0000-0000-0000-0000000000a0','W6 Private'),
  ('f6400000-0000-0000-0000-000000000003','f6000000-0000-0000-0000-0000000000b0','W6 Group2');
INSERT INTO locations (id, tenant_id, name) VALUES
  ('f6800000-0000-0000-0000-000000000001','f6000000-0000-0000-0000-0000000000a0','W6 Pool');

INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT v.id, 'f6000000-0000-0000-0000-0000000000a0', pg_temp.id(v.coach), v.title, (SELECT dow FROM f)::day_of_week,
       v.st, v.et, 'f6800000-0000-0000-0000-000000000001', 30.00, v.cat
  FROM (VALUES
    ('f6500000-0000-0000-0000-000000000001'::uuid,'coach1','W6 Dolphins','09:00'::time,'10:00'::time,'f6400000-0000-0000-0000-000000000001'::uuid),
    ('f6500000-0000-0000-0000-000000000002'::uuid,'coach1','W6 Private','10:00'::time,'11:00'::time,'f6400000-0000-0000-0000-000000000002'::uuid),
    ('f6500000-0000-0000-0000-000000000003'::uuid,'coach2','W6 Sharks','13:00'::time,'14:00'::time,'f6400000-0000-0000-0000-000000000001'::uuid),
    ('f6500000-0000-0000-0000-000000000004'::uuid,'coach1','W6 Retired','11:00'::time,'12:00'::time,'f6400000-0000-0000-0000-000000000001'::uuid)
  ) v(id, coach, title, st, et, cat);
-- W6 Retired was deactivated 45 days ago: none of its later dates may count for the guard.
UPDATE classes SET is_active = FALSE, deactivated_at = app_now() - INTERVAL '45 days'
 WHERE id = 'f6500000-0000-0000-0000-000000000004';

INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id) VALUES
  ('f6300000-0000-0000-0000-000000000001','W6 Ava','assigned',TRUE,'f6000000-0000-0000-0000-0000000000a0'),
  ('f6300000-0000-0000-0000-000000000002','W6 Ben','assigned',TRUE,'f6000000-0000-0000-0000-0000000000a0'),
  ('f6300000-0000-0000-0000-000000000003','W6 Cai','assigned',TRUE,'f6000000-0000-0000-0000-0000000000a0'),
  ('f6300000-0000-0000-0000-000000000004','W6 Dee','assigned',TRUE,'f6000000-0000-0000-0000-0000000000a0'),
  ('f6300000-0000-0000-0000-000000000005','W6 Eli','assigned',TRUE,'f6000000-0000-0000-0000-0000000000a0'),
  ('f6300000-0000-0000-0000-000000000006','W6 Fay','assigned',TRUE,'f6000000-0000-0000-0000-0000000000a0'),
  ('f6300000-0000-0000-0000-000000000007','W6 Gus','assigned',TRUE,'f6000000-0000-0000-0000-0000000000a0');
INSERT INTO parent_students (parent_id, student_id) VALUES
  (pg_temp.id('P1'),'f6300000-0000-0000-0000-000000000001'), (pg_temp.id('P1'),'f6300000-0000-0000-0000-000000000002'),
  (pg_temp.id('P2'),'f6300000-0000-0000-0000-000000000003'),
  (pg_temp.id('P3'),'f6300000-0000-0000-0000-000000000004'), (pg_temp.id('P3'),'f6300000-0000-0000-0000-000000000005'),
  (pg_temp.id('P4'),'f6300000-0000-0000-0000-000000000006'),
  (pg_temp.id('P5'),'f6300000-0000-0000-0000-000000000007');

-- Enrolments: Ava + Ben in Dolphins from d42; Ava also Private from d42. Cai/Dee/Eli/Fay in Dolphins from TODAY
-- (no earlier lessons). Gus in Dolphins from X. Noon SGT, so the SGT date is unambiguous.
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT s, c, (d::timestamp + TIME '12:00') AT TIME ZONE 'Asia/Singapore', TRUE
  FROM (VALUES
    ('f6300000-0000-0000-0000-000000000001'::uuid,'f6500000-0000-0000-0000-000000000001'::uuid,(SELECT d42 FROM f)),
    ('f6300000-0000-0000-0000-000000000002'::uuid,'f6500000-0000-0000-0000-000000000001'::uuid,(SELECT d42 FROM f)),
    ('f6300000-0000-0000-0000-000000000001'::uuid,'f6500000-0000-0000-0000-000000000002'::uuid,(SELECT d42 FROM f)),
    ('f6300000-0000-0000-0000-000000000003'::uuid,'f6500000-0000-0000-0000-000000000001'::uuid,(SELECT d0 FROM f)),
    ('f6300000-0000-0000-0000-000000000004'::uuid,'f6500000-0000-0000-0000-000000000001'::uuid,(SELECT d0 FROM f)),
    ('f6300000-0000-0000-0000-000000000005'::uuid,'f6500000-0000-0000-0000-000000000001'::uuid,(SELECT d0 FROM f)),
    ('f6300000-0000-0000-0000-000000000006'::uuid,'f6500000-0000-0000-0000-000000000001'::uuid,(SELECT d0 FROM f)),
    ('f6300000-0000-0000-0000-000000000007'::uuid,'f6500000-0000-0000-0000-000000000001'::uuid,(SELECT x FROM f))
  ) v(s, c, d);

-- Products: G3 = 3 Group @40; G2 = 2 Group @40; G1 = 1 Group @40; A5 = 5 any-class @30; T2A = T2's.
INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count, rate_per_lesson, validity_weeks) VALUES
  ('f6600000-0000-0000-0000-000000000001','f6000000-0000-0000-0000-0000000000a0','G3','f6400000-0000-0000-0000-000000000001',3,40.00,20),
  ('f6600000-0000-0000-0000-000000000002','f6000000-0000-0000-0000-0000000000a0','G2','f6400000-0000-0000-0000-000000000001',2,40.00,20),
  ('f6600000-0000-0000-0000-000000000003','f6000000-0000-0000-0000-0000000000a0','G1','f6400000-0000-0000-0000-000000000001',1,40.00,20),
  ('f6600000-0000-0000-0000-000000000004','f6000000-0000-0000-0000-0000000000a0','A5',NULL,5,30.00,20),
  ('f6600000-0000-0000-0000-000000000005','f6000000-0000-0000-0000-0000000000b0','T2A',NULL,5,30.00,20);

CREATE OR REPLACE FUNCTION pg_temp.sell(p_id UUID, p_parent TEXT, p_product UUID, p_start DATE) RETURNS VOID AS $$
  INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, start_date)
  SELECT p_id, pr.tenant_id, pg_temp.id(p_parent), p_product, 'active', p_start
    FROM package_products pr WHERE pr.id = p_product $$ LANGUAGE sql;
SELECT pg_temp.sell('f6700000-0000-0000-0000-000000000001','P1','f6600000-0000-0000-0000-000000000001',(SELECT d42 FROM f)); -- PK1 G3
SELECT pg_temp.sell('f6700000-0000-0000-0000-000000000009','P1','f6600000-0000-0000-0000-000000000005',(SELECT d49 FROM f)); -- T2 pkg

CREATE OR REPLACE FUNCTION pg_temp.s(p_class UUID, p_date DATE) RETURNS UUID AS $$
DECLARE v UUID;
BEGIN
  SELECT id INTO v FROM lesson_sessions WHERE class_id = p_class AND session_date = p_date;
  IF v IS NULL THEN
    INSERT INTO lesson_sessions (class_id, session_date, start_time, end_time)
    SELECT id, p_date, start_time, end_time FROM classes WHERE id = p_class RETURNING id INTO v;
  END IF;
  RETURN v;
END $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION pg_temp.mark(p_class UUID, p_date DATE, p_student UUID, p_status TEXT) RETURNS VOID AS $$
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
  VALUES (pg_temp.s(p_class, p_date), p_student, p_status::attendance_status, 'f6100000-0000-0000-0000-0000000000c1')
  ON CONFLICT (lesson_session_id, student_id) DO UPDATE SET status = EXCLUDED.status $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.live(p_class UUID, p_date DATE, p_student UUID) RETURNS INTEGER AS $$
  SELECT count(*)::int FROM package_applications pa JOIN lesson_sessions ls ON ls.id = pa.lesson_session_id
   WHERE ls.class_id = p_class AND ls.session_date = p_date AND pa.student_id = p_student AND pa.reversed_at IS NULL $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.apps(p_class UUID, p_date DATE, p_student UUID) RETURNS INTEGER AS $$
  SELECT count(*)::int FROM package_applications pa JOIN lesson_sessions ls ON ls.id = pa.lesson_session_id
   WHERE ls.class_id = p_class AND ls.session_date = p_date AND pa.student_id = p_student $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.rem(p_pkg UUID) RETURNS NUMERIC AS $$
  SELECT value_remaining FROM parent_packages WHERE id = p_pkg $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(TEXT), pg_temp.id(TEXT) TO authenticated;

-- ══ 1. Switch OFF → a present mark draws nothing ═══════════════════════════════════════════════════════════
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000001', 'present');
SELECT is(pg_temp.apps('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000001'),
  0, '1: switch off — a present mark writes no draw');

UPDATE tenants SET package_draw_at_marking = TRUE WHERE id = 'f6000000-0000-0000-0000-0000000000a0';

-- ══ 2. Present → absent writes nothing (nothing was drawn); as the COACH, absent → present draws ═════════════
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000001', 'absent');
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000c1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$
  UPDATE attendance SET status = 'present'
   WHERE student_id = 'f6300000-0000-0000-0000-000000000001'
     AND lesson_session_id = (SELECT id FROM lesson_sessions WHERE class_id = 'f6500000-0000-0000-0000-000000000001'
                                AND session_date = (SELECT d42 FROM f)) $$,
  '2: the coach marks present (the coach cannot write parent_packages)');
RESET ROLE;
SELECT is(pg_temp.rem('f6700000-0000-0000-0000-000000000001'), 80.00::numeric, '2b: ...and it drew one lesson at the locked rate (120 → 80)');
SELECT is((SELECT lesson_date FROM package_applications WHERE parent_package_id = 'f6700000-0000-0000-0000-000000000001'
            AND reversed_at IS NULL), (SELECT d42 FROM f), '2c: the draw snapshots the lesson date');

-- ══ 3. An unchanged re-upsert writes nothing (§7.323) ═══════════════════════════════════════════════════════
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000001', 'present');
SELECT is(pg_temp.apps('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000001')
          || '/' || pg_temp.rem('f6700000-0000-0000-0000-000000000001'),
  '1/80.00', '3: re-saving present unchanged writes no ledger row and moves no balance');

-- ══ 4–5. Return on flip, re-draw on re-mark (D4) ═══════════════════════════════════════════════════════════
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000001', 'absent');
SELECT is(pg_temp.live('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000001')
          || '/' || pg_temp.rem('f6700000-0000-0000-0000-000000000001'),
  '0/120.00', '4: present → absent returns the lesson to the package');
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000001', 'present');
SELECT is(pg_temp.apps('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000001')
          || '/' || pg_temp.live('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000001')
          || '/' || pg_temp.rem('f6700000-0000-0000-0000-000000000001'),
  '2/1/80.00', '5: absent → present draws AGAIN (a new row; the returned one stays as history)');

-- ══ 6–7. Funded at most once ═══════════════════════════════════════════════════════════════════════════════
SELECT throws_ok($$
  INSERT INTO package_applications (parent_package_id, amount, lesson_session_id, student_id, lesson_date)
  VALUES ('f6700000-0000-0000-0000-000000000001', 40, pg_temp.s('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f)),
          'f6300000-0000-0000-0000-000000000001', (SELECT d42 FROM f)) $$,
  '23505', NULL, '6: a second LIVE draw for the same lesson is refused by the unique index');
SELECT throws_ok($$
  INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
  VALUES (gen_random_uuid(), 'f6300000-0000-0000-0000-000000000001',
          pg_temp.s('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f)), 'present', 30, 'W6 Dolphins', (SELECT d42 FROM f)) $$,
  'PK002', NULL, '7: an invoice line for a drawn lesson is refused (PK002 backstop)');

-- ══ 8–9. An INVOICED lesson is never drawn, however it is flipped ═════════════════════════════════════════
INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount, net_amount, reference_number, public_token)
VALUES ('f6900000-0000-0000-0000-000000000001', pg_temp.id('P1'), 'f6000000-0000-0000-0000-0000000000a0',
        to_char((SELECT d42 FROM f), 'YYYY-MM'), 30, 30, 'INV-W6-0001', 'w6-token-0001');
INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
VALUES ('f6900000-0000-0000-0000-000000000001', 'f6300000-0000-0000-0000-000000000002',
        pg_temp.s('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f)), 'present', 30, 'W6 Dolphins', (SELECT d42 FROM f));
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000002', 'present');
SELECT is(pg_temp.apps('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000002'),
  0, '8: marking present a lesson that already has an invoice line draws nothing');
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000002', 'absent');
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000002', 'present');
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000002', 'absent');
SELECT is(pg_temp.apps('f6500000-0000-0000-0000-000000000001', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000002')
          || '/' || pg_temp.rem('f6700000-0000-0000-0000-000000000001'),
  '0/80.00', '9: an invoiced lesson flipped absent→present→absent writes no marking-time row (the credit-note path owns it)');

-- ══ 10–13. The matcher: category, window, trial_paid, make-up snapshot ═════════════════════════════════════
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000002', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000001', 'present');
SELECT is(pg_temp.apps('f6500000-0000-0000-0000-000000000002', (SELECT d42 FROM f), 'f6300000-0000-0000-0000-000000000001'),
  0, '10: a Private lesson does not draw a Group package (category scope)');
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d49 FROM f), 'f6300000-0000-0000-0000-000000000002', 'present');
SELECT is(pg_temp.apps('f6500000-0000-0000-0000-000000000001', (SELECT d49 FROM f), 'f6300000-0000-0000-0000-000000000002'),
  0, '11: a lesson before the package start date does not draw (window)');
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d35 FROM f), 'f6300000-0000-0000-0000-000000000001', 'trial_paid');
SELECT is(pg_temp.rem('f6700000-0000-0000-0000-000000000001'), 40.00::numeric, '12: trial_paid draws (engine parity)');
INSERT INTO makeup_bookings (tenant_id, student_id, class_id, session_date, category_id, home_class_id, booked_by)
VALUES ('f6000000-0000-0000-0000-0000000000a0', 'f6300000-0000-0000-0000-000000000002', 'f6500000-0000-0000-0000-000000000002',
        (SELECT d35 FROM f), 'f6400000-0000-0000-0000-000000000001', 'f6500000-0000-0000-0000-000000000001',
        'f6100000-0000-0000-0000-0000000000a1');
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000002', (SELECT d35 FROM f), 'f6300000-0000-0000-0000-000000000002', 'present');
SELECT is(pg_temp.live('f6500000-0000-0000-0000-000000000002', (SELECT d35 FROM f), 'f6300000-0000-0000-0000-000000000002'),
  1, '13: a make-up in a Private class draws the Group package by the booking''s category snapshot');

-- ══ 14. Exhaustion → ad-hoc; another tenant's package is never touched ═════════════════════════════════════
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d35 FROM f), 'f6300000-0000-0000-0000-000000000002', 'present');
SELECT is(pg_temp.apps('f6500000-0000-0000-0000-000000000001', (SELECT d35 FROM f), 'f6300000-0000-0000-0000-000000000002')
          || '/' || pg_temp.rem('f6700000-0000-0000-0000-000000000009'),
  '0/150.00', '14: an exhausted package draws nothing (ad-hoc), and the family''s OTHER business''s package is untouched');

-- ══ 15–20. The D6 guard ════════════════════════════════════════════════════════════════════════════════════
SELECT pg_temp.sell('f6700000-0000-0000-0000-000000000002','P1','f6600000-0000-0000-0000-000000000002',(SELECT d42 FROM f)); -- PK2 G2
-- Earlier unmarked Group lessons for the family: Dolphins d28 + d21 (Ava and Ben) = 4; PK2 has 2 left.
SELECT throws_ok($$ SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d14 FROM f),
                                        'f6300000-0000-0000-0000-000000000001', 'present') $$,
  'PK001',
  'Mark ' || to_char((SELECT d28 FROM f), 'FMDD Mon') || ' first — the package has 2 lessons left. (W6 Ava · W6 Dolphins) Nothing was saved.',
  '15: present on d14 with 4 earlier unmarked lessons and 2 left is refused, naming the earliest lesson');
SELECT lives_ok($$ SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d14 FROM f),
                                       'f6300000-0000-0000-0000-000000000001', 'absent') $$,
  '16: absent is never blocked');
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', d, k, 'absent')
  FROM f, LATERAL (VALUES (f.d28), (f.d21)) dd(d),
       LATERAL (VALUES ('f6300000-0000-0000-0000-000000000001'::uuid), ('f6300000-0000-0000-0000-000000000002'::uuid)) kk(k);
SELECT lives_ok($$ SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d14 FROM f),
                                       'f6300000-0000-0000-0000-000000000001', 'present') $$,
  '17: once the earlier lessons are marked, absent → present on d14 is allowed (the UPDATE path)');
SELECT is(pg_temp.rem('f6700000-0000-0000-0000-000000000002'), 40.00::numeric, '17b: ...and drew from PK2 (80 → 40)');

-- Ben joins Sharks (coach 2's class) from d42 → his Sharks lessons d42..d14 are unmarked. PK2 has 1 left.
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT 'f6300000-0000-0000-0000-000000000002', 'f6500000-0000-0000-0000-000000000003',
       ((SELECT d42 FROM f)::timestamp + TIME '12:00') AT TIME ZONE 'Asia/Singapore', TRUE;
SELECT pg_temp.s('f6500000-0000-0000-0000-000000000001', (SELECT d7 FROM f));
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000c1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
  VALUES ((SELECT id FROM lesson_sessions WHERE class_id = 'f6500000-0000-0000-0000-000000000001' AND session_date = (SELECT d7 FROM f)),
          'f6300000-0000-0000-0000-000000000001', 'present', 'f6100000-0000-0000-0000-0000000000c1') $$,
  'PK001',
  'Mark ' || to_char((SELECT d42 FROM f), 'FMDD Mon') || ' first — the package has 1 lesson left. (W6 Ben · W6 Sharks) Nothing was saved.',
  '18: as the COACH, a sibling''s unmarked lesson in ANOTHER coach''s class is counted');
RESET ROLE;

-- Clear Ben's Sharks lessons, then give the family only (a) Retired-class lessons after its deactivation and
-- (b) a make-up booked onto a CANCELLED Sharks lesson. Neither may count.
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000003', d, 'f6300000-0000-0000-0000-000000000002', 'absent')
  FROM f, LATERAL (VALUES (f.d42), (f.d35), (f.d28), (f.d21), (f.d14)) dd(d);
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active, unenrolled_at)
SELECT 'f6300000-0000-0000-0000-000000000002', 'f6500000-0000-0000-0000-000000000004',
       ((SELECT d49 FROM f)::timestamp + TIME '12:00') AT TIME ZONE 'Asia/Singapore', FALSE, NULL;
DELETE FROM attendance WHERE lesson_session_id = pg_temp.s('f6500000-0000-0000-0000-000000000003', (SELECT d14 FROM f));
UPDATE lesson_sessions SET status = 'cancelled', cancelled_at = app_now(), cancelled_by = 'f6100000-0000-0000-0000-0000000000a1', cancellation_reason = 'w6 test'
 WHERE id = pg_temp.s('f6500000-0000-0000-0000-000000000003', (SELECT d14 FROM f));
INSERT INTO makeup_bookings (tenant_id, student_id, class_id, session_date, category_id, home_class_id, booked_by)
VALUES ('f6000000-0000-0000-0000-0000000000a0', 'f6300000-0000-0000-0000-000000000002', 'f6500000-0000-0000-0000-000000000003',
        (SELECT d14 FROM f), 'f6400000-0000-0000-0000-000000000001', 'f6500000-0000-0000-0000-000000000001',
        'f6100000-0000-0000-0000-0000000000a1');
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d7 FROM f), 'f6300000-0000-0000-0000-000000000002', 'absent');
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d14 FROM f), 'f6300000-0000-0000-0000-000000000002', 'absent');
SELECT lives_ok($$ SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d7 FROM f),
                                       'f6300000-0000-0000-0000-000000000001', 'present') $$,
  '19: a deactivated class''s later dates and a cancelled lesson''s make-up are not counted');
SELECT is(pg_temp.rem('f6700000-0000-0000-0000-000000000002'), 0.00::numeric, '19b: ...and PK2''s last lesson was drawn');

-- Re-saving the drawn class unchanged with PK2 at 0 and earlier unmarked lessons existing is NOT refused.
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000003', (SELECT d21 FROM f), 'f6300000-0000-0000-0000-000000000002', 'absent');
DELETE FROM attendance WHERE student_id = 'f6300000-0000-0000-0000-000000000002'
   AND lesson_session_id = pg_temp.s('f6500000-0000-0000-0000-000000000003', (SELECT d21 FROM f));
SELECT lives_ok($$
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
  SELECT lesson_session_id, student_id, status, marked_by FROM attendance
   WHERE lesson_session_id = pg_temp.s('f6500000-0000-0000-0000-000000000001', (SELECT d7 FROM f))
  ON CONFLICT (lesson_session_id, student_id) DO UPDATE SET status = EXCLUDED.status $$,
  '20: re-saving a whole class unchanged is never refused');

-- ══ 21. Two siblings, one statement, one lesson left: both save, exactly one draws ═════════════════════════
SELECT pg_temp.sell('f6700000-0000-0000-0000-000000000003','P3','f6600000-0000-0000-0000-000000000003',(SELECT d42 FROM f)); -- PKR G1
SELECT lives_ok($$
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
  VALUES (pg_temp.s('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f)), 'f6300000-0000-0000-0000-000000000004', 'present', 'f6100000-0000-0000-0000-0000000000c1'),
         (pg_temp.s('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f)), 'f6300000-0000-0000-0000-000000000005', 'present', 'f6100000-0000-0000-0000-0000000000c1') $$,
  '21: two siblings marked present in one statement with one lesson left both save');
SELECT is((SELECT count(*)::int FROM package_applications WHERE parent_package_id = 'f6700000-0000-0000-0000-000000000003' AND reversed_at IS NULL)
          || '/' || pg_temp.rem('f6700000-0000-0000-0000-000000000003'),
  '1/0.00', '21b: ...and exactly one of them drew');

-- ══ 22. A live settlement covering the lesson blocks the draw; reversed, it draws ══════════════════════════
SELECT pg_temp.sell('f6700000-0000-0000-0000-000000000004','P4','f6600000-0000-0000-0000-000000000004',(SELECT d42 FROM f)); -- PKS A5
INSERT INTO student_settlements (id, tenant_id, student_id, settled_through, kind, amount, recorded_by)
VALUES ('f6a00000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-0000000000a0', 'f6300000-0000-0000-0000-000000000006',
        (SELECT d0 FROM f), 'paid_outside', 30, 'f6100000-0000-0000-0000-0000000000a1');
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f), 'f6300000-0000-0000-0000-000000000006', 'present');
SELECT is(pg_temp.apps('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f), 'f6300000-0000-0000-0000-000000000006'),
  0, '22: a lesson covered by a live settlement is not drawn');
UPDATE student_settlements SET reversed_at = app_now(), reversed_by = 'f6100000-0000-0000-0000-0000000000a1' WHERE id = 'f6a00000-0000-0000-0000-000000000001';
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f), 'f6300000-0000-0000-0000-000000000006', 'absent');
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f), 'f6300000-0000-0000-0000-000000000006', 'present');
SELECT is(pg_temp.live('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f), 'f6300000-0000-0000-0000-000000000006'),
  1, '22b: ...reversed, the re-mark draws');

-- ══ 23. FIFO by expiry ════════════════════════════════════════════════════════════════════════════════════
-- Family Q holds A5 from d42 and G3 from d42 whose 20 weeks run the same; a second A5 starting d49 expires a week
-- EARLIER than one starting d42 — it must be drawn first.
SELECT pg_temp.sell('f6700000-0000-0000-0000-000000000005','P2','f6600000-0000-0000-0000-000000000004',(SELECT d42 FROM f));
SELECT pg_temp.sell('f6700000-0000-0000-0000-000000000006','P2','f6600000-0000-0000-0000-000000000004',(SELECT d49 FROM f));
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f), 'f6300000-0000-0000-0000-000000000003', 'present');
SELECT is((SELECT parent_package_id FROM package_applications pa
            WHERE pa.student_id = 'f6300000-0000-0000-0000-000000000003' AND pa.reversed_at IS NULL),
  'f6700000-0000-0000-0000-000000000006'::uuid, '23: the earliest-EXPIRING package draws first');

-- ══ 24–26. Returns: delete, onto a cancelled package, holiday void; un-voiding still works ═════════════════
DELETE FROM attendance WHERE student_id = 'f6300000-0000-0000-0000-000000000003'
   AND lesson_session_id = pg_temp.s('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f));
SELECT is(pg_temp.rem('f6700000-0000-0000-0000-000000000006'), 150.00::numeric, '24: deleting a drawn mark returns it');
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f), 'f6300000-0000-0000-0000-000000000003', 'present');
UPDATE parent_packages SET status = 'cancelled' WHERE id = 'f6700000-0000-0000-0000-000000000006';
INSERT INTO tenant_public_holidays (tenant_id, holiday_date, name)
VALUES ('f6000000-0000-0000-0000-0000000000a0', (SELECT d0 FROM f), 'W6 Day');
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT mark_day_holiday('f6000000-0000-0000-0000-0000000000a0', (SELECT d0 FROM f)) $$,
  '25: the owner voids the day');
RESET ROLE;
SELECT is(pg_temp.live('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f), 'f6300000-0000-0000-0000-000000000003')
          || '/' || pg_temp.rem('f6700000-0000-0000-0000-000000000006'),
  '0/150.00', '25b: a holiday void returns the draw — onto the CANCELLED package it came from');
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT unmark_day_holiday('f6000000-0000-0000-0000-0000000000a0', (SELECT d0 FROM f)) $$,
  '26: un-voiding still works when a returned draw references the session it deletes (CASCADE)');
RESET ROLE;

-- The void returned family R's draw too, and un-voiding deleted the d0 marks. Re-mark both siblings: again
-- one draws R's single lesson and the other is ad-hoc — the undrawn present lesson cases 38 and 50a need.
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES (pg_temp.s('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f)), 'f6300000-0000-0000-0000-000000000004', 'present', 'f6100000-0000-0000-0000-0000000000c1'),
       (pg_temp.s('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f)), 'f6300000-0000-0000-0000-000000000005', 'present', 'f6100000-0000-0000-0000-0000000000c1');
SELECT is((SELECT count(*)::int FROM attendance a JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
            WHERE ls.session_date = (SELECT d0 FROM f) AND a.status = 'present'
              AND a.student_id IN ('f6300000-0000-0000-0000-000000000004','f6300000-0000-0000-0000-000000000005')
              AND NOT EXISTS (SELECT 1 FROM package_applications pa WHERE pa.lesson_session_id = a.lesson_session_id
                                AND pa.student_id = a.student_id AND pa.reversed_at IS NULL)),
  1, '26b: (fixture) exactly one sibling''s d0 lesson is present and undrawn');

-- ══ 27–30. Backlog (D5) ═══════════════════════════════════════════════════════════════════════════════════
-- Family P's ad-hoc Group lessons in window: Ben Dolphins d35 (exhausted at 14), Ava's d28/d21 are absent.
-- PK3 = G3 sold now; preview, then draw.
SELECT pg_temp.sell('f6700000-0000-0000-0000-000000000007','P1','f6600000-0000-0000-0000-000000000001',(SELECT d42 FROM f));
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE pv AS SELECT * FROM package_backlog_preview('f6700000-0000-0000-0000-000000000007');
SELECT is((SELECT count(*)::int FROM pv WHERE funds_this), 1, '27: the preview finds the one un-invoiced, undrawn Group lesson');
SELECT is(draw_package_backlog('f6700000-0000-0000-0000-000000000007'), (SELECT count(*)::int FROM pv WHERE funds_this),
  '28: the backlog draw draws exactly the lessons the preview said this package would fund');
SELECT is(draw_package_backlog('f6700000-0000-0000-0000-000000000007'), 0, '29: a second backlog draw draws nothing');
RESET ROLE;
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT draw_package_backlog('f6700000-0000-0000-0000-000000000009') $$,
  'P0001', 'this business does not draw packages at marking yet', '30: the backlog draw is refused while the switch is off');
RESET ROLE;

-- ══ 31–37. package_usage caller shapes ════════════════════════════════════════════════════════════════════
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT ok((SELECT count(*) FROM package_usage('f6700000-0000-0000-0000-000000000001')) >= 3, '31: the owner reads the usage list (returns included)');
RESET ROLE;
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000d1');
SET LOCAL ROLE authenticated;
SELECT ok((SELECT count(*) FROM package_usage('f6700000-0000-0000-0000-000000000001')) >= 3, '32: the owning parent reads it');
RESET ROLE;
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000d2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT * FROM package_usage('f6700000-0000-0000-0000-000000000001') $$, '42501', NULL, '33: another family''s parent is refused');
RESET ROLE;
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000c1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT * FROM package_usage('f6700000-0000-0000-0000-000000000001') $$, '42501', NULL, '34: a coach is refused');
RESET ROLE;
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT * FROM package_usage('f6700000-0000-0000-0000-000000000001') $$, '42501', NULL, '35: another business''s admin is refused');
RESET ROLE;
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000e1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT * FROM package_usage('f6700000-0000-0000-0000-000000000001') $$, '42501', NULL, '36: a Front-desk co-admin (packages: none) is refused');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT * FROM package_usage('f6700000-0000-0000-0000-000000000001') $$, '42501', NULL, '37: anon cannot call it');
RESET ROLE;

-- Family R's undrawn present lesson on d0 (the sibling who lost the last lesson at 21) now has a package that
-- could fund it — the admin chose KEEP AS AD-HOC (no backlog draw). The simulation must not subtract it.
SELECT pg_temp.sell('f6700000-0000-0000-0000-00000000000a','P3','f6600000-0000-0000-0000-000000000003',(SELECT d42 FROM f));
-- ══ 38–40. Readers ════════════════════════════════════════════════════════════════════════════════════════
SELECT is((SELECT count(*)::int FROM package_live_balances() b
            WHERE b.tenant_id = 'f6000000-0000-0000-0000-0000000000a0' AND b.live_value_remaining <> b.value_remaining),
  0, '38: switch on — every package''s live balance IS its stored balance');
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT ok((SELECT drawn_lessons FROM package_month_funding('f6000000-0000-0000-0000-0000000000a0')
            WHERE billing_month = to_char((SELECT d42 FROM f), 'YYYY-MM')) >= 1,
  '39: package_month_funding counts the month''s drawn lessons');
RESET ROLE;
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000c1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT * FROM package_month_funding('f6000000-0000-0000-0000-0000000000a0') $$, '42501', NULL,
  '40: a coach cannot read month funding');
RESET ROLE;

-- ══ 41. Below the floor is not counted (Gus: X sealed away, Y = X + 7 above it) ════════════════════════════
SELECT pg_temp.sell('f6700000-0000-0000-0000-000000000008','P5','f6600000-0000-0000-0000-000000000003',(SELECT x FROM f) - 7);
INSERT INTO billing_periods (tenant_id, billing_month)
VALUES ('f6000000-0000-0000-0000-0000000000a0', to_char((SELECT x FROM f), 'YYYY-MM'));
SELECT lives_ok($$ SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT x FROM f) + 7,
                                       'f6300000-0000-0000-0000-000000000007', 'present') $$,
  '41: an unmarked lesson below markable_floor does not count against the last package lesson');

-- ══ 42–43. unbilled_sealed_lessons excludes a drawn lesson, and lists it once returned ════════════════════
-- Gus's Y lesson is drawn; seal its month.
INSERT INTO billing_periods (tenant_id, billing_month)
VALUES ('f6000000-0000-0000-0000-0000000000a0', to_char((SELECT x FROM f) + 7, 'YYYY-MM'))
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM unbilled_sealed_lessons('f6000000-0000-0000-0000-0000000000a0')
            WHERE student_id = 'f6300000-0000-0000-0000-000000000007'),
  0, '42: a drawn lesson in a sealed month is not an orphan');
RESET ROLE;
UPDATE package_applications SET reversed_at = app_now() WHERE student_id = 'f6300000-0000-0000-0000-000000000007';
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM unbilled_sealed_lessons('f6000000-0000-0000-0000-0000000000a0')
            WHERE student_id = 'f6300000-0000-0000-0000-000000000007'),
  1, '43: the same lesson, its draw reversed, IS listed');
RESET ROLE;

-- ══ 44. The switch is refused to a client ═════════════════════════════════════════════════════════════════
SELECT pg_temp.as_user('f6100000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ UPDATE tenants SET package_draw_at_marking = FALSE WHERE id = 'f6000000-0000-0000-0000-0000000000a0' $$,
  '42501', NULL, '44: the owner cannot flip the switch');
RESET ROLE;

-- ══ 45–49. Grants and structure ═══════════════════════════════════════════════════════════════════════════
SELECT ok(NOT has_function_privilege('anon', 'public.package_backlog_preview(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.draw_package_backlog(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.package_usage(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.package_month_funding(uuid)', 'EXECUTE'),
  '45: anon can call none of the four RPCs');
SELECT ok(has_function_privilege('authenticated', 'public.package_backlog_preview(uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.draw_package_backlog(uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.package_usage(uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.package_month_funding(uuid)', 'EXECUTE'),
  '46: authenticated can call the four RPCs (each gates itself)');
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('package_candidates_for','package_draw_for','package_return_for',
                                'class_unmarked_lesson_pairs','package_backlog_lessons')
              AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   OR has_function_privilege('service_role', p.oid, 'EXECUTE'))),
  0, '47: the internal functions are callable by nobody but their definer callers (§7.78)');
SELECT is((SELECT confdeltype::text FROM pg_constraint
            WHERE conrelid = 'package_applications'::regclass AND conname = 'package_applications_student_id_fkey'),
  'a', '48: package_applications.student_id is NO ACTION — never a CASCADE onto students (§7.327)');
SELECT ok('guard_attendance_date_trg' COLLATE "C" < 'guard_package_draw_order_trg' COLLATE "C",
  '49: the D6 guard sorts after the date guard (§7.167)');

-- ══ 50–52. FAILS OPEN (last: it breaks class_unmarked_lesson_pairs for the rest of this transaction) ═══════
-- Family R: PKR exhausted at 21. A fresh G1 with Eli's earlier lesson unmarked would be refused...
UPDATE student_class_enrolments SET enrolled_at = ((SELECT d14 FROM f)::timestamp + TIME '12:00') AT TIME ZONE 'Asia/Singapore'
 WHERE student_id = 'f6300000-0000-0000-0000-000000000005' AND class_id = 'f6500000-0000-0000-0000-000000000001';
UPDATE student_class_enrolments SET enrolled_at = ((SELECT d14 FROM f)::timestamp + TIME '12:00') AT TIME ZONE 'Asia/Singapore'
 WHERE student_id = 'f6300000-0000-0000-0000-000000000004' AND class_id = 'f6500000-0000-0000-0000-000000000001';
SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d14 FROM f), 'f6300000-0000-0000-0000-000000000004', 'absent');
SELECT lives_ok($$
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
  SELECT lesson_session_id, student_id, status, marked_by FROM attendance
   WHERE lesson_session_id = pg_temp.s('f6500000-0000-0000-0000-000000000001', (SELECT d0 FROM f))
     AND student_id IN ('f6300000-0000-0000-0000-000000000004','f6300000-0000-0000-0000-000000000005')
  ON CONFLICT (lesson_session_id, student_id) DO UPDATE SET status = EXCLUDED.status $$,
  '50a: re-saving an UNDRAWN present lesson that a package could now fund is not a new draw — never refused');
SELECT throws_ok($$ SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d7 FROM f),
                                        'f6300000-0000-0000-0000-000000000004', 'present') $$,
  'PK001', NULL, '50: (control) Dee on d7 is refused while Eli''s d14 is unmarked and one lesson is left');
CREATE OR REPLACE FUNCTION public.class_unmarked_lesson_pairs(p_class_id UUID)
RETURNS TABLE (session_date DATE, student_id UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT (CASE WHEN 1 / (SELECT 0) = 1 THEN '2026-09-15'::date END), NULL::uuid $$;
SELECT lives_ok($$ SELECT pg_temp.mark('f6500000-0000-0000-0000-000000000001', (SELECT d7 FROM f),
                                       'f6300000-0000-0000-0000-000000000004', 'present') $$,
  '51: with the guard''s derivation broken, the mark SAVES (fail open, §7.324)');
SELECT is(pg_temp.live('f6500000-0000-0000-0000-000000000001', (SELECT d7 FROM f), 'f6300000-0000-0000-0000-000000000004'),
  1, '52: ...and still draws');

SELECT * FROM finish();
ROLLBACK;
