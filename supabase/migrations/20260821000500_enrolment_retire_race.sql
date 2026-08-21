-- ============================================================
-- Close the ENROLMENT-vs-concurrent-retire race — the roster-axis twin of the
-- booking race. (§7.201; BACKLOG "The ROSTER axis has the SAME booking-vs-retire
-- race"; found 2026-08-21 while shipping §7.200.)
--
-- THE RACE. enforce_enrolment_schedule() is the trigger that refuses an
-- enrolment into a RETIRED class. It reads classes.is_active with an UNLOCKED
-- SELECT at the top, refuses if the class is inactive, then the enrolment
-- inserts. Under READ COMMITTED that read is stale by insert time: a concurrent
-- deactivate_class() committing in the gap leaves an ACTIVE enrolment in a
-- now-retired class — breaking the "a retired class holds zero active
-- enrolments" invariant the calendar and Lessons badge lean on, and an inactive
-- class is invisible to every role who could clear it (§7.109).
--
-- This is exactly §7.200 on the roster axis. The capacity trigger
-- (enforce_class_capacity / trg_class_capacity) already took the §7.198
-- `FOR UPDATE` class-row lock for the last-seat race, but capacity and is_active
-- are two DIFFERENT triggers: trg_class_capacity fires first (alphabetical), and
-- on an UNCAPPED class it returns early WITHOUT locking (v_cap IS NULL), so
-- nothing serialised the is_active read at all. The enrolment FK on class_id
-- takes only FOR KEY SHARE, which does not serialise against deactivate_class()'s
-- non-key is_active UPDATE.
--
-- FIX. Lock NEW.class_id and read is_active UNDER the lock — by adding FOR UPDATE
-- to the trigger's existing class read. One clause; the refusal is already here.
-- The lock is UNCONDITIONAL (every active enrolment, capped or not), so the
-- uncapped case is covered too. The reverse direction (a retire racing this
-- INSERT) is already caught by trg_class_retirement_guard (§7.199) re-running
-- assert_class_retirable once this lock releases — its roster count then sees the
-- just-committed enrolment and refuses the retire. Safe both ways round.
--
-- ⚠ THE LOCK IS ON NEW.class_id ONLY — the class being ENTERED, never a
-- counterparty. The half-two overlap check below still reads sibling classes (c2)
-- lock-free and is_active-BLIND, which is a STANDING PROHIBITION (HANDOVER §3):
-- an inactive counterparty provably holds no enrolment because entry to a retired
-- class is refused, so the overlap check must not consult c2.is_active. This
-- migration does not touch that; it locks and re-reads only the entered class.
-- reactivate_class() is likewise untouched (it never enters this trigger with a
-- retired NEW.class_id — the WHEN (NEW.is_active) clause and the refusal below
-- forbid it).
--
-- One CREATE OR REPLACE, trigger function unchanged in every other respect;
-- SECURITY DEFINER kept (RLS could hide the sibling row the overlap check needs,
-- §7.125). No new object, no grant touched.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_enrolment_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day        day_of_week;
  v_start      TIME;
  v_end        TIME;
  v_title      TEXT;
  v_own_active BOOLEAN;
  v_clash      TEXT;
BEGIN
  -- ⚠ §7.201: lock the entered class row and read is_active UNDER the lock. An
  -- unlocked read is stale by the time the enrolment commits — a concurrent
  -- deactivate_class() in the gap would land an ACTIVE enrolment in a now-retired
  -- class (the roster-axis twin of the booking race §7.200). FOR UPDATE on
  -- NEW.class_id ONLY (the class being ENTERED); the c2 overlap check below stays
  -- lock-free and is_active-blind by standing prohibition. The reverse direction
  -- is caught by trg_class_retirement_guard once this lock releases (§7.199).
  SELECT c.day_of_week, c.start_time, c.end_time, c.title, c.is_active
    INTO v_day, v_start, v_end, v_title, v_own_active
    FROM classes c
   WHERE c.id = NEW.class_id
     FOR UPDATE;

  IF v_day IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  -- Half one of the inversion. Nothing may ENTER a retired class; the class
  -- guards added in 20260810000100 said the same thing for bookings.
  IF NOT v_own_active THEN
    RAISE EXCEPTION
      '% has been retired — restore it on the Classes page before enrolling anyone',
      v_title;
  END IF;

  -- Half two. Note the absence of `AND c2.is_active` — deliberate, see above.
  -- `e2.id <> NEW.id` handles the UPDATE case, and also the INSERT that an
  -- .upsert() resolves to an UPDATE (§7.57). Column defaults are applied before
  -- BEFORE-ROW triggers, so NEW.id is populated on INSERT.
  --
  -- `e2.class_id <> NEW.class_id` IS NOT REDUNDANT — it is the difference
  -- between two rules. This trigger owns "two DIFFERENT classes at the same
  -- time"; the SAME class twice is the unique index's job. Without this line a
  -- duplicate enrolment reaches the trigger first (BEFORE INSERT precedes the
  -- index check), the class overlaps ITSELF, and the admin is told
  -- "Mon 5pm clashes with Mon 5pm" instead of getting a 23505. Measured, not
  -- predicted — it is what the first version actually did.
  SELECT string_agg(c2.title, ', ' ORDER BY c2.title)
    INTO v_clash
    FROM student_class_enrolments e2
    JOIN classes c2 ON c2.id = e2.class_id
   WHERE e2.student_id = NEW.student_id
     AND e2.is_active
     AND e2.id       <> NEW.id
     AND e2.class_id <> NEW.class_id
     AND c2.day_of_week = v_day
     AND c2.start_time < v_end
     AND v_start       < c2.end_time;

  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION
      '% clashes with % — a child cannot be in two classes at the same time. '
      'Remove them from one first.',
      v_title, v_clash;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_enrolment_schedule() IS
  'Wave 2: refuses an enrolment into a retired class, and one that overlaps '
  'another of the child''s active enrolments. SECURITY DEFINER so RLS cannot '
  'hide a sibling row and make the check silently pass. §7.201: the entered '
  'class row is read FOR UPDATE so is_active cannot go stale against a concurrent '
  'deactivate_class() (the roster-axis twin of the booking race §7.200); the lock '
  'is on NEW.class_id only, never the c2 counterparty.';

-- ── Apply-time probe (§7.87): the lock must be present, and the trigger must
--    still exist. RAISE, do not warn.
DO $$
BEGIN
  IF pg_get_functiondef('public.enforce_enrolment_schedule()'::regprocedure)
       NOT LIKE '%WHERE c.id = NEW.class_id%FOR UPDATE%' THEN
    RAISE EXCEPTION 'enforce_enrolment_schedule lost its FOR UPDATE lock on the entered class — the enrolment-vs-retire race is reopened (§7.201)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.student_class_enrolments'::regclass
       AND tgname = 'trg_enrolment_schedule'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_enrolment_schedule is missing — the enrolment retire/overlap guard is gone';
  END IF;
END $$;
