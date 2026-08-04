-- pgTAP: every audit row knows which business it is about (20260804000300).
--
-- WHY THIS MATTERS EVEN THOUGH NOTHING READS audit_log YET. The read policy is
-- `is_platform_admin() OR is_tenant_admin(tenant_id)`, and is_tenant_admin()
-- returns FALSE for a NULL tenant. So an unstamped row is not "unfiltered", it
-- is invisible to the business it describes — and it looks identical to a row
-- that simply did not happen. The first history screen built on this table
-- would show claims and merges and silently omit every attendance save.
--
-- PROVEN RED. Against the schema immediately before 20260804000300, assertions
-- 1, 2 and 4 failed: close_student_enrolment wrote a NULL tenant_id, and the
-- unknown-entity_type insert succeeded instead of raising (§7.25).

BEGIN;
SELECT plan(8);

-- ══ Fixture: two businesses, so a wrong derivation shows up as the WRONG
--    tenant rather than merely a null one. ═══════════════════════════════════
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('a0d17000-0000-0000-0000-000000000001','audit-a','AUDIT Business A','SWIM-ADTA'),
  ('a0d17000-0000-0000-0000-000000000002','audit-b','AUDIT Business B','SWIM-ADTB');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','a0d17000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','admin-a@audit.test','x',NOW(),'{}','{}',NOW(),NOW(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','a0d17000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','coach-a@audit.test','x',NOW(),'{}','{}',NOW(),NOW(),'','','','');

UPDATE profiles SET role = 'tenant_admin', tenant_id = 'a0d17000-0000-0000-0000-000000000001'
 WHERE id = 'a0d17000-0000-0000-0000-0000000000a1';
UPDATE profiles SET role = 'coach', tenant_id = 'a0d17000-0000-0000-0000-000000000001'
 WHERE id = 'a0d17000-0000-0000-0000-0000000000c1';

INSERT INTO coaches (id, tenant_id, profile_id)
VALUES ('a0d17000-0000-0000-0000-0000000000f1','a0d17000-0000-0000-0000-000000000001',
        'a0d17000-0000-0000-0000-0000000000c1');

INSERT INTO class_categories (id, tenant_id, name)
VALUES ('a0d17000-0000-0000-0000-0000000000e1','a0d17000-0000-0000-0000-000000000001','Group');

INSERT INTO classes (id, tenant_id, category_id, coach_id, title, day_of_week,
                     start_time, end_time, location_name, price_per_lesson)
VALUES ('a0d17000-0000-0000-0000-0000000000b1','a0d17000-0000-0000-0000-000000000001',
        'a0d17000-0000-0000-0000-0000000000e1','a0d17000-0000-0000-0000-0000000000f1',
        'AUDIT Class','monday','09:00','10:00','AUDIT Pool',40);

-- The student belongs to business B while the CLASS belongs to A: assertion 3
-- then distinguishes "derived from the entity" from "derived from anything else
-- that happens to be in scope".
INSERT INTO students (id, tenant_id, full_name, date_of_birth)
VALUES ('a0d17000-0000-0000-0000-0000000000d1','a0d17000-0000-0000-0000-000000000002',
        'AUDIT Child B','2016-04-01');

-- A second child, this one in business A, because the enrolment guard
-- (correctly) refuses to put B's child in A's class — so assertion 5 needs its
-- own subject. Keeping BOTH is the point: 1 and 3 prove the stamp follows the
-- STUDENT across a tenant boundary, and 5 proves the trigger reaches a writer
-- this migration never edited.
INSERT INTO students (id, tenant_id, full_name, date_of_birth)
VALUES ('a0d17000-0000-0000-0000-0000000000d2','a0d17000-0000-0000-0000-000000000001',
        'AUDIT Child A','2016-05-01');

INSERT INTO lesson_sessions (id, class_id, session_date)
VALUES ('a0d17000-0000-0000-0000-0000000000c9','a0d17000-0000-0000-0000-0000000000b1','2026-08-03');

-- ══ 1. A 'Student' row is stamped from the STUDENT's business ═══════════════
INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
VALUES ('a0d17000-0000-0000-0000-0000000000a1','test_student','Student',
        'a0d17000-0000-0000-0000-0000000000d1','{}'::jsonb);

SELECT is(
  (SELECT tenant_id FROM audit_log WHERE action = 'test_student'),
  'a0d17000-0000-0000-0000-000000000002'::uuid,
  'a Student row is stamped from the student''s own business, not the actor''s');

-- ══ 2. A 'lesson_session' row resolves through its class ════════════════════
INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
VALUES ('a0d17000-0000-0000-0000-0000000000c1','test_session','lesson_session',
        'a0d17000-0000-0000-0000-0000000000c9','{}'::jsonb);

SELECT is(
  (SELECT tenant_id FROM audit_log WHERE action = 'test_session'),
  'a0d17000-0000-0000-0000-000000000001'::uuid,
  'a lesson_session row resolves through its class to the class''s business');

-- ══ 3. A SUPPLIED tenant_id does not win over a derivable one ═══════════════
-- The whole point of deriving. audit_log's INSERT policy never constrained
-- tenant_id, so a supplied value was always the client's word for it.
INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value, tenant_id)
VALUES ('a0d17000-0000-0000-0000-0000000000a1','test_override','Student',
        'a0d17000-0000-0000-0000-0000000000d1','{}'::jsonb,
        'a0d17000-0000-0000-0000-000000000001');

SELECT is(
  (SELECT tenant_id FROM audit_log WHERE action = 'test_override'),
  'a0d17000-0000-0000-0000-000000000002'::uuid,
  'a supplied tenant_id is OVERWRITTEN by the derived one');

-- ══ 4. An unknown entity_type RAISES rather than writing an invisible row ═══
SELECT throws_ok(
  $$ INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
     VALUES ('a0d17000-0000-0000-0000-0000000000a1','test_unknown','Invoice',
             'a0d17000-0000-0000-0000-0000000000d1','{}'::jsonb) $$,
  NULL,
  'an entity_type with no derivation is refused, not silently left NULL');

-- ══ 5. THE REGRESSION THIS EXISTS FOR ══════════════════════════════════════
-- schedule_extra_lesson() is one of the writers that does NOT set tenant_id
-- (the live list on 2026-08-04 is seven: add_unclaimed_student, book_makeup,
-- book_trial, cancel_makeup_booking, cancel_trial_booking, link_invited_parent,
-- schedule_extra_lesson — asked of pg_proc, not taken from BACKLOG, which still
-- said "13 of 19" after later work had fixed six of them).
--
-- It is not edited by this migration; the trigger is the whole fix. So this
-- asserts the mechanism reaches an untouched call site AND fires inside a
-- SECURITY DEFINER function, where the insert runs as the table owner.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a0d17000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT lives_ok(
  $$ SELECT schedule_extra_lesson('a0d17000-0000-0000-0000-0000000000b1',
                                  (CURRENT_DATE + 7), 'audit test') $$,
  'schedule_extra_lesson still runs');

RESET ROLE;

SELECT is(
  (SELECT a.tenant_id FROM audit_log a
     JOIN lesson_sessions ls ON ls.id = a.entity_id
    WHERE a.entity_type = 'lesson_session'
      AND ls.class_id = 'a0d17000-0000-0000-0000-0000000000b1'
      AND ls.off_schedule_reason = 'audit test'),
  'a0d17000-0000-0000-0000-000000000001'::uuid,
  'a writer that does NOT set tenant_id now produces a correctly stamped row');

-- ══ 6. The narrowed INSERT policy ══════════════════════════════════════════
-- A coach may record attendance on a session they own, and may not fabricate a
-- row about anything else. Both directions, because a policy that refuses
-- everything would pass a one-sided test.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"a0d17000-0000-0000-0000-0000000000c1","role":"authenticated"}';

SELECT lives_ok(
  $$ INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
     VALUES ('a0d17000-0000-0000-0000-0000000000c1','attendance_saved','lesson_session',
             'a0d17000-0000-0000-0000-0000000000c9','{}'::jsonb) $$,
  'the coach CAN audit a session they own — the one real client write path');

SELECT throws_ok(
  $$ INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
     VALUES ('a0d17000-0000-0000-0000-0000000000c1','fabricated','Student',
             'a0d17000-0000-0000-0000-0000000000d1','{}'::jsonb) $$,
  NULL,
  'the coach CANNOT fabricate an audit row about a student');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
