-- ============================================================
-- Capacity becomes a HARD limit — a refusal for EVERYONE, the admin included.
-- (docs/plans/CAPACITY_HOLIDAY_BADGE_PLAN.md, Phase B; Decisions 1–4.)
--
-- 20260819000100 shipped capacity/default_capacity as ADVISORY (calendar +
-- lesson page showed "x/y" and a "Book anyway"). This enforces it on all three
-- write paths with ONE rule per axis:
--   * a BOOKING on a date (book_makeup / book_trial) is refused when the lesson's
--     EXPECTED SET (enrolled-by-span + trial + make-up guests) reaches the cap;
--   * an ENROLMENT is refused when the class's ACTIVE ROSTER reaches it,
--     via a BEFORE INSERT/UPDATE trigger — the admin writes the table directly
--     from three pages, so there is no RPC to guard (Decision 2).
-- Each refusal matches the number the admin is already looking at (Decision 3):
-- the lesson page's x+y/cap, the Classes table's students/max.
--
-- NO override, no p_force: a full class is fixed by raising its maximum, not by
-- booking past it. The 08-19 "the admin is the authority" call (ADMIN_CALENDAR
-- RISK 3) is superseded (Decision 1). NULL cap = unlimited, everywhere.
-- ============================================================

-- ── (a) Two helpers, callable by NOBODY (they run inside SECURITY DEFINER
--        bodies as the owner). REVOKE from every role, §7.87-style. ──────────

-- The class's effective maximum: its own, else the category default, else NULL.
-- The ONE SQL copy of calendarLessons.ts effectiveCapacity().
CREATE FUNCTION public.class_effective_capacity(p_class_id uuid) RETURNS smallint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(c.capacity, cat.default_capacity)
    FROM classes c
    LEFT JOIN class_categories cat ON cat.id = c.category_id
   WHERE c.id = p_class_id
$$;

-- Who is EXPECTED in one lesson: enrolled ON THAT DATE by span (SGT, inclusive
-- both ends — never is_active) + uncancelled trial + uncancelled make-up guests,
-- DISTINCT student. The ONE SQL copy of attendanceCompleteness.ts
-- expectedStudentsOn(); the same union class_unmarked_lesson_dates() and
-- mark_day_holiday() already spell out, span predicate byte for byte.
CREATE FUNCTION public.class_expected_count(p_class_id uuid, p_date date) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM (
    SELECT e.student_id
      FROM student_class_enrolments e
     WHERE e.class_id = p_class_id
       AND (e.enrolled_at AT TIME ZONE 'Asia/Singapore')::date <= p_date
       AND (e.unenrolled_at IS NULL
            OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= p_date)
    UNION
    SELECT tb.student_id
      FROM trial_bookings tb
     WHERE tb.class_id = p_class_id AND tb.session_date = p_date AND tb.cancelled_at IS NULL
    UNION
    SELECT mb.student_id
      FROM makeup_bookings mb
     WHERE mb.class_id = p_class_id AND mb.session_date = p_date AND mb.cancelled_at IS NULL
  ) x;
$$;

REVOKE ALL ON FUNCTION public.class_effective_capacity(uuid)      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.class_expected_count(uuid, date)    FROM PUBLIC, anon, authenticated, service_role;

-- ── (b) book_makeup / book_trial — CREATE OR REPLACE, SAME SIGNATURES ───────
--   Bodies captured live from pg_get_functiondef (§7.115), plus one capacity
--   block inserted immediately before the INSERT — AFTER every existing refusal,
--   so an already-booked child still hears "already booked", not "full".
--   Same signature -> same pg_proc row -> ACL survives (§7.123); the DEFAULT NULL
--   on book_makeup's 4th arg is preserved so the deployed 3-arg client still
--   resolves through the deploy window (§7.123/§7.124).

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
  IF v_cap IS NOT NULL AND class_expected_count(p_class_id, p_session_date) >= v_cap THEN
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
  IF v_cap IS NOT NULL AND class_expected_count(p_class_id, p_session_date) >= v_cap THEN
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
$function$;

COMMENT ON FUNCTION public.book_makeup(uuid, date, uuid, uuid) IS
  'Books a make-up guest slot. Refuses: not-admin, wrong tenant, inactive child, not-enrolled, ambiguous/foreign home class, own class, wrong category, wrong weekday, below the billed floor, duplicate booking, and (since 20260820000200) a lesson already at capacity — the expected set (enrolled-by-span + guests) reaching the effective maximum. NULL cap = unlimited.';
COMMENT ON FUNCTION public.book_trial(uuid, date, uuid) IS
  'Books a trial guest. Refuses: not-admin, wrong tenant, below the billed floor, wrong weekday, already-enrolled, holds prepaid value, and (since 20260820000200) a lesson already at capacity — the expected set reaching the effective maximum. NULL cap = unlimited.';

REVOKE ALL ON FUNCTION public.book_makeup(uuid, date, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.book_trial(uuid, date, uuid)        FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_makeup(uuid, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.book_trial(uuid, date, uuid)        TO authenticated;

-- ── (c) The enrolment trigger — the ROSTER axis (Decision 2/3) ──────────────
-- SECURITY DEFINER is load-bearing, not style (§7.125, enforce_enrolment_schedule
-- learned it): a plain trigger counts under the caller's RLS, so an admin of
-- another tenant or a future parent-role caller would count zero rows and sail
-- through. Counts is_active enrolments (the roster the Classes table shows),
-- NOT class_expected_count (which counts by span on a date, Decision 3).
CREATE FUNCTION public.enforce_class_capacity() RETURNS trigger
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

-- BEFORE INSERT OR UPDATE OF is_active, class_id: the UPDATE arm is structural
-- insurance (no write path flips is_active back to TRUE, and no client upserts
-- this table — verified 2026-08-20), and class_id catches a future row moved
-- between classes with is_active untouched. Sorts after enrolment_tenant_guard
-- and BEFORE trg_enrolment_schedule (alphabetical) — immaterial by design (a
-- retired class holds zero active enrolments, and the early return above).
CREATE TRIGGER trg_class_capacity
  BEFORE INSERT OR UPDATE OF is_active, class_id ON public.student_class_enrolments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_class_capacity();

-- ── (d) Column comments: advisory -> enforced ───────────────────────────────
COMMENT ON COLUMN public.classes.capacity IS
  'The class''s own maximum head-count. Enforced since 20260820000200: a booking is refused when the lesson''s expected set reaches it, an enrolment when the active roster does. NULL = fall back to the category default; NULL there too = unlimited.';
COMMENT ON COLUMN public.class_categories.default_capacity IS
  'Default maximum head-count for classes in this category. Enforced since 20260820000200 (a class''s own capacity overrides it). NULL = unlimited.';

-- ── Apply-time probes (⚠ plan RISK 2/7) — RAISE, do not warn ────────────────
-- CREATE OR REPLACE preserved the two RPC ACLs; the two helpers are ungranted.
-- A silent change here reaches production as `permission denied` or a stray
-- overload PostgREST calls instead (§7.87, §7.123, §7.124).
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'book_makeup' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'book_makeup has a stray overload — PostgREST resolution is now ambiguous (§7.124)';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'book_trial' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'book_trial has a stray overload (§7.124)';
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
END $$;
