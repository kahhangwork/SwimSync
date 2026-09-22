\set ON_ERROR_STOP on
-- Stage 4 hand-check fixture (scratchpad, not a repo driver). As postgres (guard-exempt).
CREATE TEMP TABLE hc AS
WITH t AS (SELECT (now() AT TIME ZONE 'Asia/Singapore')::date AS today)
SELECT today, (today - 7) AS d_prev,
  (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[EXTRACT(DOW FROM today)::int + 1]::day_of_week AS dow
FROM t;
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id, tenant_id, is_active)
SELECT v.id, co.id, v.title, hc.dow, v.st, v.et, '71000000-0000-0000-0000-000000000001', 30.00,
       '7c000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', true
FROM coaches co, hc, (VALUES
  ('e9000000-0000-0000-0000-0000000000c1'::uuid, 'HC Billed Class', '07:00'::time, '07:45'::time),
  ('e9000000-0000-0000-0000-0000000000c2'::uuid, 'HC Fresh Class',  '08:00'::time, '08:45'::time)) v(id,title,st,et)
WHERE co.profile_id = 'c0000000-0000-0000-0000-000000000001';
INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id) VALUES
  ('e9000000-0000-0000-0000-00000000a001','HC Billed Kid','assigned',true,'70000000-0000-0000-0000-000000000001'),
  ('e9000000-0000-0000-0000-00000000a002','HC Other Kid','assigned',true,'70000000-0000-0000-0000-000000000001'),
  ('e9000000-0000-0000-0000-00000000b001','HC Fresh Kid','assigned',true,'70000000-0000-0000-0000-000000000001');
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, is_active)
SELECT s, c, (hc.today - 30)::timestamptz, true FROM hc, (VALUES
  ('e9000000-0000-0000-0000-00000000a001'::uuid,'e9000000-0000-0000-0000-0000000000c1'::uuid),
  ('e9000000-0000-0000-0000-00000000a002'::uuid,'e9000000-0000-0000-0000-0000000000c1'::uuid),
  ('e9000000-0000-0000-0000-00000000b001'::uuid,'e9000000-0000-0000-0000-0000000000c2'::uuid)) v(s,c);
INSERT INTO lesson_sessions (id, class_id, session_date, status)
SELECT 'e9000000-0000-0000-0000-0000000000d1','e9000000-0000-0000-0000-0000000000c1', hc.d_prev, 'scheduled' FROM hc;
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by) VALUES
  ('e9000000-0000-0000-0000-0000000000d1','e9000000-0000-0000-0000-00000000a001','present','c0000000-0000-0000-0000-000000000001'),
  ('e9000000-0000-0000-0000-0000000000d1','e9000000-0000-0000-0000-00000000a002','present','c0000000-0000-0000-0000-000000000001');
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('00000000-0000-0000-0000-000000000000','e9000000-0000-0000-0000-0000000000f1','authenticated','authenticated',
  'hc-parent@swimsync.test', crypt('password123', gen_salt('bf')), NOW(), '{"provider":"email","providers":["email"]}',
  '{"full_name":"HC Parent","role":"parent"}', NOW(), NOW(), '', '', '', '');
INSERT INTO parent_tenants (parent_id, tenant_id) SELECT p.id, '70000000-0000-0000-0000-000000000001' FROM parents p WHERE p.profile_id='e9000000-0000-0000-0000-0000000000f1';
INSERT INTO parent_students (parent_id, student_id) SELECT p.id, 'e9000000-0000-0000-0000-00000000a001' FROM parents p WHERE p.profile_id='e9000000-0000-0000-0000-0000000000f1';
INSERT INTO invoices (tenant_id, id, parent_id, billing_month, gross_amount, credit_applied, net_amount, status)
SELECT '70000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-0000000000e1', p.id, to_char(hc.d_prev,'YYYY-MM'), 30.00, 0.00, 30.00, 'outstanding'
FROM parents p, hc WHERE p.profile_id='e9000000-0000-0000-0000-0000000000f1';
INSERT INTO invoice_items (invoice_id, student_id, lesson_session_id, attendance_status, amount, class_title, session_date)
SELECT 'e9000000-0000-0000-0000-0000000000e1','e9000000-0000-0000-0000-00000000a001','e9000000-0000-0000-0000-0000000000d1','present',30.00,'HC Billed Class',hc.d_prev FROM hc;
SELECT d_prev FROM hc;
