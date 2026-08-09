-- pgTAP: every edit to a `students` row is recorded, and NO edit is refused
-- because of it (20260809000200, Wave 1 Chunk 3).
--
-- WHY THE "STILL SUCCEEDS" HALF IS THE IMPORTANT HALF. This trigger's failure
-- mode is not a missing audit row, it is a REFUSED STUDENT EDIT — the admin
-- level picker, the admin contact-details modal, the coach roster and the
-- parent's own edit-child screen all UPDATE `students` straight from the
-- client, and a raising trigger kills the whole statement (§7.66, §7.67). Two
-- separate things can raise: audit_log's INSERT policy, which permits
-- `authenticated` exactly one entity_type (20260804000300), and
-- audit_log.actor_id being NOT NULL on a path with no JWT (§7.50).
--
-- SO EVERY WRITE HERE IS MADE AS THE ROLE THAT ACTUALLY MAKES IT. A test that
-- only writes as `postgres` passes against the broken build and proves nothing:
-- postgres is the owner, so the policy never applies to it and the DEFINER bug
-- is invisible.
--
-- PROVEN RED, both ways, by breaking the live function and re-running (§7.25):
--   * `ALTER FUNCTION audit_student_update() SECURITY INVOKER` → assertion 1
--     dies with 42501 "new row violates row-level security policy for table
--     audit_log" — the admin's ordinary level edit is REFUSED — and the aborted
--     transaction takes 2-11 down with it. That cascade is the honest picture of
--     the bug: it is not one broken screen, it is every student edit.
--   * remove the `IF v_actor IS NULL THEN RETURN NULL` guard → 1-8 stay green
--     and 9 and 10 die with 23502 "null value in column actor_id violates
--     not-null constraint". Nothing a user does breaks; the next data-fix
--     migration fails `supabase db push` against production instead.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(11);

-- ══ Fixture — its own business, so nothing here depends on another test's
--    state and no other test's rows can be mistaken for this one's. ═════════
INSERT INTO tenants (id, slug, display_name, join_code) VALUES
  ('adb00000-0000-0000-0000-000000000001','aud-students','AUDIT Students Swim','SWIM-AUDS');

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','adb00000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','aud-admin@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}',
   '{"full_name":"Audit Admin","role":"tenant_admin","tenant_id":"adb00000-0000-0000-0000-000000000001"}',
   now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','adb00000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','aud-parent@test.local', crypt('x', gen_salt('bf')), now(),
   '{"provider":"email"}', '{"full_name":"Audit Parent","role":"parent"}',
   now(), now(), '','','','');

INSERT INTO tenant_levels (id, tenant_id, label, sort_order)
VALUES ('adb00000-0000-0000-0000-0000000000e1','adb00000-0000-0000-0000-000000000001','Seahorse',1);

INSERT INTO students (id, tenant_id, full_name, date_of_birth,
                      provisional_contact_phone)
VALUES ('adb00000-0000-0000-0000-0000000000d1','adb00000-0000-0000-0000-000000000001',
        'Audit Child','2017-03-03','91110000');

INSERT INTO parent_students (parent_id, student_id)
SELECT p.id, 'adb00000-0000-0000-0000-0000000000d1'
  FROM parents p WHERE p.profile_id='adb00000-0000-0000-0000-0000000000b1';

INSERT INTO parent_tenants (parent_id, tenant_id)
SELECT p.id, 'adb00000-0000-0000-0000-000000000001'
  FROM parents p WHERE p.profile_id='adb00000-0000-0000-0000-0000000000b1';

-- ══ THE ADMIN LEVEL PICKER ═════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"adb00000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 1. The one that goes red without SECURITY DEFINER. This is setLevel().
SELECT lives_ok($$
  UPDATE students SET level_id = 'adb00000-0000-0000-0000-0000000000e1'
   WHERE id = 'adb00000-0000-0000-0000-0000000000d1'
$$, 'the admin CAN still set a level — the trigger does not refuse the edit');

RESET ROLE;

-- EVERY SCALAR SUBQUERY BELOW IS PINNED TO ITS OWN EDIT by a value only that
-- edit produced, never by entity_id + action alone. This file writes several
-- rows about ONE student, so a query filtered only by entity_id happens to
-- return one row solely because of where it sits — and the day an assertion is
-- inserted above it, it raises `more than one row returned by a subquery`,
-- which reads as a product failure rather than a test-ordering one. created_at
-- cannot disambiguate them: it defaults to NOW(), which is transaction start,
-- so every row in this file ties.

-- 2. …and it was recorded, as the admin, under the one entity_type the closed
--    set in audit_log_tenant_of() accepts.
SELECT is(
  (SELECT actor_id FROM audit_log
    WHERE entity_type = 'Student' AND action = 'student_updated'
      AND entity_id = 'adb00000-0000-0000-0000-0000000000d1'
      AND new_value ->> 'level_id' = 'adb00000-0000-0000-0000-0000000000e1'),
  'adb00000-0000-0000-0000-0000000000a1'::uuid,
  'the level change is recorded against the admin who made it');

-- 3. WHAT IT USED TO BE — the whole reason this records to_jsonb(OLD) rather
--    than the string "edited".
SELECT ok(
  (SELECT old_value ->> 'level_id' IS NULL
     FROM audit_log
    WHERE entity_id = 'adb00000-0000-0000-0000-0000000000d1'
      AND new_value ->> 'level_id' = 'adb00000-0000-0000-0000-0000000000e1'),
  'the row carries the level BEFORE and AFTER, not merely that something changed');

-- 4. tenant_id is derived from the entity by set_audit_log_tenant, which is why
--    the trigger deliberately does not supply one.
SELECT is(
  (SELECT tenant_id FROM audit_log
    WHERE entity_id = 'adb00000-0000-0000-0000-0000000000d1'
      AND new_value ->> 'level_id' = 'adb00000-0000-0000-0000-0000000000e1'),
  'adb00000-0000-0000-0000-000000000001'::uuid,
  'the audit row is stamped with the student''s own business');

-- ══ THE CONTACT-DETAILS MODAL — the dispute this feature exists for ════════
-- provisional_contact_phone is a top-two ranked signal in
-- find_student_candidates(); it decides which parent is offered which child,
-- and after approval only that flow's own undo can unlink them (§7.47).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"adb00000-0000-0000-0000-0000000000a1","role":"authenticated"}';

UPDATE students SET provisional_contact_phone = '98887777'
 WHERE id = 'adb00000-0000-0000-0000-0000000000d1';

RESET ROLE;

-- 5.
SELECT is(
  (SELECT old_value ->> 'provisional_contact_phone' FROM audit_log
    WHERE entity_id = 'adb00000-0000-0000-0000-0000000000d1'
      AND new_value ->> 'provisional_contact_phone' = '98887777'),
  '91110000',
  'the trail answers "what was the number before" — the dispute it exists for');

-- 6. A NO-OP UPDATE writes nothing. Both the level picker and the contact modal
--    can re-save identical values; a trail full of "changed nothing" is noise
--    that hides the row somebody is looking for.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"adb00000-0000-0000-0000-0000000000a1","role":"authenticated"}';

UPDATE students SET provisional_contact_phone = '98887777'
 WHERE id = 'adb00000-0000-0000-0000-0000000000d1';

RESET ROLE;

SELECT is(
  (SELECT count(*) FROM audit_log
    WHERE entity_id = 'adb00000-0000-0000-0000-0000000000d1' AND action = 'student_updated'),
  2::bigint,
  'an UPDATE that changes nothing records nothing');

-- ══ THE PARENT'S OWN EDIT-CHILD SCREEN ═════════════════════════════════════
-- §7.86: parents PATCH `students` directly. This is a different RLS path from
-- the admin's, so it is asserted separately rather than assumed to follow.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"adb00000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- 7.
SELECT lives_ok($$
  UPDATE students SET full_name = 'Audit Child Renamed'
   WHERE id = 'adb00000-0000-0000-0000-0000000000d1'
$$, 'a parent CAN still edit their own child — the trigger does not refuse it');

RESET ROLE;

-- 8.
SELECT is(
  (SELECT actor_id FROM audit_log
    WHERE entity_id = 'adb00000-0000-0000-0000-0000000000d1'
      AND new_value ->> 'full_name' = 'Audit Child Renamed'),
  'adb00000-0000-0000-0000-0000000000b1'::uuid,
  'the parent''s own edit is recorded against the parent');

-- ══ THE BACKEND PATHS — no JWT, and they MUST NOT BE REFUSED ═══════════════
-- A data-fix migration, psql, the seed, an edge function under service_role.
-- auth.uid() is NULL on every one of them, and actor_id is NOT NULL. There are
-- already ~12 migration files containing `UPDATE students`; the next one would
-- fail `supabase db push` against production.
SET LOCAL "request.jwt.claims" TO '{}';

-- 9. As `postgres` — the migration / psql path.
SELECT lives_ok($$
  UPDATE students SET notes = 'set by a migration'
   WHERE id = 'adb00000-0000-0000-0000-0000000000d1'
$$, 'a backend UPDATE with no JWT actor still succeeds (the migration path)');

-- 10. As `service_role` — the edge-function path.
SET LOCAL ROLE service_role;

SELECT lives_ok($$
  UPDATE students SET notes = 'set by an edge function'
   WHERE id = 'adb00000-0000-0000-0000-0000000000d1'
$$, 'a service_role UPDATE with no JWT actor still succeeds (the engine path)');

RESET ROLE;

-- 11. …and neither recorded anything. The gap is deliberate and stated in the
--     migration header: an audit gap on a backend path is recoverable, a
--     refused student write is not.
SELECT is(
  (SELECT count(*) FROM audit_log
    WHERE entity_id = 'adb00000-0000-0000-0000-0000000000d1' AND action = 'student_updated'),
  3::bigint,
  'the two actorless backend writes recorded nothing, leaving the parent''s edit as the third');

SELECT * FROM finish();
ROLLBACK;
