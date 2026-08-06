-- ============================================================
-- THE MARKING FLOOR FOLLOWS billing_periods, NOT THE CALENDAR.
--
-- 20260727000100 made the attendance window a database rule and floored it at
-- the 1st of LAST MONTH — a calendar proxy for the question it actually asks,
-- "can this lesson still bill?". Its own §10.1 recorded what the proxy costs:
--
--   The engine bills ANY completed month, but the floor reaches back one.
--   Bill AUGUST on 5 OCTOBER with one unmarked lesson and the gate names a
--   lesson nobody can record any more — not the coach, not the admin. There is
--   no override by design (PRD §7.7), and closing the enrolment does not help
--   (spans mean past dates still expect the child). The month can never bill.
--
-- Before the guard was a database rule this was recoverable, because the window
-- was a UI convention and the coach could still reach the date. It is not any
-- more, which is why the proxy is being replaced rather than merely noted.
--
-- ── THE RULE ────────────────────────────────────────────────────────────────
--   floor(tenant) = LEAST(
--     1st of last month,                        -- the old rule, kept
--     COALESCE(
--       1st of the month AFTER the tenant's LATEST sealed billing month,
--       the tenant's created_at date            -- only when nothing is sealed
--     ))
--
-- ⚠ LEAST IS LOAD-BEARING, AND IT IS THE WHOLE SAFETY ARGUMENT: the floor can
-- only move EARLIER or stay. No date markable before this migration becomes
-- unmarkable after it, for any tenant, on any day. That is asserted directly —
-- not case by case — in markable_floor.test.sql, over a matrix of seal and
-- created_at states. If you edit this function, that assertion is the one that
-- has to stay green; a GREATEST typo or a reordered COALESCE fails it even when
-- every named example still passes.
--
-- ── WHY "LATEST SEAL", NOT "EARLIEST UNSEALED MONTH" ────────────────────────
-- The obvious reading of the backlog item is "open every month that has not
-- been billed". It does not work, and the reason is easy to re-derive wrongly:
-- the engine NEVER SEALS A MONTH WITH NOTHING RECORDED (§8a.1, core.ts's
-- `classesComplete > 0` condition). So gaps in billing_periods are ORDINARY,
-- not exceptional — a quiet month leaves no row, and neither does every month
-- before the business started. "Earliest unsealed" therefore reaches back
-- forever and leaves no floor at all: a hand-typed 2026-03-14 would be
-- accepted. Anchoring on the LATEST seal keeps the window bounded while still
-- reopening exactly the months that can still legitimately bill.
--
-- ── THE FLOOR IS NOW PER-TENANT ─────────────────────────────────────────────
-- billing_periods is keyed (tenant_id, billing_month) since 20260718001100, so
-- one business finishing July cannot move another's floor. session_window_start()
-- survives as the CALENDAR HALF only — markable_floor() calls it. Nothing else
-- should: a caller that wants "the floor" wants this function.
--
-- ── THIS IS NOT AN OVERRIDE ─────────────────────────────────────────────────
-- It widens what can be RECORDED. It adds no way to skip the unmarked-attendance
-- block or the completed-month guard, both of which were refused an override on
-- the record (BACKLOG → Deliberately not doing). Do not give this function a
-- force parameter, and do not build an admin "reopen this month" button on top
-- of it. The escape hatch for a genuinely closed month is a credit note.
-- ============================================================


-- ── The floor ───────────────────────────────────────────────────────────────
-- SECURITY DEFINER because it reads billing_periods, which a coach cannot see
-- (billing_periods_select is platform-admin or tenant-admin only) — and the
-- coach app is the main consumer. It discloses one DATE and nothing else; do
-- NOT widen it to return a month name, a count or a row, or that acceptance
-- stops holding (tenant UUIDs are not enumerable, the §7.86 argument, but a
-- caller who has one would then learn how a business bills).
--
-- No current_user seam in here, deliberately. The seam that tells a client from
-- a definer writer stays in the trigger functions, evaluated BEFORE this is
-- called — putting it inside a definer function is §7.38, where current_user is
-- 'postgres' and every check waves everyone through.
--
-- NULL-SAFE BY CONSTRUCTION. markable_floor(NULL) — an unresolvable tenant —
-- returns the calendar floor, never NULL and never an error: COALESCE collapses
-- to NULL and Postgres's LEAST skips NULL arguments. Every guard below passes
-- its lookup straight through for exactly this reason, so a data oddity
-- degrades to the pre-migration behaviour instead of refusing every write.
-- pgTAP pins it so a future rewrite cannot quietly lose it.

CREATE OR REPLACE FUNCTION public.markable_floor(p_tenant_id UUID)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT LEAST(
    session_window_start(),
    COALESCE(
      -- The month after the latest month this business has sealed. to_date on
      -- a 'YYYY-MM' CHAR(7) lands on the 1st, so +1 month is the 1st of the
      -- next one. MAX over a text column is safe here precisely because the
      -- format is zero-padded and fixed-width: lexical order is chronological.
      (SELECT (to_date(MAX(bp.billing_month), 'YYYY-MM') + INTERVAL '1 month')::date
         FROM billing_periods bp
        WHERE bp.tenant_id = p_tenant_id),
      -- Nothing sealed: the business has never billed, so nothing it recorded
      -- can have been locked out — but the window still must not open before
      -- the business existed. Singapore-local, like every other date here (§7.7).
      (SELECT (t.created_at AT TIME ZONE 'Asia/Singapore')::date
         FROM tenants t
        WHERE t.id = p_tenant_id)
    )
  )
$$;

COMMENT ON FUNCTION public.markable_floor(UUID) IS
  'The earliest date this business may still record attendance for: LEAST(1st of last month, month after its latest sealed billing month, else its created_at). THE SINGLE DEFINITION of the floor — session_window_start() is only its calendar half. Can only ever move earlier than the calendar rule, never later; markable_floor.test.sql asserts that as a property. NULL tenant returns the calendar floor.';

-- session_window_start() keeps its behaviour and its pgTAP coverage, but it is
-- no longer THE floor — it is one of the three terms above.
COMMENT ON FUNCTION public.session_window_start() IS
  'The CALENDAR HALF of the marking floor: the 1st of last month, Singapore time. NOT the floor itself since 20260806000200 — call markable_floor(tenant_id) for that, which is this value or earlier. Kept as the upper bound that guarantees the per-tenant floor can never be stricter than the old calendar rule.';


-- ── The rule ────────────────────────────────────────────────────────────────
-- Takes the tenant now. The one-argument form is DROPPED at the foot of this
-- migration rather than left as an overload: two signatures would be two copies
-- of one safety rule, and §7.18 is what four hand-written copies cost — a live
-- underbill. There is one definition.

CREATE OR REPLACE FUNCTION public.assert_markable_date(p_date DATE, p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_floor DATE := markable_floor(p_tenant_id);
  v_today DATE := today_sg();
BEGIN
  IF p_date < v_floor THEN
    RAISE EXCEPTION
      'That lesson (%) is closed. Attendance can be marked back to %; an earlier lesson sits behind an invoice already sent, so it needs a credit note rather than a late mark.',
      to_char(p_date, 'DD Mon YYYY'), to_char(v_floor, 'DD Mon YYYY');
  END IF;

  IF p_date > v_today THEN
    RAISE EXCEPTION
      'That lesson (%) has not happened yet — attendance cannot be marked ahead of time.',
      to_char(p_date, 'DD Mon YYYY');
  END IF;
END $$;


-- ── The coach app's read path ───────────────────────────────────────────────
-- The database opening a month does NOTHING on its own: the coach's roster and
-- Today tab build their lesson lists from their own copy of the floor
-- (backlogWindowStart in lib/lessonDates.ts), so a screen still floored at the
-- calendar never OFFERS the reopened date and the month stays stuck. This is
-- what the client reads instead.
--
-- No argument, deliberately: the tenant comes from the caller's own profile, so
-- a coach cannot probe another business's floor. The client treats the result
-- as a widening only — min(calendar, this ?? calendar) — so a failed or slow
-- fetch degrades to today's behaviour rather than locking anyone out.

CREATE OR REPLACE FUNCTION public.markable_window_start()
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT markable_floor(current_tenant_id()) $$;

COMMENT ON FUNCTION public.markable_window_start() IS
  'The caller''s own business''s marking floor, for the coach app. Affordance, not the guard — the guard is assert_markable_date() in the two triggers. Returns a DATE and nothing else.';


-- ── Caller 1: lesson_sessions ───────────────────────────────────────────────
-- Verbatim 20260727000100 apart from the tenant lookup and the two-argument
-- call. NOT SECURITY DEFINER, still: this function's whole job is to tell a
-- client apart from a definer writer, and inside a definer function
-- current_user is 'postgres' (§7.38).

CREATE OR REPLACE FUNCTION public.guard_session_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
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
END $$;


-- ── Caller 2: attendance ────────────────────────────────────────────────────
-- The tenant rides along on the SELECT that was already fetching the session's
-- date — one added join, no extra statement. This trigger fires once per
-- attendance row and the coach's save sends the whole class in one statement,
-- so it is the hottest path in the migration.

CREATE OR REPLACE FUNCTION public.guard_attendance_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
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
END $$;


-- ── Caller 3: the admin's extra lesson ──────────────────────────────────────
-- Verbatim 20260727000100 apart from the two floor references.

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
END $function$;


-- ── Caller 4: make-up bookings ──────────────────────────────────────────────
-- Verbatim 20260802000200 apart from the two floor references.

CREATE OR REPLACE FUNCTION public.book_makeup(p_class_id uuid, p_session_date date, p_student_id uuid)
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
  v_booking        UUID;
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

  -- ── The HOME class: the child's one active enrolment ─────────────────────
  -- one_active_enrolment_per_student guarantees at most one row, so this
  -- SELECT INTO is deterministic. Derived here, never a parameter.
  SELECT e.class_id, c.category_id, c.title
    INTO v_home_class, v_home_category, v_home_title
    FROM student_class_enrolments e
    JOIN classes c ON c.id = e.class_id
   WHERE e.student_id = p_student_id AND e.is_active;

  IF v_home_class IS NULL THEN
    RAISE EXCEPTION
      'that child is not enrolled in a class — a make-up is for enrolled children; book a trial instead';
  END IF;

  -- ── Own class? That is an EXTRA LESSON, which already exists ─────────────
  IF v_home_class = p_class_id THEN
    RAISE EXCEPTION
      'that is the child''s own class — schedule it with "Extra lesson" on the Classes page instead';
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
  -- window is an affordance, this is the guard. (book_trial gained the same
  -- floor in 20260806000200; the asymmetry noted here is closed.)
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


-- ── Caller 5: trial bookings — the one place this can REFUSE something ──────
-- ⚠ EVERY OTHER CHANGE IN THIS MIGRATION ONLY WIDENS. This one does not:
-- book_trial predates the floor entirely and has never had one, so a call that
-- succeeds today can start failing. That is the point — a trial booked into an
-- already-billed month can neither be marked nor billed and is silently lost,
-- the same shape book_makeup() has guarded against since 20260802000200. It was
-- recorded as a BACKLOG asymmetry then rather than fixed, to keep that batch
-- single-purpose; it is closed here because the floor moved anyway and one
-- definition with four callers is the whole point of markable_floor().
--
-- Otherwise verbatim 20260725000800.

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
$function$;


-- ── Retire the one-argument rule ────────────────────────────────────────────
-- LAST, deliberately. A migration is one transaction, so no session ever
-- observes a state where a guard points at a function that does not exist — but
-- the ordering also means that if anything in this file fails, the old function
-- is still there and the rollback is a no-op.
--
-- Every caller was enumerated before this was written, from the live catalog
-- rather than by grep, because a plpgsql body resolves its calls at RUNTIME: a
-- caller missed here would not fail at apply time, it would fail the next time
-- a coach saved attendance. The answer was guard_session_date and
-- guard_attendance_date, both replaced above.
--
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prosrc LIKE '%assert_markable_date%';
--
-- After this migration that query must return those two and nothing else, and
-- pg_proc must hold exactly ONE assert_markable_date.

DROP FUNCTION IF EXISTS public.assert_markable_date(DATE);


-- ── Grants ──────────────────────────────────────────────────────────────────
-- A function is callable by NOBODY until its own migration grants it (§7.87),
-- and default privileges stopped handing anon/PUBLIC anything on 2026-08-04
-- (§7.85) — so every new signature needs its grant spelled out here or the app
-- throws `permission denied` in development. Both layers, every time (§7.35):
-- PUBLIC is its own grantee, and revoking it leaves role grants untouched.
--
-- `authenticated` holds EXECUTE on markable_floor and assert_markable_date
-- because THE GUARD TRIGGERS CALL THEM WHILE RUNNING AS THAT ROLE — this is not
-- an API surface being opened, it is the price of the current_user seam living
-- in the trigger. anon and service_role need neither: both return early at it.
--
-- markable_window_start() IS a deliberate API surface, for the coach app.
--
-- ⚠ Local and cloud disagree by construction — Supabase's project-level default
-- privileges are not reproduced by the local stack, so a grant verified here
-- can still be wrong in production. Take a REMOTE DUMP after pushing; it is the
-- only honest check (§7.39, §7.89, docs/DEPLOYMENT.md §11.7).

REVOKE ALL ON FUNCTION public.markable_floor(UUID)                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_markable_date(DATE, UUID)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.markable_window_start()                  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.markable_floor(UUID)                 FROM anon, service_role;
REVOKE EXECUTE ON FUNCTION public.assert_markable_date(DATE, UUID)     FROM anon, service_role;
REVOKE EXECUTE ON FUNCTION public.markable_window_start()              FROM anon, service_role;

GRANT EXECUTE ON FUNCTION public.markable_floor(UUID)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_markable_date(DATE, UUID)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.markable_window_start()               TO authenticated;


-- ── Apply-time probes ───────────────────────────────────────────────────────
-- RAISE at apply time rather than trusting a later test run, the pattern
-- 20260804000400 established. These are the two facts the whole migration rests
-- on; if either is false the database is in a state no test would explain.

DO $$
DECLARE
  v_count INT;
  v_bad   INT;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'assert_markable_date';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'assert_markable_date has % definitions, expected exactly 1 — two signatures are two copies of one safety rule (§7.18)',
      v_count;
  END IF;

  -- The safety property, on whatever tenants this database actually holds. The
  -- exhaustive version (a matrix of seal and created_at states) is in
  -- supabase/tests/markable_floor.test.sql; this is the cheap version that runs
  -- against production data at the moment of the deploy.
  SELECT count(*) INTO v_bad
    FROM tenants t
   WHERE markable_floor(t.id) > session_window_start();

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      '% tenant(s) got a floor LATER than the calendar rule — markable_floor must only ever widen',
      v_bad;
  END IF;
END $$;
