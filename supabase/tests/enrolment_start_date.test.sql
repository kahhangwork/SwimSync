-- pgTAP: A START DATE ON ADD-TO-CLASS, AND CHANGING IT (20261005000100).
-- docs/plans/WAVE4_START_DATE_FRONT_DESK_PLAN.md (reviewed).
--
-- WHAT THIS FILE PROTECTS.
--   (1) the mode is explicit — 'add' never rewrites an existing start (RISK 2);
--   (2) only operations:edit / the platform admin — no coach, no viewer, no other business (RISK 4);
--   (3) a past start lands on the SAME calendar day for SGT and UTC readers (RISK 5, D10);
--   (4) bounds: not future, not below markable_floor; not before a previous window's end, equality allowed (RISK 7);
--   (5) a later start cannot pass a mark, and records the lessons it stops expecting (D7, RISK 6);
--   (6) the fourth path, add_unclaimed_student, takes the same start and keeps its old call shape (D12, §7.123).
--
-- FIXTURE (prefix e5a…). Tenant A created 120 days ago (so its floor is session_window_start(), not today);
-- owner OA, a FRONT DESK co-admin FD (standard_key front_desk), a VIEW co-admin VW, coach CA (owns class C1).
-- Tenant B: owner OB, student KB. Tenant N created 60 days ago, never billed (floor = LEAST(session window,
-- creation date) = its creation date). Tenant A is never billed either until case 9 seals last month.
-- C1 runs on TODAY's weekday 10:00–11:00; C2 overlaps it; dates are derived — d7 / d14 = 7 / 14 days ago.
-- ⚠ Wave 7: superseded — the clock is pinned (first statement after BEGIN), so these dates are now LITERALS
--   relative to the pin and cannot expire; the relationships described above are what the literals keep.
--
-- RED-FIRST PROOF (§7.25, 2026-10-05 — each guard mutated in the live body, one at a time, then restored):
--   D7 dropped → 6 · D8 dropped → 4 · D8 `<`→`<=` → 4 (same-day re-add) · midnight storage → 2 (UTC clause) ·
--   auth gate dropped → 7 ×3 · coach arm added → 7 (coach) · cross-tenant check dropped → 7 (student) ·
--   mode inferred → 12 · dropped_dates blanked → 6b · future allowed → 3 · floor dropped → 3 ·
--   add_unclaimed_student ignores the start → 14 · trial start not refused → 14.
--   NOT provable here: a ZONELESS `p_starts_on::timestamptz` — the test session runs in UTC, where it lands on
--   00:00 UTC = 08:00 SGT, the same date for both readers. Noon storage is what is pinned (case 2).

BEGIN;
SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(42);
SELECT is(app_today(), '2026-09-15'::date, 'clock pinned');

-- Wave 7: literals = the former derivation evaluated at the pinned clock (2026-09-15 10:00+08).
CREATE TEMP TABLE f AS
SELECT
  '2026-09-15'::date AS today,
  '2026-09-08'::date AS d7,
  '2026-09-01'::date AS d14,
  '2026-08-01'::date AS sws,
  '2026-08'::text    AS last_month,
  'tuesday'::text    AS dow;
GRANT SELECT ON f TO PUBLIC;

INSERT INTO tenants (id, slug, display_name, join_code, created_at) VALUES
  ('e5a00000-0000-0000-0000-0000000000a0','esd-a','ESD A','SWIM-ESDA', app_now() - INTERVAL '120 days'),
  ('e5a00000-0000-0000-0000-0000000000b0','esd-b','ESD B','SWIM-ESDB', app_now() - INTERVAL '120 days'),
  ('e5a00000-0000-0000-0000-0000000000c0','esd-n','ESD N','SWIM-ESDN', app_now() - INTERVAL '60 days');

CREATE OR REPLACE FUNCTION pg_temp.mkuser(p_id UUID, p_email TEXT, p_meta JSONB) RETURNS VOID AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
    updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, crypt('x', gen_salt('bf')), app_now(), '{"provider":"email"}', p_meta,
    app_now(), app_now(), '', '', '', '') $$ LANGUAGE sql;

SELECT pg_temp.mkuser('e5a10000-0000-0000-0000-0000000000a1','esd-owner-a@test.local',
  '{"full_name":"ESD Owner A","role":"tenant_admin","tenant_id":"e5a00000-0000-0000-0000-0000000000a0"}');
SELECT pg_temp.mkuser('e5a10000-0000-0000-0000-0000000000b1','esd-owner-b@test.local',
  '{"full_name":"ESD Owner B","role":"tenant_admin","tenant_id":"e5a00000-0000-0000-0000-0000000000b0"}');
SELECT pg_temp.mkuser('e5a10000-0000-0000-0000-0000000000c1','esd-owner-n@test.local',
  '{"full_name":"ESD Owner N","role":"tenant_admin","tenant_id":"e5a00000-0000-0000-0000-0000000000c0"}');
SELECT pg_temp.mkuser('e5a10000-0000-0000-0000-0000000000f1','esd-frontdesk@test.local',
  jsonb_build_object('role','tenant_admin','tenant_id','e5a00000-0000-0000-0000-0000000000a0','admin_role_id',
    (SELECT id FROM tenant_roles WHERE tenant_id='e5a00000-0000-0000-0000-0000000000a0' AND standard_key='front_desk')));
SELECT pg_temp.mkuser('e5a10000-0000-0000-0000-0000000000c8','esd-coach-n@test.local',
  '{"full_name":"ESD Coach N","role":"coach","tenant_id":"e5a00000-0000-0000-0000-0000000000c0"}');
SELECT pg_temp.mkuser('e5a10000-0000-0000-0000-0000000000c9','esd-coach-a@test.local',
  '{"full_name":"ESD Coach A","role":"coach","tenant_id":"e5a00000-0000-0000-0000-0000000000a0"}');

-- A view-only operations role, created as the owner would.
SELECT set_config('request.jwt.claims', '{"sub":"e5a10000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT create_role('ESD View', '{"operations":"view","profile":"none","admins":"none","pricing":"none","billing":"none","packages":"none","wages":"none","accounting":"none"}');
SELECT set_config('request.jwt.claims', '', true);
SELECT pg_temp.mkuser('e5a10000-0000-0000-0000-0000000000e1','esd-viewer@test.local',
  jsonb_build_object('role','tenant_admin','tenant_id','e5a00000-0000-0000-0000-0000000000a0','admin_role_id',
    (SELECT id FROM tenant_roles WHERE tenant_id='e5a00000-0000-0000-0000-0000000000a0' AND name='ESD View')));

INSERT INTO class_categories (tenant_id, name)
SELECT t, 'Default Group' FROM unnest(ARRAY['e5a00000-0000-0000-0000-0000000000a0','e5a00000-0000-0000-0000-0000000000c0']::uuid[]) t
 WHERE NOT EXISTS (SELECT 1 FROM class_categories c WHERE c.tenant_id = t AND lower(trim(c.name)) = 'default group');
INSERT INTO locations (tenant_id, name)
SELECT t, 'Default location' FROM unnest(ARRAY['e5a00000-0000-0000-0000-0000000000a0','e5a00000-0000-0000-0000-0000000000c0']::uuid[]) t
 WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.tenant_id = t AND lower(trim(l.name)) = 'default location');

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT v.id, co.id, v.title, (SELECT dow FROM f)::day_of_week, v.st, v.et,
       (SELECT id FROM locations WHERE tenant_id = co.tenant_id AND lower(trim(name)) = 'default location'), 30.00,
       (SELECT id FROM class_categories WHERE tenant_id = co.tenant_id AND lower(trim(name)) = 'default group')
  FROM coaches co,
       (VALUES ('e5a20000-0000-0000-0000-000000000001'::uuid, 'ESD C1', '10:00'::time, '11:00'::time),
               ('e5a20000-0000-0000-0000-000000000002'::uuid, 'ESD C2', '10:30'::time, '11:30'::time)) v(id, title, st, et)
 WHERE co.profile_id = 'e5a10000-0000-0000-0000-0000000000c9';

INSERT INTO students (id, full_name, assignment_status, is_active, tenant_id) VALUES
  ('e5a30000-0000-0000-0000-000000000001','ESD Kid1','unassigned',TRUE,'e5a00000-0000-0000-0000-0000000000a0'),
  ('e5a30000-0000-0000-0000-000000000002','ESD Kid2','unassigned',TRUE,'e5a00000-0000-0000-0000-0000000000a0'),
  ('e5a30000-0000-0000-0000-000000000003','ESD Kid3','unassigned',TRUE,'e5a00000-0000-0000-0000-0000000000a0'),
  ('e5a30000-0000-0000-0000-000000000004','ESD Kid4','unassigned',TRUE,'e5a00000-0000-0000-0000-0000000000a0'),
  ('e5a30000-0000-0000-0000-000000000005','ESD Kid5','unassigned',TRUE,'e5a00000-0000-0000-0000-0000000000a0'),
  ('e5a30000-0000-0000-0000-0000000000b1','ESD KidB','unassigned',TRUE,'e5a00000-0000-0000-0000-0000000000b0');

-- Kid3 was in C1 and left TODAY (the same-day remove → re-add case).
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, unenrolled_at, is_active)
VALUES ('e5a30000-0000-0000-0000-000000000003','e5a20000-0000-0000-0000-000000000001',
        app_now() - INTERVAL '30 days', app_now(), FALSE);

CREATE TEMP TABLE g AS SELECT markable_floor('e5a00000-0000-0000-0000-0000000000a0') AS floor_a;
GRANT SELECT ON g TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid TEXT) RETURNS VOID AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.start_of(p_student UUID, p_class UUID, p_tz TEXT) RETURNS DATE AS $$
  SELECT (enrolled_at AT TIME ZONE p_tz)::date FROM student_class_enrolments
   WHERE student_id = p_student AND class_id = p_class AND is_active $$ LANGUAGE sql SECURITY DEFINER;
CREATE OR REPLACE FUNCTION pg_temp.audits(p_student UUID, p_action TEXT) RETURNS SETOF audit_log AS $$
  SELECT * FROM audit_log WHERE entity_id = p_student AND action = p_action $$ LANGUAGE sql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(TEXT), pg_temp.start_of(UUID, UUID, TEXT), pg_temp.audits(UUID, TEXT) TO authenticated;

SET LOCAL ROLE authenticated;

-- ── 1. Add with no date (Front desk) — today, atomic assign, audited under A ────
SELECT pg_temp.as_user('e5a10000-0000-0000-0000-0000000000f1');
SELECT lives_ok($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000001','e5a20000-0000-0000-0000-000000000001', NULL, 'add') $$,
  '1: Front desk (operations:edit) adds with no date');
SELECT is(pg_temp.start_of('e5a30000-0000-0000-0000-000000000001','e5a20000-0000-0000-0000-000000000001','Asia/Singapore'),
  (SELECT today FROM f), '1: no date → starts today (SGT)');
SELECT is((SELECT assignment_status::text FROM students WHERE id='e5a30000-0000-0000-0000-000000000001'),
  'assigned', '1: the add moves the child to assigned in the same call');
SELECT is((SELECT tenant_id FROM pg_temp.audits('e5a30000-0000-0000-0000-000000000001','enrolment_added')),
  'e5a00000-0000-0000-0000-0000000000a0'::uuid, '1: one audit row, under the class''s business');

-- ── 2. Add with a past date — the SAME day for SGT and UTC readers (RISK 5) ─────
SELECT pg_temp.as_user('e5a10000-0000-0000-0000-0000000000a1');
SELECT ok((set_enrolment_start('e5a30000-0000-0000-0000-000000000002','e5a20000-0000-0000-0000-000000000001',
  (SELECT d7 FROM f), 'add') ->> 'in_sealed_month')::boolean = FALSE, '2: a past start in an open month is not flagged sealed');
SELECT is(pg_temp.start_of('e5a30000-0000-0000-0000-000000000002','e5a20000-0000-0000-0000-000000000001','Asia/Singapore'),
  (SELECT d7 FROM f), '2: SGT date of the stored start = the chosen date');
SELECT is(pg_temp.start_of('e5a30000-0000-0000-0000-000000000002','e5a20000-0000-0000-0000-000000000001','UTC'),
  (SELECT d7 FROM f), '2: UTC date = the chosen date too (the engine''s raw slice reads this)');

-- ── 3. Bounds ───────────────────────────────────────────────────────────────────
SELECT throws_ok(format($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000004','e5a20000-0000-0000-0000-000000000001', %L, 'add') $$,
  (SELECT today + 1 FROM f)), '23514', NULL, '3: a future start is refused');
SELECT throws_ok(format($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000004','e5a20000-0000-0000-0000-000000000001', %L, 'add') $$,
  (SELECT floor_a - 1 FROM g)), '23514', NULL, '3: a start below the marking floor is refused');
SELECT throws_ok($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000004','e5a20000-0000-0000-0000-000000000001', NULL, 'upsert') $$,
  'P0001', 'mode must be add or change', '3: an unknown mode is refused');

-- ── 4. Previous window (D8 corrected, RISK 7) ───────────────────────────────────
SELECT throws_ok(format($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000003','e5a20000-0000-0000-0000-000000000001', %L, 'add') $$,
  (SELECT today - 1 FROM f)), '23514', NULL, '4: a start before the previous window''s end is refused');
SELECT lives_ok($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000003','e5a20000-0000-0000-0000-000000000001', NULL, 'add') $$,
  '4: the same-day re-add (start = previous end) is allowed');
RESET ROLE;
SELECT is(class_expected_count('e5a20000-0000-0000-0000-000000000001', (SELECT today FROM f)), 3,
  '4: today expects Kid1, Kid2, Kid3 — Kid3 counted ONCE though both windows include today');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM student_class_enrolments
            WHERE student_id='e5a30000-0000-0000-0000-000000000003' AND is_active), 1,
  '4: one active enrolment after the re-add');

-- ── 5. Change earlier — audited with old and new ────────────────────────────────
SELECT lives_ok(format($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000001','e5a20000-0000-0000-0000-000000000001', %L, 'change') $$,
  (SELECT d7 FROM f)), '5: change earlier');
SELECT is(pg_temp.start_of('e5a30000-0000-0000-0000-000000000001','e5a20000-0000-0000-0000-000000000001','Asia/Singapore'),
  (SELECT d7 FROM f), '5: the start moved');
SELECT ok((SELECT old_value IS NOT NULL AND new_value IS NOT NULL
             FROM pg_temp.audits('e5a30000-0000-0000-0000-000000000001','enrolment_start_changed')),
  '5: the change is audited with old and new');

-- ── 6. Change later: refused past a mark; records dropped dates (D7, RISK 6) ────
RESET ROLE;
INSERT INTO lesson_sessions (id, class_id, session_date, status)
SELECT 'e5a40000-0000-0000-0000-000000000001','e5a20000-0000-0000-0000-000000000001', d7, 'completed' FROM f;
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
VALUES ('e5a40000-0000-0000-0000-000000000001','e5a30000-0000-0000-0000-000000000002','present',
        'e5a10000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e5a10000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000002','e5a20000-0000-0000-0000-000000000001', NULL, 'change') $$,
  '23514', NULL, '6: a later start past a marked lesson is refused');
SELECT is(pg_temp.start_of('e5a30000-0000-0000-0000-000000000002','e5a20000-0000-0000-0000-000000000001','Asia/Singapore'),
  (SELECT d7 FROM f), '6: …and the start is unchanged');
SELECT lives_ok(format($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000004','e5a20000-0000-0000-0000-000000000002', %L, 'add') $$,
  (SELECT d14 FROM f)), '6b: Kid4 added to C2 two weeks back');
SELECT lives_ok($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000004','e5a20000-0000-0000-0000-000000000002', NULL, 'change') $$,
  '6b: an unmarked later move is allowed');
SELECT is((SELECT new_value->'dropped_dates' FROM pg_temp.audits('e5a30000-0000-0000-0000-000000000004','enrolment_start_changed')),
  (SELECT to_jsonb(ARRAY[d14, d7]) FROM f), '6b: the audit records both lessons it stopped expecting');

-- ── 7. Auth (RISK 4) ────────────────────────────────────────────────────────────
SELECT pg_temp.as_user('e5a10000-0000-0000-0000-0000000000e1');
SELECT throws_ok($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000005','e5a20000-0000-0000-0000-000000000001', NULL, 'add') $$,
  'P0001', 'not permitted to change this child''s classes', '7: operations:view is refused');
SELECT pg_temp.as_user('e5a10000-0000-0000-0000-0000000000c9');
SELECT throws_ok($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000005','e5a20000-0000-0000-0000-000000000001', NULL, 'add') $$,
  'P0001', 'not permitted to change this child''s classes', '7: the coach who owns the class is refused (§7.202)');
SELECT pg_temp.as_user('e5a10000-0000-0000-0000-0000000000b1');
SELECT throws_ok($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000005','e5a20000-0000-0000-0000-000000000001', NULL, 'add') $$,
  'P0001', 'not permitted to change this child''s classes', '7: another business''s owner is refused');
SELECT pg_temp.as_user('e5a10000-0000-0000-0000-0000000000a1');
SELECT throws_ok($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-0000000000b1','e5a20000-0000-0000-0000-000000000001', NULL, 'add') $$,
  'P0001', 'that child belongs to a different business', '7: a student from another business is refused');
SELECT ok(NOT has_function_privilege('anon','public.set_enrolment_start(uuid,uuid,date,text)','EXECUTE')
      AND NOT has_function_privilege('anon','public.enrolment_start_bounds(uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.enrolment_start_at(uuid,date)','EXECUTE'),
  '7: anon executes nothing; the internal helper has no client grant');

-- ── 8. The overlap trigger still fires through the RPC ──────────────────────────
SELECT throws_ok($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000001','e5a20000-0000-0000-0000-000000000002', NULL, 'add') $$,
  NULL, NULL, '8: C2 overlaps C1 on the same day — the schedule trigger refuses');

-- ── 9. in_sealed_month ──────────────────────────────────────────────────────────
RESET ROLE;
INSERT INTO billing_periods (tenant_id, billing_month, completed_at)
SELECT 'e5a00000-0000-0000-0000-0000000000a0', last_month, app_now() FROM f;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('e5a10000-0000-0000-0000-0000000000a1');
SELECT ok((set_enrolment_start('e5a30000-0000-0000-0000-000000000005','e5a20000-0000-0000-0000-000000000001',
  (SELECT sws FROM f), 'add') ->> 'in_sealed_month')::boolean, '9: a start inside a sealed month is flagged');

-- ── 10. bounds = markable_floor ─────────────────────────────────────────────────
SELECT is((enrolment_start_bounds('e5a20000-0000-0000-0000-000000000001') ->> 'floor')::date,
  markable_floor('e5a00000-0000-0000-0000-0000000000a0'), '10: bounds floor = markable_floor');
SELECT is(enrolment_start_bounds('e5a20000-0000-0000-0000-000000000001') ->> 'last_sealed_month',
  (SELECT last_month FROM f), '10: bounds carry the last sealed month');

-- ── 11. COMMENTs: old text kept as the prefix, decision appended ────────────────
SELECT ok(obj_description('public.claim_invoice_email(uuid,boolean)'::regprocedure, 'pg_proc')
          LIKE 'Claim one invoice email (UNSENT/RETRYABLE; MAY_HAVE_SENT only when p_manual). Returns the settle token, or no row. service_role only. 20260927000100. %REUSES%'
      AND obj_description('public.claim_credit_note_email(uuid,boolean)'::regprocedure, 'pg_proc')
          LIKE 'Claim one credit-note email (UNSENT/RETRYABLE; MAY_HAVE_SENT only when p_manual). Returns the settle token + issued_at, or no row. service_role only. 20260927000100. %REUSES%',
  '11: both claim COMMENTs keep their old text and say the key is REUSED');

-- ── 12. The mode is explicit (RISK 2) ───────────────────────────────────────────
SELECT throws_ok($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000002','e5a20000-0000-0000-0000-000000000001', NULL, 'add') $$,
  '23505', NULL, '12: add on an existing enrolment is refused — never a silent rewrite');
SELECT is(pg_temp.start_of('e5a30000-0000-0000-0000-000000000002','e5a20000-0000-0000-0000-000000000001','Asia/Singapore'),
  (SELECT d7 FROM f), '12: …and its start is unchanged');
SELECT throws_ok($$ SELECT set_enrolment_start('e5a30000-0000-0000-0000-000000000004','e5a20000-0000-0000-0000-000000000001', NULL, 'change') $$,
  'P0001', NULL, '12: change on a class the child is not in is refused');

-- ── 13. A never-billed business: the floor is its creation date ─────────────────
SELECT pg_temp.as_user('e5a10000-0000-0000-0000-0000000000c1');
RESET ROLE;
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id)
SELECT 'e5a20000-0000-0000-0000-0000000000c1',
       (SELECT id FROM coaches WHERE profile_id = 'e5a10000-0000-0000-0000-0000000000c8'), 'ESD N1', 'monday', '09:00', '10:00',
       (SELECT id FROM locations WHERE tenant_id = 'e5a00000-0000-0000-0000-0000000000c0' AND lower(trim(name)) = 'default location'), 30.00,
       (SELECT id FROM class_categories WHERE tenant_id = 'e5a00000-0000-0000-0000-0000000000c0' AND lower(trim(name)) = 'default group');
SET LOCAL ROLE authenticated;
SELECT is((enrolment_start_bounds('e5a20000-0000-0000-0000-0000000000c1') ->> 'floor')::date,
  ((app_now() - INTERVAL '60 days') AT TIME ZONE 'Asia/Singapore')::date,
  '13: a never-billed business''s floor is its creation date (the UI must warn about unbilled months)');

-- ── 14. The fourth path: add_unclaimed_student (D12) ────────────────────────────
SELECT pg_temp.as_user('e5a10000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ SELECT add_unclaimed_student(p_class_id => 'e5a20000-0000-0000-0000-000000000001',
  p_full_name => 'ESD Old Shape', p_kind => 'ongoing') $$,
  '14: the OLD named-argument call still works (the live app until it is redeployed)');
SELECT lives_ok(format($$ SELECT add_unclaimed_student(p_class_id => 'e5a20000-0000-0000-0000-000000000001',
  p_full_name => 'ESD New Shape', p_kind => 'ongoing', p_starts_on => %L) $$, (SELECT d7 FROM f)),
  '14: a new child with a past start');
SELECT throws_ok(format($$ SELECT add_unclaimed_student(p_class_id => 'e5a20000-0000-0000-0000-000000000001',
  p_full_name => 'ESD Trial', p_kind => 'trial', p_session_date => %L, p_starts_on => %L) $$,
  (SELECT today FROM f), (SELECT d7 FROM f)), '23514', NULL, '14: a trial with a start date is refused');

RESET ROLE;
SELECT is((SELECT (e.enrolled_at AT TIME ZONE 'Asia/Singapore')::date FROM student_class_enrolments e
             JOIN students s ON s.id = e.student_id WHERE s.full_name = 'ESD New Shape'),
  (SELECT d7 FROM f), '14: the new child''s start is the chosen date');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'add_unclaimed_student'), 1,
  '14: exactly one add_unclaimed_student (no overload, §7.124)');

SELECT * FROM finish();
ROLLBACK;
