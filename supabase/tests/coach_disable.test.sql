-- pgTAP: DISABLE A COACH (20260813000200, Wave 5 chunk 2).
--
-- WHAT EACH BLOCK PROVES:
--   1. Fixture controls: profiles/coaches built, owners claimed, the target
--      really is a coach with authority (the positive control against a
--      silently-superuser run, §7.16).
--   2. Gates: coach, parent and a CROSS-TENANT admin are all refused on both
--      RPCs; unknown coach refused.
--   3. Pre-write refusals: active classes with no replacement (naming the
--      classes — ACTIVE only, the retired one is not named); self-replacement;
--      cross-tenant replacement.
--   4. The sole-coach-who-is-the-owner guard (tenant B: owner, sole coach).
--   5. THE DISABLE, by a CO-ADMIN (decision 7), with the PREVIOUS month sealed
--      — the normal arrears state (⚠ RISK 7a). Classes handed to the
--      replacement via an effective-dated class_rates row; the RETIRED class
--      untouched; shadow rows END-DATED never deleted; FUTURE substitute
--      overrides deleted, past ones kept; audit row tenant-stamped by the new
--      'Coach' arm (§7.37); idempotent re-run writes no second row.
--   6. Authority dark: current_coach_id() NULL, classes/sessions/attendance
--      all gone — while the current_tenant_id()-scoped reads STAY LIT, pinned
--      as EXPECTED (⚠ RISK 5: accepted, token-lifetime, the auth ban is the
--      enforcement). A disabled coach cannot reactivate themselves.
--   7. The guard is LOAD-BEARING: the disabled coach's own UPDATE clearing
--      disabled_at is refused (coaches_update's self-arm would otherwise let
--      it through), and so is an admin's direct UPDATE.
--   8. ⚠ RISK 8: a PAST session whose substitute override names the disabled
--      coach — the replacement canNOT mark it, the admin CAN, and the month
--      has no unmarked (student, lesson) pair left once they do.
--   9. Payroll is UNTOUCHED: the disabled coach's taught July lessons still
--      produce their payout at their own rate — disabling is forward-looking.
--  10. An admin-who-coaches keeps ADMIN authority when their coach half is
--      disabled (BACKLOG:1188's mirror image), and can run the reactivation.
--  11. Reactivation: gate + idempotency and NOTHING else; classes are NOT
--      handed back. A disabled coach is refused as a replacement.
--  12. ⚠ RISK 7b: with a PAID current-month payout, the disable ABORTS
--      ATOMICALLY — coach not disabled, classes not moved, shadow not ended.
--  13. Staff-shape invariant: no profile holds both a parents row and a staff
--      tenant_id (chunk 3's bulk ban leans on this).
--  14. anon holds EXECUTE on neither RPC.
--
-- ORDER IS FORCED BY THE SEALS, same as class_shadow_coaches.test.sql: the
-- July billing seal lands before the disable (that IS case 7a), and the PAID
-- August payout lands last — after it, no reassignment and no shadow write in
-- August can succeed at all.
--
-- PROVEN RED (§7.25), five measured sabotages, all run 2026-08-13:
--   • current_coach_id() reverted to its pre-migration body (no disabled_at
--     clause): 6/55 fail — 28-31 and 43 directly (the disabled coach KEEPS
--     their authority), 38 downstream (test 31's insert lands under the
--     sabotage, so the admin's mark collides).
--   • coaches_guard_privileges trigger DROPPED: 7/55 fail — 34/35 directly
--     (the self-clear LANDS — coaches_update's self-arm is real, the guard is
--     load-bearing, not belt-and-braces), and 46/48/50/51/52 downstream
--     because test 34's successful self-clear re-enabled the coach early.
--   • audit_log_tenant_of reverted to the chunk-1 body (no 'Coach' arm):
--     23/55 fail — the disable itself dies on its own audit INSERT, §7.37's
--     design doing its job.
--   • the sole-owner-coach guard disabled (IF FALSE): exactly 1 fail — 15;
--     the forbidden disable LANDS and B's business loses its only coach.
--   • the is_tenant_admin gate off both RPCs (IF FALSE): 12/55 fail —
--     7/8/9/10/33 directly (a coach, a parent and a FOREIGN admin all reach
--     the write), 34/35/46/48/50/51/52 downstream of 33's successful
--     self-reactivation. That cascade is the self-rescue path the gate closes.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(55);

-- ── Fixture ──────────────────────────────────────────────────────────────────
-- Tenant A: owner-admin-who-coaches OA, co-admin CA, target coach T,
-- replacement coach R, parent P. Tenant B: owner BO, who is B's ONLY coach.
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('d15a0000-0000-0000-0000-000000000001','cd-school','Coach Disable School','SWIM-CDSA'),
  ('d15b0000-0000-0000-0000-000000000001','cd-solo','Coach Disable Solo','SWIM-CDSB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','d15a0000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','cd-owner@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Owner Odele","role":"tenant_admin","tenant_id":"d15a0000-0000-0000-0000-000000000001","is_coach":true}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','d15a0000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','cd-coadmin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Coadmin Chris","role":"tenant_admin","tenant_id":"d15a0000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','d15a0000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','cd-target@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Target Tara","role":"coach","tenant_id":"d15a0000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','d15a0000-0000-0000-0000-0000000000c2',
   'authenticated','authenticated','cd-replacement@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Replacement Rae","role":"coach","tenant_id":"d15a0000-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','d15a0000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','cd-parent@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','d15b0000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','cd-solo-owner@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"Solo Sam","role":"tenant_admin","tenant_id":"d15b0000-0000-0000-0000-000000000001","is_coach":true}', now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM class_categories c
                    WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

-- Saturday classes (every session date below is a Saturday). X is the target's
-- active class; Y is the replacement's, which the target SHADOWS and
-- SUBSTITUTES on; Z is the target's RETIRED class — the proof that only
-- active classes are handed over.
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'd15a0000-0000-0000-0000-000000000011', c.id, 'Target Lane', 'saturday','09:00','10:00','Pool', 40,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = c.tenant_id AND lower(trim(cc.name)) = 'default group')
  FROM coaches c WHERE c.profile_id = 'd15a0000-0000-0000-0000-0000000000c1';
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, category_id)
SELECT 'd15a0000-0000-0000-0000-000000000012', c.id, 'Replacement Lane', 'saturday','11:00','12:00','Pool', 40,
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = c.tenant_id AND lower(trim(cc.name)) = 'default group')
  FROM coaches c WHERE c.profile_id = 'd15a0000-0000-0000-0000-0000000000c2';
INSERT INTO classes (id, coach_id, title, day_of_week, start_time, end_time, location_name, price_per_lesson, is_active, deactivated_at, category_id)
SELECT 'd15a0000-0000-0000-0000-000000000013', c.id, 'Retired Lane', 'saturday','13:00','14:00','Pool', 40, FALSE, now(),
       (SELECT cc.id FROM class_categories cc
         WHERE cc.tenant_id = c.tenant_id AND lower(trim(cc.name)) = 'default group')
  FROM coaches c WHERE c.profile_id = 'd15a0000-0000-0000-0000-0000000000c1';

INSERT INTO students (id, full_name, assignment_status, tenant_id) VALUES
  ('d15a0000-0000-0000-0000-000000000021','Target Kid','assigned','d15a0000-0000-0000-0000-000000000001'),
  ('d15a0000-0000-0000-0000-000000000022','Replacement Kid','assigned','d15a0000-0000-0000-0000-000000000001');
INSERT INTO student_class_enrolments (student_id, class_id, is_active) VALUES
  ('d15a0000-0000-0000-0000-000000000021','d15a0000-0000-0000-0000-000000000011', TRUE),
  ('d15a0000-0000-0000-0000-000000000022','d15a0000-0000-0000-0000-000000000012', TRUE);

-- Rates: the target holds a main AND a shadow rate; the replacement a main
-- rate. The owners hold NONE — "no rate is the finished state" (PRD §7.13),
-- and it keeps them out of the payroll loop here.
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from, role)
SELECT c.id, 30.00, 60, '2026-01-01', 'main'   FROM coaches c WHERE c.profile_id='d15a0000-0000-0000-0000-0000000000c1';
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from, role)
SELECT c.id, 10.00, 60, '2026-01-01', 'shadow' FROM coaches c WHERE c.profile_id='d15a0000-0000-0000-0000-0000000000c1';
INSERT INTO coach_rates (coach_id, amount, unit_minutes, effective_from, role)
SELECT c.id, 25.00, 60, '2026-01-01', 'main'   FROM coaches c WHERE c.profile_id='d15a0000-0000-0000-0000-0000000000c2';

-- Lessons. X: one JULY lesson (the payout month) and one August, both marked
-- by the target. Y: a PAST August lesson (unmarked — the ⚠ RISK 8 subject)
-- and a FUTURE one, each carrying a substitute override naming the target.
INSERT INTO lesson_sessions (id, class_id, session_date, status) VALUES
  ('d15a0000-0000-0000-0000-000000000031','d15a0000-0000-0000-0000-000000000011','2026-07-04','completed'),
  ('d15a0000-0000-0000-0000-000000000032','d15a0000-0000-0000-0000-000000000011','2026-08-01','completed'),
  ('d15a0000-0000-0000-0000-000000000033','d15a0000-0000-0000-0000-000000000012','2026-08-08','completed'),
  ('d15a0000-0000-0000-0000-000000000034','d15a0000-0000-0000-0000-000000000012','2026-08-15','scheduled');
INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
SELECT ls.id,'d15a0000-0000-0000-0000-000000000021','present','d15a0000-0000-0000-0000-0000000000c1'
  FROM lesson_sessions ls WHERE ls.id IN
    ('d15a0000-0000-0000-0000-000000000031','d15a0000-0000-0000-0000-000000000032');

-- The target shadows the replacement's class (stamp trigger fills tenant)…
INSERT INTO class_shadow_coaches (tenant_id, class_id, coach_id, effective_from, assigned_by)
SELECT 'd15a0000-0000-0000-0000-000000000001','d15a0000-0000-0000-0000-000000000012', c.id, '2026-08-01',
       'd15a0000-0000-0000-0000-0000000000a1'
  FROM coaches c WHERE c.profile_id='d15a0000-0000-0000-0000-0000000000c1';
-- …and substitutes on its past AND future lesson.
INSERT INTO session_coaches (tenant_id, lesson_session_id, coach_id, assigned_by)
SELECT 'd15a0000-0000-0000-0000-000000000001', ls.id, c.id, 'd15a0000-0000-0000-0000-0000000000a1'
  FROM lesson_sessions ls, coaches c
 WHERE ls.id IN ('d15a0000-0000-0000-0000-000000000033','d15a0000-0000-0000-0000-000000000034')
   AND c.profile_id='d15a0000-0000-0000-0000-0000000000c1';

-- Coach ids, captured while still postgres. The GATE probes below run under
-- claims that cannot SEE these rows (a parent, a cross-tenant admin) — an
-- inline subselect under their RLS returns NULL and the RPC answers 'no such
-- coach' before the gate is ever reached, which tests nothing. Same device as
-- class_shadow_coaches' _foreign_coach; the non-NULL control is test 55.
CREATE TEMP TABLE _c AS SELECT
  (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000a1') AS oa,
  (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1') AS t,
  (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c2') AS r,
  (SELECT id FROM coaches WHERE profile_id='d15b0000-0000-0000-0000-0000000000b1') AS b;
-- Without this, the probes die on 'permission denied for table _c' — an error
-- a message-pinned throws_ok catches, but a NULL-message one would call PASS.
GRANT SELECT ON _c TO authenticated;

-- ============================================================
-- 1. FIXTURE CONTROLS
-- ============================================================

-- 1
SELECT is(
  (SELECT COUNT(*) FROM profiles WHERE id IN
    ('d15a0000-0000-0000-0000-0000000000a1','d15a0000-0000-0000-0000-0000000000a2',
     'd15a0000-0000-0000-0000-0000000000c1','d15a0000-0000-0000-0000-0000000000c2',
     'd15a0000-0000-0000-0000-0000000000d1','d15b0000-0000-0000-0000-0000000000b1'))::int,
  6, 'control: handle_new_user built all six fixture profiles');

-- 2
SELECT is(
  (SELECT COUNT(*) FROM coaches WHERE profile_id IN
    ('d15a0000-0000-0000-0000-0000000000a1','d15b0000-0000-0000-0000-0000000000b1'))::int,
  2, 'control: both owners hold coach EXTENSION ROWS (admin-who-coaches is real)');

-- 3
SELECT is(
  (SELECT owner_profile_id FROM tenants WHERE id = 'd15b0000-0000-0000-0000-000000000001'),
  'd15b0000-0000-0000-0000-0000000000b1'::uuid,
  'control: B''s sole admin owns B (the sole-owner-coach guard has a real subject)');

-- Positive controls under the TARGET's own claims — authority is real before
-- the disable, so "dark" later means the disable did it (§7.16).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d15a0000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- 4
SELECT isnt((SELECT current_coach_id()), NULL,
  'control: before the disable the target RESOLVES as a coach');

-- 5
SELECT is((SELECT COUNT(*)::int FROM classes WHERE id='d15a0000-0000-0000-0000-000000000011'),
  1, 'control: the target reads their own class');

-- 6
SELECT ok(coach_is_main_on_session('d15a0000-0000-0000-0000-000000000033'),
  'control: the substitute override makes the target MAIN on the past lesson (⚠ RISK 8 subject)');

-- ============================================================
-- 2. GATES — both RPCs, every wrong caller
-- ============================================================

-- 7. A coach cannot disable a colleague.
SELECT throws_ok(
  $$ SELECT disable_coach((SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c2')) $$,
  'P0001', 'not permitted to manage coaches for this business',
  'a coach cannot disable another coach');

-- 8. A parent is refused. (Real id from _c: the parent's own RLS cannot see
--    the coach row, and a NULL argument tests the wrong refusal.)
SET LOCAL "request.jwt.claims" TO '{"sub":"d15a0000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT disable_coach((SELECT t FROM _c)) $$,
  'P0001', 'not permitted to manage coaches for this business',
  'a parent is refused');

-- 9. A CROSS-TENANT admin is refused — B's owner cannot touch A's coach.
SET LOCAL "request.jwt.claims" TO '{"sub":"d15b0000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT disable_coach((SELECT t FROM _c)) $$,
  'P0001', 'not permitted to manage coaches for this business',
  'an admin of ANOTHER business is refused');

-- 10. Same gate on the mirror RPC.
SELECT throws_ok(
  $$ SELECT reactivate_coach((SELECT t FROM _c)) $$,
  'P0001', 'not permitted to manage coaches for this business',
  'reactivate_coach carries the same gate');

-- 11. An unknown coach id.
SET LOCAL "request.jwt.claims" TO '{"sub":"d15a0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT disable_coach('00000000-0000-0000-0000-00000000dead') $$,
  'P0001', 'no such coach',
  'an unknown coach id is refused');

-- ============================================================
-- 3. PRE-WRITE REFUSALS (as the co-admin — decision 7's actor)
-- ============================================================

-- 12. Active classes, no replacement — the refusal NAMES the active classes
--     and does not name the retired one.
SELECT throws_ok(
  $$ SELECT disable_coach((SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')) $$,
  'P0001',
  'this coach still teaches: Target Lane. Choose a replacement coach — the classes are handed over and the coach disabled in one step.',
  'active classes with no replacement: refused, naming ONLY the active class');

-- 13. Self-replacement.
SELECT throws_ok(
  $$ SELECT disable_coach(
       (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1'),
       (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')) $$,
  'P0001', 'a coach cannot be their own replacement',
  'a coach cannot be their own replacement');

-- 14. A cross-tenant replacement. (Real id from _c — under A's admin the
--     inline subselect for B's coach is NULL, which would exercise the
--     no-replacement branch instead.)
SELECT throws_ok(
  $$ SELECT disable_coach((SELECT t FROM _c), (SELECT b FROM _c)) $$,
  'P0001', 'the replacement must be an active coach of this business',
  'a coach of another business is refused as replacement');

-- ============================================================
-- 4. THE SOLE-COACH-WHO-IS-THE-OWNER GUARD (tenant B)
-- ============================================================

-- 15. B's owner is B's only active coach: refused, extension-rows-decided.
SET LOCAL "request.jwt.claims" TO '{"sub":"d15b0000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT disable_coach((SELECT id FROM coaches WHERE profile_id='d15b0000-0000-0000-0000-0000000000b1')) $$,
  'P0001',
  'this is the owner''s coach account and the business''s only active coach — hire another coach before disabling it',
  'the owner''s coach row is refused while it is the business''s ONLY active coach');

-- ============================================================
-- 5. THE DISABLE — co-admin actor, previous month sealed (⚠ RISK 7a)
-- ============================================================
RESET ROLE;
-- Seal JULY: the normal arrears state a real disable happens in. This is the
-- ⚠ RISK 7a fixture — set_class_terms refuses only a seal at/after the
-- CURRENT month, so this must pass.
INSERT INTO billing_periods (tenant_id, billing_month, invoices_issued)
VALUES ('d15a0000-0000-0000-0000-000000000001','2026-07', 1);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d15a0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- 16. The disable lands — a CO-ADMIN, not the owner, with July sealed.
SELECT lives_ok(
  $$ SELECT disable_coach(
       (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1'),
       (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c2')) $$,
  '⚠ RISK 7a — the disable succeeds with the PREVIOUS month sealed (arrears state), run by a co-admin');

-- 17. disabled_at is set.
SELECT isnt(
  (SELECT disabled_at FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1'),
  NULL, 'the target is disabled');

-- 18. The active class moved to the replacement.
SELECT is(
  (SELECT c.coach_id FROM classes c WHERE c.id='d15a0000-0000-0000-0000-000000000011'),
  (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c2'),
  'the active class now belongs to the replacement');

-- 19. …via an EFFECTIVE-DATED class_rates row, today, same price.
SELECT is(
  (SELECT COUNT(*)::int FROM class_rates r
    WHERE r.class_id='d15a0000-0000-0000-0000-000000000011'
      AND r.effective_from = today_sg()
      AND r.price_per_lesson = 40
      AND r.paid_coach_id = (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c2')),
  1, 'the handover wrote the effective-dated class_rates row (wage history preserved)');

-- 20. The RETIRED class was not touched.
SELECT is(
  (SELECT c.coach_id FROM classes c WHERE c.id='d15a0000-0000-0000-0000-000000000013'),
  (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1'),
  'the retired class still names the disabled coach — history, not a live roster');

-- 21. The shadow row is END-DATED today, by the actor — never deleted.
SELECT is(
  (SELECT COUNT(*)::int FROM class_shadow_coaches s
    WHERE s.coach_id=(SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')
      AND s.class_id='d15a0000-0000-0000-0000-000000000012'
      AND s.effective_to = today_sg()
      AND s.ended_by = 'd15a0000-0000-0000-0000-0000000000a2'),
  1, 'the shadow assignment is end-dated today by the disabling admin, and KEPT');

-- 22. The FUTURE substitute override is gone…
SELECT is(
  (SELECT COUNT(*)::int FROM session_coaches
    WHERE lesson_session_id='d15a0000-0000-0000-0000-000000000034'),
  0, 'the future substitute override is deleted');

-- 23. …and the PAST one is intact (wage history + the ⚠ RISK 8 subject).
SELECT is(
  (SELECT COUNT(*)::int FROM session_coaches
    WHERE lesson_session_id='d15a0000-0000-0000-0000-000000000033'
      AND coach_id=(SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')),
  1, 'the past substitute override still names the disabled coach');

-- 24. The audit row landed, tenant-stamped by the NEW 'Coach' arm — the INSERT
--     reaching the table at all proves the arm exists (§7.37).
SELECT is(
  (SELECT COUNT(*)::int FROM audit_log
    WHERE action='coach_disabled'
      AND entity_type='Coach'
      AND entity_id=(SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')
      AND tenant_id='d15a0000-0000-0000-0000-000000000001'),
  1, 'one coach_disabled audit row, tenant-stamped by the Coach arm');

-- 25. It names the replacement and the moved class.
SELECT is(
  (SELECT (new_value->>'replacement_coach_id')::uuid = (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c2')
      AND new_value->'classes_reassigned' @> '["d15a0000-0000-0000-0000-000000000011"]'
     FROM audit_log WHERE action='coach_disabled'
    ORDER BY created_at DESC LIMIT 1),
  TRUE, 'the audit row records the replacement and the reassigned class');

-- 26. Idempotent: a second disable is a silent no-op…
SELECT lives_ok(
  $$ SELECT disable_coach((SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')) $$,
  're-running the disable succeeds as a no-op');

-- 27. …with no second audit row.
SELECT is(
  (SELECT COUNT(*)::int FROM audit_log WHERE action='coach_disabled')::int,
  1, 'the idempotent re-run wrote no second audit row');

-- ============================================================
-- 6. AUTHORITY DARK — and the ⚠ RISK 5 residue, pinned as EXPECTED
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub":"d15a0000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- 28. The identity helper answers NULL.
SELECT is((SELECT current_coach_id()), NULL,
  'current_coach_id() is NULL for a disabled coach');

-- 29. Every class is gone (own-class arm, roster arm, shadow arm — all flow
--     through the helper).
SELECT is((SELECT COUNT(*)::int FROM classes), 0,
  'a disabled coach reads ZERO classes');

-- 30. Every lesson is gone.
SELECT is((SELECT COUNT(*)::int FROM lesson_sessions), 0,
  'a disabled coach reads ZERO lessons');

-- 31. Attendance writes are refused (the override on the past lesson no longer
--     resolves to them).
SELECT throws_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     VALUES ('d15a0000-0000-0000-0000-000000000033','d15a0000-0000-0000-0000-000000000022',
             'present','d15a0000-0000-0000-0000-0000000000c1') $$,
  '42501', NULL,
  'a disabled coach cannot write attendance, even on their old override lesson');

-- 32. ⚠ RISK 5, PINNED AS EXPECTED — NOT A LEAK. The current_tenant_id()-scoped
--     reads stay lit for the token lifetime (accepted consequence 2,
--     WAVE_5_PLAN.md): the auth-layer ban is the enforcement. A future session
--     finding this test finds a documented decision.
SELECT is((SELECT COUNT(*)::int FROM coaches
            WHERE tenant_id='d15a0000-0000-0000-0000-000000000001'),
  3, 'EXPECTED residue (⚠ RISK 5): a disabled coach still passes current_tenant_id()-scoped reads — token-lifetime, the ban enforces');

-- 33. A disabled coach cannot reactivate themselves through the RPC.
SELECT throws_ok(
  $$ SELECT reactivate_coach((SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')) $$,
  'P0001', 'not permitted to manage coaches for this business',
  'a disabled coach cannot reactivate themselves');

-- ============================================================
-- 7. THE GUARD IS LOAD-BEARING
-- ============================================================

-- 34. The disabled coach's own UPDATE clearing disabled_at is refused —
--     coaches_update's self-arm (profile_id = auth.uid()) reaches the row;
--     ONLY the guard stands between them and re-enabling themselves.
SELECT throws_ok(
  $$ UPDATE coaches SET disabled_at = NULL
      WHERE profile_id = 'd15a0000-0000-0000-0000-0000000000c1' $$,
  'P0001',
  'coaches.profile_id / tenant_id / disabled_at cannot be changed directly — use disable_coach()/reactivate_coach() (20260813000200)',
  'THE LOAD-BEARING CASE: a disabled coach cannot clear their own disabled_at');

-- 35. An admin's direct write is refused the same way (the RPCs are the only
--     path).
SET LOCAL "request.jwt.claims" TO '{"sub":"d15a0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT throws_ok(
  $$ UPDATE coaches SET disabled_at = NULL
      WHERE profile_id = 'd15a0000-0000-0000-0000-0000000000c1' $$,
  'P0001',
  'coaches.profile_id / tenant_id / disabled_at cannot be changed directly — use disable_coach()/reactivate_coach() (20260813000200)',
  'an admin cannot clear disabled_at by direct UPDATE either');

-- ============================================================
-- 8. ⚠ RISK 8 — the past override lesson after the disable
-- ============================================================

-- 36. The REPLACEMENT is not main on it (the override still names the
--     disabled coach) and cannot mark it.
SET LOCAL "request.jwt.claims" TO '{"sub":"d15a0000-0000-0000-0000-0000000000c2","role":"authenticated"}';
SELECT ok(NOT coach_is_main_on_session('d15a0000-0000-0000-0000-000000000033'),
  '⚠ RISK 8: the replacement is NOT main on the disabled coach''s override lesson');

-- 37.
SELECT throws_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     VALUES ('d15a0000-0000-0000-0000-000000000033','d15a0000-0000-0000-0000-000000000022',
             'present','d15a0000-0000-0000-0000-0000000000c2') $$,
  '42501', NULL,
  '⚠ RISK 8: the replacement cannot mark that lesson');

-- 38. The ADMIN can — marking it falls to them, as the dialog says.
SET LOCAL "request.jwt.claims" TO '{"sub":"d15a0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SELECT lives_ok(
  $$ INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
     VALUES ('d15a0000-0000-0000-0000-000000000033','d15a0000-0000-0000-0000-000000000022',
             'present','d15a0000-0000-0000-0000-0000000000a2') $$,
  '⚠ RISK 8: the admin CAN mark the override lesson');

-- 39. And with that mark, the month has no unmarked (student, lesson) pair
--     left — the predicate the billing completeness gate reads.
SELECT is(
  (SELECT COUNT(*)::int
     FROM lesson_sessions ls
     JOIN classes c ON c.id = ls.class_id
     JOIN student_class_enrolments e ON e.class_id = ls.class_id AND e.is_active
    WHERE c.tenant_id = 'd15a0000-0000-0000-0000-000000000001'
      AND ls.session_date BETWEEN '2026-08-01' AND today_sg()
      AND NOT EXISTS (SELECT 1 FROM attendance a
                       WHERE a.lesson_session_id = ls.id AND a.student_id = e.student_id)),
  0, '⚠ RISK 8: once the admin marks, August holds no unmarked (student, lesson) pair');

-- ============================================================
-- 9. PAYROLL IS FORWARD-LOOKING — taught lessons still pay
-- ============================================================

-- 40. July payroll runs…
SELECT lives_ok(
  $$ SELECT COUNT(*) FROM generate_coach_payouts('d15a0000-0000-0000-0000-000000000001','2026-07') $$,
  'July payroll runs with a disabled coach on the books');

-- 41. …and the DISABLED coach's July lesson pays at their own main rate.
SELECT is(
  (SELECT gross_amount FROM coach_payouts
    WHERE tenant_id='d15a0000-0000-0000-0000-000000000001'
      AND coach_id=(SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')
      AND period_month='2026-07'),
  30.00::numeric(10,2),
  'the disabled coach''s taught July lesson still produces their payout (60 min at 30)');

-- ============================================================
-- 10. AN ADMIN-WHO-COACHES KEEPS THEIR ADMIN HALF
-- ============================================================

-- 42. The co-admin disables the OWNER's coach half (no active classes, no
--     replacement needed; another active coach exists so the sole-coach guard
--     stays quiet).
SELECT lives_ok(
  $$ SELECT disable_coach((SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000a1')) $$,
  'the owner''s COACH half can be disabled while another active coach exists');

-- 43. Their coach half is dark…
SET LOCAL "request.jwt.claims" TO '{"sub":"d15a0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT is((SELECT current_coach_id()), NULL,
  'the owner''s coach identity is gone');

-- 44. …their ADMIN half is not (BACKLOG:1188's mirror image): they still read
--     admin-only tables and can run the reactivation themselves.
SELECT is((SELECT COUNT(*)::int FROM billing_periods
            WHERE tenant_id='d15a0000-0000-0000-0000-000000000001'),
  1, 'the owner still reads admin-only tables — admin authority survives the coach disable');

-- 45.
SELECT lives_ok(
  $$ SELECT reactivate_coach((SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000a1')) $$,
  'and their admin half can reactivate their own coach half');

-- ============================================================
-- 11. REACTIVATION — gate + idempotency and NOTHING else
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub":"d15a0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- 46. A DISABLED coach is refused as a replacement (while the target is still
--     disabled, try to hand them the replacement's classes).
SELECT throws_ok(
  $$ SELECT disable_coach(
       (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c2'),
       (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')) $$,
  'P0001', 'the replacement must be an active coach of this business',
  'a DISABLED coach is refused as a replacement');

-- 47. Reactivate the target: lives, and the class is NOT handed back — the
--     reassignment was effective-dated and STANDS.
SELECT lives_ok(
  $$ SELECT reactivate_coach((SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')) $$,
  'reactivation takes no refusals beyond the gate');

-- 48.
SELECT ok(
  (SELECT disabled_at IS NULL FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')
  AND (SELECT coach_id FROM classes WHERE id='d15a0000-0000-0000-0000-000000000011')
      = (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c2'),
  'the coach is back and the class was NOT handed back — returning it is a deliberate admin act');

-- ============================================================
-- 12. ⚠ RISK 7b — a PAID current-month payout aborts the disable ATOMICALLY
-- ============================================================
-- Rebuild the disable-able state first: hand the class back to the target,
-- re-shadow them on the replacement's class — all BEFORE the seal, which
-- forbids exactly these writes afterwards.

-- 49 (three lives_ok folded into the state rebuild + the abort + atomicity).
SELECT lives_ok(
  $$ SELECT set_class_terms('d15a0000-0000-0000-0000-000000000011','Target Lane','saturday','09:00','10:00','Pool',40,
       (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1'), NULL, FALSE, NULL) $$,
  'state rebuild: the class is handed back to the reactivated coach');

SELECT lives_ok(
  $$ SELECT assign_class_shadow('d15a0000-0000-0000-0000-000000000012',
       (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')) $$,
  'state rebuild: the coach shadows the replacement''s class again');

RESET ROLE;
-- THE SEAL: a PAID payout for the CURRENT month. From here, set_class_terms
-- refuses any reassignment and class_shadow_guard any shadow write.
INSERT INTO coach_payouts (tenant_id, coach_id, period_month, gross_amount, status, paid_at)
SELECT 'd15a0000-0000-0000-0000-000000000001', c.id, to_char(today_sg(),'YYYY-MM'), 25.00, 'paid', now()
  FROM coaches c WHERE c.profile_id='d15a0000-0000-0000-0000-0000000000c2';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"d15a0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT disable_coach(
       (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1'),
       (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c2')) $$,
  'P0001',
  format('cannot change terms from %s — a coach payout for %s or later has already '
         'been paid. The correction will surface as an adjustment instead.',
         today_sg(), to_char(today_sg(),'YYYY-MM')),
  '⚠ RISK 7b: a PAID current-month payout aborts the disable, surfacing set_class_terms''s own message');

SELECT ok(
  (SELECT disabled_at IS NULL FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')
  AND (SELECT coach_id FROM classes WHERE id='d15a0000-0000-0000-0000-000000000011')
      = (SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')
  AND (SELECT COUNT(*) FROM class_shadow_coaches s
        WHERE s.coach_id=(SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')
          AND s.class_id='d15a0000-0000-0000-0000-000000000012'
          AND s.effective_to IS NULL) = 1
  AND (SELECT COUNT(*) FROM audit_log WHERE action='coach_disabled'
        AND entity_id=(SELECT id FROM coaches WHERE profile_id='d15a0000-0000-0000-0000-0000000000c1')) = 1,
  '⚠ RISK 7b: the abort is ATOMIC — coach NOT disabled, class NOT moved, shadow NOT ended, no audit row');

-- ============================================================
-- 13. STAFF-SHAPE INVARIANT + ANON
-- ============================================================
RESET ROLE;

SELECT is(
  (SELECT COUNT(*)::int FROM profiles p
     JOIN parents pa ON pa.profile_id = p.id
    WHERE p.tenant_id IS NOT NULL
      AND p.role IN ('tenant_admin','coach')),
  0, 'staff-shape invariant: no profile holds BOTH a parents row and a staff tenant_id (chunk 3''s bulk ban leans on this)');

SELECT is(
  (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('disable_coach','reactivate_coach')),
  FALSE, 'anon holds EXECUTE on neither new function');

-- 55. APPENDED (not inlined, so the numbers above stay true): the _c probe ids
--     are all REAL — not NULLs that would pass the gate tests for free.
SELECT ok(
  (SELECT oa IS NOT NULL AND t IS NOT NULL AND r IS NOT NULL AND b IS NOT NULL FROM _c),
  'control: every captured probe id is real');

SELECT * FROM finish();
ROLLBACK;
