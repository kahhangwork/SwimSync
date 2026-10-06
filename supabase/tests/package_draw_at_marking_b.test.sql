-- pgTAP: Wave 6 migration B's BACKFILL (20261006000200, package_backfill_draws).
-- docs/plans/WAVE6_PACKAGE_DRAW_AT_MARKING_PLAN.md §1.3 (RISK 4: one-shot money write on prod).
--
-- WHAT THIS FILE PROTECTS. Lessons marked BEFORE the switch flipped are drawn exactly once, by the one matcher:
--   oldest first; an invoiced lesson, a settled lesson and a sealed-month lesson are never drawn; an absent mark
--   is never drawn; a tenant whose switch is off is untouched; a second run draws nothing; the switch-off live
--   balance and the post-backfill stored balance agree for a package with no settled / sealed lessons.
--
-- FIXTURE (prefix f7…). Tenant T (switch OFF while marking, then flipped). Classes on today's weekday; dN = N
-- days ago. Package G3 = 3 Group lessons @40, start d84. Ava (family P) and Ben (family P).
--   d77 Ava present — its month is SEALED            → not drawn
--   d35 Ava present                                  → drawn (1st)
--   d28 Ben present — already on an invoice          → not drawn
--   d21 Ben present — covered by a live settlement   → not drawn
--   d14 Ava present                                  → drawn (2nd)
--   d14 Ben absent                                   → not drawn
--   d7  Ava present                                  → drawn (3rd, package now 0)
--   d0  Ava present                                  → exhausted → stays ad-hoc (oldest-first proof)
-- Tenant U (switch OFF throughout) holds the same shape for one lesson — must be untouched.

BEGIN;
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);
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
  '2026-06-30'::date AS d77,
  '2026-06-23'::date AS d84,
  'tuesday'::text    AS dow;

INSERT INTO tenants (id, slug, display_name, join_code, created_at, package_draw_at_marking) VALUES
  ('f7000000-0000-0000-0000-0000000000a0','w6b-t','W6B T','SWIM-W6BT', app_now() - INTERVAL '200 days', FALSE),
  ('f7000000-0000-0000-0000-0000000000b0','w6b-u','W6B U','SWIM-W6BU', app_now() - INTERVAL '200 days', FALSE);

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email,
       crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', v.meta, app_now(), app_now(), '', '', '', ''
  FROM (VALUES
    ('f7100000-0000-0000-0000-0000000000c1'::uuid, 'w6b-coach@test.local',
     '{"full_name":"W6B Coach","role":"coach","tenant_id":"f7000000-0000-0000-0000-0000000000a0"}'::jsonb),
    ('f7100000-0000-0000-0000-0000000000c2'::uuid, 'w6b-coach-u@test.local',
     '{"full_name":"W6B Coach U","role":"coach","tenant_id":"f7000000-0000-0000-0000-0000000000b0"}'::jsonb),
    ('f7100000-0000-0000-0000-0000000000d1'::uuid, 'w6b-parent@test.local',
     '{"full_name":"W6B Parent","role":"parent"}'::jsonb),
    ('f7100000-0000-0000-0000-0000000000d2'::uuid, 'w6b-parent-u@test.local',
     '{"full_name":"W6B Parent U","role":"parent"}'::jsonb)
  ) v(id, email, meta);

CREATE TEMP TABLE ids AS
SELECT 'P' AS k, p.id AS v FROM parents p JOIN profiles pr ON pr.id = p.profile_id WHERE pr.email = 'w6b-parent@test.local'
UNION ALL
SELECT 'PU', p.id FROM parents p JOIN profiles pr ON pr.id = p.profile_id WHERE pr.email = 'w6b-parent-u@test.local'
UNION ALL
SELECT 'coach', c.id FROM coaches c WHERE c.profile_id = 'f7100000-0000-0000-0000-0000000000c1'
UNION ALL
SELECT 'coachU', c.id FROM coaches c WHERE c.profile_id = 'f7100000-0000-0000-0000-0000000000c2';
CREATE OR REPLACE FUNCTION pg_temp.id(p_k TEXT) RETURNS UUID AS $$ SELECT v FROM ids WHERE k = p_k $$ LANGUAGE sql STABLE;

INSERT INTO parent_tenants (parent_id, tenant_id) VALUES
  (pg_temp.id('P'), 'f7000000-0000-0000-0000-0000000000a0'), (pg_temp.id('PU'), 'f7000000-0000-0000-0000-0000000000b0');
INSERT INTO class_categories (id, tenant_id, name) VALUES
  ('f7400000-0000-0000-0000-000000000001','f7000000-0000-0000-0000-0000000000a0','W6B Group'),
  ('f7400000-0000-0000-0000-000000000002','f7000000-0000-0000-0000-0000000000b0','W6B Group U');
INSERT INTO locations (id, tenant_id, name) VALUES
  ('f7800000-0000-0000-0000-000000000001','f7000000-0000-0000-0000-0000000000a0','W6B Pool'),
  ('f7800000-0000-0000-0000-000000000002','f7000000-0000-0000-0000-0000000000b0','W6B Pool U');
INSERT INTO classes (id, tenant_id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
VALUES
  ('f7500000-0000-0000-0000-000000000001','f7000000-0000-0000-0000-0000000000a0', pg_temp.id('coach'), 'W6B Dolphins',
   (SELECT dow FROM f)::day_of_week, '09:00', '10:00', 'f7800000-0000-0000-0000-000000000001', 30.00, 'f7400000-0000-0000-0000-000000000001'),
  ('f7500000-0000-0000-0000-000000000002','f7000000-0000-0000-0000-0000000000b0', pg_temp.id('coachU'), 'W6B U Class',
   (SELECT dow FROM f)::day_of_week, '09:00', '10:00', 'f7800000-0000-0000-0000-000000000002', 30.00, 'f7400000-0000-0000-0000-000000000002');
INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id) VALUES
  ('f7300000-0000-0000-0000-000000000001','W6B Ava','assigned',TRUE,'f7000000-0000-0000-0000-0000000000a0'),
  ('f7300000-0000-0000-0000-000000000002','W6B Ben','assigned',TRUE,'f7000000-0000-0000-0000-0000000000a0'),
  ('f7300000-0000-0000-0000-000000000009','W6B Una','assigned',TRUE,'f7000000-0000-0000-0000-0000000000b0');
INSERT INTO parent_students (parent_id, student_id) VALUES
  (pg_temp.id('P'), 'f7300000-0000-0000-0000-000000000001'), (pg_temp.id('P'), 'f7300000-0000-0000-0000-000000000002'),
  (pg_temp.id('PU'), 'f7300000-0000-0000-0000-000000000009');

INSERT INTO package_products (id, tenant_id, name, category_id, lesson_count, rate_per_lesson, validity_weeks) VALUES
  ('f7600000-0000-0000-0000-000000000001','f7000000-0000-0000-0000-0000000000a0','W6B G3','f7400000-0000-0000-0000-000000000001',3,40.00,20),
  ('f7600000-0000-0000-0000-000000000002','f7000000-0000-0000-0000-0000000000b0','W6B U3','f7400000-0000-0000-0000-000000000002',3,40.00,20);
INSERT INTO parent_packages (id, tenant_id, parent_id, product_id, status, start_date) VALUES
  ('f7700000-0000-0000-0000-000000000001','f7000000-0000-0000-0000-0000000000a0', pg_temp.id('P'),
   'f7600000-0000-0000-0000-000000000001','active',(SELECT d84 FROM f)),
  ('f7700000-0000-0000-0000-000000000002','f7000000-0000-0000-0000-0000000000b0', pg_temp.id('PU'),
   'f7600000-0000-0000-0000-000000000002','active',(SELECT d84 FROM f));

CREATE OR REPLACE FUNCTION pg_temp.mark(p_class UUID, p_date DATE, p_student UUID, p_status TEXT) RETURNS UUID AS $$
DECLARE v UUID;
BEGIN
  SELECT id INTO v FROM lesson_sessions WHERE class_id = p_class AND session_date = p_date;
  IF v IS NULL THEN
    INSERT INTO lesson_sessions (class_id, session_date, start_time, end_time)
    SELECT id, p_date, start_time, end_time FROM classes WHERE id = p_class RETURNING id INTO v;
  END IF;
  INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
  VALUES (v, p_student, p_status::attendance_status, 'f7100000-0000-0000-0000-0000000000c1');
  RETURN v;
END $$ LANGUAGE plpgsql;

-- Marks with the switch OFF: nothing draws.
SELECT pg_temp.mark('f7500000-0000-0000-0000-000000000001', d, s::uuid, st)
  FROM f, LATERAL (VALUES
    (f.d77, 'f7300000-0000-0000-0000-000000000001', 'present'),
    (f.d35, 'f7300000-0000-0000-0000-000000000001', 'present'),
    (f.d28, 'f7300000-0000-0000-0000-000000000002', 'present'),
    (f.d21, 'f7300000-0000-0000-0000-000000000002', 'present'),
    (f.d14, 'f7300000-0000-0000-0000-000000000001', 'present'),
    (f.d14, 'f7300000-0000-0000-0000-000000000002', 'absent'),
    (f.d7,  'f7300000-0000-0000-0000-000000000001', 'present'),
    (f.d0,  'f7300000-0000-0000-0000-000000000001', 'present')
  ) v(d, s, st);
SELECT pg_temp.mark('f7500000-0000-0000-0000-000000000002', (SELECT d35 FROM f), 'f7300000-0000-0000-0000-000000000009', 'present');

-- d77's month is sealed; d28 is already invoiced; d21 is settled.
INSERT INTO billing_periods (tenant_id, billing_month)
VALUES ('f7000000-0000-0000-0000-0000000000a0', to_char((SELECT d77 FROM f), 'YYYY-MM'));
INSERT INTO invoices (id, parent_id, tenant_id, billing_month, gross_amount, net_amount, reference_number, public_token)
VALUES ('f7900000-0000-0000-0000-000000000001', pg_temp.id('P'), 'f7000000-0000-0000-0000-0000000000a0',
        to_char((SELECT d28 FROM f), 'YYYY-MM'), 30, 30, 'INV-W6B-0001', 'w6b-token-0001');
INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
SELECT 'f7900000-0000-0000-0000-000000000001', 'f7300000-0000-0000-0000-000000000002', ls.id, 'present', 30, 'W6B Dolphins', ls.session_date
  FROM lesson_sessions ls WHERE ls.class_id = 'f7500000-0000-0000-0000-000000000001' AND ls.session_date = (SELECT d28 FROM f);
INSERT INTO student_settlements (tenant_id, student_id, settled_through, kind, amount, recorded_by)
VALUES ('f7000000-0000-0000-0000-0000000000a0', 'f7300000-0000-0000-0000-000000000002', (SELECT d21 FROM f),
        'paid_outside', 30, 'f7100000-0000-0000-0000-0000000000c1');

SELECT is((SELECT count(*)::int FROM package_applications WHERE invoice_item_id IS NULL
            AND parent_package_id IN ('f7700000-0000-0000-0000-000000000001','f7700000-0000-0000-0000-000000000002')),
  0, '1: with the switch off, marking drew nothing (the backfill has work to do)');

UPDATE tenants SET package_draw_at_marking = TRUE WHERE id = 'f7000000-0000-0000-0000-0000000000a0';

SELECT is(package_backfill_draws(), 3, '2: the backfill draws exactly the three eligible lessons');
SELECT is((SELECT string_agg(to_char(pa.lesson_date, 'YYYY-MM-DD'), ',' ORDER BY pa.lesson_date)
             FROM package_applications pa WHERE pa.parent_package_id = 'f7700000-0000-0000-0000-000000000001'),
  (SELECT string_agg(to_char(d, 'YYYY-MM-DD'), ',' ORDER BY d) FROM f, LATERAL (VALUES (f.d35), (f.d14), (f.d7)) v(d)),
  '3: oldest first — d35, d14, d7 drawn; the sealed d77, invoiced d28, settled d21, absent d14 and exhausted d0 are not');
SELECT is((SELECT value_remaining FROM parent_packages WHERE id = 'f7700000-0000-0000-0000-000000000001'),
  0.00::numeric, '4: the package is spent by exactly the three draws');
SELECT is(package_backfill_draws(), 0, '5: a second run draws nothing (idempotent)');
SELECT is((SELECT value_remaining FROM parent_packages WHERE id = 'f7700000-0000-0000-0000-000000000002'),
  120.00::numeric, '6: a tenant whose switch is OFF is untouched');
SELECT is((SELECT count(*)::int FROM package_applications pa
             JOIN invoice_items ii ON ii.lesson_session_id = pa.lesson_session_id AND ii.student_id = pa.student_id
            WHERE pa.reversed_at IS NULL),
  0, '7: no lesson is both invoiced and drawn');
SELECT ok(NOT has_function_privilege('authenticated', 'public.package_backfill_draws()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.package_backfill_draws()', 'EXECUTE')
      AND NOT has_function_privilege('service_role', 'public.package_backfill_draws()', 'EXECUTE'),
  '8: the backfill is callable by nobody but its migration (§7.78)');

SELECT * FROM finish();
ROLLBACK;
