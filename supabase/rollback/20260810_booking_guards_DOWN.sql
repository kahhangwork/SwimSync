-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260810000100_booking_class_active_guards.sql
--
-- §7.93: this file is EXECUTED, not merely written — running the DOWN is the
-- half that finds the bugs (§7.92 was found exactly that way). The procedure
-- used on 2026-08-10 was: apply the migration, dump `pg_get_functiondef()` for
-- both functions, run this file, dump again and diff against the pre-migration
-- definitions, then re-apply the migration on top and diff once more.
--
-- ⚠ WHAT THIS RESTORES IS A KNOWN-BROKEN STATE, AND THAT IS THE POINT OF
-- SAYING SO HERE. After running this:
--   * a trial can be booked into a RETIRED class, and
--   * an extra lesson can be scheduled on one,
-- either of which — once generate-invoices v20 is live — creates a lesson that
-- BLOCKS a billing month with no override and no screen able to clear it
-- (§7.109). So this file must never be run while v20 is deployed unless the
-- engine is rolled back to v19 FIRST. Order matters in both directions.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. Drop the CHECK constraint ───────────────────────────────────────────
-- Dropped first: while it exists, nothing can create the legacy-inactive row,
-- and the functions below are restored to versions that assume it does not.

ALTER TABLE public.classes
  DROP CONSTRAINT IF EXISTS classes_inactive_requires_deactivated_at;


-- ── 2. book_trial() — restored to its 20260806000200 definition ────────────
-- Identical to the live definition read off pg_get_functiondef() on
-- 2026-08-10 immediately before the migration was applied. The ONLY difference
-- from 20260810000100 is the absence of the `v_host_active` declaration, the
-- `c.is_active` in the SELECT, and the refusal that follows `class not found`.

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
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.tenant_id, c.category_id, c.day_of_week, c.title
    INTO v_tenant, v_category, v_class_day, v_class_title
    FROM classes c WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
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

COMMENT ON FUNCTION public.book_trial(UUID, DATE, UUID) IS NULL;


-- ── 3. schedule_extra_lesson() — restored to its 20260806000200 definition ─
-- Including the ORIGINAL inline comment and error message, wording error and
-- all. A rollback file that quietly improves things is not a rollback.

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
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- The tenant is DERIVED FROM THE CLASS and is not a parameter. A SECURITY
  -- DEFINER writer is exempt from pin_student_tenant() and from every
  -- current_user-seam trigger (§7.42), so a tenant it merely accepted would be
  -- checked by nothing downstream.
  SELECT c.tenant_id, c.title INTO v_tenant, v_title
    FROM classes c WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
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
  -- still applies — scheduling a lesson into an already-invoiced month would
  -- create a lesson that can never bill.
  IF p_date < markable_floor(v_tenant) THEN
    RAISE EXCEPTION
      'An extra lesson cannot be added before % — that month has been billed.',
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

COMMENT ON FUNCTION public.schedule_extra_lesson(UUID, DATE, TEXT) IS NULL;
