-- ============================================================
-- ROLLBACK for 20260821000700_advance_cancel_lesson.sql (advance-cancel a lesson).
--
-- Drops cancel_lesson()/restore_lesson(), restores the EIGHT replaced bodies to
-- the definitions that were live immediately before (captured from
-- pg_get_functiondef() on a database at 20260821000600 — §7.115: the live body,
-- not the migration that first created it), then drops the constraints and the
-- three columns. Same signatures throughout, so every ACL survives.
--
-- ⚠ DATA: dropping the columns DISCARDS every cancellation. A session row that
-- cancel_lesson() created (no attendance, no off_schedule_reason) survives as a
-- bare 'scheduled' row — which the engine treats as an ordinary lesson that
-- then EXPECTS its enrolled children and blocks the month until marked. Run the
-- SELECT below first and decide per row; on production today there are none.
--
--   SELECT ls.id, c.title, ls.session_date, ls.cancellation_reason
--     FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
--    WHERE ls.cancelled_at IS NOT NULL;
--
-- Rehearsed locally (§7.93): apply 20260821000700 → run this → supabase test db
-- green → re-apply 20260821000700 → green.
-- ============================================================

DROP FUNCTION IF EXISTS public.cancel_lesson(uuid, date, text);
DROP FUNCTION IF EXISTS public.restore_lesson(uuid, date);

-- ── guard_session_date: body live before 20260821000700 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_session_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- off_schedule_reason is the admin's authorisation, so a client may never
  -- write it. Checked on INSERT and UPDATE alike.
  IF TG_OP = 'INSERT' AND NEW.off_schedule_reason IS NOT NULL THEN
    RAISE EXCEPTION
      'An off-schedule lesson is scheduled by your business''s admin, not recorded directly.';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.off_schedule_reason IS DISTINCT FROM OLD.off_schedule_reason THEN
    RAISE EXCEPTION
      'An off-schedule lesson is scheduled by your business''s admin, not recorded directly.';
  END IF;

  -- An UPDATE that does not move the date is not this trigger's business — that
  -- is an ordinary edit to a session that already passed the rule.
  IF TG_OP = 'UPDATE' AND NEW.session_date IS NOT DISTINCT FROM OLD.session_date THEN
    RETURN NEW;
  END IF;

  -- ⚠ FAIL OPEN, NOT CLOSED. A class that resolves to no tenant leaves v_tenant
  -- NULL, which markable_floor() answers with the calendar floor — the exact
  -- rule that applied before this migration. Do NOT raise here instead: the FK
  -- on class_id is about to reject the row anyway, and a guard that refuses on
  -- its own lookup miss turns a data oddity into "no coach can mark anything".
  -- Same reasoning as the v_date IS NULL branch in guard_attendance_date.
  SELECT c.tenant_id INTO v_tenant FROM classes c WHERE c.id = NEW.class_id;

  PERFORM assert_markable_date(NEW.session_date, v_tenant);

  -- An existing off-schedule lesson keeps its exemption when edited, otherwise
  -- the admin's own makeup lesson would become uneditable by the coach.
  IF TG_OP = 'INSERT' OR OLD.off_schedule_reason IS NULL THEN
    PERFORM assert_class_runs_on(NEW.class_id, NEW.session_date);
  END IF;

  RETURN NEW;
END $function$

;

-- ── guard_attendance_date: body live before 20260821000700 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_attendance_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_date   DATE;
  v_tenant UUID;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- ⚠ A BEFORE INSERT TRIGGER ALSO FIRES FOR ROWS THAT RESOLVE TO AN UPDATE.
  -- PostgREST emits `.upsert(…, { onConflict })` as
  -- INSERT … ON CONFLICT DO UPDATE, and Postgres runs BEFORE INSERT triggers
  -- for every candidate row BEFORE the conflict is detected. Confirmed
  -- empirically, not reasoned about.
  --
  -- So without this branch the guard would refuse every CORRECTION to an
  -- out-of-window lesson — which is the credit-note flow (PRD §7.8), the exact
  -- feature the INSERT/UPDATE split was chosen to protect. Worse, the coach's
  -- save sends every student in ONE statement, so a single refused row fails
  -- the whole class's save.
  --
  -- An existing row for this (session, student) means this is a correction, not
  -- a new charge. Corrections are always allowed; only NEW charges are bounded.
  IF EXISTS (
    SELECT 1 FROM attendance a
     WHERE a.lesson_session_id = NEW.lesson_session_id
       AND a.student_id = NEW.student_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT ls.session_date, c.tenant_id
    INTO v_date, v_tenant
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
   WHERE ls.id = NEW.lesson_session_id;

  -- No session means the FK is about to reject this anyway; raising here would
  -- replace a clear referential error with a confusing one about dates.
  IF v_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- Deliberately NO weekday check. The session's existence already settled
  -- that, and an off-schedule lesson scheduled by the admin must remain
  -- markable by the coach.
  --
  -- v_tenant cannot be NULL past the guard above (classes.tenant_id is NOT
  -- NULL and the join is inner), but if it ever were, markable_floor() answers
  -- with the calendar floor rather than failing — see guard_session_date.
  PERFORM assert_markable_date(v_date, v_tenant);

  RETURN NEW;
END $function$

;

-- ── book_makeup: body live before 20260821000700 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.book_makeup(p_class_id uuid, p_session_date date, p_student_id uuid, p_home_class_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor          UUID := auth.uid();
  v_tenant         UUID;
  v_host_category  UUID;
  v_host_active    BOOLEAN;
  v_class_day      day_of_week;
  v_class_title    TEXT;
  v_home_class     UUID;
  v_home_category  UUID;
  v_home_title     TEXT;
  v_n_enrolments   INT;
  v_booking        UUID;
  v_cap            SMALLINT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.tenant_id, c.category_id, c.day_of_week, c.title, c.is_active
    INTO v_tenant, v_host_category, v_class_day, v_class_title, v_host_active
    FROM classes c WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  IF NOT v_host_active THEN
    RAISE EXCEPTION '% is no longer running', v_class_title;
  END IF;

  -- Admin only. Arranging is the admin's, observing is the coach's — the same
  -- split book_trial and schedule_extra_lesson enforce.
  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may book a make-up';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM students s
     WHERE s.id = p_student_id AND s.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'that child belongs to another business';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM students s
     WHERE s.id = p_student_id AND s.is_active
  ) THEN
    RAISE EXCEPTION 'that child is no longer attending — reactivate them first';
  END IF;

  -- ── The HOME class: named by the admin, or derived when there is no choice ─
  SELECT count(*) INTO v_n_enrolments
    FROM student_class_enrolments e
   WHERE e.student_id = p_student_id AND e.is_active;

  IF v_n_enrolments = 0 THEN
    RAISE EXCEPTION
      'that child is not enrolled in a class — a make-up is for enrolled children; book a trial instead';
  END IF;

  IF p_home_class_id IS NULL THEN
    IF v_n_enrolments > 1 THEN
      RAISE EXCEPTION
        'that child is in more than one class — say which class this make-up is for';
    END IF;
    -- STRICT, not plain: if the one-row assumption ever breaks again this
    -- raises rather than picking a row and pricing an invoice from it.
    SELECT e.class_id, c.category_id, c.title
      INTO STRICT v_home_class, v_home_category, v_home_title
      FROM student_class_enrolments e
      JOIN classes c ON c.id = e.class_id
     WHERE e.student_id = p_student_id AND e.is_active;
  ELSE
    SELECT e.class_id, c.category_id, c.title
      INTO v_home_class, v_home_category, v_home_title
      FROM student_class_enrolments e
      JOIN classes c ON c.id = e.class_id
     WHERE e.student_id = p_student_id
       AND e.is_active
       AND e.class_id = p_home_class_id;

    IF v_home_class IS NULL THEN
      RAISE EXCEPTION
        'that is not one of the child''s current classes — pick the class this make-up replaces';
    END IF;
  END IF;

  -- ── ANY of their own classes? That is an extra lesson, not a guest slot ────
  -- Widened from `v_home_class = p_class_id` — see the header. Booking into the
  -- child's OTHER class is the silent-void case.
  IF EXISTS (
    SELECT 1 FROM student_class_enrolments e
     WHERE e.student_id = p_student_id
       AND e.class_id   = p_class_id
       AND e.is_active
  ) THEN
    RAISE EXCEPTION
      'that is one of the child''s own classes — a make-up is a guest slot in a class they are NOT in. Schedule an "Extra lesson" on the Classes page instead';
  END IF;

  -- ── Same category only ───────────────────────────────────────────────────
  -- Compared LIVE at booking time, then v_home_category is snapshotted onto
  -- the row (§7.45 — both category columns are mutable).
  IF v_home_category IS DISTINCT FROM v_host_category THEN
    RAISE EXCEPTION
      'a make-up must stay in the child''s own category: % is %, but % is %',
      v_home_title,
      (SELECT name FROM class_categories WHERE id = v_home_category),
      v_class_title,
      (SELECT name FROM class_categories WHERE id = v_host_category);
  END IF;

  -- ── The date must be a lesson that will actually happen ──────────────────
  -- Either a day this class runs (EXTRACT(DOW), not to_char — a non-English
  -- lc_time would break every name comparison, see book_trial), OR a date an
  -- admin-scheduled off-schedule session already exists for. The OR branch is
  -- deliberate: guesting into another class's extra lesson is a real make-up,
  -- and the session's existence proves the lesson is real and markable — the
  -- same reasoning as guard_attendance_date's deliberate no-weekday-check.
  IF (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
        )[EXTRACT(DOW FROM p_session_date)::int + 1] <> v_class_day::text
     AND NOT EXISTS (
       SELECT 1 FROM lesson_sessions ls
        WHERE ls.class_id = p_class_id AND ls.session_date = p_session_date
     )
  THEN
    RAISE EXCEPTION
      '% runs on a %, and no extra lesson is scheduled for % — pick a day the class actually meets',
      v_class_title, v_class_day, to_char(p_session_date, 'DD Mon YYYY');
  END IF;

  -- ── Floor: never into an already-billed month ────────────────────────────
  -- A booking below the attendance window can neither be marked nor bill — it
  -- would be silently lost. Future dates are allowed, no ceiling: the picker's
  -- window is an affordance, this is the guard.
  IF p_session_date < markable_floor(v_tenant) THEN
    RAISE EXCEPTION
      'A make-up cannot be booked before % — that month has been billed.',
      to_char(markable_floor(v_tenant), 'DD Mon YYYY');
  END IF;

  -- ── Duplicate live booking: a plain sentence, not a constraint error ─────
  IF EXISTS (
    SELECT 1 FROM makeup_bookings mb
     WHERE mb.student_id = p_student_id
       AND mb.class_id = p_class_id
       AND mb.session_date = p_session_date
       AND mb.cancelled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'that child is already booked into that lesson';
  END IF;

  -- ── Serialise against a concurrent RETIRE and the last seat (§7.198, §7.200) ─
  -- Lock the class row FIRST, UNCONDITIONALLY. §7.198 locked only a CAPPED class
  -- (the last-seat race is booking-vs-booking); §7.200 is booking-vs-RETIRE and
  -- exists on an UNCAPPED class too — makeup_bookings.class_id's FK takes only
  -- FOR KEY SHARE, which does not serialise against deactivate_class()'s non-key
  -- is_active UPDATE. The "unlimited classes never lock" optimisation is
  -- deliberately traded here for correctness.
  PERFORM 1 FROM classes WHERE id = p_class_id FOR UPDATE;

  -- Re-read is_active UNDER the lock. The check at the top read it WITHOUT a
  -- lock; a deactivate_class() that committed in the gap would otherwise leave
  -- this guest in a now-retired class — an unmarkable booking that blocks the
  -- month with no override, breaking the "a retired class holds zero live
  -- guests" invariant. (The reverse — a retire racing THIS booking — is caught
  -- by trg_class_retirement_guard re-running assert_class_retirable once this
  -- lock releases, §7.199.)
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id AND is_active) THEN
    RAISE EXCEPTION '% is no longer running', v_class_title;
  END IF;

  -- ── Capacity: a hard refusal for EVERYONE, admin included (Decision 1) ────
  -- Counts the lesson's expected set on p_session_date (enrolled-by-span +
  -- trial + make-up guests) against the effective maximum. LAST, so an
  -- already-booked child hears "already booked" above, not "full". Read UNDER
  -- the lock (§7.200) so a concurrent capacity DECREASE is seen — the stale-v_cap
  -- half §7.198 left by reading v_cap before the lock.
  v_cap := class_effective_capacity(p_class_id);
  IF v_cap IS NOT NULL
     AND class_expected_count(p_class_id, p_session_date) >= v_cap THEN
    RAISE EXCEPTION
      '% is full on % (% of %) — free a place or raise the class''s maximum first',
      v_class_title, to_char(p_session_date, 'DD Mon YYYY'),
      class_expected_count(p_class_id, p_session_date), v_cap;
  END IF;

  INSERT INTO makeup_bookings
    (tenant_id, student_id, class_id, session_date, category_id, home_class_id, booked_by)
  VALUES
    (v_tenant, p_student_id, p_class_id, p_session_date, v_home_category, v_home_class, v_actor)
  RETURNING id INTO v_booking;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_actor, 'makeup_booked', 'Student', p_student_id,
    jsonb_build_object('class_id', p_class_id, 'session_date', p_session_date,
                       'category_id', v_home_category, 'home_class_id', v_home_class,
                       'booking_id', v_booking)
  );

  RETURN v_booking;
END;
$function$

;

-- ── book_trial: body live before 20260821000700 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.book_trial(p_class_id uuid, p_session_date date, p_student_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor    UUID := auth.uid();
  v_tenant   UUID;
  v_category UUID;
  v_class_day day_of_week;
  v_booking  UUID;
  v_class_title TEXT;
  v_host_active BOOLEAN;
  v_cap      SMALLINT;
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

  -- ── Serialise against a concurrent RETIRE and the last seat (§7.198, §7.200) ─
  -- Same rule as book_makeup, and same reasoning: lock the class row FIRST and
  -- UNCONDITIONALLY, then re-check is_active and the capacity UNDER the lock.
  -- The lock closes booking-vs-retire on an UNCAPPED class too, where
  -- trial_bookings.class_id's FK (FOR KEY SHARE) does not serialise against
  -- deactivate_class()'s non-key is_active UPDATE.
  PERFORM 1 FROM classes WHERE id = p_class_id FOR UPDATE;

  -- Re-read is_active under the lock: a deactivate_class() that committed since
  -- the top-of-function read would otherwise leave this trial guest in a retired
  -- class (§7.200). The reverse direction is caught by trg_class_retirement_guard
  -- (§7.199).
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id AND is_active) THEN
    RAISE EXCEPTION '% is no longer running', v_class_title;
  END IF;

  -- ── Capacity: a hard refusal for EVERYONE, admin included (Decision 1) ────
  -- The expected set on p_session_date against the effective maximum, AFTER
  -- every refusal above, read UNDER the lock (§7.200). (A duplicate live trial is
  -- still caught by trial_bookings_live_slot_uniq -> 23505; at capacity the count
  -- check may fire first and read "full" — a cosmetic edge, kept because
  -- book_trial has never carried its own duplicate sentence and trial_onboarding
  -- pins the index behaviour.)
  v_cap := class_effective_capacity(p_class_id);
  IF v_cap IS NOT NULL
     AND class_expected_count(p_class_id, p_session_date) >= v_cap THEN
    RAISE EXCEPTION
      '% is full on % (% of %) — free a place or raise the class''s maximum first',
      v_class_title, to_char(p_session_date, 'DD Mon YYYY'),
      class_expected_count(p_class_id, p_session_date), v_cap;
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
$function$

;

-- ── schedule_extra_lesson: body live before 20260821000700 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.schedule_extra_lesson(p_class_id uuid, p_date date, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$

;

-- ── class_unmarked_lesson_dates: body live before 20260821000700 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.class_unmarked_lesson_dates(p_class_id uuid)
 RETURNS date[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cls AS (
    SELECT c.id, c.tenant_id, c.day_of_week
      FROM classes c
     WHERE c.id = p_class_id
  ),
  win AS (
    SELECT markable_floor((SELECT tenant_id FROM cls)) AS floor_date,
           today_sg()                                  AS today_date
  ),
  -- Every date the class was DUE to run in the window, plus every date it
  -- actually recorded a session on. The second arm is not redundant: an extra
  -- lesson (schedule_extra_lesson) sits off the class's own weekday and would
  -- never appear in the weekday series.
  candidate_dates AS (
    SELECT d::date AS session_date
      FROM win w,
           generate_series(w.floor_date, w.today_date, INTERVAL '1 day') AS d
     WHERE (ARRAY['sunday','monday','tuesday','wednesday','thursday',
                  'friday','saturday'])[EXTRACT(DOW FROM d)::int + 1]
           = (SELECT day_of_week::text FROM cls)
    UNION
    SELECT ls.session_date
      FROM lesson_sessions ls, win w
     WHERE ls.class_id = p_class_id
       AND ls.session_date BETWEEN w.floor_date AND w.today_date
  ),
  -- (date, student) pairs someone should have marked.
  expected AS (
    SELECT cd.session_date, e.student_id
      FROM candidate_dates cd
      JOIN student_class_enrolments e
        ON e.class_id = p_class_id
       AND (e.enrolled_at AT TIME ZONE 'Asia/Singapore')::date <= cd.session_date
       AND (e.unenrolled_at IS NULL
            OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= cd.session_date)
    UNION
    SELECT tb.session_date, tb.student_id
      FROM trial_bookings tb
      JOIN candidate_dates cd ON cd.session_date = tb.session_date
     WHERE tb.class_id = p_class_id
       AND tb.cancelled_at IS NULL
    UNION
    SELECT mb.session_date, mb.student_id
      FROM makeup_bookings mb
      JOIN candidate_dates cd ON cd.session_date = mb.session_date
     WHERE mb.class_id = p_class_id
       AND mb.cancelled_at IS NULL
  )
  SELECT COALESCE(
           array_agg(DISTINCT x.session_date ORDER BY x.session_date),
           '{}'::DATE[]
         )
    FROM expected x
   WHERE NOT EXISTS (
     SELECT 1
       FROM lesson_sessions ls
       JOIN attendance a
         ON a.lesson_session_id = ls.id
        AND a.student_id = x.student_id
      WHERE ls.class_id = p_class_id
        AND ls.session_date = x.session_date
   );
$function$

;

-- ── tenant_unmarked_lesson_count: body live before 20260821000700 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_unmarked_lesson_count(p_tenant uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT (is_platform_admin() OR can_admin_tenant(p_tenant)) THEN
    RAISE EXCEPTION 'Not authorized to read the unmarked-lesson count for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH win AS (
    SELECT markable_floor(p_tenant)                    AS floor_date,
           today_sg()                                  AS today_date,
           (now() AT TIME ZONE 'Asia/Singapore')::time AS now_time
  ),
  cls AS (
    SELECT c.id, c.day_of_week, c.end_time,
           CASE WHEN c.deactivated_at IS NOT NULL
                THEN (c.deactivated_at AT TIME ZONE 'Asia/Singapore')::date
           END AS cutoff,
           (CASE c.day_of_week
              WHEN 'sunday' THEN 0 WHEN 'monday' THEN 1 WHEN 'tuesday' THEN 2
              WHEN 'wednesday' THEN 3 WHEN 'thursday' THEN 4 WHEN 'friday' THEN 5
              WHEN 'saturday' THEN 6 END) AS dow
      FROM classes c
     WHERE c.tenant_id = p_tenant
  ),
  -- Weekday series with a 7-day step from the first matching weekday >= floor.
  pattern AS (
    SELECT cl.id AS class_id, d::date AS session_date
      FROM cls cl, win w,
           generate_series(
             w.floor_date + (((cl.dow - EXTRACT(DOW FROM w.floor_date)::int) + 7) % 7) * INTERVAL '1 day',
             w.today_date,
             INTERVAL '7 days'
           ) AS d
  ),
  sess AS (
    SELECT ls.class_id, ls.session_date
      FROM lesson_sessions ls
      JOIN cls cl ON cl.id = ls.class_id
      CROSS JOIN win w
     WHERE ls.session_date BETWEEN w.floor_date AND w.today_date
  ),
  -- A pattern date on/after the retirement cutoff is dropped unless a session
  -- row exists for it; a session-row date is always kept.
  candidate AS (
    SELECT p.class_id, p.session_date
      FROM pattern p
      JOIN cls cl ON cl.id = p.class_id
     WHERE cl.cutoff IS NULL
        OR p.session_date < cl.cutoff
        OR EXISTS (SELECT 1 FROM sess s WHERE s.class_id = p.class_id AND s.session_date = p.session_date)
    UNION
    SELECT s.class_id, s.session_date FROM sess s
  ),
  expected AS (
    SELECT cd.class_id, cd.session_date, e.student_id
      FROM candidate cd
      JOIN student_class_enrolments e
        ON e.class_id = cd.class_id
       AND (e.enrolled_at AT TIME ZONE 'Asia/Singapore')::date <= cd.session_date
       AND (e.unenrolled_at IS NULL
            OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= cd.session_date)
    UNION
    SELECT cd.class_id, cd.session_date, tb.student_id
      FROM candidate cd
      JOIN trial_bookings tb ON tb.class_id = cd.class_id AND tb.session_date = cd.session_date AND tb.cancelled_at IS NULL
    UNION
    SELECT cd.class_id, cd.session_date, mb.student_id
      FROM candidate cd
      JOIN makeup_bookings mb ON mb.class_id = cd.class_id AND mb.session_date = cd.session_date AND mb.cancelled_at IS NULL
  ),
  agg AS (
    SELECT x.class_id, x.session_date,
           count(*) AS expected_ct,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM lesson_sessions ls
              JOIN attendance a ON a.lesson_session_id = ls.id AND a.student_id = x.student_id
             WHERE ls.class_id = x.class_id AND ls.session_date = x.session_date
           )) AS marked_ct
      FROM expected x
     GROUP BY x.class_id, x.session_date
  )
  SELECT count(*)::int INTO v_count
    FROM agg a
    JOIN cls cl ON cl.id = a.class_id
    CROSS JOIN win w
   WHERE a.expected_ct > 0
     AND a.marked_ct < a.expected_ct
     AND (
       a.marked_ct > 0
       OR a.session_date < w.today_date
       OR (a.session_date = w.today_date AND cl.end_time <= w.now_time)
     );

  RETURN v_count;
END;
$function$

;

-- ── mark_day_holiday: body live before 20260821000700 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_day_holiday(p_tenant uuid, p_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_dow   text := (ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])
                    [EXTRACT(ISODOW FROM p_date)::int];
  v_count integer;
BEGIN
  IF NOT can_admin_tenant(p_tenant) THEN
    RAISE EXCEPTION 'Not authorized to void a day for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tenant_public_holidays
                  WHERE tenant_id = p_tenant AND holiday_date = p_date) THEN
    RAISE EXCEPTION 'Add % to the public-holiday calendar before voiding its lessons.', p_date
      USING ERRCODE = 'check_violation';
  END IF;

  -- Materialize the missing sessions (a class scheduled that weekday, running on
  -- that date — includes one retired ON OR AFTER the date, by its SGT date).
  INSERT INTO lesson_sessions (class_id, session_date, start_time, end_time)
  SELECT c.id, p_date, c.start_time, c.end_time
  FROM classes c
  WHERE c.tenant_id = p_tenant
    AND c.day_of_week::text = v_dow
    AND (c.is_active OR (c.deactivated_at IS NOT NULL
         AND (c.deactivated_at AT TIME ZONE 'Asia/Singapore')::date >= p_date))
  ON CONFLICT (class_id, session_date) DO NOTHING;

  WITH sessions AS (
    SELECT ls.id AS session_id, ls.class_id
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
    WHERE ls.session_date = p_date
      AND c.tenant_id = p_tenant
      AND c.day_of_week::text = v_dow
      AND (c.is_active OR (c.deactivated_at IS NOT NULL
           AND (c.deactivated_at AT TIME ZONE 'Asia/Singapore')::date >= p_date))
  ),
  expected AS (
    -- SGT casts, not bare ::date (which is the UTC date, §7.7): the billing
    -- gate's enrolment spans are SGT (core.ts dateInTimeZone), and this set
    -- must match it exactly or an unvoided student blocks the month (RISK 6).
    SELECT s.session_id, e.student_id
      FROM sessions s
      JOIN student_class_enrolments e ON e.class_id = s.class_id
       AND (e.enrolled_at AT TIME ZONE 'Asia/Singapore')::date <= p_date
       AND (e.unenrolled_at IS NULL
            OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= p_date)
    UNION
    SELECT s.session_id, tb.student_id
      FROM sessions s
      JOIN trial_bookings tb ON tb.class_id = s.class_id
       AND tb.session_date = p_date AND tb.cancelled_at IS NULL
    UNION
    SELECT s.session_id, mb.student_id
      FROM sessions s
      JOIN makeup_bookings mb ON mb.class_id = s.class_id
       AND mb.session_date = p_date AND mb.cancelled_at IS NULL
  ),
  ins AS (
    INSERT INTO attendance (lesson_session_id, student_id, status, marked_by)
    SELECT session_id, student_id, 'holiday', v_actor FROM expected
    ON CONFLICT (lesson_session_id, student_id)
      DO UPDATE SET status = 'holiday', marked_by = v_actor
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN v_count;
END;
$function$

;

-- ── unmark_day_holiday: body live before 20260821000700 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.unmark_day_holiday(p_tenant uuid, p_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT can_admin_tenant(p_tenant) THEN
    RAISE EXCEPTION 'Not authorized to un-void a day for this business.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH del AS (
    DELETE FROM attendance a
    USING lesson_sessions ls, classes c
    WHERE a.lesson_session_id = ls.id
      AND ls.class_id = c.id
      AND c.tenant_id = p_tenant
      AND ls.session_date = p_date
      AND a.status = 'holiday'
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM del;

  DELETE FROM lesson_sessions ls
  USING classes c
  WHERE ls.class_id = c.id
    AND c.tenant_id = p_tenant
    AND ls.session_date = p_date
    AND ls.off_schedule_reason IS NULL
    AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.lesson_session_id = ls.id);

  RETURN v_count;
END;
$function$

;

-- ── Columns last: a function above that still referenced them would fail to
--    plan, so the bodies are restored first. ──────────────────────────────────
ALTER TABLE lesson_sessions
  DROP CONSTRAINT IF EXISTS lesson_sessions_cancel_coherent,
  DROP CONSTRAINT IF EXISTS lesson_sessions_cancel_has_reason;

-- A cancelled row's status must go back to 'scheduled' BEFORE the flag column
-- goes, or the constraint-free table keeps a 'cancelled' status nothing reads.
UPDATE lesson_sessions SET status = 'scheduled' WHERE cancelled_at IS NOT NULL;

ALTER TABLE lesson_sessions
  DROP COLUMN IF EXISTS cancellation_reason,
  DROP COLUMN IF EXISTS cancelled_by,
  DROP COLUMN IF EXISTS cancelled_at;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('cancel_lesson','restore_lesson') AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'rollback incomplete: a cancel RPC still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lesson_sessions' AND column_name = 'cancelled_at') THEN
    RAISE EXCEPTION 'rollback incomplete: lesson_sessions.cancelled_at still exists';
  END IF;
  IF pg_get_functiondef('public.guard_attendance_date()'::regprocedure) LIKE '%cancelled_at%' THEN
    RAISE EXCEPTION 'rollback incomplete: guard_attendance_date() still references cancelled_at';
  END IF;
END $$;
