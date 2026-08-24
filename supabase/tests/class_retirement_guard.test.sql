-- pgTAP: A RAW PostgREST UPDATE CANNOT RETIRE A CLASS PAST ITS REFUSALS.
-- trg_class_retirement_guard / assert_class_retirable() (20260821000300, §7.199).
--
-- WHAT THIS FILE EXISTS TO PROTECT. deactivate_class() refuses to retire a class
-- that still has children on its roster, future guest bookings, or lessons owed
-- a mark (class_deactivation.test.sql pins all three). But classes_write is
-- FOR ALL TO authenticated and 20260804000600 grants UPDATE, so a tenant admin
-- could send `UPDATE classes SET is_active=false, deactivated_at=now()` straight
-- over PostgREST — never entering the RPC, never passing those refusals. The
-- classes_inactive_requires_deactivated_at CHECK only blocked the NO-DATE shape;
-- a raw UPDATE CAN supply the date. This file proves the BEFORE UPDATE trigger
-- now enforces the three refusals on that raw path too.
--
-- ⚠ RED-FIRST. Without the trigger, assertions 1 and 3 (the throws_ok on an
-- obstructed class) go green→red: the raw UPDATE succeeds and writes, so the
-- expected P0001 never comes. Assertions 5–7 (clean retire, reactivate) stay
-- green either way — they are the "does not simply refuse everything" partners
-- (§7.112), the failure mode markable_floor.test.sql calls out.
--
-- The three refusals themselves — and their §7.66 span reading — are pinned once
-- in class_deactivation.test.sql against the SHARED helper. This file's job is
-- narrower: that the RAW path reaches that helper at all, and that a SAFE raw
-- retire and a reactivation are NOT blocked.
--
-- METHOD (§7.16): every probe runs under SET LOCAL ROLE inside this transaction.
-- Outside one, SET LOCAL ROLE is a no-op, the session stays superuser, RLS is
-- bypassed and the throws_ok assertions "pass" for the wrong reason. The refusals
-- also assert NOTHING WAS WRITTEN.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

-- ── Dates from one anchor (§7.33). Classes run on d_past's weekday, so d_past
--    is a real lesson date inside the window and d_future has not happened. ────
CREATE TEMP TABLE rg AS
SELECT
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '1 month')::date                                  AS d_floor,
  (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
     - INTERVAL '1 month' + INTERVAL '7 days')::date              AS d_past,
  ((now() AT TIME ZONE 'Asia/Singapore') + INTERVAL '7 days')::date AS d_future;
GRANT SELECT ON rg TO PUBLIC;

INSERT INTO tenants (id, slug, display_name, join_code, created_at) VALUES
  ('7b777777-0000-0000-0000-000000000001','rgx','RGX Business','SWIM-RGXA', now());

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000','7b100000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','rgx-admin@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"RGX Admin","role":"tenant_admin","tenant_id":"7b777777-0000-0000-0000-000000000001"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','7b100000-0000-0000-0000-0000000000c1',
   'authenticated','authenticated','rgx-coach@test.local', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}',
   '{"full_name":"RGX Coach","role":"coach","tenant_id":"7b777777-0000-0000-0000-000000000001"}', now(), now(), '', '', '', '');

INSERT INTO class_categories (tenant_id, name)
SELECT '7b777777-0000-0000-0000-000000000001', 'Default Group'
 WHERE NOT EXISTS (
   SELECT 1 FROM class_categories c
    WHERE c.tenant_id = '7b777777-0000-0000-0000-000000000001'
      AND lower(trim(c.name)) = 'default group');

-- Three classes: CLEAN (nothing), ENROL (an OPEN enrolment → refusal 1),
-- BOOKED (a future trial → refusal 2).
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
  ids.id, '7b777777-0000-0000-0000-000000000001',
  (SELECT id FROM coaches WHERE profile_id='7b100000-0000-0000-0000-0000000000c1'),
  ids.title,
  (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    )[EXTRACT(DOW FROM rg.d_past)::int + 1]::day_of_week,
  '10:00','11:00',(SELECT l.id FROM locations l WHERE l.tenant_id = '7b777777-0000-0000-0000-000000000001' AND lower(trim(l.name)) = 'default location'), 30,
  (SELECT id FROM class_categories
    WHERE tenant_id='7b777777-0000-0000-0000-000000000001'
      AND lower(trim(name))='default group')
FROM rg, (VALUES
  ('7b777777-1111-0000-0000-00000000000e'::UUID,'RGX Clean Class'),
  ('7b777777-1111-0000-0000-000000000001'::UUID,'RGX Enrolled Class'),
  ('7b777777-1111-0000-0000-000000000004'::UUID,'RGX Booked Class')
) AS ids(id, title);

INSERT INTO students (id, full_name, assignment_status, tenant_id) VALUES
  ('7b500000-0000-0000-0000-000000000001','RGX Enrolled Kid','assigned','7b777777-0000-0000-0000-000000000001'),
  ('7b500000-0000-0000-0000-000000000004','RGX Trial Kid','unassigned','7b777777-0000-0000-0000-000000000001');

-- ENROL: an OPEN enrolment → children still on the roster.
INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at, unenrolled_at, is_active)
SELECT '7b500000-0000-0000-0000-000000000001','7b777777-1111-0000-0000-000000000001',
       (d_past - 60)::TIMESTAMPTZ, NULL::TIMESTAMPTZ, TRUE FROM rg;

-- BOOKED: a future trial guest → a lesson that has not happened.
INSERT INTO trial_bookings (tenant_id, student_id, class_id, session_date, category_id, booked_by)
SELECT '7b777777-0000-0000-0000-000000000001','7b500000-0000-0000-0000-000000000004',
       '7b777777-1111-0000-0000-000000000004', d_future,
       (SELECT id FROM class_categories
         WHERE tenant_id='7b777777-0000-0000-0000-000000000001'
           AND lower(trim(name))='default group'),
       '7b100000-0000-0000-0000-0000000000a1'
FROM rg;

-- Scoped baseline (§7.16): read as postgres, compared under SET LOCAL ROLE.
CREATE TEMP TABLE rg_baseline AS
  SELECT (SELECT COUNT(*)::INT FROM classes
           WHERE tenant_id = '7b777777-0000-0000-0000-000000000001'
             AND is_active = FALSE) AS inactive;
GRANT SELECT ON rg_baseline TO PUBLIC;


SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"7b100000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ══ 1-2. A raw UPDATE that supplies the date is STILL refused (refusal 1) ════
-- This is the hole. The CHECK is satisfied (date present); only the trigger can
-- refuse it. The admin owns the tenant, so classes_write lets the row through to
-- the BEFORE trigger, which raises.
SELECT throws_ok(
  $$ UPDATE classes SET is_active = false, deactivated_at = now()
      WHERE id = '7b777777-1111-0000-0000-000000000001' $$,
  'P0001',
  NULL,
  'a raw UPDATE with the date cannot retire a class that still has children on its roster');

SELECT ok(
  (SELECT is_active FROM classes WHERE id='7b777777-1111-0000-0000-000000000001'),
  'and the class stayed active — a BEFORE trigger that raises wrote nothing');

-- ══ 3-4. Same for a future guest booking (refusal 2) ════════════════════════
SELECT throws_ok(
  $$ UPDATE classes SET is_active = false, deactivated_at = now()
      WHERE id = '7b777777-1111-0000-0000-000000000004' $$,
  'P0001',
  NULL,
  'a raw UPDATE cannot retire a class holding a future guest booking either');

SELECT ok(
  (SELECT is_active FROM classes WHERE id='7b777777-1111-0000-0000-000000000004'),
  'and it stayed active too');

-- ══ 5. An ORDINARY edit of an obstructed ACTIVE class is NOT blocked ═════════
-- ENROL still has its open enrolment and is still active. Editing its title must
-- sail through — the guard fires on retirement, not on every UPDATE of a class
-- that happens to have children. A trigger condition accidentally widened to
-- "any UPDATE" would brick every edit of any populated class; this catches it.
SELECT lives_ok(
  $$ UPDATE classes SET title = 'RGX Enrolled Class (renamed)'
      WHERE id = '7b777777-1111-0000-0000-000000000001' $$,
  'renaming an obstructed but still-active class is fine — the guard is retirement-only');

-- ══ 6-7. A SAFE raw retire is NOT blocked — the guard is not "refuse all" ════
-- The clean class has nothing to strand, so the trigger passes and the raw
-- UPDATE (date supplied) commits. This is the §7.112 partner: it proves 1 and 3
-- are the retirement refusals firing, not the trigger refusing everything.
SELECT lives_ok(
  $$ UPDATE classes SET is_active = false, deactivated_at = now()
      WHERE id = '7b777777-1111-0000-0000-00000000000e' $$,
  'a raw retire of an EMPTY class succeeds — the guard blocks unsafe retires, not all of them');

SELECT ok(
  (SELECT NOT is_active AND deactivated_at IS NOT NULL
     FROM classes WHERE id='7b777777-1111-0000-0000-00000000000e'),
  'and it is inactive WITH a date, satisfying the CHECK');

-- ══ 8-9. A raw UPDATE cannot MOVE an already-retired class's date ════════════
-- The sibling hole (§7.199): the engine reads deactivated_at as how far the class
-- was expected to run, so shifting it on a still-retired class widens that window
-- — deactivate_class() refuses to rewrite it, and so must the raw path.
RESET ROLE;
CREATE TEMP TABLE rg_stamp AS
  SELECT deactivated_at AS at FROM classes WHERE id='7b777777-1111-0000-0000-00000000000e';
GRANT SELECT ON rg_stamp TO PUBLIC;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"7b100000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT throws_ok(
  $$ UPDATE classes SET deactivated_at = now() + interval '1 day'
      WHERE id = '7b777777-1111-0000-0000-00000000000e' $$,
  'P0001',
  NULL,
  'a raw UPDATE cannot move the retirement date of an already-retired class');

SELECT is(
  (SELECT deactivated_at FROM classes WHERE id='7b777777-1111-0000-0000-00000000000e'),
  (SELECT at FROM rg_stamp),
  'and the date did not move — the engine''s expectation window is unchanged');

-- ══ 10. Reactivation (false->true) is NEVER guarded ═════════════════════════
-- The trigger fires only on a true->false transition, so a raw reactivation
-- passes straight through — the standing prohibition that reactivate_class()
-- takes no refusals holds for the raw path too.
SELECT lives_ok(
  $$ UPDATE classes SET is_active = true, deactivated_at = NULL
      WHERE id = '7b777777-1111-0000-0000-00000000000e' $$,
  'a raw reactivation is not blocked — the guard is one-directional (true->false only)');

-- ══ 8. THE TRUST BOUNDARY: a NO-USER context is exempt ═════════════════════
-- auth.uid() gates the trigger. With no jwt claim (a service_role or superuser
-- context — note RESET ROLE alone leaves the LOCAL claim set, so we clear it too)
-- auth.uid() is null, the guard does not fire, and even the obstructed ENROL
-- class retires. This is not a hole — it is why the edge functions (service_role,
-- no sub -> no auth.uid) and the Deno engine tests can force retired-class states
-- the engine must still read. The threat — an AUTHENTICATED tenant admin
-- (assertions 1/3) — always carries a uid.
RESET ROLE;
SET LOCAL "request.jwt.claims" TO '';
SELECT lives_ok(
  $$ UPDATE classes SET is_active = false, deactivated_at = now()
      WHERE id = '7b777777-1111-0000-0000-000000000001' $$,
  'a no-user (superuser/service_role) context is exempt — auth.uid() is the trust boundary');

-- ══ 12. Reactivation of an OBSTRUCTED, now-inactive class is NOT blocked ═════
-- ENROL was just retired (as superuser, past its refusals) and still holds an
-- open enrolment — the emergency-exit case (HANDOVER §3): reactivate_class()
-- takes no refusals, and the raw false->true path must not have grown one either,
-- or a business retired into this state could never be recovered.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"7b100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SELECT lives_ok(
  $$ UPDATE classes SET is_active = true, deactivated_at = NULL
      WHERE id = '7b777777-1111-0000-0000-000000000001' $$,
  'reactivating an obstructed inactive class is not blocked — the exit stays open');

SELECT * FROM finish();
ROLLBACK;
