-- ============================================================
-- THE ATTENDANCE WINDOW IS NOW A RULE, NOT A UI CONVENTION.
--
-- Since HANDOVER §8b every ENTRY POINT is bounded to the lesson window, so the
-- UX no longer offers a bad date. The screen itself had no guard: it writes
-- whatever `date` the URL hands it, and `sessions_write` constrains WHOSE class
-- a caller may write, never WHICH date. A coach's own token against PostgREST
-- could therefore create — and bill — a session on any date at all.
--
-- Two bounds, enforced in two places because they answer different questions:
--
--   lesson_sessions  — "did this lesson happen?"   weekday + [floor, today]
--   attendance       — "who is being charged?"     [floor, today]
--
-- The floor is the 1st of LAST month. Older lessons sit behind an issued
-- invoice: a late mark is never added to it (the month is sealed and the
-- no-double-billing guard skips a parent who already has one), so it would
-- record a lesson that can never bill. The remedy for those is a credit note,
-- which is why the coach's roster already says "you can mark lessons back to
-- <date>". This makes that sentence true.
--
-- WHY THE RULE IS SCOPED TO `authenticated` AND NOT TO EVERY WRITER.
-- The rule is "a CLIENT may not assert that a lesson happened outside the
-- window". Test fixtures are not clients — their job is to construct the past
-- the rule is about (an invoiced March, a sealed month). Making it absolute
-- would force every fixture to date itself relative to now(), which is §7.33's
-- trap and which already cost this repo eight hours a day of red suite
-- (§8.12, the lesson_packages CURRENT_DATE fixture).
-- The seam is `current_user`, not auth.uid(): client DML arrives as
-- 'authenticated', SECURITY DEFINER functions as 'postgres', the billing engine
-- as 'service_role'. Same seam as pin_student_tenant() (20260719001500).
--
-- The residual risk is §7.42 — a future SECURITY DEFINER writer inherits the
-- exemption silently. That is why the rule lives in assert_markable_date() and
-- assert_class_runs_on() rather than inline in the triggers: a future definer
-- writer calls the same two functions instead of re-deriving the rule. There is
-- one definition. §7.18 is what four hand-written copies of one safety rule
-- cost: a live underbill.
-- ============================================================


-- ── The clock ───────────────────────────────────────────────────────────────
-- Dates in this product are Singapore-local. A UTC-derived date is the previous
-- day before 08:00 SGT and it shipped a real double-billing bug (§7.7). Same
-- expression as platform_tenant_overview (20260719002400).

CREATE OR REPLACE FUNCTION public.today_sg()
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT (now() AT TIME ZONE 'Asia/Singapore')::date $$;

COMMENT ON FUNCTION public.today_sg() IS
  'Today''s calendar date in Singapore. Never derive a date from now() directly — see §7.7.';

CREATE OR REPLACE FUNCTION public.session_window_start()
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))
          - INTERVAL '1 month')::date
$$;

COMMENT ON FUNCTION public.session_window_start() IS
  'Floor of the markable window: the 1st of last month, Singapore time. Mirrors the calendar half of backlogWindowStart() in lib/lessonDates.ts. The client keeps a TIGHTER, enrolment-aware floor as UX; this is the backstop, so the two are deliberately not identical.';


-- ── The two rules ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assert_markable_date(p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_floor DATE := session_window_start();
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

-- The weekday check. SECURITY DEFINER purely to read classes.day_of_week
-- without depending on the caller's view of `classes`; it writes nothing and
-- returns nothing, so it grants no capability beyond an error message. The
-- current_user SEAM IS EVALUATED IN THE TRIGGER, BEFORE THIS IS CALLED —
-- putting the seam inside a definer function is §7.38, where current_user is
-- 'postgres' and every check waves everyone through.
CREATE OR REPLACE FUNCTION public.assert_class_runs_on(p_class_id UUID, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_day day_of_week;
  v_title     TEXT;
  v_date_day  TEXT;
BEGIN
  SELECT c.day_of_week, c.title
    INTO v_class_day, v_title
    FROM classes c
   WHERE c.id = p_class_id;

  IF v_class_day IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  -- EXTRACT(DOW) rather than to_char(…,'day'): to_char renders the weekday NAME
  -- through `lc_time`, so on a server with a non-English locale every
  -- comparison here fails and NO lesson could ever be marked. DOW is an integer
  -- and means the same thing everywhere. 0 = Sunday. Lifted verbatim from
  -- book_trial() (20260725000800) — do not rewrite this from scratch.
  v_date_day := (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
                )[EXTRACT(DOW FROM p_date)::int + 1];

  IF v_date_day <> v_class_day::text THEN
    RAISE EXCEPTION
      '% runs on a %, but % is a %. If the lesson genuinely moved, your business''s admin can schedule it as an extra lesson.',
      v_title, v_class_day, to_char(p_date, 'DD Mon YYYY'), v_date_day;
  END IF;
END $$;


-- ── A lesson that did not run on the class's own weekday ────────────────────
-- NULL means an ordinary lesson. Written ONLY by schedule_extra_lesson(); the
-- guard trigger below refuses any client that tries to set or change it, so a
-- coach cannot self-authorise an off-schedule lesson by supplying a reason.

ALTER TABLE lesson_sessions
  ADD COLUMN IF NOT EXISTS off_schedule_reason TEXT;

COMMENT ON COLUMN lesson_sessions.off_schedule_reason IS
  'Why this lesson exists on a day the class does not normally run (makeup, holiday shift). NULL = ordinary lesson. Written only by schedule_extra_lesson(); clients cannot set it.';


-- ── Guard: lesson_sessions ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_session_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- NOT SECURITY DEFINER, deliberately: this function's whole job is to tell a
  -- client apart from a definer writer, and inside a definer function
  -- current_user is 'postgres' (§7.38).
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

  PERFORM assert_markable_date(NEW.session_date);

  -- An existing off-schedule lesson keeps its exemption when edited, otherwise
  -- the admin's own makeup lesson would become uneditable by the coach.
  IF TG_OP = 'INSERT' OR OLD.off_schedule_reason IS NULL THEN
    PERFORM assert_class_runs_on(NEW.class_id, NEW.session_date);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_session_date_trg ON lesson_sessions;
CREATE TRIGGER guard_session_date_trg
  BEFORE INSERT OR UPDATE ON lesson_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_date();


-- ── Guard: attendance ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_attendance_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_date DATE;
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

  SELECT ls.session_date INTO v_date
    FROM lesson_sessions ls
   WHERE ls.id = NEW.lesson_session_id;

  -- No session means the FK is about to reject this anyway; raising here would
  -- replace a clear referential error with a confusing one about dates.
  IF v_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- Deliberately NO weekday check. The session's existence already settled
  -- that, and an off-schedule lesson scheduled by the admin must remain
  -- markable by the coach.
  PERFORM assert_markable_date(v_date);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_attendance_date_trg ON attendance;
CREATE TRIGGER guard_attendance_date_trg
  BEFORE INSERT ON attendance
  FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_date();


-- ── The admin's override ────────────────────────────────────────────────────
-- The admin SCHEDULES the lesson; the coach MARKS it. That is the distinction
-- book_trial() already draws — "booking is an arrangement, not an observation".
-- The admin never records attendance.
--
-- This is the SECOND writer of lesson_sessions. §7.43 retired that gotcha when
-- trials became bookings; this re-creates it, so its rule is live again:
-- a duplicate (class_id, session_date) row DOUBLE-BILLS A WHOLE CLASS (§7.7),
-- so this takes the date as a PARAMETER (never now()) and conflicts DO NOTHING.

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
  IF p_date < session_window_start() THEN
    RAISE EXCEPTION
      'An extra lesson cannot be added before % — that month has been billed.',
      to_char(session_window_start(), 'DD Mon YYYY');
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


-- ── Grants ──────────────────────────────────────────────────────────────────
-- BOTH layers, every time (§7.35) — and `anon`/`service_role` explicitly,
-- because PUBLIC is its own grantee and revoking it leaves role grants
-- untouched. Supabase CLOUD additionally carries project-level default
-- privileges granting EXECUTE on new public functions to all three roles, which
-- the local stack does not reproduce: a grant verified locally can be wrong in
-- production, so the only honest check is a dump of the remote after pushing
-- (§7.39).
--
-- `authenticated` keeps EXECUTE on the three assert/clock helpers because the
-- guard triggers call them while running as that role. `service_role` and
-- `anon` do not need them: both return early at the seam.

REVOKE ALL ON FUNCTION public.today_sg()               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.session_window_start()   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_markable_date(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_class_runs_on(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_extra_lesson(UUID, DATE, TEXT) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.assert_class_runs_on(UUID, DATE)
  FROM anon, service_role;
REVOKE EXECUTE ON FUNCTION public.schedule_extra_lesson(UUID, DATE, TEXT)
  FROM anon, service_role;

GRANT EXECUTE ON FUNCTION public.today_sg()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_window_start()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_markable_date(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_class_runs_on(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_extra_lesson(UUID, DATE, TEXT) TO authenticated;
