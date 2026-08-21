-- ============================================================
-- Capacity's HARD limit gets a concurrency lock — the last-seat race.
-- (BACKLOG "Capacity's last-seat check has no concurrency lock"; found in the
--  20260820000200 pre-deploy review. §7.198.)
--
-- 20260820000200 made capacity a hard limit on three write paths, each a
-- check-then-insert: read count(*) of the expected set / active roster, compare
-- to the effective maximum, then INSERT. Under READ COMMITTED (PostgREST's
-- default) that read-then-write is NOT atomic across sessions. Two writers for
-- the LAST seat each run their count before either INSERT commits, both read
-- cap-1, both pass `>= v_cap` as false, and both commit -> cap+1, silently. The
-- unique indexes (trial_bookings_live_slot_uniq, the enrolment partial index)
-- only stop DUPLICATE rows for the SAME child; two DISTINCT children racing the
-- last seat sail through.
--
-- FIX: before each count, take a row lock on the CLASS row
-- (`SELECT 1 FROM classes WHERE id = <class> FOR UPDATE`). A second writer for
-- the same class blocks on that lock until the first commits, then re-reads the
-- count under a fresh statement snapshot (§7.198) — now seeing the first row —
-- and is refused. It serialises writers for ONE class only; cheap, and a class
-- with no cap (v_cap IS NULL) never takes the lock, so unlimited classes never
-- contend at all.
--
-- Three CREATE OR REPLACE, SAME SIGNATURES (§7.123): book_makeup, book_trial,
-- and the enforce_class_capacity() enrolment trigger. Bodies are byte-identical
-- to 20260820000200 except for the lock and the IF restructure around it; the
-- ACLs survive CREATE OR REPLACE and are re-asserted below.
--
-- ⚠ THEORETICAL DEADLOCK, accepted: book_makeup takes FOR UPDATE on the host
-- class, then the home_class FK takes FOR KEY SHARE on the home class. Two admins
-- booking make-ups that cross-reference each other's classes as host/home at the
-- same instant can deadlock (40P01) — one gets a clean, retryable error. It needs
-- two capacity-limited classes cross-referenced simultaneously by two admins;
-- vanishingly rare at any real scale, and the failure is safe. Not worth a lock
-- ordering that would slow the common path.
-- ============================================================

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

  -- ── Capacity: a hard refusal for EVERYONE, admin included (Decision 1) ────
  -- Counts the lesson's expected set on p_session_date (enrolled-by-span +
  -- trial + make-up guests) against the effective maximum. LAST, so an
  -- already-booked child hears "already booked" above, not "full".
  v_cap := class_effective_capacity(p_class_id);
  IF v_cap IS NOT NULL THEN
    -- ⚠ §7.198: serialise the last seat. Lock the class row so a concurrent
    -- booking/enrolment for THIS class cannot read the same count and both
    -- commit past the cap. The count below re-reads under a fresh statement
    -- snapshot once the lock is held.
    PERFORM 1 FROM classes WHERE id = p_class_id FOR UPDATE;
    IF class_expected_count(p_class_id, p_session_date) >= v_cap THEN
      RAISE EXCEPTION
        '% is full on % (% of %) — free a place or raise the class''s maximum first',
        v_class_title, to_char(p_session_date, 'DD Mon YYYY'),
        class_expected_count(p_class_id, p_session_date), v_cap;
    END IF;
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
$function$;

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

  -- ── Capacity: a hard refusal for EVERYONE, admin included (Decision 1) ────
  -- Same rule as book_makeup: the expected set on p_session_date against the
  -- effective maximum, AFTER every refusal above. (A duplicate live trial is
  -- still caught by trial_bookings_live_slot_uniq -> 23505; at capacity the
  -- count check may fire first and read "full" — a cosmetic edge, kept because
  -- book_trial has never carried its own duplicate sentence and trial_onboarding
  -- pins the index behaviour.)
  v_cap := class_effective_capacity(p_class_id);
  IF v_cap IS NOT NULL THEN
    -- ⚠ §7.198: serialise the last seat — see book_makeup. Lock the class row
    -- before the count so two concurrent bookings cannot both pass.
    PERFORM 1 FROM classes WHERE id = p_class_id FOR UPDATE;
    IF class_expected_count(p_class_id, p_session_date) >= v_cap THEN
      RAISE EXCEPTION
        '% is full on % (% of %) — free a place or raise the class''s maximum first',
        v_class_title, to_char(p_session_date, 'DD Mon YYYY'),
        class_expected_count(p_class_id, p_session_date), v_cap;
    END IF;
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
$function$;

-- ── The enrolment trigger — the ROSTER axis. Same lock, before the count. ───
CREATE OR REPLACE FUNCTION public.enforce_class_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cap   smallint;
  v_taken integer;
  v_title text;
BEGIN
  -- Only an OPENING matters: a closed span (add_unclaimed_student's 'trial' row)
  -- occupies no seat, and a closing UPDATE frees one.
  IF NOT NEW.is_active THEN RETURN NEW; END IF;
  -- §7.57: detect the update. `OLD.class_id = NEW.class_id` is load-bearing —
  -- a row MOVED to another class with is_active untouched (true->true) is a NEW
  -- opening in the destination and must be checked there; without this term the
  -- early return would skip it, so the `UPDATE OF … class_id` arm on the trigger
  -- would be dead. No live path sets class_id today; this is the structural
  -- insurance the trigger declaration claims (verified 2026-08-20 review).
  IF TG_OP = 'UPDATE' AND OLD.is_active AND OLD.class_id = NEW.class_id THEN RETURN NEW; END IF;
  v_cap := class_effective_capacity(NEW.class_id);
  IF v_cap IS NULL THEN RETURN NEW; END IF;
  -- ⚠ §7.198: serialise the last seat. Lock the class row before the roster
  -- count so two concurrent enrolments (or an enrolment racing a booking) for
  -- this class cannot both read cap-1 and both commit. NULL cap returned above,
  -- so an unlimited class never locks.
  PERFORM 1 FROM classes WHERE id = NEW.class_id FOR UPDATE;
  -- ⚠ RISK 1 / §7.126: `e.student_id <> NEW.student_id` is NOT redundant with
  -- `e.id <> NEW.id`. A BEFORE trigger runs BEFORE the unique-index check, so a
  -- duplicate of a child already in a full class reaches this count first;
  -- without this term the admin is told "full" instead of getting the 23505 the
  -- index exists to raise. Same trap enforce_enrolment_schedule documents.
  SELECT count(*) INTO v_taken FROM student_class_enrolments e
   WHERE e.class_id = NEW.class_id AND e.is_active
     AND e.id <> NEW.id AND e.student_id <> NEW.student_id;
  IF v_taken >= v_cap THEN
    SELECT title INTO v_title FROM classes WHERE id = NEW.class_id;
    RAISE EXCEPTION '% is full (% of %) — free a place or raise the class''s maximum first',
      v_title, v_taken, v_cap;
  END IF;
  RETURN NEW;
END $$;

-- ── Apply-time probes (§7.87, §7.123): CREATE OR REPLACE must not have moved a
--    grant. The two capacity helpers stay callable by NOBODY; the RPCs keep
--    EXECUTE for authenticated and none for anon. RAISE, do not warn.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'book_makeup' AND pronamespace = 'public'::regnamespace) <> 1
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'book_trial' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'a booking RPC has a stray overload — PostgREST resolution is now ambiguous (§7.124)';
  END IF;
  IF pg_get_function_arguments('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure) NOT LIKE '%DEFAULT NULL%' THEN
    RAISE EXCEPTION 'book_makeup lost its DEFAULT NULL — the deployed 3-arg client can no longer resolve it (§7.123)';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.book_makeup(uuid,date,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.book_trial(uuid,date,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a booking RPC lost EXECUTE for authenticated — the admin UI would fail with permission denied';
  END IF;
  IF has_function_privilege('anon', 'public.book_makeup(uuid,date,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.book_trial(uuid,date,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a booking RPC is EXECUTE-able by anon — see §7.82';
  END IF;
  IF has_function_privilege('authenticated', 'public.class_effective_capacity(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.class_expected_count(uuid,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.class_effective_capacity(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.class_expected_count(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a capacity helper is EXECUTE-able by a client role — it must be callable by nobody (§7.87)';
  END IF;
  -- The lock itself: every path that counts against the cap must hold it first.
  -- Match the whole `FROM classes WHERE id ... FOR UPDATE` shape, not a bare
  -- 'FOR UPDATE' a comment could satisfy (review finding, 2026-08-21).
  IF pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure) NOT LIKE '%FROM classes WHERE id%FOR UPDATE%'
     OR pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure) NOT LIKE '%FROM classes WHERE id%FOR UPDATE%'
     OR pg_get_functiondef('public.enforce_class_capacity()'::regprocedure) NOT LIKE '%FROM classes WHERE id%FOR UPDATE%' THEN
    RAISE EXCEPTION 'a capacity write path lost its FOR UPDATE class-row lock — the last-seat race is reopened (§7.198)';
  END IF;
END $$;
