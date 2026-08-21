-- pgTAP: AN ENROLMENT READS THE ENTERED CLASS's is_active UNDER A `FOR UPDATE`
-- LOCK — enforce_enrolment_schedule() (20260821000500, §7.201).
--
-- WHAT THIS FILE EXISTS TO PROTECT. enforce_enrolment_schedule() is the trigger
-- that refuses an enrolment into a RETIRED class. It read classes.is_active with
-- an UNLOCKED SELECT, so between that read and the enrolment's commit a
-- concurrent deactivate_class() could COMMIT, landing an ACTIVE enrolment in a
-- now-retired class — the roster-axis twin of the booking race (§7.200), and the
-- same broken invariant ("a retired class holds zero active enrolments"). The
-- capacity trigger's §7.198 lock did not cover it: capacity and is_active are two
-- DIFFERENT triggers, and on an UNCAPPED class the capacity one returns early
-- without locking. 20260821000500 adds FOR UPDATE to this trigger's own class
-- read, unconditionally.
--
-- ⚠ WHY THIS IS A STRUCTURAL PIN, NOT A RACE — SAME AS booking_retire_race.test
-- and class_capacity_lock.test. The bug is a concurrency property; proving it
-- directly needs TWO sessions in a controlled interleave, and pgTAP runs inside
-- ONE transaction rolled back at the end — it cannot open a second connection or
-- observe a real lock wait. So this asserts the one thing a single session can:
-- that the entered-class read (`WHERE c.id = NEW.class_id`) carries FOR UPDATE,
-- so is_active is read UNDER the lock. Red on the pre-20260821000500 body, where
-- that SELECT had no lock. A genuine two-writer stress test would live in a
-- Deno/bash harness; filed as the honest limitation, not hidden.
--
-- ⚠ THE LOCK IS ON THE ENTERED CLASS ONLY. The half-two overlap check reads
-- sibling classes (c2) and must stay lock-free and is_active-blind by standing
-- prohibition (HANDOVER §3); the migration header and function comment carry that
-- reasoning. (A count-of-FOR-UPDATE assertion was considered and dropped: the
-- token also appears in the function's own explanatory comment, so a text count
-- cannot cleanly separate the SQL lock from the prose — it would be fragile, not
-- protective.)
--
-- MEASURED (§7.25): restore enforce_enrolment_schedule() to its 20260811000100
-- body and re-run — both assertions go red (that body's class read had no lock).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(2);

-- ── 1. A FOR UPDATE lock is present on the class read. ──────────────────────
SELECT ok(
  pg_get_functiondef('public.enforce_enrolment_schedule()'::regprocedure) LIKE '%FROM classes c%FOR UPDATE%',
  'enforce_enrolment_schedule locks the class row it reads (§7.201)');

-- ── 2. …and it is the ENTERED class (NEW.class_id) that is locked — so
--       is_active is read under the lock, not some other row. ───────────────
-- Red on the pre-20260821000500 body: the entered-class read had no lock.
SELECT ok(
  pg_get_functiondef('public.enforce_enrolment_schedule()'::regprocedure) LIKE '%WHERE c.id = NEW.class_id%FOR UPDATE%',
  'the lock is on the entered class NEW.class_id, so is_active is re-read under it (§7.201)');

SELECT * FROM finish();
ROLLBACK;
