-- ROLLBACK for 20260927000400_roles_repoint_operations.sql
--
-- Restores the 33 policies and 34 functions to their pre-migration
-- expressions and bodies, captured from the database 2026-09-27 immediately
-- before the migration was applied. Nothing stored is lost; the operations
-- and profile areas simply stop being consulted.
--
-- REHEARSED (§7.93): apply the UP, run this, confirm
-- roles_operations.test.sql fails, re-apply the UP; schema dump identical.

ALTER POLICY attendance_select ON public.attendance
  USING ((is_platform_admin() OR parent_owns_student(student_id) OR coach_owns_session(lesson_session_id) OR coach_teaches_session(lesson_session_id) OR is_tenant_admin(session_tenant(lesson_session_id))));

ALTER POLICY attendance_write ON public.attendance
  USING ((coach_is_main_on_session(lesson_session_id) OR can_admin_tenant(session_tenant(lesson_session_id))))
  WITH CHECK ((coach_is_main_on_session(lesson_session_id) OR can_admin_tenant(session_tenant(lesson_session_id))));

ALTER POLICY audit_log_insert ON public.audit_log
  WITH CHECK (((actor_id = auth.uid()) AND (entity_type = 'lesson_session'::text) AND (coach_owns_session(entity_id) OR can_admin_tenant(session_tenant(entity_id)))));

ALTER POLICY audit_log_select ON public.audit_log
  USING ((is_platform_admin() OR is_tenant_admin(tenant_id)));

ALTER POLICY sessions_select ON public.lesson_sessions
  USING ((is_platform_admin() OR coach_owns_class(class_id) OR coach_teaches_session(id) OR is_tenant_admin(class_tenant(class_id)) OR parent_has_child_in_class(class_id)));

ALTER POLICY sessions_write ON public.lesson_sessions
  USING ((coach_owns_class(class_id) OR can_admin_tenant(class_tenant(class_id))))
  WITH CHECK ((coach_owns_class(class_id) OR can_admin_tenant(class_tenant(class_id))));

ALTER POLICY makeup_bookings_insert ON public.makeup_bookings
  WITH CHECK (can_admin_tenant(tenant_id));

ALTER POLICY makeup_bookings_update ON public.makeup_bookings
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

ALTER POLICY trial_bookings_insert ON public.trial_bookings
  WITH CHECK (can_admin_tenant(tenant_id));

ALTER POLICY trial_bookings_update ON public.trial_bookings
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

ALTER POLICY tenant_public_holidays_select ON public.tenant_public_holidays
  USING ((is_platform_admin() OR can_admin_tenant(tenant_id) OR parent_in_tenant(tenant_id) OR (EXISTS ( SELECT 1
   FROM coaches co
  WHERE ((co.profile_id = auth.uid()) AND (co.tenant_id = tenant_public_holidays.tenant_id))))));

ALTER POLICY tenant_public_holidays_write ON public.tenant_public_holidays
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

ALTER POLICY students_select ON public.students
  USING ((is_platform_admin() OR ((created_by = auth.uid()) AND (NOT tenant_suspended(tenant_id))) OR parent_owns_student(id) OR is_tenant_admin(tenant_id) OR coach_serves_student(id) OR coach_rostered_with_student(id)));

ALTER POLICY students_insert ON public.students
  WITH CHECK ((is_platform_admin() OR is_tenant_admin(tenant_id)));

ALTER POLICY students_update ON public.students
  USING ((is_platform_admin() OR ((created_by = auth.uid()) AND (NOT tenant_suspended(tenant_id))) OR parent_owns_student(id) OR is_tenant_admin(tenant_id)))
  WITH CHECK ((is_platform_admin() OR ((created_by = auth.uid()) AND (NOT tenant_suspended(tenant_id))) OR parent_owns_student(id) OR is_tenant_admin(tenant_id)));

ALTER POLICY enrolments_select ON public.student_class_enrolments
  USING ((is_platform_admin() OR parent_owns_student(student_id) OR coach_owns_class(class_id) OR coach_rostered_in_class(class_id) OR is_tenant_admin(class_tenant(class_id))));

ALTER POLICY enrolments_write ON public.student_class_enrolments
  USING (can_admin_tenant(class_tenant(class_id)))
  WITH CHECK (can_admin_tenant(class_tenant(class_id)));

ALTER POLICY student_claims_select ON public.student_claims
  USING ((is_platform_admin() OR ((parent_id = current_parent_id()) AND (NOT tenant_suspended(tenant_id))) OR is_tenant_admin(tenant_id)));

ALTER POLICY student_skill_progress_write ON public.student_skill_progress
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

ALTER POLICY skill_grade_levels_write ON public.skill_grade_levels
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

ALTER POLICY classes_select ON public.classes
  USING ((is_platform_admin() OR is_tenant_admin(tenant_id) OR (coach_id = current_coach_id()) OR coach_rostered_in_class(id) OR parent_has_child_in_class(id)));

ALTER POLICY classes_write ON public.classes
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

ALTER POLICY class_categories_write ON public.class_categories
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

ALTER POLICY locations_write ON public.locations
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

ALTER POLICY tenant_levels_write ON public.tenant_levels
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

ALTER POLICY tenant_level_skills_write ON public.tenant_level_skills
  USING ((EXISTS ( SELECT 1
   FROM tenant_levels l
  WHERE ((l.id = tenant_level_skills.level_id) AND can_admin_tenant(l.tenant_id)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM tenant_levels l
  WHERE ((l.id = tenant_level_skills.level_id) AND can_admin_tenant(l.tenant_id)))));

ALTER POLICY coaches_update ON public.coaches
  USING (((profile_id = auth.uid()) OR can_admin_tenant(tenant_id)))
  WITH CHECK (((profile_id = auth.uid()) OR can_admin_tenant(tenant_id)));

ALTER POLICY class_shadow_coaches_select ON public.class_shadow_coaches
  USING ((is_platform_admin() OR can_admin_tenant(tenant_id) OR (coach_id = current_coach_id())));

ALTER POLICY class_shadow_coaches_write ON public.class_shadow_coaches
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

ALTER POLICY session_coaches_select ON public.session_coaches
  USING ((is_platform_admin() OR can_admin_tenant(tenant_id) OR (coach_id = current_coach_id())));

ALTER POLICY session_coaches_write ON public.session_coaches
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

ALTER POLICY session_coach_absences_select ON public.session_coach_absences
  USING ((is_platform_admin() OR can_admin_tenant(tenant_id) OR (coach_id = current_coach_id()) OR coach_is_main_on_session(lesson_session_id)));

ALTER POLICY session_coach_absences_write ON public.session_coach_absences
  USING ((can_admin_tenant(tenant_id) OR coach_is_main_on_session(lesson_session_id)))
  WITH CHECK ((can_admin_tenant(tenant_id) OR coach_is_main_on_session(lesson_session_id)));

CREATE OR REPLACE FUNCTION public.cancel_lesson(p_class_id uuid, p_date date, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor        UUID := auth.uid();
  v_tenant       UUID;
  v_title        TEXT;
  v_active       BOOLEAN;
  v_session      UUID;
  v_cancelled_at TIMESTAMPTZ;
  v_guests       TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.tenant_id, c.title, c.is_active INTO v_tenant, v_title, v_active
    FROM classes c WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  -- Admin only. Cancelling is an arrangement, not an observation — the same
  -- split book_trial, book_makeup and schedule_extra_lesson enforce.
  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may cancel a lesson';
  END IF;

  IF NOT v_active THEN
    RAISE EXCEPTION '% is no longer running — a retired class has no lessons to cancel', v_title;
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION
      'a reason is required — it is what the parent and the coach will see in place of the lesson';
  END IF;

  -- ── RISK 2: advance means ADVANCE ─────────────────────────────────────────
  -- today_sg(), never a session-time-zone date (§7.7). A lesson that is today or in the past
  -- either ran (mark it) or did not (the coach records cancelled_rain /
  -- cancelled_coach, which satisfies the gate without billing — core.ts: "there
  -- is no case that needs a bypass"). This function is not that path.
  IF p_date <= today_sg() THEN
    RAISE EXCEPTION
      'Only a lesson that has not happened yet can be cancelled here. % is today or already past — if it did not run, record it as cancelled (rain / coach) on its attendance screen instead.',
      to_char(p_date, 'DD Mon YYYY');
  END IF;

  -- ── RISK 3: serialise against a concurrent booking (§7.198, §7.200) ───────
  -- book_makeup / book_trial / schedule_extra_lesson take this same class-row
  -- lock before they write, so a guest booked "at the same instant" is either
  -- visible to the refusal below or refused by their own cancelled check.
  PERFORM 1 FROM classes WHERE id = p_class_id FOR UPDATE;

  -- Re-read is_active under the lock (a deactivate_class() that committed in
  -- the gap would otherwise leave a cancelled session on a retired class).
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id AND is_active) THEN
    RAISE EXCEPTION '% is no longer running — a retired class has no lessons to cancel', v_title;
  END IF;

  SELECT ls.id, ls.cancelled_at INTO v_session, v_cancelled_at
    FROM lesson_sessions ls
   WHERE ls.class_id = p_class_id AND ls.session_date = p_date;

  -- Idempotent: cancelling a cancelled lesson is a no-op, not an error (two
  -- admins, a double-click, a retried request).
  IF v_cancelled_at IS NOT NULL THEN
    RETURN v_session;
  END IF;

  -- Nothing to cancel on a day the class does not meet — unless an admin
  -- already scheduled an extra lesson there (the session row proves it).
  IF v_session IS NULL THEN
    PERFORM assert_class_runs_on(p_class_id, p_date);
  END IF;

  -- ── RISK 2: a marked lesson RAN ───────────────────────────────────────────
  -- Unreachable for a future date through the product (assert_markable_date
  -- refuses marking ahead), but the engine must not have to trust that: the
  -- refusal is structural, so no marked reality is ever deleted by a cancel.
  IF v_session IS NOT NULL
     AND EXISTS (SELECT 1 FROM attendance a WHERE a.lesson_session_id = v_session) THEN
    RAISE EXCEPTION
      'Attendance has already been recorded for % on % — a lesson that was marked is a lesson that ran. Correct the marks instead.',
      v_title, to_char(p_date, 'DD Mon YYYY');
  END IF;

  -- ── RISK 3: live guests are NAMED, never silently stranded ────────────────
  -- A make-up booking is a parent's credit for a missed lesson; voiding it
  -- underneath them is the exact loss this refusal exists to prevent.
  SELECT string_agg(b.label, ', ' ORDER BY b.label) INTO v_guests
    FROM (
      SELECT s.full_name || ' (trial)' AS label
        FROM trial_bookings tb JOIN students s ON s.id = tb.student_id
       WHERE tb.class_id = p_class_id AND tb.session_date = p_date AND tb.cancelled_at IS NULL
      UNION ALL
      SELECT s.full_name || ' (make-up)'
        FROM makeup_bookings mb JOIN students s ON s.id = mb.student_id
       WHERE mb.class_id = p_class_id AND mb.session_date = p_date AND mb.cancelled_at IS NULL
    ) b;

  IF v_guests IS NOT NULL THEN
    RAISE EXCEPTION
      '% on % still has guests booked: %. Move or cancel those bookings first — cancelling the lesson would silently strand them.',
      v_title, to_char(p_date, 'DD Mon YYYY'), v_guests;
  END IF;

  -- ── Write ─────────────────────────────────────────────────────────────────
  -- The row is created if the lesson was never touched (rows are lazy, PRD §7.5)
  -- and flagged in place if it was (an extra lesson, or a session a substitute
  -- was assigned to). trg_fill_session_times fills the times on insert.
  IF v_session IS NULL THEN
    INSERT INTO lesson_sessions
      (class_id, session_date, status, cancelled_at, cancelled_by, cancellation_reason)
    VALUES
      (p_class_id, p_date, 'cancelled', now(), v_actor, btrim(p_reason))
    RETURNING id INTO v_session;
  ELSE
    UPDATE lesson_sessions
       SET status = 'cancelled', cancelled_at = now(),
           cancelled_by = v_actor, cancellation_reason = btrim(p_reason)
     WHERE id = v_session;
  END IF;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_actor, 'lesson_cancelled', 'lesson_session', v_session,
    jsonb_build_object(
      'class_id', p_class_id,
      'class_title', v_title,
      'session_date', p_date,
      'reason', btrim(p_reason)
    )
  );

  RETURN v_session;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_lesson(p_class_id uuid, p_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor        UUID := auth.uid();
  v_tenant       UUID;
  v_title        TEXT;
  v_active       BOOLEAN;
  v_session      UUID;
  v_cancelled_at TIMESTAMPTZ;
  v_floor        DATE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.tenant_id, c.title, c.is_active INTO v_tenant, v_title, v_active
    FROM classes c WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may restore a lesson';
  END IF;

  -- Same lock as cancel_lesson and the booking RPCs, so a restore and a cancel
  -- of the same lesson serialise rather than interleave.
  PERFORM 1 FROM classes WHERE id = p_class_id FOR UPDATE;

  -- Mirrors cancel_lesson's refusal (re-read under the lock): a lesson restored
  -- into a RETIRED class is a lesson no screen renders (§7.109) — it would be
  -- expected, unmarkable, and block the month. Reactivate the class first.
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id AND is_active) THEN
    RAISE EXCEPTION '% is no longer running — restore the class before one of its lessons', v_title;
  END IF;

  SELECT ls.id, ls.cancelled_at INTO v_session, v_cancelled_at
    FROM lesson_sessions ls
   WHERE ls.class_id = p_class_id AND ls.session_date = p_date;

  IF v_session IS NULL OR v_cancelled_at IS NULL THEN
    RAISE EXCEPTION 'there is no cancelled lesson for % on % to restore',
      v_title, to_char(p_date, 'DD Mon YYYY');
  END IF;

  -- ── RISK 2: never restore INTO a sealed month (§11.6) ─────────────────────
  -- The marking floor does NOT cover this: markable_floor() is LEAST(calendar,
  -- month-after-latest-seal), so a sealed month inside the calendar window is
  -- still markable (that is §8.48's reported-and-settled path, deliberate). A
  -- lesson restored there would be an expected lesson the invoice run can never
  -- pick up again, so it is refused outright.
  IF EXISTS (
    SELECT 1 FROM billing_periods bp
     WHERE bp.tenant_id = v_tenant
       AND bp.billing_month = to_char(p_date, 'YYYY-MM')
  ) THEN
    RAISE EXCEPTION
      '% has already been billed — a lesson restored into a billed month could never be invoiced. Leave it cancelled.',
      to_char(p_date, 'Mon YYYY');
  END IF;

  -- ── …nor below the marking floor ──────────────────────────────────────────
  -- Below the floor nobody can record attendance (assert_markable_date), so a
  -- restored lesson there is expected, unmarkable, and blocks its month with no
  -- override and no screen able to clear it (§7.109's shape).
  v_floor := markable_floor(v_tenant);
  IF p_date < v_floor THEN
    RAISE EXCEPTION
      'That lesson (%) cannot be restored — attendance can only be recorded back to %, so it could never be marked or billed.',
      to_char(p_date, 'DD Mon YYYY'), to_char(v_floor, 'DD Mon YYYY');
  END IF;

  -- The row stays (its history is the audit trail; the engine and every screen
  -- treat a bare session row as an ordinary lesson). Only the flag is cleared.
  UPDATE lesson_sessions
     SET status = 'scheduled', cancelled_at = NULL,
         cancelled_by = NULL, cancellation_reason = NULL
   WHERE id = v_session;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_actor, 'lesson_restored', 'lesson_session', v_session,
    jsonb_build_object('class_id', p_class_id, 'class_title', v_title, 'session_date', p_date)
  );

  RETURN v_session;
END;
$function$;

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

  -- ── A cancelled lesson is restored, not scheduled over (20260821000700) ───
  PERFORM 1 FROM classes WHERE id = p_class_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM lesson_sessions ls
     WHERE ls.class_id = p_class_id
       AND ls.session_date = p_date
       AND ls.cancelled_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      '% on % was cancelled — restore that lesson instead of scheduling over it',
      v_title, to_char(p_date, 'DD Mon YYYY');
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
      -- A cancelled lesson is already void (20260821000700).
      AND ls.cancelled_at IS NULL
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
$function$;

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
    -- Never delete a cancellation (20260821000700) — it looks exactly like a
    -- session this void left empty, and it is not one.
    AND ls.cancelled_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.lesson_session_id = ls.id);

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_holiday_admin_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_touches_holiday BOOLEAN;
  v_session UUID;
BEGIN
  -- Only client DML is gated; backend writers (postgres) pass through.
  IF current_user <> 'authenticated' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_touches_holiday :=
       (TG_OP = 'INSERT' AND NEW.status = 'holiday')
    OR (TG_OP = 'UPDATE' AND (NEW.status = 'holiday' OR OLD.status = 'holiday'))
    OR (TG_OP = 'DELETE' AND OLD.status = 'holiday');

  IF v_touches_holiday THEN
    v_session := COALESCE(NEW.lesson_session_id, OLD.lesson_session_id);
    IF NOT can_admin_tenant(session_tenant(v_session)) THEN
      RAISE EXCEPTION 'Only a tenant admin can set or clear a public-holiday mark.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

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

  -- ── A cancelled lesson takes no guests (20260821000700, plan RISK 3) ─────
  -- Read UNDER the lock: cancel_lesson() holds this same lock while it checks
  -- for guests and writes, so this either sees the cancellation or precedes
  -- it — and in the second case cancel_lesson() sees this guest and refuses.
  IF EXISTS (
    SELECT 1 FROM lesson_sessions ls
     WHERE ls.class_id = p_class_id
       AND ls.session_date = p_session_date
       AND ls.cancelled_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      '% on % has been cancelled — restore the lesson first, or pick another date',
      v_class_title, to_char(p_session_date, 'DD Mon YYYY');
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

  -- ── A cancelled lesson takes no guests (20260821000700, plan RISK 3) ─────
  -- Under the lock, for the reason book_makeup gives.
  IF EXISTS (
    SELECT 1 FROM lesson_sessions ls
     WHERE ls.class_id = p_class_id
       AND ls.session_date = p_session_date
       AND ls.cancelled_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      '% on % has been cancelled — restore the lesson first, or pick another date',
      v_class_title, to_char(p_session_date, 'DD Mon YYYY');
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
$function$;

CREATE OR REPLACE FUNCTION public.cancel_makeup_booking(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT tenant_id INTO v_tenant FROM makeup_bookings WHERE id = p_booking_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may cancel a make-up';
  END IF;

  UPDATE makeup_bookings
     SET cancelled_at = NOW(), cancelled_by = v_actor
   WHERE id = p_booking_id AND cancelled_at IS NULL;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (v_actor, 'makeup_booking_cancelled', 'Student',
          (SELECT student_id FROM makeup_bookings WHERE id = p_booking_id),
          jsonb_build_object('booking_id', p_booking_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_trial_booking(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT tenant_id INTO v_tenant FROM trial_bookings WHERE id = p_booking_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may cancel a trial';
  END IF;

  UPDATE trial_bookings
     SET cancelled_at = NOW(), cancelled_by = v_actor
   WHERE id = p_booking_id AND cancelled_at IS NULL;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (v_actor, 'trial_booking_cancelled', 'Student',
          (SELECT student_id FROM trial_bookings WHERE id = p_booking_id),
          jsonb_build_object('booking_id', p_booking_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_unclaimed_student(p_class_id uuid, p_full_name text, p_kind unclaimed_student_kind, p_session_date date DEFAULT NULL::date, p_status attendance_status DEFAULT NULL::attendance_status, p_date_of_birth date DEFAULT NULL::date, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor    UUID := auth.uid();
  v_tenant   UUID;
  v_student  UUID;
  v_name     TEXT := trim(COALESCE(p_full_name, ''));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'a name is required' USING ERRCODE = 'check_violation';
  END IF;

  v_tenant := class_tenant(p_class_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  -- BOTH kinds are now admin-only. A TRIAL always was (like book_trial()); an
  -- ONGOING student joins it as of 2026-08-21 — every new child goes through
  -- the admin, no coach arm. (§7.202)
  IF p_kind = 'trial' THEN
    IF NOT is_tenant_admin(v_tenant) THEN
      RAISE EXCEPTION 'only this business''s admin may book a trial';
    END IF;
    IF p_session_date IS NULL THEN
      RAISE EXCEPTION 'a trial needs the date of the lesson'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'not permitted to add a student to this class';
  END IF;

  BEGIN
    INSERT INTO students (
      full_name, date_of_birth, tenant_id, created_by, assignment_status,
      provisional_contact_name, provisional_contact_phone, provisional_contact_email
    )
    VALUES (
      v_name, p_date_of_birth, v_tenant, v_actor,
      -- A trial is not an assignment. They are expected at ONE lesson, not
      -- placed in the class, so they stay unassigned until someone enrols them
      -- deliberately.
      (CASE WHEN p_kind = 'trial' THEN 'unassigned' ELSE 'assigned' END)::assignment_status,
      NULLIF(trim(COALESCE(p_contact_name, '')), ''),
      NULLIF(trim(COALESCE(p_contact_phone, '')), ''),
      NULLIF(trim(COALESCE(p_contact_email, '')), '')
    )
    RETURNING id INTO v_student;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION
      'A child called % with that date of birth is already registered with this business. If this is the same child, find them on the roster instead of adding them again.',
      v_name
      USING ERRCODE = 'unique_violation';
  END;

  IF p_kind = 'trial' THEN
    -- One booking, nothing else. book_trial() carries the date and
    -- already-a-customer checks; a brand-new child can trip neither, but
    -- routing through it keeps ONE definition of what booking means.
    PERFORM book_trial(p_class_id, p_session_date, v_student);
  ELSE
    INSERT INTO student_class_enrolments (student_id, class_id)
    VALUES (v_student, p_class_id);
  END IF;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_actor,
    CASE WHEN p_kind = 'trial' THEN 'unclaimed_trial_booked'
         ELSE 'unclaimed_student_added' END,
    'Student',
    v_student,
    (SELECT to_jsonb(s) FROM students s WHERE s.id = v_student)
  );

  RETURN v_student;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_student_claim(p_claim_id uuid)
 RETURNS TABLE(student_id uuid, others_declined integer, dob_filled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor   UUID := auth.uid();
  v_claim   student_claims%ROWTYPE;
  v_profile UUID;
  v_others  INT := 0;
  v_dob     BOOLEAN := FALSE;
  v_gender  BOOLEAN := FALSE;
  v_notes   BOOLEAN := FALSE;
  v_had_dob BOOLEAN;
  v_had_gen BOOLEAN;
  v_had_not BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_claim FROM student_claims WHERE id = p_claim_id;
  IF v_claim.id IS NULL THEN
    RAISE EXCEPTION 'claim not found';
  END IF;

  IF NOT is_tenant_admin(v_claim.tenant_id) THEN
    RAISE EXCEPTION 'only this business''s admin may decide a claim';
  END IF;

  IF v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'that claim has already been decided';
  END IF;

  SELECT p.profile_id INTO v_profile FROM parents p WHERE p.id = v_claim.parent_id;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'that parent account no longer exists';
  END IF;

  PERFORM link_invited_parent(v_profile, v_claim.student_id);

  -- What was MISSING before we touched it. Read first, so "we filled this" is
  -- a fact rather than an inference from the value afterwards.
  SELECT date_of_birth IS NULL, gender IS NULL, notes IS NULL
    INTO v_had_dob, v_had_gen, v_had_not
    FROM students WHERE id = v_claim.student_id;

  IF v_claim.claimed_dob IS NOT NULL AND v_had_dob THEN
    BEGIN
      UPDATE students SET date_of_birth = v_claim.claimed_dob
       WHERE id = v_claim.student_id AND date_of_birth IS NULL;
      v_dob := FOUND;
    EXCEPTION WHEN unique_violation THEN
      -- A third row already has that name and date. Keep the link, skip this.
      v_dob := FALSE;
    END;
  END IF;

  UPDATE students
     SET gender = COALESCE(
           gender,
           (CASE WHEN lower(btrim(COALESCE(v_claim.claimed_gender, '')))
                      IN ('male','female','other')
                 THEN lower(btrim(v_claim.claimed_gender))::gender_type END)
         ),
         notes  = COALESCE(notes, v_claim.claimed_notes)
   WHERE id = v_claim.student_id;

  v_gender := v_had_gen AND lower(btrim(COALESCE(v_claim.claimed_gender, '')))
                             IN ('male','female','other');
  v_notes  := v_had_not AND v_claim.claimed_notes IS NOT NULL;

  UPDATE student_claims
     SET status = 'approved', decided_at = NOW(), decided_by = v_actor,
         filled_dob = v_dob, filled_gender = v_gender, filled_notes = v_notes
   WHERE id = p_claim_id;

  WITH closed AS (
    UPDATE student_claims sc
       SET status = 'declined', decided_at = NOW()
     WHERE sc.student_id = v_claim.student_id
       AND sc.id <> p_claim_id
       AND sc.status = 'pending'
    RETURNING 1
  )
  SELECT count(*)::INT INTO v_others FROM closed;

  INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_claim.tenant_id, v_actor, 'student_claim_approved', 'Student', v_claim.student_id,
    jsonb_build_object(
      'claim_id', p_claim_id, 'parent_id', v_claim.parent_id,
      'others_declined', v_others, 'dob_filled', v_dob,
      'gender_filled', v_gender, 'notes_filled', v_notes
    )
  );

  RETURN QUERY SELECT v_claim.student_id, v_others, v_dob;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decline_student_claim(p_claim_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_claim student_claims%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_claim FROM student_claims WHERE id = p_claim_id;
  IF v_claim.id IS NULL THEN
    RAISE EXCEPTION 'claim not found';
  END IF;

  IF NOT is_tenant_admin(v_claim.tenant_id) THEN
    RAISE EXCEPTION 'only this business''s admin may decide a claim';
  END IF;

  IF v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'that claim has already been decided';
  END IF;

  UPDATE student_claims
     SET status = 'declined', decided_at = NOW(), decided_by = v_actor
   WHERE id = p_claim_id;

  INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_claim.tenant_id, v_actor, 'student_claim_declined', 'Student', v_claim.student_id,
    jsonb_build_object('claim_id', p_claim_id, 'parent_id', v_claim.parent_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.undo_student_claim(p_claim_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor   UUID := auth.uid();
  v_claim   student_claims%ROWTYPE;
  v_invoice TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_claim FROM student_claims WHERE id = p_claim_id;
  IF v_claim.id IS NULL THEN
    RAISE EXCEPTION 'claim not found';
  END IF;

  IF NOT is_tenant_admin(v_claim.tenant_id) THEN
    RAISE EXCEPTION 'only this business''s admin may undo a claim';
  END IF;

  IF v_claim.status <> 'approved' THEN
    RAISE EXCEPTION 'only an approved claim can be undone';
  END IF;

  SELECT i.billing_month INTO v_invoice
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
   WHERE ii.student_id = v_claim.student_id
     AND i.parent_id = v_claim.parent_id
   LIMIT 1;

  IF v_invoice IS NOT NULL THEN
    RAISE EXCEPTION
      'This link cannot be undone: % has already been invoiced to this parent (%). Issue a credit note instead.',
      (SELECT full_name FROM students WHERE id = v_claim.student_id), v_invoice;
  END IF;

  DELETE FROM parent_students
   WHERE parent_id = v_claim.parent_id
     AND student_id = v_claim.student_id;

  -- ⚠ AND UNDO WHAT THE APPROVAL WROTE ONTO THE CHILD. Each field is cleared
  -- only if it STILL holds exactly what this claim supplied — a coach may have
  -- corrected it since, and destroying their correction to reverse ours would
  -- be a worse error than the one being fixed.
  UPDATE students s
     SET date_of_birth = CASE
           WHEN v_claim.filled_dob AND s.date_of_birth IS NOT DISTINCT FROM v_claim.claimed_dob
             THEN NULL ELSE s.date_of_birth END,
         gender = CASE
           WHEN v_claim.filled_gender
            AND s.gender::text IS NOT DISTINCT FROM lower(btrim(v_claim.claimed_gender))
             THEN NULL ELSE s.gender END,
         notes = CASE
           WHEN v_claim.filled_notes AND s.notes IS NOT DISTINCT FROM v_claim.claimed_notes
             THEN NULL ELSE s.notes END
   WHERE s.id = v_claim.student_id;

  UPDATE student_claims
     SET status = 'declined', decided_at = NOW(), decided_by = v_actor,
         filled_dob = FALSE, filled_gender = FALSE, filled_notes = FALSE
   WHERE id = p_claim_id;

  INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_claim.tenant_id, v_actor, 'student_claim_undone', 'Student', v_claim.student_id,
    jsonb_build_object(
      'claim_id', p_claim_id, 'parent_id', v_claim.parent_id,
      'reverted_dob', v_claim.filled_dob,
      'reverted_gender', v_claim.filled_gender,
      'reverted_notes', v_claim.filled_notes
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_student_enrolment(p_student_id uuid, p_set_inactive boolean, p_class_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID;
  v_old    JSONB;
  v_left   INT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- "Gone" is a different question from "not in this class", and it has owned
  -- its own RPC since 20260719001200. That path closes every enrolment, which
  -- is correct: an open enrolment for a child who no longer attends keeps the
  -- class permanently incomplete and BLOCKS invoicing for the whole business.
  -- set_students_active() runs its own authorization.
  IF p_set_inactive THEN
    PERFORM set_students_active(ARRAY[p_student_id], FALSE);
    RETURN;
  END IF;

  -- The other half of "no default": an explicit NULL is refused, so there is no
  -- spelling of this call that means "all of them".
  IF p_class_id IS NULL THEN
    RAISE EXCEPTION
      'name the class to remove them from — a child may be in more than one';
  END IF;

  SELECT tenant_id INTO v_tenant FROM students WHERE id = p_student_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;

  IF NOT (is_platform_admin() OR is_tenant_admin(v_tenant)
          OR coach_owns_class(p_class_id)) THEN
    RAISE EXCEPTION 'not permitted to change this student''s enrolment';
  END IF;

  SELECT to_jsonb(s) INTO v_old FROM students s WHERE s.id = p_student_id;

  UPDATE student_class_enrolments
     SET is_active = FALSE, unenrolled_at = NOW()
   WHERE student_id = p_student_id
     AND class_id   = p_class_id
     AND is_active;

  -- 'unassigned' means "in NO class", not "left a class". A child dropped from
  -- one of two is still assigned, and the Students page reads this column.
  SELECT count(*) INTO v_left
    FROM student_class_enrolments
   WHERE student_id = p_student_id AND is_active;

  UPDATE students
     SET assignment_status = CASE WHEN v_left = 0
                                  THEN 'unassigned'::assignment_status
                                  ELSE assignment_status END,
         updated_at        = NOW()
   WHERE id = p_student_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (v_actor, 'student_removed_from_class', 'Student', p_student_id,
          v_old || jsonb_build_object('removed_from_class_id', p_class_id),
          (SELECT to_jsonb(s) FROM students s WHERE s.id = p_student_id), v_tenant);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_students_active(p_student_ids uuid[], p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  UUID := auth.uid();
  v_sid    UUID;
  v_tenant UUID;
  v_old    JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_student_ids IS NULL OR array_length(p_student_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no students given';
  END IF;

  FOREACH v_sid IN ARRAY p_student_ids LOOP
    SELECT tenant_id INTO v_tenant FROM students WHERE id = v_sid;
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'student % not found', v_sid;
    END IF;

    -- Checked BEFORE anything is closed: coach_serves_student() reads the
    -- ACTIVE enrolment, so it returns false once we have closed it.
    IF NOT (is_platform_admin() OR is_tenant_admin(v_tenant)
            OR coach_serves_student(v_sid)) THEN
      RAISE EXCEPTION 'not permitted to change this student';
    END IF;

    SELECT to_jsonb(s) INTO v_old FROM students s WHERE s.id = v_sid;

    IF NOT p_active THEN
      -- Closing the enrolment is not tidiness: an open enrolment for a child who
      -- no longer attends keeps their class permanently incomplete, which BLOCKS
      -- invoice generation for the whole business (PRD §7.7). Lessons already
      -- attended still bill — billing follows attendance rows, not enrolment
      -- (§7.13).
      UPDATE student_class_enrolments
         SET is_active = FALSE, unenrolled_at = NOW()
       WHERE student_id = v_sid AND is_active;
    END IF;

    UPDATE students
       SET is_active      = p_active,
           inactivated_at = CASE WHEN p_active THEN NULL ELSE NOW() END,
           -- 'inactive' is NO LONGER written here. Assignment answers only
           -- "in a class?", and phase 6 drops the value from the enum — which
           -- would fail at RUNTIME, not migration time, if a cast survived in
           -- a function body (§7.21).
           assignment_status = CASE WHEN p_active THEN assignment_status
                                    ELSE 'unassigned'::assignment_status END,
           updated_at     = NOW()
     WHERE id = v_sid;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                           old_value, new_value, tenant_id)
    VALUES (v_actor,
            CASE WHEN p_active THEN 'student_reactivated' ELSE 'student_set_inactive' END,
            'Student', v_sid, v_old,
            (SELECT to_jsonb(s) FROM students s WHERE s.id = v_sid), v_tenant);

    -- ── The family consequence, applied per (parent, tenant) ──────────────
    -- Deactivating: a family with no active children left here is no longer a
    -- customer here. Reactivating: a child cannot be active inside an inactive
    -- family, so the family comes back with them.
    UPDATE parent_tenants pt
       SET is_active      = p_active,
           inactivated_at = CASE WHEN p_active THEN NULL ELSE NOW() END
      FROM parent_students ps
     WHERE ps.student_id = v_sid
       AND pt.parent_id  = ps.parent_id
       AND pt.tenant_id  = v_tenant
       AND pt.is_active IS DISTINCT FROM p_active
       AND (
         p_active                      -- reactivation: unconditional
         OR NOT EXISTS (               -- deactivation: only once none are left
           SELECT 1 FROM students s2
             JOIN parent_students ps2 ON ps2.student_id = s2.id
            WHERE ps2.parent_id = ps.parent_id
              AND s2.tenant_id  = v_tenant
              AND s2.is_active
         )
       );
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_parent_tenant_active(p_parent_id uuid, p_tenant_id uuid, p_active boolean, p_student_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (is_platform_admin() OR is_tenant_admin(p_tenant_id)) THEN
    RAISE EXCEPTION 'not permitted to change this family';
  END IF;

  -- Children first: deactivating them flips the family via the consequence
  -- rule above, so this is usually all that is needed.
  IF p_student_ids IS NOT NULL AND array_length(p_student_ids, 1) IS NOT NULL THEN
    PERFORM set_students_active(p_student_ids, p_active);
  END IF;

  -- Then the family itself — for the case the children did not cover: marking a
  -- family inactive while deliberately leaving a child active (the admin chose
  -- "just this one"), or a family with no children yet.
  UPDATE parent_tenants
     SET is_active      = p_active,
         inactivated_at = CASE WHEN p_active THEN NULL ELSE NOW() END
   WHERE parent_id = p_parent_id AND tenant_id = p_tenant_id
     AND is_active IS DISTINCT FROM p_active;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (v_actor,
          CASE WHEN p_active THEN 'family_reactivated' ELSE 'family_set_inactive' END,
          'ParentTenant', p_parent_id,
          jsonb_build_object('tenant_id', p_tenant_id),
          jsonb_build_object('is_active', p_active, 'students', p_student_ids),
          p_tenant_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rename_student(p_student_id uuid, p_new_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_row   students%ROWTYPE;
  v_name  TEXT := btrim(COALESCE(p_new_name, ''));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_row FROM students WHERE id = p_student_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'child not found';
  END IF;

  -- Tenant from the ROW (§7.42). This one predicate refuses a non-admin, a
  -- disabled admin, a suspended tenant, and the platform admin.
  IF NOT is_tenant_admin(v_row.tenant_id) THEN
    RAISE EXCEPTION 'only this business''s admin may rename a child';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'a name is required' USING ERRCODE = 'check_violation';
  END IF;

  -- A resubmission of the exact same name is a clean no-op: the audit trigger
  -- would not fire anyway, and skipping avoids the self-referential probe.
  IF v_name = btrim(v_row.full_name) THEN
    RETURN;
  END IF;

  -- ⚠ RISK 2: refuse a name that would make TWO ACTIVE children of this business
  -- share (name, DOB) — INCLUDING the NULL-DOB case the unique index cannot see.
  -- Scoped to is_active because an inactive child is off the roster (the
  -- "cannot tell them apart" harm needs both live); a non-NULL collision against
  -- an inactive row is still caught by the index below.
  IF EXISTS (
    SELECT 1 FROM students s
     WHERE s.tenant_id = v_row.tenant_id
       AND s.id <> p_student_id
       AND s.is_active
       AND lower(btrim(s.full_name)) = lower(v_name)
       AND s.date_of_birth IS NOT DISTINCT FROM v_row.date_of_birth
  ) THEN
    RAISE EXCEPTION '% is already registered with this coach or school.', v_name
      USING ERRCODE = 'unique_violation';
  END IF;

  -- The write. The students audit trigger records it against auth.uid()
  -- automatically. The index is the backstop for a non-NULL (name, DOB)
  -- collision the probe above deliberately does not cover (an inactive row, or
  -- a race) — surfaced with the same friendly message rather than a raw 23505.
  BEGIN
    UPDATE students SET full_name = v_name WHERE id = p_student_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '% is already registered with this coach or school.', v_name
      USING ERRCODE = 'unique_violation';
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.merge_students(p_survivor_id uuid, p_duplicate_id uuid)
 RETURNS TABLE(moved_parent_links integer, moved_trial_bookings integer, moved_makeup_bookings integer, moved_settlements integer, moved_claims integer, moved_skill_progress integer, dropped_collisions integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor      UUID := auth.uid();
  v_surv       students%ROWTYPE;
  v_dup        students%ROWTYPE;
  v_surv_att   INT;
  v_dup_att    INT;
  v_unknown    TEXT;
  v_ps INT := 0; v_tb INT := 0; v_mb INT := 0; v_ss INT := 0; v_cl INT := 0;
  v_sp INT := 0;
  v_drop INT := 0; v_drop_ps INT := 0; v_drop_tb INT := 0; v_drop_mb INT := 0;
  v_drop_sp INT := 0;
  v_ps_before INT; v_tb_before INT; v_mb_before INT; v_ss_before INT; v_sp_before INT;
  v_ps_after  INT; v_tb_after  INT; v_mb_after  INT; v_ss_after  INT; v_sp_after  INT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_survivor_id = p_duplicate_id THEN
    RAISE EXCEPTION 'those are the same child';
  END IF;

  SELECT * INTO v_surv FROM students WHERE id = p_survivor_id;
  SELECT * INTO v_dup  FROM students WHERE id = p_duplicate_id;

  IF v_surv.id IS NULL OR v_dup.id IS NULL THEN
    RAISE EXCEPTION 'child not found';
  END IF;

  IF v_surv.tenant_id <> v_dup.tenant_id THEN
    RAISE EXCEPTION 'those two children belong to different businesses';
  END IF;

  -- Tenant derived from the ROWS, never from a parameter (§7.42).
  IF NOT is_tenant_admin(v_surv.tenant_id) THEN
    RAISE EXCEPTION 'only this business''s admin may merge two children';
  END IF;

  -- ⚠ RISK 4 — THE STRUCTURAL GUARD. DO NOT REMOVE OR "SIMPLIFY" THIS.
  --
  -- This function ends in a DELETE, so every CASCADING foreign key into
  -- students silently takes rows with it. The mitigation cannot be a list in
  -- a comment that someone remembers to update. It is this: ask the CATALOGUE
  -- what cascades, and REFUSE if anything has appeared that this function has
  -- not been taught to move. student_skill_progress (2026-08-28) is the newest
  -- table this guard caught — it failed the suite the moment the table landed.
  SELECT string_agg(conrelid::regclass::text, ', ')
    INTO v_unknown
    FROM pg_constraint
   WHERE confrelid = 'students'::regclass
     AND contype = 'f'
     AND confdeltype = 'c'
     AND conrelid::regclass::text NOT IN
         ('parent_students', 'student_settlements', 'trial_bookings',
          'student_claims', 'makeup_bookings', 'student_skill_progress');

  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION
      'merge_students has not been taught to move %, which now CASCADES from students. Teach it before merging, or the merge will destroy those rows.',
      v_unknown;
  END IF;

  -- ── Direction. Asserted, never inferred silently. ───────────────────────
  SELECT count(*)::INT INTO v_surv_att FROM attendance WHERE student_id = p_survivor_id;
  SELECT count(*)::INT INTO v_dup_att  FROM attendance WHERE student_id = p_duplicate_id;

  IF v_surv_att > 0 AND v_dup_att > 0 THEN
    RAISE EXCEPTION
      'Both children have lessons recorded (% and %). Merging would move attendance off a real record — this one needs to be sorted out by hand.',
      v_surv_att, v_dup_att;
  END IF;

  -- The survivor must be the row with the history. If the caller has them the
  -- wrong way round, REFUSE and say so rather than quietly swapping.
  IF v_dup_att > 0 THEN
    RAISE EXCEPTION
      'The child you marked as the duplicate is the one with % lessons recorded. Swap them: the record with the history must be the one that survives.',
      v_dup_att;
  END IF;

  IF EXISTS (SELECT 1 FROM invoice_items WHERE student_id = p_duplicate_id)
     OR EXISTS (SELECT 1 FROM credit_notes WHERE student_id = p_duplicate_id) THEN
    RAISE EXCEPTION
      'The duplicate record already appears on an invoice or credit note, so it cannot be deleted. Sort this one out by hand.';
  END IF;

  -- Counted before anything moves, so the invariant at the end is honest.
  SELECT count(*)::INT INTO v_ps_before FROM parent_students;
  SELECT count(*)::INT INTO v_tb_before FROM trial_bookings;
  SELECT count(*)::INT INTO v_mb_before FROM makeup_bookings;
  SELECT count(*)::INT INTO v_ss_before FROM student_settlements;
  SELECT count(*)::INT INTO v_sp_before FROM student_skill_progress;

  -- ── 1. The duplicate's better fields, ONLY where the survivor has none ──
  BEGIN
    UPDATE students
       SET date_of_birth = COALESCE(date_of_birth, v_dup.date_of_birth),
           gender        = COALESCE(gender,        v_dup.gender),
           notes         = COALESCE(notes,         v_dup.notes),
           level_id      = COALESCE(level_id,      v_dup.level_id),
           provisional_contact_name  = COALESCE(provisional_contact_name,  v_dup.provisional_contact_name),
           provisional_contact_phone = COALESCE(provisional_contact_phone, v_dup.provisional_contact_phone),
           provisional_contact_email = COALESCE(provisional_contact_email, v_dup.provisional_contact_email)
     WHERE id = p_survivor_id;
  EXCEPTION WHEN unique_violation THEN
    -- Filling the DOB can collide with a THIRD row of the same name and date.
    -- The merge is still correct; only the enrichment is impossible.
    NULL;
  END;

  -- ── 2. Parent links ─────────────────────────────────────────────────────
  WITH moved AS (
    UPDATE parent_students ps
       SET student_id = p_survivor_id
     WHERE ps.student_id = p_duplicate_id
       AND NOT EXISTS (
         SELECT 1 FROM parent_students x
          WHERE x.student_id = p_survivor_id AND x.parent_id = ps.parent_id
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_ps FROM moved;

  WITH dropped AS (
    DELETE FROM parent_students WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_ps FROM dropped;

  -- ── 3. Trial bookings ───────────────────────────────────────────────────
  WITH moved AS (
    UPDATE trial_bookings tb
       SET student_id = p_survivor_id
     WHERE tb.student_id = p_duplicate_id
       AND (
         tb.cancelled_at IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM trial_bookings x
            WHERE x.student_id = p_survivor_id
              AND x.class_id = tb.class_id
              AND x.session_date = tb.session_date
              AND x.cancelled_at IS NULL
         )
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_tb FROM moved;

  WITH dropped AS (
    DELETE FROM trial_bookings WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_tb FROM dropped;

  -- ── 3b. Make-up bookings — same live-slot rule as trials ────────────────
  WITH moved AS (
    UPDATE makeup_bookings mb
       SET student_id = p_survivor_id
     WHERE mb.student_id = p_duplicate_id
       AND (
         mb.cancelled_at IS NOT NULL
         OR NOT EXISTS (
           SELECT 1 FROM makeup_bookings x
            WHERE x.student_id = p_survivor_id
              AND x.class_id = mb.class_id
              AND x.session_date = mb.session_date
              AND x.cancelled_at IS NULL
         )
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_mb FROM moved;

  WITH dropped AS (
    DELETE FROM makeup_bookings WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_mb FROM dropped;

  -- ── 3c. Skill progress — collision key is UNIQUE (student_id, skill_id) ──
  -- A graded skill moves to the survivor unless the survivor already holds a
  -- grade on that skill; the survivor holds the history, so its grade wins and
  -- the duplicate's colliding row is dropped. The student_id repoint fires
  -- enforce_skill_progress_tenant (validation only — the grade is unchanged, so
  -- graded_by/graded_at are preserved, not re-stamped to the merging admin).
  WITH moved AS (
    UPDATE student_skill_progress sp
       SET student_id = p_survivor_id
     WHERE sp.student_id = p_duplicate_id
       AND NOT EXISTS (
         SELECT 1 FROM student_skill_progress x
          WHERE x.student_id = p_survivor_id AND x.skill_id = sp.skill_id
       )
    RETURNING 1
  ) SELECT count(*)::INT INTO v_sp FROM moved;

  WITH dropped AS (
    DELETE FROM student_skill_progress WHERE student_id = p_duplicate_id RETURNING 1
  ) SELECT count(*)::INT INTO v_drop_sp FROM dropped;

  v_drop := v_drop_ps + v_drop_tb + v_drop_mb + v_drop_sp;

  -- ── 4. Settlements — no unique constraint, so all of them move ──────────
  WITH moved AS (
    UPDATE student_settlements SET student_id = p_survivor_id
     WHERE student_id = p_duplicate_id
    RETURNING 1
  ) SELECT count(*)::INT INTO v_ss FROM moved;

  -- ── 5. Claims ───────────────────────────────────────────────────────────
  UPDATE student_claims sc
     SET status = 'declined', decided_at = NOW()
   WHERE sc.student_id = p_duplicate_id
     AND sc.status = 'pending'
     AND EXISTS (
       SELECT 1 FROM student_claims x
        WHERE x.student_id = p_survivor_id
          AND x.parent_id = sc.parent_id
          AND x.status = 'pending'
     );

  WITH moved AS (
    UPDATE student_claims SET student_id = p_survivor_id
     WHERE student_id = p_duplicate_id
    RETURNING 1
  ) SELECT count(*)::INT INTO v_cl FROM moved;

  -- ── 6. Enrolments. Safe to delete: the duplicate has no attendance. ─────
  DELETE FROM student_class_enrolments WHERE student_id = p_duplicate_id;

  -- ── 7. The record of what was destroyed, BEFORE destroying it ───────────
  INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  VALUES (
    v_surv.tenant_id, v_actor, 'students_merged', 'Student', p_survivor_id,
    to_jsonb(v_dup),
    jsonb_build_object(
      'survivor_id', p_survivor_id, 'duplicate_id', p_duplicate_id,
      'moved_parent_links', v_ps, 'moved_trial_bookings', v_tb,
      'moved_makeup_bookings', v_mb,
      'moved_settlements', v_ss, 'moved_claims', v_cl,
      'moved_skill_progress', v_sp
    )
  );

  DELETE FROM students WHERE id = p_duplicate_id;

  -- ── 8. THE INVARIANT: a merge MOVES rows, it never destroys them. ───────
  SELECT count(*)::INT INTO v_ps_after FROM parent_students;
  SELECT count(*)::INT INTO v_tb_after FROM trial_bookings;
  SELECT count(*)::INT INTO v_mb_after FROM makeup_bookings;
  SELECT count(*)::INT INTO v_ss_after FROM student_settlements;
  SELECT count(*)::INT INTO v_sp_after FROM student_skill_progress;

  IF v_ss_after <> v_ss_before THEN
    RAISE EXCEPTION
      'merge lost % settlement row(s) — rolling back. A settlement is recorded revenue.',
      v_ss_before - v_ss_after;
  END IF;

  IF v_ps_after + v_tb_after + v_mb_after + v_sp_after
     > v_ps_before + v_tb_before + v_mb_before + v_sp_before THEN
    RAISE EXCEPTION 'merge invented rows — rolling back';
  END IF;

  IF (v_ps_before + v_tb_before + v_mb_before + v_sp_before)
     - (v_ps_after + v_tb_after + v_mb_after + v_sp_after) <> v_drop THEN
    RAISE EXCEPTION
      'merge lost % row(s) beyond the % deliberate collision drop(s) — rolling back',
      (v_ps_before + v_tb_before + v_mb_before + v_sp_before)
        - (v_ps_after + v_tb_after + v_mb_after + v_sp_after) - v_drop, v_drop;
  END IF;

  RETURN QUERY SELECT v_ps, v_tb, v_mb, v_ss, v_cl, v_sp, v_drop;
END;
$function$;

CREATE OR REPLACE FUNCTION public.link_invited_parent(p_profile_id uuid, p_student_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor   UUID := auth.uid();
  v_tenant  UUID;
  v_parent  UUID;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- The tenant comes from the STUDENT, never from the caller's input — same
  -- rule as add_unclaimed_student, and for the same reason: this is SECURITY
  -- DEFINER, so pin_student_tenant() does not apply.
  SELECT s.tenant_id INTO v_tenant FROM students s WHERE s.id = p_student_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;

  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'only this business''s admin may link a parent to this child';
  END IF;

  SELECT p.id INTO v_parent FROM parents p WHERE p.profile_id = p_profile_id;
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'that account is not a parent account';
  END IF;

  -- Already linked to THIS parent: a no-op. An invite resent, or an admin
  -- clicking twice, must not error — nothing about the desired state differs.
  IF EXISTS (
    SELECT 1 FROM parent_students ps
     WHERE ps.student_id = p_student_id AND ps.parent_id = v_parent
  ) THEN
    RETURN;
  END IF;

  -- Linked to SOMEBODY ELSE: refuse. Adding a second parent to a family is a
  -- real future case (parent_students is many-to-many — see BACKLOG household
  -- split billing), but it is not what an invite does, and silently attaching
  -- a stranger to an existing family is the worst outcome available here.
  --
  -- The two cases are separated deliberately. Collapsing them into one "already
  -- has a parent" refusal makes the harmless case (re-inviting the same person)
  -- fail, and collapsing them the other way lets the dangerous one through.
  IF EXISTS (SELECT 1 FROM parent_students ps WHERE ps.student_id = p_student_id) THEN
    RAISE EXCEPTION 'that child is already linked to a different parent account';
  END IF;

  INSERT INTO parent_tenants (parent_id, tenant_id)
  VALUES (v_parent, v_tenant)
  ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key DO NOTHING;

  INSERT INTO parent_students (parent_id, student_id)
  VALUES (v_parent, p_student_id)
  ON CONFLICT (parent_id, student_id) DO NOTHING;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (
    v_actor, 'unclaimed_student_linked_to_parent', 'Student', p_student_id,
    jsonb_build_object('parent_id', v_parent, 'tenant_id', v_tenant)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.deactivate_class(p_class_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID;
  v_title  TEXT;
  v_active BOOLEAN;
  v_old    JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.tenant_id, c.title, c.is_active
    INTO v_tenant, v_title, v_active
    FROM classes c
   WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'not permitted to deactivate this class';
  END IF;

  -- Idempotent. Re-deactivating must not move deactivated_at: that date is what
  -- the engine expects lessons up to, and rewriting it would silently widen the
  -- expectation window on a class already retired.
  IF NOT v_active THEN
    RETURN;
  END IF;

  -- The three refusals, now shared with the raw-UPDATE trigger (§7.199).
  -- Called here so the refusal lands before the audit snapshot below, keeping
  -- this function's order and error messages exactly as they were.
  PERFORM assert_class_retirable(p_class_id);

  SELECT to_jsonb(c) INTO v_old FROM classes c WHERE c.id = p_class_id;

  UPDATE classes
     SET is_active      = FALSE,
         deactivated_at = NOW(),
         updated_at     = NOW()
   WHERE id = p_class_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (v_actor, 'class_deactivated', 'Class', p_class_id, v_old,
          (SELECT to_jsonb(c) FROM classes c WHERE c.id = p_class_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_class(p_class_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID;
  v_active BOOLEAN;
  v_old    JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT c.tenant_id, c.is_active
    INTO v_tenant, v_active
    FROM classes c
   WHERE c.id = p_class_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  IF NOT is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'not permitted to reactivate this class';
  END IF;

  IF v_active THEN
    RETURN;
  END IF;

  SELECT to_jsonb(c) INTO v_old FROM classes c WHERE c.id = p_class_id;

  UPDATE classes
     SET is_active      = TRUE,
         deactivated_at = NULL,
         updated_at     = NOW()
   WHERE id = p_class_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (v_actor, 'class_reactivated', 'Class', p_class_id, v_old,
          (SELECT to_jsonb(c) FROM classes c WHERE c.id = p_class_id));
END $function$;

CREATE OR REPLACE FUNCTION public.assign_class_shadow(p_class_id uuid, p_coach_id uuid, p_effective_from date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_from   DATE := COALESCE(p_effective_from, today_sg());
  v_id     UUID;
BEGIN
  v_tenant := class_tenant(p_class_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;
  IF NOT can_admin_tenant(v_tenant) THEN
    RAISE EXCEPTION 'not permitted to assign coaches for this business';
  END IF;

  IF v_from > today_sg() THEN
    RAISE EXCEPTION 'a shadow assignment cannot start in the future (got %)', v_from;
  END IF;

  -- ⚠ ALSO ENFORCED BY trg_class_shadow_guard, DELIBERATELY TWICE. This copy
  -- names the failure in the admin's own words; the trigger is what covers every
  -- caller that is not this function, including a direct PostgREST write, which
  -- is how this rule was measured to be bypassable.
  IF EXISTS (SELECT 1 FROM classes c
              WHERE c.id = p_class_id AND c.coach_id = p_coach_id) THEN
    RAISE EXCEPTION
      'that coach already teaches this class — they cannot also shadow it';
  END IF;

  -- The trigger enforces this too; this copy exists for the wording.
  PERFORM assert_payout_month_open(v_tenant, v_from, 'start a shadow assignment');

  INSERT INTO class_shadow_coaches
    (tenant_id, class_id, coach_id, effective_from, assigned_by)
  VALUES
    ('00000000-0000-0000-0000-000000000000', p_class_id, p_coach_id, v_from, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.end_class_shadow(p_class_id uuid, p_coach_id uuid, p_effective_to date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_to     DATE := COALESCE(p_effective_to, today_sg());
  v_from   DATE;
BEGIN
  v_tenant := class_tenant(p_class_id);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;
  IF NOT can_admin_tenant(v_tenant) THEN
    RAISE EXCEPTION 'not permitted to assign coaches for this business';
  END IF;

  SELECT s.effective_from INTO v_from
    FROM class_shadow_coaches s
   WHERE s.class_id = p_class_id AND s.coach_id = p_coach_id AND s.effective_to IS NULL;

  IF v_from IS NULL THEN
    RAISE EXCEPTION 'that coach is not currently shadowing this class';
  END IF;

  IF v_to < v_from THEN
    RAISE EXCEPTION
      'a shadow assignment cannot end (%) before it started (%)', v_to, v_from;
  END IF;

  -- Ending an assignment CHANGES PAY for every lesson after the end date, so it
  -- is sealed on exactly the same terms as starting one.
  PERFORM assert_payout_month_open(v_tenant, v_to, 'end a shadow assignment');

  UPDATE class_shadow_coaches
     SET effective_to = v_to, ended_by = auth.uid(), ended_at = NOW()
   WHERE class_id = p_class_id AND coach_id = p_coach_id AND effective_to IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_session_coach(p_class_id uuid, p_session_date date, p_coach_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session     UUID;
  v_terms_coach UUID;
BEGIN
  IF NOT can_admin_tenant(class_tenant(p_class_id)) THEN
    RAISE EXCEPTION 'not permitted to assign coaches for this business';
  END IF;

  -- The no-op guard (see header). class_rate_on() returns exactly one row for a
  -- date that has terms in force, and every class has terms from 2000-01-01.
  SELECT paid_coach_id INTO v_terms_coach
    FROM class_rate_on(p_class_id, p_session_date);
  IF v_terms_coach IS NOT NULL AND p_coach_id = v_terms_coach THEN
    RAISE EXCEPTION
      'that coach already teaches this lesson — a substitute must be a different '
      'coach (to go back to the class''s own coach, remove the substitute)';
  END IF;

  SELECT ls.id INTO v_session
    FROM lesson_sessions ls
   WHERE ls.class_id = p_class_id AND ls.session_date = p_session_date;

  IF v_session IS NULL THEN
    -- Refuse a date the class does not run on. A roster row against a
    -- fabricated date is a lesson that will be marked, paid and BILLED on a day
    -- the class never met. An existing row is honoured either way, because a
    -- rescheduled or extra lesson is legitimately off-pattern.
    PERFORM assert_class_runs_on(p_class_id, p_session_date);

    INSERT INTO lesson_sessions (class_id, session_date)
    VALUES (p_class_id, p_session_date)
    ON CONFLICT (class_id, session_date) DO NOTHING;

    SELECT ls.id INTO v_session
      FROM lesson_sessions ls
     WHERE ls.class_id = p_class_id AND ls.session_date = p_session_date;
  END IF;

  PERFORM set_session_main_coach(v_session, p_coach_id);

  RETURN v_session;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_session_main_coach(p_session_id uuid, p_coach_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT can_admin_tenant(session_tenant(p_session_id)) THEN
    RAISE EXCEPTION 'not permitted to assign coaches for this business';
  END IF;

  DELETE FROM session_coaches WHERE lesson_session_id = p_session_id;

  INSERT INTO session_coaches (tenant_id, lesson_session_id, coach_id, assigned_by)
  VALUES ('00000000-0000-0000-0000-000000000000', p_session_id, p_coach_id, auth.uid());
END;
$function$;

CREATE OR REPLACE FUNCTION public.disable_coach(p_coach_id uuid, p_replacement_coach_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_coach       coaches%ROWTYPE;
  v_owner       UUID;
  v_class       RECORD;
  v_price       NUMERIC;
  v_class_names TEXT;
  v_reassigned  UUID[] := '{}';
BEGIN
  SELECT * INTO v_coach FROM coaches WHERE id = p_coach_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such coach';
  END IF;

  IF NOT is_tenant_admin(v_coach.tenant_id) THEN
    RAISE EXCEPTION 'not permitted to manage coaches for this business';
  END IF;

  IF v_coach.disabled_at IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT t.owner_profile_id INTO v_owner
    FROM tenants t WHERE t.id = v_coach.tenant_id;
  IF v_coach.profile_id IS NOT DISTINCT FROM v_owner AND NOT EXISTS (
    SELECT 1 FROM coaches c
     WHERE c.tenant_id = v_coach.tenant_id
       AND c.id <> p_coach_id
       AND c.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'this is the owner''s coach account and the business''s only active '
      'coach — hire another coach before disabling it';
  END IF;

  IF p_replacement_coach_id IS NOT NULL THEN
    IF p_replacement_coach_id = p_coach_id THEN
      RAISE EXCEPTION 'a coach cannot be their own replacement';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM coaches c
       WHERE c.id = p_replacement_coach_id
         AND c.tenant_id = v_coach.tenant_id
         AND c.disabled_at IS NULL
    ) THEN
      RAISE EXCEPTION
        'the replacement must be an active coach of this business';
    END IF;
  END IF;

  SELECT string_agg(c.title, ', ' ORDER BY c.title) INTO v_class_names
    FROM classes c
   WHERE c.coach_id = p_coach_id AND c.is_active;
  IF v_class_names IS NOT NULL AND p_replacement_coach_id IS NULL THEN
    RAISE EXCEPTION
      'this coach still teaches: %. Choose a replacement coach — the classes '
      'are handed over and the coach disabled in one step.', v_class_names;
  END IF;

  FOR v_class IN
    SELECT c.* FROM classes c
     WHERE c.coach_id = p_coach_id AND c.is_active
     ORDER BY c.title
  LOOP
    SELECT r.price_per_lesson INTO v_price
      FROM class_rate_on(v_class.id, today_sg()) r;
    PERFORM set_class_terms(
      v_class.id,
      v_class.title,
      v_class.day_of_week,
      v_class.start_time,
      v_class.end_time,
      NULL,     -- p_location_name — free-text column dropped (contract), ignored
      COALESCE(v_price, v_class.price_per_lesson),
      p_replacement_coach_id,
      NULL,     -- effective from today
      FALSE,    -- a handover, never an in-place correction
      NULL,     -- p_location_address — dropped, ignored
      v_class.location_id   -- p_location_id: keep the class's location
    );
    v_reassigned := v_reassigned || v_class.id;
  END LOOP;

  UPDATE class_shadow_coaches
     SET effective_to = GREATEST(effective_from, today_sg()),
         ended_by     = auth.uid(),
         ended_at     = NOW()
   WHERE coach_id = p_coach_id AND effective_to IS NULL;

  DELETE FROM session_coaches sc
   USING lesson_sessions ls
   WHERE ls.id = sc.lesson_session_id
     AND sc.coach_id = p_coach_id
     AND ls.session_date > today_sg();

  UPDATE coaches SET disabled_at = NOW() WHERE id = p_coach_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (auth.uid(), 'coach_disabled', 'Coach', p_coach_id,
          jsonb_build_object('disabled_at', NULL),
          jsonb_build_object(
            'disabled_at',           NOW(),
            'replacement_coach_id',  p_replacement_coach_id,
            'classes_reassigned',    to_jsonb(v_reassigned)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_coach(p_coach_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_coach coaches%ROWTYPE;
BEGIN
  SELECT * INTO v_coach FROM coaches WHERE id = p_coach_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such coach';
  END IF;

  IF NOT is_tenant_admin(v_coach.tenant_id) THEN
    RAISE EXCEPTION 'not permitted to manage coaches for this business';
  END IF;

  IF v_coach.disabled_at IS NULL THEN
    RETURN; -- idempotent: already active, nothing to do, no audit row
  END IF;

  UPDATE coaches SET disabled_at = NULL WHERE id = p_coach_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value)
  VALUES (auth.uid(), 'coach_reactivated', 'Coach', p_coach_id,
          jsonb_build_object('disabled_at', v_coach.disabled_at),
          jsonb_build_object('disabled_at', NULL));
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_student_claims()
 RETURNS TABLE(id uuid, status text, certainty text, match_reason text, created_at timestamp with time zone, decided_at timestamp with time zone, claimed_name text, claimed_dob date, student_id uuid, student_name text, student_dob date, lessons integer, parent_id uuid, parent_name text, parent_email text, parent_phone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    sc.id,
    sc.status::TEXT,
    sc.certainty::TEXT,
    sc.match_reason,
    sc.created_at,
    sc.decided_at,
    sc.claimed_name,
    sc.claimed_dob,
    sc.student_id,
    s.full_name,
    s.date_of_birth,
    -- The number that makes a wrong approval expensive, so it belongs on the
    -- decision screen rather than a click away.
    (SELECT count(*)::INT FROM attendance a WHERE a.student_id = s.id),
    sc.parent_id,
    pr.full_name,
    pr.email,
    pr.phone
  FROM student_claims sc
  JOIN students s  ON s.id = sc.student_id
  JOIN parents p   ON p.id = sc.parent_id
  JOIN profiles pr ON pr.id = p.profile_id
  -- The whole boundary. Per claim, against that claim's own tenant.
  WHERE is_tenant_admin(sc.tenant_id)
  ORDER BY sc.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.find_roster_duplicates(p_tenant_id uuid, p_full_name text, p_phone text DEFAULT NULL::text, p_dob date DEFAULT NULL::date)
 RETURNS TABLE(student_id uuid, full_name text, parent_name text, is_active boolean, reason text, last_lesson date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone TEXT := normalize_phone(p_phone);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- RULE 1. The whole boundary. Refuse, do not return empty. False for a coach
  -- and for a foreign-tenant admin.
  IF NOT is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'not an admin of this business';
  END IF;

  RETURN QUERY
  WITH roster AS (
    -- RULE 2: this tenant only. Active AND inactive.
    SELECT s.id, s.full_name, s.date_of_birth, s.is_active,
           s.provisional_contact_phone
      FROM students s
     WHERE s.tenant_id = p_tenant_id
  ),
  -- Claiming parents of THIS tenant's students only (rule 2).
  parented AS (
    SELECT ps.student_id,
           pr.full_name              AS parent_name,
           normalize_phone(pr.phone) AS parent_phone
      FROM roster r
      JOIN parent_students ps ON ps.student_id = r.id
      JOIN parents         pa ON pa.id = ps.parent_id
      JOIN profiles        pr ON pr.id = pa.profile_id
  ),
  scored AS (
    SELECT r.id, r.full_name, r.is_active,
           (SELECT p.parent_name FROM parented p
             WHERE p.student_id = r.id
             ORDER BY p.parent_name LIMIT 1) AS parent_name,
           CASE
             -- Phone always wins, regardless of DOB. Either the child's own
             -- provisional contact number, or any claiming parent's account.
             WHEN v_phone IS NOT NULL AND (
                    normalize_phone(r.provisional_contact_phone) = v_phone
                    OR EXISTS (SELECT 1 FROM parented p
                                WHERE p.student_id = r.id
                                  AND p.parent_phone = v_phone)
                  )
               THEN 'phone'
             -- Name is the weaker signal, and a KNOWN different DOB kills it:
             -- two "Ethan Tan" born on different days are namesakes, not a dup.
             WHEN names_match(r.full_name, p_full_name)
              AND NOT (p_dob IS NOT NULL
                       AND r.date_of_birth IS NOT NULL
                       AND r.date_of_birth <> p_dob)
               THEN 'name'
             ELSE NULL
           END AS reason
      FROM roster r
  )
  SELECT
    sc.id,
    sc.full_name,
    sc.parent_name,
    sc.is_active,
    sc.reason,
    (SELECT max(ls.session_date)
       FROM attendance a
       JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
      WHERE a.student_id = sc.id)
  FROM scored sc
  WHERE sc.reason IS NOT NULL
  -- Strongest signal first, active before inactive, then name for stability.
  ORDER BY CASE sc.reason WHEN 'phone' THEN 1 ELSE 2 END,
           sc.is_active DESC,
           sc.full_name
  -- RULE 4.
  LIMIT 5;
END;
$function$;

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
     -- A cancelled lesson expects nobody enrolled (20260821000700).
     WHERE NOT EXISTS (
       SELECT 1 FROM lesson_sessions ls
        WHERE ls.class_id = cd.class_id
          AND ls.session_date = cd.session_date
          AND ls.cancelled_at IS NOT NULL
     )
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
$function$;

CREATE OR REPLACE FUNCTION public.unbilled_sealed_lessons(p_tenant uuid)
 RETURNS TABLE(student_id uuid, student_name text, billing_month text, lessons bigint, earliest_session_date date, latest_session_date date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (is_platform_admin() OR can_admin_tenant(p_tenant)) THEN
    RAISE EXCEPTION 'not authorised to read this business''s billing reports';
  END IF;

  RETURN QUERY
  SELECT
    a.student_id,
    s.full_name,
    to_char(ls.session_date, 'YYYY-MM'),
    count(*),
    min(ls.session_date),
    max(ls.session_date)
  FROM attendance a
  JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
  JOIN classes c          ON c.id = ls.class_id
  JOIN students s         ON s.id = a.student_id
  WHERE c.tenant_id = p_tenant
    -- The engine's own billability rule (core.ts BILLABLE, PRD §5.4).
    AND a.status IN ('present', 'trial_paid')
    -- Only months this tenant has SEALED. An unsealed month is not orphaned:
    -- its lessons hold the month open and bill normally.
    AND EXISTS (
      SELECT 1 FROM billing_periods bp
       WHERE bp.tenant_id = p_tenant
         AND bp.billing_month = to_char(ls.session_date, 'YYYY-MM'))
    -- Never billed: no invoice line for THIS student on THIS lesson.
    AND NOT EXISTS (
      SELECT 1 FROM invoice_items ii
       WHERE ii.student_id = a.student_id
         AND ii.lesson_session_id = a.lesson_session_id)
    -- Not already settled: same rule the engine applies to unclaimed
    -- attendance — a live settlement covers lessons ON OR BEFORE its date.
    AND NOT EXISTS (
      SELECT 1 FROM student_settlements ss
       WHERE ss.student_id = a.student_id
         AND ss.reversed_at IS NULL
         AND ss.settled_through >= ls.session_date)
  GROUP BY a.student_id, s.full_name, to_char(ls.session_date, 'YYYY-MM')
  ORDER BY to_char(ls.session_date, 'YYYY-MM'), s.full_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tenant_admin_has_member(p_parent_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT is_tenant_admin(current_tenant_id())
     AND EXISTS (
       SELECT 1 FROM parent_tenants
       WHERE parent_id = p_parent_id
         AND tenant_id = current_tenant_id()
     );
$function$;

CREATE OR REPLACE FUNCTION public.regenerate_join_code(p_tenant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code TEXT;
BEGIN
  IF NOT can_admin_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'not permitted to change this business''s join code';
  END IF;

  LOOP
    v_code := generate_join_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE join_code = v_code);
  END LOOP;

  UPDATE tenants SET join_code = v_code, updated_at = NOW() WHERE id = p_tenant_id;
  RETURN v_code;
END;
$function$;
