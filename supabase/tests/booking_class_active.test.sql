-- pgTAP: A GUEST CANNOT BE BOOKED INTO, AND A LESSON CANNOT BE SCHEDULED ON,
-- A CLASS THAT IS NO LONGER RUNNING — book_trial() / schedule_extra_lesson() /
-- the classes CHECK constraint (20260810000100).
--
-- WHAT THIS FILE EXISTS TO PROTECT. generate-invoices v20 makes an unmarked
-- trial or make-up booking BLOCK a billing month, and that block has no
-- override by design (§8a). An inactive class is invisible to every role who
-- could clear it — the coach class list, the coach Schedule tab and the admin
-- Classes page all filter `is_active` (§7.109) — so a booking sitting in a
-- RETIRED class would block a whole business with nothing able to mark it.
-- `deactivate_class()` already refuses to CREATE that state (20260809000300);
-- these three guards are what stop it being created from the other direction,
-- by booking into a class that is already retired.
--
-- ⚠ EVERY REFUSAL IS PAIRED WITH A `lives_ok` ON THE SAME SUBJECT, AND THAT
-- PAIRING IS THE WHOLE TEST (§7.112). `book_trial()` carries SIX other
-- refusals — not authenticated, class not found, not this business's admin,
-- child of another business, below markable_floor(), wrong weekday, already
-- enrolled, holds prepaid value — and `throws_ok(…, 'P0001', NULL, …)` matches
-- ANY of them. A subject that trips a second guard therefore proves nothing;
-- §8.39 shipped exactly that mistake and only found it by breaking the code.
-- So each subject here is OTHERWISE PERFECTLY VALID, and the partner assertion
-- re-runs the same call after `reactivate_class()`. Delete the guard under test
-- and the pair flips: the throws_ok goes green→red while the lives_ok stays
-- green, which no other refusal can produce.
--
-- MEASURED, by running the rollback file and re-running this whole file:
-- sabotaged, assertions 4, 5, 7, 8, 10, 11 and 13 go red and 6, 9, 12, 14 stay
-- green. That list is the file's real signature — if a future change makes a
-- DIFFERENT set go red, the change did something other than what it claimed.
--
-- ⚠ THE MESSAGE IS ASSERTED, NOT LEFT NULL. Same reason. `'% is no longer
-- running'` is unique to the guard under test.
--
-- WHY THE DATES ARE COMPUTED, NOT HARDCODED (§7.33): the rules under test are
-- relative to now(). Every date derives from ONE anchor, and the class weekday
-- is derived FROM the date so the weekday refusal can never be what fires.
--
-- METHOD (§7.16): every client probe runs inside this explicit transaction with
-- SET LOCAL ROLE. Outside one, SET LOCAL ROLE is a no-op, the session stays
-- superuser, RLS is bypassed and every assertion "passes" — including the ones
-- that must fail. Each refusal also asserts NOTHING WAS WRITTEN: a gate that
-- raises after writing is not a gate.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(14);

-- ── The dates, from one anchor ──────────────────────────────────────────────
--   d_future   today + 7 days    comfortably above markable_floor(), and not yet
--                                happened, so no lesson is owed a mark and
--                                deactivate_class()'s refusal 3 has nothing to
--                                find. Classes below run on THIS date's weekday.
--   d_future2  today + 14 days   the SAME weekday, one week later.
--
-- ⚠ WHY THE PARTNER ASSERTION USES A DIFFERENT DATE — MEASURED, NOT GUESSED.
-- `trial_bookings_live_slot_uniq` is UNIQUE (student_id, class_id, session_date)
-- WHERE cancelled_at IS NULL. On a SABOTAGE run the refusal under test does not
-- fire, so assertion 4's call SUCCEEDS and writes a booking — and a partner
-- re-running the identical call then dies on a duplicate key (23505), turning
-- the partner red for a reason that has nothing to do with the guard. That red
-- is collateral, not signal, and it would mask a genuine regression in the
-- partner. One week later, same weekday, keeps the partner testing exactly what
-- it claims to: with the guard present it proves the subject is otherwise
-- valid; with the guard deleted it stays GREEN while only the throws_ok flips.
-- (`schedule_extra_lesson()` needs no such split — it is idempotent by
-- ON CONFLICT DO NOTHING, so its partner survives the sabotage run unaided.)
CREATE TEMP TABLE bca AS
SELECT ((now() AT TIME ZONE 'Asia/Singapore') + INTERVAL '7 days')::date  AS d_future,
       ((now() AT TIME ZONE 'Asia/Singapore') + INTERVAL '14 days')::date AS d_future2;
GRANT SELECT ON bca TO PUBLIC;

INSERT INTO tenants (id, slug, display_name, join_code, created_at) VALUES
  ('7a777777-0000-0000-0000-000000000001','bca','BCA Business','SWIM-BCAA', now());

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','7a100000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','bca-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"BCA Admin","role":"tenant_admin","tenant_id":"7a777777-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','7a100000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','bca-coach@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"BCA Coach","role":"coach","tenant_id":"7a777777-0000-0000-0000-000000000001"}', now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT t.id, 'Default Group' FROM tenants t
 WHERE t.id = '7a777777-0000-0000-0000-000000000001'
   AND NOT EXISTS (
     SELECT 1 FROM class_categories c
      WHERE c.tenant_id = t.id AND lower(trim(c.name)) = 'default group');

-- ── Three EMPTY classes, one per guard ──────────────────────────────────────
-- Empty on purpose: an empty class is the one deactivate_class() allows
-- through (§7.17), so the fixture can reach the retired state through the
-- PRODUCT's own path rather than by a raw UPDATE the new CHECK now forbids.
--   TRIAL   retired, then a trial is attempted into it
--   EXTRA   retired, then an extra lesson is attempted on it
--   CONSTR  never retired; the CHECK constraint's subject
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
  ids.id, '7a777777-0000-0000-0000-000000000001',
  (SELECT id FROM coaches WHERE profile_id='7a100000-0000-0000-0000-0000000000c1'),
  ids.title,
  (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    )[EXTRACT(DOW FROM bca.d_future)::int + 1]::day_of_week,
  '10:00','11:00',(SELECT l.id FROM locations l WHERE l.tenant_id = '7a777777-0000-0000-0000-000000000001' AND lower(trim(l.name)) = 'default location'), 30,
  (SELECT id FROM class_categories
    WHERE tenant_id='7a777777-0000-0000-0000-000000000001'
      AND lower(trim(name))='default group')
FROM bca, (VALUES
  ('7a777777-1111-0000-0000-000000000001'::UUID,'BCA Trial Target Class'),
  ('7a777777-1111-0000-0000-000000000002'::UUID,'BCA Extra Lesson Class'),
  ('7a777777-1111-0000-0000-000000000003'::UUID,'BCA Constraint Class')
) AS ids(id, title);

-- The trial subject: this business's child, NO enrolment anywhere, NO package.
-- Every one of book_trial()'s other refusals is therefore already satisfied.
INSERT INTO students (id, full_name, assignment_status, tenant_id) VALUES
  ('7a500000-0000-0000-0000-000000000001','BCA Trial Kid','unassigned','7a777777-0000-0000-0000-000000000001');

-- Baselines, scoped rather than bare COUNT(*): taken as postgres and compared
-- under SET LOCAL ROLE, a global count reads a different row set on each side.
CREATE TEMP TABLE bca_baseline AS
  SELECT (SELECT COUNT(*)::INT FROM trial_bookings
           WHERE tenant_id = '7a777777-0000-0000-0000-000000000001')  AS trials,
         (SELECT COUNT(*)::INT FROM lesson_sessions
           WHERE class_id  = '7a777777-1111-0000-0000-000000000002')  AS extras;
GRANT SELECT ON bca_baseline TO PUBLIC;


-- ══ 0. The fixture's premises, asserted ═════════════════════════════════════
-- If either of these is false, every assertion below is measuring something
-- other than what it claims to.
SELECT ok(
  (SELECT d_future FROM bca) >= markable_floor('7a777777-0000-0000-0000-000000000001'),
  'the subject date is ABOVE the markable floor — so the floor refusal can never be what fires');

SELECT is(
  (SELECT day_of_week::text FROM classes WHERE id='7a777777-1111-0000-0000-000000000001'),
  (SELECT (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
            )[EXTRACT(DOW FROM d_future)::int + 1] FROM bca),
  'the subject date IS the class''s weekday — so the weekday refusal can never be what fires');


SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"7a100000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Retire the two subjects through the PRODUCT's path. Both are empty, so this
-- is the §7.17 case and takes no refusal.
SELECT lives_ok(
  $$ SELECT deactivate_class('7a777777-1111-0000-0000-000000000001');
     SELECT deactivate_class('7a777777-1111-0000-0000-000000000002'); $$,
  'the two empty subjects retire through deactivate_class() — the fixture uses the product path, not a raw UPDATE');


-- ══ 1-3. book_trial() refuses a class that is no longer running ═════════════
SELECT throws_ok(
  $$ SELECT book_trial('7a777777-1111-0000-0000-000000000001',
                       (SELECT d_future FROM bca),
                       '7a500000-0000-0000-0000-000000000001') $$,
  'P0001',
  'BCA Trial Target Class is no longer running',
  'book_trial() refuses a RETIRED host class — a guest booked there is unmarkable AND blocking');

SELECT is(
  (SELECT COUNT(*)::INT FROM trial_bookings
    WHERE tenant_id = '7a777777-0000-0000-0000-000000000001'),
  (SELECT trials FROM bca_baseline),
  'and wrote nothing — a gate that raises after writing is not a gate');

-- THE PARTNER. Same subject, same class, same weekday, one week later (see the
-- note on d_future2 — the offset exists so a sabotage run cannot poison this
-- with a duplicate booking). Only `is_active` differs from the call above, so
-- this is what makes that refusal discriminating rather than "some P0001".
SELECT lives_ok(
  $$ SELECT reactivate_class('7a777777-1111-0000-0000-000000000001');
     SELECT book_trial('7a777777-1111-0000-0000-000000000001',
                       (SELECT d_future2 FROM bca),
                       '7a500000-0000-0000-0000-000000000001'); $$,
  'the same call one week later succeeds once the class is running again — so is_active was the only thing refusing');


-- ══ 4-6. schedule_extra_lesson() refuses a class that is no longer running ══
-- Reachable since 20260809000300's deploy gave the admin Classes page a
-- *Show retired* toggle: a retired class is now on screen, and this function
-- had no is_active check at all. A lesson_session on a retired class enters the
-- engine's datesToCheck through sessionByDate, which is deliberately NOT
-- clamped by deactivated_at — a lesson that genuinely ran must always block.
SELECT throws_ok(
  $$ SELECT schedule_extra_lesson('7a777777-1111-0000-0000-000000000002',
                                  (SELECT d_future FROM bca),
                                  'pool closed, moved') $$,
  'P0001',
  'BCA Extra Lesson Class is no longer running',
  'schedule_extra_lesson() refuses a RETIRED class — otherwise it creates a blocking lesson no coach screen renders');

SELECT is(
  (SELECT COUNT(*)::INT FROM lesson_sessions
    WHERE class_id = '7a777777-1111-0000-0000-000000000002'),
  (SELECT extras FROM bca_baseline),
  'and wrote no lesson_session');

SELECT lives_ok(
  $$ SELECT reactivate_class('7a777777-1111-0000-0000-000000000002');
     SELECT schedule_extra_lesson('7a777777-1111-0000-0000-000000000002',
                                  (SELECT d_future FROM bca),
                                  'pool closed, moved'); $$,
  'the SAME call succeeds once the class is running again — so is_active was the only thing refusing');


-- ══ 7-10. `is_active = false` REQUIRES a date, enforced by the DATABASE ═════
-- This is the structural guarantee the engine leans on: core.ts reads
-- deactivated_at to decide how far an inactive class was expected to run, and a
-- NULL there means "expect nothing". Safe for a derived weekday date; a silent
-- underbill if it ever reached a booking. After this constraint no such row can
-- exist, so the prohibition against clamping bookings is enforced by the
-- schema rather than by a comment someone has to remember.
--
-- The CHECK is one half of closing a real hole: classes_write is FOR ALL TO
-- authenticated and 20260804000600 grants UPDATE, so a tenant admin could retire
-- a class straight over PostgREST. This constraint blocks the NO-DATE shape
-- below (23514). ⚠ It does NOT, on its own, force retirement through
-- deactivate_class(): a raw UPDATE CAN supply the date, and the 20260810000100
-- header's claim otherwise was wrong. The three refusals are enforced for a raw
-- WITH-DATE retire by trg_class_retirement_guard (20260821000300, §7.199) — see
-- class_retirement_guard.test.sql. Class 003 is otherwise clean, so here the
-- trigger passes and it is purely the missing date that raises.
SELECT throws_ok(
  $$ UPDATE classes SET is_active = false
      WHERE id = '7a777777-1111-0000-0000-000000000003' $$,
  '23514',
  NULL,
  'a raw UPDATE with NO date is refused by the CHECK constraint (the retirement refusals themselves are pinned in class_retirement_guard.test.sql)');

SELECT ok(
  (SELECT is_active FROM classes WHERE id='7a777777-1111-0000-0000-000000000003'),
  'and the class is untouched');

-- The supported shape still works, so the constraint is not simply refusing
-- everything — the failure mode markable_floor.test.sql calls out.
SELECT lives_ok(
  $$ SELECT deactivate_class('7a777777-1111-0000-0000-000000000003') $$,
  'deactivate_class() still retires it — the constraint bounds the SHAPE, it does not forbid retiring');

SELECT ok(
  (SELECT NOT is_active AND deactivated_at IS NOT NULL
     FROM classes WHERE id='7a777777-1111-0000-0000-000000000003'),
  'and the row satisfies the constraint: inactive WITH a date');

-- reactivate_class() must leave a row the constraint also accepts — it sets
-- is_active = TRUE and deactivated_at = NULL together, and a future edit that
-- cleared only one of them would deadlock the only exit from a retired class.
SELECT lives_ok(
  $$ SELECT reactivate_class('7a777777-1111-0000-0000-000000000003') $$,
  'reactivate_class() is still the exit — it clears is_active and deactivated_at together');


SELECT * FROM finish();
ROLLBACK;
