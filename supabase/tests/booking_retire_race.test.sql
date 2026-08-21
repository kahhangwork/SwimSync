-- pgTAP: A BOOKING RE-CHECKS is_active UNDER THE CLASS-ROW LOCK, AND THAT LOCK IS
-- UNCONDITIONAL — book_makeup / book_trial (20260821000400, §7.200).
--
-- WHAT THIS FILE EXISTS TO PROTECT. Both functions read classes.is_active at the
-- TOP without a lock, refuse a retired host, then insert a guest. Between that
-- unlocked read and the insert a concurrent deactivate_class() can COMMIT, so the
-- guest lands in a now-retired class: unmarkable (no coach screen renders a
-- retired class) and blocking the whole billing month with no override, and it
-- breaks the "a retired class holds zero live guests" invariant the calendar and
-- Lessons badge lean on. 20260821000400 closes it by taking the §7.198 class-row
-- FOR UPDATE lock UNCONDITIONALLY (not just for a capped class) and re-reading
-- is_active UNDER it.
--
-- ⚠ WHY THIS IS A STRUCTURAL PIN, NOT A RACE — SAME AS class_capacity_lock.test.
-- The bug is a concurrency property; proving it directly needs TWO sessions in a
-- controlled interleave, and pgTAP runs inside ONE transaction rolled back at the
-- end — it cannot open a second connection or observe a real lock wait. So this
-- file asserts the two things a single session can, and each is a DISCRIMINATOR
-- that goes red on the pre-20260821000400 body:
--   • the under-lock is_active re-check (`WHERE id = p_class_id AND is_active`)
--     did not exist before — its presence is the fix;
--   • the lock now sits BEFORE the capacity read. In 20260821000200 the order
--     was `v_cap := class_effective_capacity(...)` THEN the FOR UPDATE, inside the
--     `v_cap IS NOT NULL` branch — so on an UNCAPPED class no lock was taken at
--     all. Asserting strpos(lock) < strpos(capacity-read) pins BOTH that the lock
--     moved out of the branch (unconditional) and that v_cap is now read under it
--     (§7.198's stale-v_cap half).
-- A genuine two-writer stress test would live in a Deno/bash harness; filed as the
-- honest limitation, not hidden.
--
-- MEASURED (§7.25): restore book_makeup/book_trial to their 20260821000200 bodies
-- and re-run — assertions 3,4,5,6,7,8 go red; 1,2 stay green (the lock string was
-- already present for the capped path). That split is this file's signature.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);

-- ── 1-2. The lock statement is present on both booking paths (§7.198). ──────
-- Match the whole `FROM classes WHERE id … FOR UPDATE` shape, not a bare
-- 'FOR UPDATE' a comment could satisfy.
SELECT ok(
  pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure) LIKE '%FROM classes WHERE id%FOR UPDATE%',
  'book_makeup holds a FOR UPDATE class-row lock (§7.198)');

SELECT ok(
  pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure) LIKE '%FROM classes WHERE id%FOR UPDATE%',
  'book_trial holds a FOR UPDATE class-row lock (§7.198)');

-- ── 3-4. …and re-checks is_active UNDER it — the booking-vs-retire close. ───
-- Red on the pre-20260821000400 body: this re-check did not exist.
SELECT ok(
  pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure) LIKE '%WHERE id = p_class_id AND is_active%',
  'book_makeup re-reads is_active after locking — a class retired in the gap is refused (§7.200)');

SELECT ok(
  pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure) LIKE '%WHERE id = p_class_id AND is_active%',
  'book_trial re-reads is_active after locking — a class retired in the gap is refused (§7.200)');

-- ── 5-6. The lock is UNCONDITIONAL: it precedes the capacity read. ──────────
-- Red on the pre-20260821000400 body, where `v_cap := class_effective_capacity`
-- came FIRST and the lock lived inside the `v_cap IS NOT NULL` branch (so an
-- uncapped class took no lock at all). strpos() = 0 when absent, which would also
-- fail the comparison — a belt-and-braces on the strings existing.
SELECT ok(
  strpos(pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure), 'FROM classes WHERE id = p_class_id FOR UPDATE')
    < strpos(pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure), 'class_effective_capacity(p_class_id)'),
  'book_makeup locks BEFORE reading capacity — the lock is unconditional, not gated by v_cap (§7.200)');

SELECT ok(
  strpos(pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure), 'FROM classes WHERE id = p_class_id FOR UPDATE')
    < strpos(pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure), 'class_effective_capacity(p_class_id)'),
  'book_trial locks BEFORE reading capacity — the lock is unconditional, not gated by v_cap (§7.200)');

-- ── 7-8. The is_active re-check sits AFTER the lock and BEFORE the INSERT. ───
-- A re-check that ran before the lock, or after the guest was written, would not
-- close the race. Pins the ordering the fix depends on.
SELECT ok(
  strpos(pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure), 'FROM classes WHERE id = p_class_id FOR UPDATE')
    < strpos(pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure), 'WHERE id = p_class_id AND is_active')
  AND strpos(pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure), 'WHERE id = p_class_id AND is_active')
    < strpos(pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure), 'INSERT INTO makeup_bookings'),
  'book_makeup: lock -> is_active re-check -> INSERT, in that order (§7.200)');

SELECT ok(
  strpos(pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure), 'FROM classes WHERE id = p_class_id FOR UPDATE')
    < strpos(pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure), 'WHERE id = p_class_id AND is_active')
  AND strpos(pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure), 'WHERE id = p_class_id AND is_active')
    < strpos(pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure), 'INSERT INTO trial_bookings'),
  'book_trial: lock -> is_active re-check -> INSERT, in that order (§7.200)');

SELECT * FROM finish();
ROLLBACK;
