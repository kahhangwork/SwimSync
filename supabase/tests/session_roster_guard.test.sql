-- pgTAP: the Wave 3 follow-up — 20260812000100_session_roster_guard.sql.
--
-- Plan: docs/plans/WAVE_3_FOLLOWUP_PLAN.md, and its ranked /plan-review. Two
-- things are under test:
--
--   1. assign_session_coach()'s shadow branch can no longer DEMOTE a lesson's
--      main — in EITHER of the two ways a lesson has a main. The row main (a
--      session_coaches row) and the ABSENCE main (no roster row, so the class's
--      own coach teaches it) both produce the same bug when demoted: the lesson
--      is left with no main, the absence rule takes over, and the money quietly
--      moves back to the class's coach.
--   2. sessions_i_am_main_on() answers EXACTLY the subset of its argument the
--      caller is main on. The client subtracts that answer from what it asked,
--      so every property here is one the client is allowed to trust — a short
--      answer hides a lesson that needs marking, and unmarked attendance blocks
--      the billing month with no override (§8i).
--
-- ⚠ A SEPARATE FILE FROM session_coach_roster.test.sql ON PURPOSE. That file's
-- 40 checks are a STATE CHAIN — it settles a July payout, seals months and
-- leaves roster rows in place — and half of what is asserted here needs a
-- lesson with NO roster main and session ids nothing else has touched. Building
-- that on the tail of the chain is more fragile than a fixture of its own.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(16);

-- ── fixture ────────────────────────────────────────────────────────────────
-- Two tenants: the one under test, and a foreign one whose session id is what
-- proves SECURITY DEFINER does not leak across the boundary.
INSERT INTO tenants (id, slug, display_name, join_code, rain_pays_coach)
VALUES ('98888888-0000-0000-0000-000000000001','guard','Guard Swim','SWIM-GRD1', FALSE),
       ('98888888-0000-0000-0000-000000000002','guardx','Other Swim','SWIM-GRD2', FALSE);

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','72000000-0000-0000-0000-000000000001','authenticated','authenticated','g-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"G Admin","role":"tenant_admin","tenant_id":"98888888-0000-0000-0000-000000000001"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','72000000-0000-0000-0000-000000000002','authenticated','authenticated','g-coachA@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"Guard A","role":"coach","tenant_id":"98888888-0000-0000-0000-000000000001"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','72000000-0000-0000-0000-000000000003','authenticated','authenticated','g-coachB@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"Guard B","role":"coach","tenant_id":"98888888-0000-0000-0000-000000000001"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','72000000-0000-0000-0000-000000000004','authenticated','authenticated','g-coachC@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"Guard C","role":"coach","tenant_id":"98888888-0000-0000-0000-000000000001"}', now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','72000000-0000-0000-0000-000000000005','authenticated','authenticated','g-coachX@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}','{"full_name":"Guard X","role":"coach","tenant_id":"98888888-0000-0000-0000-000000000002"}', now(), now(), '','','','');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE t.id IN ('98888888-0000-0000-0000-000000000001','98888888-0000-0000-0000-000000000002')
   AND NOT EXISTS (SELECT 1 FROM class_categories c
                    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

-- Saturday classes; every date below is a Saturday or guard_session_date
-- refuses the row.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT '68000000-0000-0000-0000-000000000001', c.id, 'Guard Lane', 'saturday','10:00','11:00','Pool', 40,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = c.tenant_id AND lower(trim(cc.name)) = 'default group')
  FROM coaches c WHERE c.profile_id = '72000000-0000-0000-0000-000000000002';

INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT '68000000-0000-0000-0000-000000000009', c.id, 'Foreign Lane', 'saturday','10:00','11:00','Pool', 40,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = c.tenant_id AND lower(trim(cc.name)) = 'default group')
  FROM coaches c WHERE c.profile_id = '72000000-0000-0000-0000-000000000005';

INSERT INTO students (id, full_name, assignment_status, tenant_id)
VALUES ('57000000-0000-0000-0000-000000000001','Guard Kid','assigned','98888888-0000-0000-0000-000000000001');
INSERT INTO student_class_enrolments (student_id, class_id, is_active)
VALUES ('57000000-0000-0000-0000-000000000001','68000000-0000-0000-0000-000000000001', TRUE);

-- S1 — the COVERED lesson. Gets a roster main below.
INSERT INTO lesson_sessions (id, class_id, session_date)
VALUES ('46000000-0000-0000-0000-000000000001','68000000-0000-0000-0000-000000000001','2026-08-08');
-- S2 — the UNTOUCHED lesson. Never gets a roster row, so its main is Guard A
-- by the absence rule and nothing else. This is what checks 7 and 12 need.
INSERT INTO lesson_sessions (id, class_id, session_date)
VALUES ('46000000-0000-0000-0000-000000000002','68000000-0000-0000-0000-000000000001','2026-08-15');
-- SX — the foreign tenant's lesson.
INSERT INTO lesson_sessions (id, class_id, session_date)
VALUES ('46000000-0000-0000-0000-000000000009','68000000-0000-0000-0000-000000000009','2026-08-08');


-- ═══ 1. THE GUARD — the ROW main ═══════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"72000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Guard B covers S1. From here S1 has an explicit main row.
SELECT set_session_main_coach('46000000-0000-0000-0000-000000000001',
  (SELECT id FROM coaches WHERE profile_id='72000000-0000-0000-0000-000000000003'));

SELECT throws_ok(
  $$ SELECT assign_session_coach('68000000-0000-0000-0000-000000000001','2026-08-08',
       (SELECT id FROM coaches WHERE profile_id='72000000-0000-0000-0000-000000000003'),'shadow') $$,
  NULL, 'that coach is already the main coach for this lesson — change the main coach first, or the lesson would be left with none',
  'shadowing the lesson''s CURRENT MAIN is refused — it would leave the lesson with no main and move the pay');

SELECT is(
  (SELECT p.full_name FROM session_coaches sc
     JOIN coaches c ON c.id = sc.coach_id JOIN profiles p ON p.id = c.profile_id
    WHERE sc.lesson_session_id='46000000-0000-0000-0000-000000000001' AND sc.role='main'),
  'Guard B',
  'and the refusal did not half-apply — the main row is still there and still MAIN');

SELECT lives_ok(
  $$ SELECT assign_session_coach('68000000-0000-0000-0000-000000000001','2026-08-08',
       (SELECT id FROM coaches WHERE profile_id='72000000-0000-0000-0000-000000000004'),'shadow') $$,
  'a DIFFERENT coach can still be added as a shadow — the guard is not a blanket refusal');

SELECT lives_ok(
  $$ SELECT assign_session_coach('68000000-0000-0000-0000-000000000001','2026-08-08',
       (SELECT id FROM coaches WHERE profile_id='72000000-0000-0000-0000-000000000004'),'shadow') $$,
  'IDEMPOTENCE SURVIVES — re-adding an existing shadow updates role to what it already holds, so FOUND is true');

SELECT lives_ok(
  $$ SELECT assign_session_coach('68000000-0000-0000-0000-000000000001','2026-08-08',
       (SELECT id FROM coaches WHERE profile_id='72000000-0000-0000-0000-000000000004'),'main') $$,
  'promoting an existing SHADOW to main still works — only the demote direction is a bug');


-- ═══ 2. THE GUARD — the ABSENCE main ══════════════════════════════════════
-- The half no client path can reach, and the half a row-only guard misses:
-- S2 has no roster row at all, so its main is the class's own coach by the
-- absence rule, and `ON CONFLICT ... WHERE role <> 'main'` has nothing to see.
--
-- 2026-08-22 deliberately has NO lesson_sessions row, so this also proves the
-- resolve-or-create half rolls back with the refusal (§7.132's orphan class).
SELECT throws_ok(
  $$ SELECT assign_session_coach('68000000-0000-0000-0000-000000000001','2026-08-22',
       (SELECT id FROM coaches WHERE profile_id='72000000-0000-0000-0000-000000000002'),'shadow') $$,
  NULL, 'that coach already teaches this lesson as the class''s coach — adding them as a shadow would say two different things about one person',
  'shadowing the CLASS''S OWN COACH on a lesson with no roster main is refused too — the ABSENCE main');

SELECT is(
  (SELECT count(*)::INT FROM lesson_sessions
    WHERE class_id='68000000-0000-0000-0000-000000000001' AND session_date='2026-08-22'),
  0,
  'and NO orphan lesson_sessions row survives the refusal — resolve-or-create rolled back with it');


-- ═══ 3. sessions_i_am_main_on — what the client is allowed to trust ════════
-- Asked as GUARD A, the coach who OWNS the class and was replaced on S1. Their
-- screen is the one that must stop nagging about S1 and keep nagging about S2,
-- and session_coaches_select hides the row that would tell them (§7.134).
SET LOCAL "request.jwt.claims" TO '{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::INT FROM sessions_i_am_main_on(ARRAY[
     '46000000-0000-0000-0000-000000000001',
     '46000000-0000-0000-0000-000000000002']::uuid[])
    WHERE sessions_i_am_main_on = '46000000-0000-0000-0000-000000000002'),
  1,
  'the replaced coach IS still main on the lesson nobody covered — by the absence rule, with no roster row');

SELECT is(
  (SELECT count(*)::INT FROM session_coaches
    WHERE lesson_session_id='46000000-0000-0000-0000-000000000002'),
  0,
  'and that answer really is the ABSENCE rule — S2 has no session_coaches row of any kind');

SELECT is(
  (SELECT count(*)::INT FROM sessions_i_am_main_on(ARRAY[
     '46000000-0000-0000-0000-000000000001',
     '46000000-0000-0000-0000-000000000002']::uuid[])
    WHERE sessions_i_am_main_on = '46000000-0000-0000-0000-000000000001'),
  0,
  '§7.134 — and the lesson another coach covers is EXCLUDED, which is the whole reason the probe exists');

SELECT is(
  (SELECT count(*)::INT FROM sessions_i_am_main_on(ARRAY[]::uuid[])),
  0,
  'an EMPTY array returns zero rows rather than erroring — the client stops calling, it does not stop working');

SELECT is(
  (SELECT count(*)::INT FROM sessions_i_am_main_on(ARRAY[
     '46000000-0000-0000-0000-000000000009']::uuid[])),
  0,
  'a FOREIGN tenant''s session is not returned — SECURITY DEFINER does not leak across the boundary');

-- ⚠ A NULL ELEMENT IN THE INPUT, which is the only thing that can make this
-- function emit one. Asserting `WHERE s IS NULL` over an array with no NULLs in
-- it counts 0 whatever the body does — it stayed green with the IS NOT NULL
-- guard deleted AND with the function returning nothing at all (§7.101, caught
-- in review). The set is asserted exactly, not just its NULL count.
SELECT set_eq(
  $$ SELECT s FROM sessions_i_am_main_on(ARRAY[
       NULL,
       '46000000-0000-0000-0000-000000000009',
       '46000000-0000-0000-0000-000000000002',
       '46000000-0000-0000-0000-0000000000ff']::uuid[]) s $$,
  ARRAY['46000000-0000-0000-0000-000000000002']::uuid[],
  'a NULL, a foreign tenant''s id and an id that does not exist are ALL absent from the answer — never a NULL the client would subtract');

-- The two properties the client's shape validation is defence-in-depth FOR.
SELECT is(
  (SELECT count(*)::INT FROM sessions_i_am_main_on(ARRAY[
     '46000000-0000-0000-0000-000000000001',
     '46000000-0000-0000-0000-000000000002']::uuid[]) s
    WHERE s NOT IN ('46000000-0000-0000-0000-000000000001',
                    '46000000-0000-0000-0000-000000000002')),
  0,
  'NEVER returns an id that was not asked about — the client treats an unasked id as proof the whole answer is untrustworthy');

SELECT is(
  (SELECT count(*)::INT FROM sessions_i_am_main_on(ARRAY[
     '46000000-0000-0000-0000-000000000002',
     '46000000-0000-0000-0000-000000000002']::uuid[])),
  1,
  'a DUPLICATED id comes back at most once — the server must not be the thing that makes the counts disagree');

-- ⚠ THE ANTI-DRIFT CHECK. sessions_i_am_main_on's body is
-- coach_is_main_on_session() and nothing else, because two copies of "who is
-- main" is the bug waiting to happen (§7.129 cost this wave a double payment).
-- This is what goes red if a later "optimisation" inlines the rule.
SELECT is(
  (SELECT count(*)::INT FROM unnest(ARRAY[
     '46000000-0000-0000-0000-000000000001',
     '46000000-0000-0000-0000-000000000002',
     '46000000-0000-0000-0000-000000000009']::uuid[]) AS a(id)
    WHERE coach_is_main_on_session(a.id)
       <> (a.id IN (SELECT s FROM sessions_i_am_main_on(ARRAY[
             '46000000-0000-0000-0000-000000000001',
             '46000000-0000-0000-0000-000000000002',
             '46000000-0000-0000-0000-000000000009']::uuid[]) s))),
  0,
  'the batch and the single-session gate AGREE on every id — one rule, two call shapes, never two rules');

SELECT * FROM finish();
ROLLBACK;
