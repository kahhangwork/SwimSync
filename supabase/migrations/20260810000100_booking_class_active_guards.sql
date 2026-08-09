-- ════════════════════════════════════════════════════════════════════════════
-- A GUEST CANNOT BE BOOKED INTO, AND A LESSON CANNOT BE SCHEDULED ON, A CLASS
-- THAT IS NO LONGER RUNNING — AND `is_active = false` NOW REQUIRES A DATE.
--
-- docs/plans/UNMARKED_BOOKING_PLAN.md, step 2. Ships immediately BEFORE the
-- engine change that makes an unmarked booking block a billing month.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
-- `generate-invoices/core.ts` bails out of its per-class loop at two early
-- guards that never consult `bookingsByDate`, so a class with no ACTIVE
-- enrolments but holding an unmarked trial or make-up booking is skipped
-- whole: the guest is neither billed nor blocking, and if a second class bills,
-- the month SEALS over that lesson and it can never be invoiced (§11.6). The
-- engine fix that follows makes such a booking BLOCK — and the block has no
-- override by design (§8a).
--
-- That is safe only if the blocking state always has a screen that can clear
-- it. The coach class list, the coach Schedule tab and the admin Classes page
-- all filter `classes.is_active` (§7.109), so a booking sitting in a RETIRED
-- class would block a whole business's month with nothing able to mark it —
-- §8.32's deadlock on a visibility axis. This migration is what makes that
-- state unreachable, and it does it at the DOOR rather than in the engine.
--
-- ── WHAT WAS ALREADY TRUE, VERIFIED RATHER THAN ASSUMED ─────────────────────
-- Read off `pg_get_functiondef()` on 2026-08-10, not off the migration files —
-- both `BACKLOG.md` and a risk review claimed `book_trial()` has no floor
-- guard, having read the SUPERSEDED `20260725000800`. It has one, added by
-- `20260806000200`, and it uses `markable_floor()`:
--
--   function                | is_active refusal | floor guard
--   ------------------------+-------------------+---------------------
--   book_makeup             | YES               | markable_floor()
--   book_trial              | NO  ← closed here | markable_floor()
--   schedule_extra_lesson   | NO  ← closed here | markable_floor()
--
-- `deactivate_class()` (20260809000300) already refuses to retire a class that
-- has children on its roster, guests booked into a future lesson, or lessons
-- still owed a mark — `class_unmarked_lesson_dates()` unions BOTH booking
-- tables. So the only remaining door into "retired class holding an unmarked
-- booking" is booking into one AFTER it was retired, which is what parts 1
-- and 2 below shut.
--
-- ── PRODUCTION AUDIT, RUN BEFORE A LINE OF THIS WAS WRITTEN ────────────────
-- 2026-08-10, against production: 0 unmarked bookings in a class with no active
-- enrolment; 0 classes with `is_active = false AND deactivated_at IS NULL`;
-- 0 unmarked bookings below `markable_floor()` in an unsealed month. Read that
-- honestly — production holds NO live booking of either kind, so the first and
-- third passed vacuously. The one non-vacuous result is the second, 0 against
-- 6 real classes, and it is what licenses the VALIDATE in part 3.
--
-- Rollback: supabase/rollback/20260810_booking_guards_DOWN.sql — EXECUTED, not
-- merely written (§7.93).
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. book_trial(): refuse a host class that is no longer running ─────────
-- Copied verbatim from book_makeup() (20260802000200), including its position
-- immediately after `class not found`: the two functions answer the same
-- question about the same column and must not drift into two wordings.
--
-- WHY A GUEST AND NOT AN ENROLMENT DECIDES THIS: a trial booking makes a child
-- expected at exactly one lesson of this class and nowhere else. A retired
-- class runs no lessons, so the booking is an appointment for a lesson that
-- will never happen — invisible to the coach, unmarkable, and (after the engine
-- change) blocking. Refusing at the door is the only place it can be refused
-- without an override, and an override here could only ever produce a
-- permanent underbill or a permanent block.

CREATE OR REPLACE FUNCTION public.book_trial(
  p_class_id     UUID,
  p_session_date DATE,
  p_student_id   UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_tenant   UUID;
  v_category UUID;
  v_class_day day_of_week;
  v_booking  UUID;
  v_class_title TEXT;
  v_host_active BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.tenant_id, c.category_id, c.day_of_week, c.title, c.is_active
    INTO v_tenant, v_category, v_class_day, v_class_title, v_host_active
    FROM classes c WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  -- NEW in 20260810000100. See the header.
  IF NOT v_host_active THEN
    RAISE EXCEPTION '% is no longer running', v_class_title;
  END IF;

  -- Admin only. Booking is an arrangement, not an observation.
  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may book a trial';
  END IF;

  -- The student must belong to this business.
  IF NOT EXISTS (
    SELECT 1 FROM students s
     WHERE s.id = p_student_id AND s.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'that child belongs to another business';
  END IF;

  -- ── 0. Not into an already-billed month ─────────────────────────────────
  -- New in 20260806000200. See the header above this function: this is the one
  -- refusal in that migration that did not exist before it.
  IF p_session_date < markable_floor(v_tenant) THEN
    RAISE EXCEPTION
      'A trial cannot be booked before % — that month has been billed.',
      to_char(markable_floor(v_tenant), 'DD Mon YYYY');
  END IF;

  -- ── 1. The date must be a day this class actually runs ──────────────────
  -- Otherwise the child is expected at a lesson that never happens: never on
  -- any roster, never marked, and blocking the billing month indefinitely with
  -- no visible cause.
  --
  -- EXTRACT(DOW) rather than to_char(…,'day'): to_char renders the weekday
  -- NAME through `lc_time`, so on a server with a non-English locale every
  -- comparison here would fail and NO trial could ever be booked. DOW is an
  -- integer and means the same thing everywhere. 0 = Sunday.
  IF (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
        )[EXTRACT(DOW FROM p_session_date)::int + 1] <> v_class_day::text THEN
    RAISE EXCEPTION
      '% runs on a %, but % is a %',
      v_class_title,
      v_class_day,
      to_char(p_session_date, 'DD Mon YYYY'),
      (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
        )[EXTRACT(DOW FROM p_session_date)::int + 1];
  END IF;

  -- ── 2. Not already a customer: an ACTIVE enrolment in ANY class ─────────
  -- A trial means "not in a class yet". A CLOSED enrolment does not block — a
  -- family that left and is considering coming back, possibly to a different
  -- class, is a real trial.
  IF EXISTS (
    SELECT 1 FROM student_class_enrolments e
     WHERE e.student_id = p_student_id AND e.is_active
  ) THEN
    RAISE EXCEPTION
      'that child is already enrolled in a class — trials are for children not yet in one';
  END IF;

  -- ── 3. Nor holding prepaid value ────────────────────────────────────────
  -- Checked across EVERY parent linked to the child: parent_students is
  -- many-to-many, so testing only the first would make this bypassable
  -- depending on which row came back first.
  IF EXISTS (
    SELECT 1
      FROM parent_students ps
      JOIN parent_packages pp ON pp.parent_id = ps.parent_id
     WHERE ps.student_id = p_student_id
       AND pp.tenant_id = v_tenant
       AND pp.status = 'active'
       AND pp.value_remaining > 0
       AND (pp.expires_on IS NULL OR pp.expires_on >= p_session_date)
  ) THEN
    RAISE EXCEPTION
      'that family already has a prepaid package with this business — a trial is for new families';
  END IF;

  -- category_id is SNAPSHOTTED from the class. See the column comment on
  -- trial_bookings: classes.category_id is mutable and money depends on it.
  INSERT INTO trial_bookings
    (tenant_id, student_id, class_id, session_date, category_id, booked_by)
  VALUES (v_tenant, p_student_id, p_class_id, p_session_date, v_category, v_actor)
  RETURNING id INTO v_booking;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_actor, 'trial_booked', 'Student', p_student_id,
    jsonb_build_object('class_id', p_class_id, 'session_date', p_session_date,
                       'category_id', v_category, 'booking_id', v_booking)
  );

  RETURN v_booking;
END;
$$;

COMMENT ON FUNCTION public.book_trial(UUID, DATE, UUID) IS
  'Book a child not yet enrolled into one lesson of a class, as a trial. Tenant admin only. Refuses: an inactive host class (20260810000100 — a retired class runs no lessons, so the guest would be unmarkable AND blocking), a date before markable_floor(), a date that is not the class''s weekday, a child with any active enrolment, and a family holding live prepaid value. None of these takes an override.';


-- ── 2. schedule_extra_lesson(): refuse a class that is no longer running ───
-- The admin Classes page grew a *Show retired* toggle in 20260809000300's
-- deploy, so a retired class is now REACHABLE in the admin UI — and this
-- function had no `is_active` check at all. A `lesson_sessions` row created on
-- a retired class enters the engine's `datesToCheck` through `sessionByDate`,
-- which is NOT clamped by `deactivated_at` (recorded sessions always count —
-- a lesson that genuinely ran must still block). So it would block a month on
-- a class no coach screen renders.
--
-- ALSO CORRECTED HERE: the inline comment below used to justify the floor check
-- with "scheduling a lesson into an already-invoiced month would create a lesson
-- that can never bill". `markable_floor()` is LEAST(1st of last month, the month
-- after the latest seal, created_at) — it is NOT the seal, and LEAST takes the
-- EARLIER, so in August the floor sits at 1 July whether or not July is sealed.
-- The check tests the FLOOR; the old wording described testing the SEAL.

CREATE OR REPLACE FUNCTION public.schedule_extra_lesson(
  p_class_id UUID,
  p_date     DATE,
  p_reason   TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   UUID := auth.uid();
  v_tenant  UUID;
  v_session UUID;
  v_title   TEXT;
  v_active  BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- The tenant is DERIVED FROM THE CLASS and is not a parameter. A SECURITY
  -- DEFINER writer is exempt from pin_student_tenant() and from every
  -- current_user-seam trigger (§7.42), so a tenant it merely accepted would be
  -- checked by nothing downstream.
  SELECT c.tenant_id, c.title, c.is_active INTO v_tenant, v_title, v_active
    FROM classes c WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  -- NEW in 20260810000100. See the header.
  IF NOT v_active THEN
    RAISE EXCEPTION '% is no longer running', v_title;
  END IF;

  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may schedule an extra lesson';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION
      'a reason is required — it is what tells the coach why this lesson exists';
  END IF;

  -- The weekday rule is waived here (that is the whole point) and FUTURE dates
  -- are allowed: a makeup lesson is arranged ahead, like a trial booking, and
  -- appears on the coach's roster so they can mark it on the day. The FLOOR
  -- still applies — below markable_floor() nobody may record attendance, so the
  -- lesson would be created already unmarkable, and after the engine change of
  -- 2026-08-10 an unmarkable lesson is one that BLOCKS.
  IF p_date < markable_floor(v_tenant) THEN
    RAISE EXCEPTION
      'An extra lesson cannot be added before % — attendance can no longer be recorded that far back.',
      to_char(markable_floor(v_tenant), 'DD Mon YYYY');
  END IF;

  INSERT INTO lesson_sessions (class_id, session_date, off_schedule_reason)
  VALUES (p_class_id, p_date, btrim(p_reason))
  ON CONFLICT (class_id, session_date) DO NOTHING
  RETURNING id INTO v_session;

  -- DO NOTHING returns no row, so a second identical call must resolve the
  -- existing session rather than returning NULL and reading as a failure.
  IF v_session IS NULL THEN
    SELECT id INTO v_session
      FROM lesson_sessions
     WHERE class_id = p_class_id AND session_date = p_date;
  END IF;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_actor, 'extra_lesson_scheduled', 'lesson_session', v_session,
    jsonb_build_object(
      'class_id', p_class_id,
      'class_title', v_title,
      'session_date', p_date,
      'reason', btrim(p_reason)
    )
  );

  RETURN v_session;
END $$;

COMMENT ON FUNCTION public.schedule_extra_lesson(UUID, DATE, TEXT) IS
  'Create an off-schedule lesson_session so a lesson held on a non-class weekday can be marked. Tenant admin only, reason mandatory. Refuses an inactive class (20260810000100) and a date before markable_floor() — that bound is the MARKING floor, not the seal; LEAST() means it can sit before an unsealed month.';


-- ── 3. `is_active = false` REQUIRES a date, enforced by the database ────────
-- This is the structural half of the plan's RISK 2, and it is what lets the
-- engine treat a booking as unconditional evidence.
--
-- `core.ts` derives `lastScheduledDate` from `deactivated_at` to answer "was
-- this class running on the 13th?". A row with `is_active = false AND
-- deactivated_at IS NULL` has no answer, so the engine's rule for it is
-- "expect nothing" — correct for a DERIVED weekday date, and catastrophic if
-- it were ever applied to a booking, which is explicit evidence that a named
-- child was expected on a named date. The prohibition against clamping
-- bookings therefore needs a backstop stronger than a comment: after this
-- constraint, no row with a null `lastScheduledDate` can exist at all.
--
-- IT ALSO CLOSES A REAL HOLE. `classes_write ON classes FOR ALL TO
-- authenticated` (20260718000900) plus `GRANT … UPDATE … ON public.classes`
-- (20260804000600) let any tenant admin run `UPDATE classes SET is_active =
-- false` straight over PostgREST, never touching deactivate_class() and never
-- passing its three refusals. The admin panel does not do this — it writes
-- is_active only on INSERT — but that is the SCREEN applying the limit, not the
-- database (§7.32). deactivate_class() is now the only way to retire a class.
--
-- NOT VALID first, then VALIDATE as a separate statement: a non-empty legacy
-- population then fails the VALIDATE, which names the offending row, instead of
-- the ADD, which does not. Production measured 0 such rows on 2026-08-10.

ALTER TABLE public.classes
  ADD CONSTRAINT classes_inactive_requires_deactivated_at
  CHECK (is_active = true OR deactivated_at IS NOT NULL) NOT VALID;

ALTER TABLE public.classes
  VALIDATE CONSTRAINT classes_inactive_requires_deactivated_at;

COMMENT ON CONSTRAINT classes_inactive_requires_deactivated_at ON public.classes IS
  'A retired class must record WHEN it was retired. generate-invoices reads deactivated_at to decide how far an inactive class was expected to run; a NULL there means "expect nothing", which is safe for a derived weekday date and would be a silent underbill if ever applied to a booking. Also makes deactivate_class() the only path that can set is_active = false, since a raw PostgREST UPDATE cannot supply the date.';


-- ── 4. Apply-time probes — these RAISE rather than warn ─────────────────────
-- No new function or table is created here, and CREATE OR REPLACE preserves an
-- existing ACL, so nothing above should have moved a grant. §7.87 means that
-- is worth ASSERTING rather than assuming: a function is callable by nobody
-- until granted, and a silent change here is the shape that reaches production
-- as `permission denied` on a screen nobody tested.

DO $$
DECLARE
  v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['book_trial', 'schedule_extra_lesson'] LOOP
    IF NOT has_function_privilege('authenticated', ('public.' || v_fn ||
         CASE v_fn WHEN 'book_trial' THEN '(uuid,date,uuid)'
                   ELSE '(uuid,date,text)' END)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION
        '%() lost EXECUTE for authenticated — the admin UI would fail with permission denied', v_fn;
    END IF;

    IF has_function_privilege('anon', ('public.' || v_fn ||
         CASE v_fn WHEN 'book_trial' THEN '(uuid,date,uuid)'
                   ELSE '(uuid,date,text)' END)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION
        '%() is EXECUTE-able by anon — see §7.82, and 20260804000400 turned off the mechanism that used to regrant it', v_fn;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM classes
              WHERE is_active = false AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION
      'a class is inactive with no deactivated_at — the CHECK above should have made this impossible';
  END IF;
END $$;
