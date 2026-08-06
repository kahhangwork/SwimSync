-- ============================================================
-- ROLLBACK for 20260806000200_markable_floor.sql.
--
-- Restores the CALENDAR floor: every caller goes back to session_window_start(),
-- assert_markable_date() goes back to one argument, and the three functions the
-- feature added are dropped.
--
-- ⚠ RUN IT WHOLE. The five callers and the one-argument rule are a set: leaving
-- a caller pointing at assert_markable_date(DATE, UUID) after the two-argument
-- form is gone does not fail here — a plpgsql body resolves its calls at
-- RUNTIME, so it fails the next time a COACH SAVES ATTENDANCE. That is the same
-- property the forward migration enumerated its callers from the live catalog
-- to protect. This file is one transaction so a partial apply cannot happen by
-- accident; do not split it to "just fix one thing".
--
-- WHAT ROLLING BACK COSTS. The floor becomes the 1st of last month again for
-- every business, which is STRICTER — so any lesson recorded in the window this
-- feature opened stays recorded (nothing is deleted) but can no longer be
-- edited or added to. If a month was reopened and is mid-marking, finish or
-- abandon it before rolling back; the rows already written are safe either way.
--
-- book_trial() ALSO LOSES A FLOOR IT NEVER HAD BEFORE 20260806000200 — that is
-- correct for a rollback (it restores the prior behaviour exactly), but it
-- re-opens the silent-loss gap recorded in BACKLOG: a trial booked into an
-- already-billed month can neither be marked nor billed.
--
-- Verify afterwards:
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname='assert_markable_date';        -- 1
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.prosrc LIKE '%markable_floor%';        -- 0 rows
-- ============================================================

BEGIN;

-- ── The one-argument rule, verbatim 20260727000100 ──────────────────────────

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

REVOKE ALL ON FUNCTION public.assert_markable_date(DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_markable_date(DATE) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.assert_markable_date(DATE) TO authenticated;

COMMENT ON FUNCTION public.session_window_start() IS
  'Floor of the markable window: the 1st of last month, Singapore time. Mirrors the calendar half of backlogWindowStart() in lib/lessonDates.ts. The client keeps a TIGHTER, enrolment-aware floor as UX; this is the backstop, so the two are deliberately not identical.';


-- ── Callers 1-3: restored VERBATIM from 20260727000100 ─────────────────────
-- Comments included, deliberately. pg_get_functiondef() is the only record of
-- these bodies once a rollback has run, and what is written in them is
-- load-bearing: why guard_session_date must NOT be SECURITY DEFINER (§7.38),
-- and why guard_attendance_date has an is-this-a-correction branch at all (a
-- BEFORE INSERT trigger also fires for rows that resolve to an UPDATE — §7.57).
-- A rollback that silently strips those leaves the next person to re-derive
-- them from an incident.

CREATE OR REPLACE FUNCTION public.guard_session_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.guard_attendance_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
END $function$;

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
END $function$;


-- book_makeup and book_trial: swap the floor expression back. Their bodies are
-- long and otherwise unchanged, so this rewrites them from the LIVE definition
-- rather than restating 250 lines that could drift from what is actually
-- deployed.
--
-- ⚠ NEVER regexp_replace() HERE, AND THIS IS NOT STYLE. The first version of
-- this file used
--   regexp_replace(def, '\s*IF p_session_date < markable_floor\(v_tenant\) THEN.*?END IF;', '', 'ns')
-- which DELETED ALL THREE of book_trial's other refusals — a trial could then
-- be booked on a non-lesson day, for an already-enrolled child, or for a family
-- holding a package. Postgres's ARE engine decides greediness for the WHOLE
-- expression from its FIRST quantifier: the leading `\s*` is greedy, so the
-- `.*?` was greedy too and ran to the LAST `END IF;` in the function.
--
-- The second version matched an exact multi-line literal instead, and failed
-- because the block's comment rule is drawn with box characters that do not
-- survive being retyped. Both were caught only because this file gets EXECUTED
-- as part of shipping, not merely written.
--
-- So: LINE-WISE removal, anchored on ASCII, with no quantifier and no Unicode
-- to transcribe. Drop from the marker line through the first `  END IF;` after
-- it, plus the blank line that follows. Any reader can check that by eye, which
-- is the property the two previous versions lacked.
DO $$
DECLARE
  v_def    TEXT;
  v_fn     TEXT;
  v_lines  TEXT[];
  v_out    TEXT[] := ARRAY[]::TEXT[];
  v_i      INT;
  v_state  INT;   -- 0 = copying, 1 = dropping, 2 = drop one trailing blank
  v_found  BOOLEAN;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['book_makeup','book_trial'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_fn;

    IF v_def IS NULL THEN
      RAISE EXCEPTION '% not found — the database is not in the state this rollback expects', v_fn;
    END IF;

    IF v_fn = 'book_trial' THEN
      -- The block did not exist before 20260806000200, so it is removed whole
      -- rather than having its expression rewritten.
      v_lines := string_to_array(v_def, E'\n');
      v_out   := ARRAY[]::TEXT[];
      v_state := 0;
      v_found := FALSE;

      FOR v_i IN 1 .. array_length(v_lines, 1) LOOP
        IF v_state = 0
           AND v_lines[v_i] LIKE '%0. Not into an already-billed month%' THEN
          v_state := 1;
          v_found := TRUE;
        ELSIF v_state = 1 AND btrim(v_lines[v_i]) = 'END IF;' THEN
          v_state := 2;
        ELSIF v_state = 2 THEN
          -- Exactly one blank line belongs to the block; anything else is the
          -- next refusal and must be kept.
          v_state := 0;
          IF btrim(v_lines[v_i]) <> '' THEN
            v_out := v_out || v_lines[v_i];
          END IF;
        ELSIF v_state = 0 THEN
          v_out := v_out || v_lines[v_i];
        END IF;
      END LOOP;

      IF NOT v_found THEN
        RAISE EXCEPTION
          'book_trial does not contain the floor block 20260806000200 adds — refusing to guess at removing it';
      END IF;
      IF v_state <> 0 THEN
        RAISE EXCEPTION
          'book_trial''s floor block had no closing END IF; — refusing to write a truncated function';
      END IF;

      v_def := array_to_string(v_out, E'\n');
    ELSE
      v_def := replace(v_def, 'markable_floor(v_tenant)', 'session_window_start()');
      -- 20260806000200 also updated the note beside book_makeup's floor to say
      -- book_trial had gained one. Rolling back makes that false again, and a
      -- comment asserting a guard exists when it does not is worse than no
      -- comment: it is the reason the asymmetry went unfixed for as long as it
      -- did. Restore the original wording, which records it as still open.
      v_def := replace(v_def,
        E'(book_trial gained the same\n  -- floor in 20260806000200; the asymmetry noted here is closed.)',
        E'(book_trial has no floor —\n  -- recorded as a BACKLOG asymmetry, deliberately not changed here.)');
    END IF;

    IF v_def LIKE '%markable_floor%' THEN
      RAISE EXCEPTION
        '% still references markable_floor after rewriting — refusing to leave a dangling call', v_fn;
    END IF;

    EXECUTE v_def;
  END LOOP;
END $$;


-- ── Drop what the feature added ─────────────────────────────────────────────
-- LAST, so every caller above is already off them. DROP would fail loudly
-- anyway if a dependency remained, but the ordering means it never has to.

DROP FUNCTION IF EXISTS public.markable_window_start();
DROP FUNCTION IF EXISTS public.assert_markable_date(DATE, UUID);
DROP FUNCTION IF EXISTS public.markable_floor(UUID);


-- ── Probe: the state this file promised ─────────────────────────────────────

DO $$
DECLARE
  v_count INT;
  v_refs  TEXT;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'assert_markable_date';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'assert_markable_date has % definitions, expected exactly 1', v_count;
  END IF;

  SELECT string_agg(p.proname, ', ') INTO v_refs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosrc LIKE '%markable_floor%';

  IF v_refs IS NOT NULL THEN
    RAISE EXCEPTION
      'these functions still call markable_floor, which no longer exists: % — they would fail at the next write, not now',
      v_refs;
  END IF;
END $$;

COMMIT;

-- The APPS must be rolled back too. A coach app built after 20260806000200
-- calls markable_window_start(), which is now gone; lib/markableFloor.ts logs
-- the error and returns null, and every consumer treats null as "use the
-- calendar rule" — so the app degrades correctly rather than breaking. Rolling
-- the apps back is therefore desirable but NOT urgent, which is the whole
-- reason the client applies the server floor as a minimum.
