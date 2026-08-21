-- ============================================================
-- ADVANCE-CANCEL A LESSON (docs/plans/UPCOMING_LESSONS_COMPLETE_PLAN.md, Phase B, Step B1).
--
-- The admin cancels a WHOLE lesson (class + date) that has not happened yet —
-- rain forecast, coach away. A single child not coming is an ABSENCE, not this.
-- The parent's Upcoming view then shows the date struck "Cancelled", the coach
-- never sees a lesson to mark, and the billing engine neither expects nor bills it.
--
-- ── WHY A SESSION ROW, NOT A MARK ─────────────────────────────────────────────
-- The engine's completeness gate (core.ts) blocks a month for any expected
-- weekday with no session and no marks — no override, by design (CLAUDE.md).
-- Holidays satisfy the gate by writing a MARKED 'holiday' row per expected
-- child. That cannot work for an advance cancel: a child who enrols between
-- cancel-time and bill-time would have no row and re-block the month. So the
-- cancel is recorded ON THE SESSION (`cancelled_at`) and the gate learns that a
-- cancelled session expects nobody who is merely enrolled — see the engine
-- change (core.ts, Step B2) and the two SQL copies of "owed a mark" below.
--
-- ── ONE FLAG, TWO COLUMNS, KEPT COHERENT ──────────────────────────────────────
-- lesson_sessions has carried `status session_status` ('scheduled' | 'completed'
-- | 'cancelled') since the initial schema, written only as 'scheduled' by the
-- coach app's insert and read by one parent-app filter (`.neq("status",
-- "cancelled")`, Phase A). `cancelled_at` is the truth (same shape as
-- makeup_bookings / trial_bookings), and a CHECK ties `status = 'cancelled'` to
-- it so the two can never disagree — a reader of either column gets the same
-- answer. A client can write neither (guard_session_date, below).
--
-- ── THE RISK MITIGATIONS THIS FILE CARRIES (plan §B1) ─────────────────────────
--   RISK 2  advance means ADVANCE: cancel_lesson refuses p_date <= today_sg()
--           (§7.7 — never now()::date), refuses a session that already has
--           attendance rows (a marked lesson RAN), and restore_lesson refuses a
--           month already sealed in billing_periods (§11.6 — a lesson restored
--           into a sealed month can never bill) and a date below markable_floor
--           (could never be marked, so it would block for ever).
--   RISK 3  cancel-vs-booking race + stranded credit: cancel_lesson takes the
--           class row FOR UPDATE (the §7.198/§7.200 discipline) and refuses,
--           NAMING them, if live make-up / trial bookings sit on that date — the
--           admin moves the guests first, nobody's make-up credit is silently
--           voided. SYMMETRIC: book_makeup, book_trial and schedule_extra_lesson
--           refuse a cancelled (class, date) UNDER THEIR OWN LOCK.
--   RISK 4  the mark-refusal lives in guard_attendance_date(), not the UI: a new
--           attendance row on a cancelled session is refused by the trigger, so
--           a stale coach screen, a deep link or a raw PostgREST POST (§7.199's
--           lesson, on the attendance axis) cannot mark a cancelled lesson. The
--           coach app's B3 exclusion is cosmetic on top of this.
--
-- ── ALSO TOUCHED, SAME SIGNATURES (§7.123), ACLs re-asserted ──────────────────
--   class_unmarked_lesson_dates / tenant_unmarked_lesson_count — the SQL copies
--     of "owed a mark" (retire refusal 3, the Lessons badge): a cancelled session
--     expects only its live guests (there are none by construction), never the
--     enrolled — mirrors the engine exactly, or the badge would light for a
--     lesson nobody can mark and deactivate_class() would refuse over it.
--   mark_day_holiday / unmark_day_holiday — a cancelled session is already void:
--     the holiday void skips it, and the un-void's "delete the sessions I left
--     empty" must NOT delete a cancellation (it matched: off_schedule_reason
--     NULL, no attendance rows).
--   guard_session_date — a client may not set or clear the cancel columns.
--
-- Rollback: supabase/rollback/20260821000700_advance_cancel_lesson_DOWN.sql
-- (rehearsed — §7.93). Remote grant dump after deploy (§7.39, §7.89, plan RISK 7).
-- ============================================================


-- ── 1. Columns ──────────────────────────────────────────────────────────────

ALTER TABLE lesson_sessions
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by        UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

COMMENT ON COLUMN lesson_sessions.cancelled_at IS
  'Set when the admin cancelled this lesson IN ADVANCE (cancel_lesson). A cancelled session expects nobody enrolled — the engine neither blocks on it nor bills it; live guests are refused on it. NULL = the lesson is (or was) on. Written only by cancel_lesson()/restore_lesson(); clients cannot set or clear it.';
COMMENT ON COLUMN lesson_sessions.cancellation_reason IS
  'Why the admin cancelled the lesson — shown to the parent (Upcoming) and the coach. Required whenever cancelled_at is set.';

-- Nothing has ever written status <> 'scheduled' (the coach app inserts
-- 'scheduled'; no code path writes 'completed' or 'cancelled'). Said out loud
-- before the CHECK so a surprise on a real database reads as a sentence, not a
-- constraint-violation stack.
DO $$
DECLARE v_n INT;
BEGIN
  SELECT count(*) INTO v_n FROM lesson_sessions WHERE status = 'cancelled';
  IF v_n > 0 THEN
    RAISE EXCEPTION
      '% lesson_sessions row(s) already carry status=''cancelled'' with no cancelled_at — inspect them before applying (nothing in the product has ever written that value)', v_n;
  END IF;
END $$;

ALTER TABLE lesson_sessions
  ADD CONSTRAINT lesson_sessions_cancel_coherent
    CHECK ((cancelled_at IS NOT NULL) = (status = 'cancelled')),
  ADD CONSTRAINT lesson_sessions_cancel_has_reason
    CHECK (cancelled_at IS NULL OR cancellation_reason IS NOT NULL);


-- ── 2. cancel_lesson ────────────────────────────────────────────────────────
-- SECURITY DEFINER like schedule_extra_lesson: the tenant is DERIVED FROM THE
-- CLASS (§7.42), never a parameter, and the admin check is the gate.

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

COMMENT ON FUNCTION public.cancel_lesson(uuid, date, text) IS
  'Admin cancels a whole FUTURE lesson (class + date) in advance. Refuses today/past (the coach''s cancelled_rain/cancelled_coach mark is that path), a session with attendance rows, and a date holding live trial/make-up guests (named). Takes the class-row lock (§7.198/§7.200). Idempotent. Reverse with restore_lesson().';


-- ── 3. restore_lesson ───────────────────────────────────────────────────────

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

COMMENT ON FUNCTION public.restore_lesson(uuid, date) IS
  'Admin reverses cancel_lesson(). Refuses a month already sealed in billing_periods (§11.6) and a date below markable_floor(). The session row is kept; only the cancel columns are cleared.';


-- ── 4. guard_session_date: a client may not touch the cancel columns ───────
-- Verbatim 20260806000200 plus the two cancel-column branches, placed with the
-- off_schedule_reason ones (before the "UPDATE that does not move the date"
-- early return, or a raw UPDATE clearing cancelled_at would slip past it).
-- Still NOT SECURITY DEFINER (§7.38): its job is to tell a client from a
-- definer writer, and cancel_lesson()/restore_lesson() run as postgres.

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

  -- The cancel columns are written by cancel_lesson()/restore_lesson() only.
  -- A client setting them would self-authorise a cancellation; a client
  -- clearing them would restore a lesson past restore_lesson()'s sealed-month
  -- refusal. `status` rides along because the CHECK ties it to cancelled_at.
  IF TG_OP = 'INSERT'
     AND (NEW.cancelled_at IS NOT NULL
          OR NEW.cancelled_by IS NOT NULL
          OR NEW.cancellation_reason IS NOT NULL
          OR NEW.status = 'cancelled') THEN
    RAISE EXCEPTION
      'A lesson is cancelled or restored by your business''s admin, not recorded directly.';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
          OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
          OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason
          OR (NEW.status = 'cancelled') <> (OLD.status = 'cancelled')) THEN
    RAISE EXCEPTION
      'A lesson is cancelled or restored by your business''s admin, not recorded directly.';
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


-- ── 5. guard_attendance_date: RISK 4 — no NEW mark on a cancelled session ──
-- Verbatim 20260806000200 plus `cancelled_at` on the SELECT it already makes
-- and one refusal BEFORE assert_markable_date, so the message names the real
-- reason (a future cancelled lesson would otherwise read "has not happened
-- yet"). The correction carve-out above it is unchanged: a session with rows
-- cannot be cancelled (cancel_lesson refuses), so the carve-out and this
-- refusal never meet on a product path; if data ever put them together, a
-- correction to an existing row stays allowed — the credit-note flow must not
-- be closed by a flag.

CREATE OR REPLACE FUNCTION public.guard_attendance_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_date         DATE;
  v_tenant       UUID;
  v_cancelled_at TIMESTAMPTZ;
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

  SELECT ls.session_date, c.tenant_id, ls.cancelled_at
    INTO v_date, v_tenant, v_cancelled_at
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
   WHERE ls.id = NEW.lesson_session_id;

  -- No session means the FK is about to reject this anyway; raising here would
  -- replace a clear referential error with a confusing one about dates.
  IF v_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- A cancelled lesson takes no new marks (plan RISK 4). This is the
  -- load-bearing refusal — the coach app hiding the lesson is cosmetic. A raw
  -- POST, a deep link and a screen loaded before the cancel all land here.
  IF v_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION
      'That lesson (%) was cancelled by your business''s admin. Restore it on the admin panel before recording attendance.',
      to_char(v_date, 'DD Mon YYYY');
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


-- ── 6. The booking RPCs refuse a cancelled (class, date) UNDER THEIR LOCK ───
-- Both bodies are byte-identical to 20260821000400 except ONE block each,
-- inserted directly after the under-lock is_active re-check: a cancelled
-- session on that date refuses the booking. Under the lock, because
-- cancel_lesson() takes the same lock before it writes — so the check either
-- sees the cancel or runs before it, in which case cancel_lesson() sees the
-- guest and refuses. Same signatures (§7.123); ACLs survive CREATE OR REPLACE
-- and are re-asserted at the foot.

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


-- ── 7. schedule_extra_lesson: do not schedule OVER a cancellation ───────────
-- Verbatim 20260810000100 plus the class-row lock and one refusal before the
-- INSERT. Without it, ON CONFLICT DO NOTHING would quietly return the CANCELLED
-- session's id and the admin would believe an extra lesson had been scheduled.
-- Locked for the same reason as the booking RPCs: a cancel_lesson() committing
-- in the gap would otherwise be read as "scheduled".

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
END $$;


-- ── 8. The two SQL copies of "owed a mark": a cancelled session expects only its guests ──
-- The engine's rule after Step B2: on a cancelled date the expected set is the
-- live bookings ONLY (none exist by construction, but the shape is kept so the
-- three answers agree — §7.18). The enrolment arm gains one NOT EXISTS; the
-- booking arms are untouched. Everything else is verbatim.

CREATE OR REPLACE FUNCTION public.class_unmarked_lesson_dates(p_class_id UUID)
RETURNS DATE[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
     -- A cancelled lesson expects nobody enrolled (20260821000700).
     WHERE NOT EXISTS (
       SELECT 1 FROM lesson_sessions ls
        WHERE ls.class_id = p_class_id
          AND ls.session_date = cd.session_date
          AND ls.cancelled_at IS NOT NULL
     )
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
$$;

CREATE OR REPLACE FUNCTION public.tenant_unmarked_lesson_count(p_tenant uuid) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;


-- ── 9. The holiday void leaves a cancelled lesson alone ─────────────────────
-- mark_day_holiday: the `sessions` CTE skips a cancelled session (already void;
-- a holiday row on it would extend packages for a lesson that was never on).
-- The materialising INSERT … ON CONFLICT DO NOTHING already leaves it alone.
-- unmark_day_holiday: the "delete the sessions I left empty" DELETE must not
-- remove a cancellation — it matched one exactly (off_schedule_reason NULL, no
-- attendance). Both otherwise verbatim 20260818000900.

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


-- ── 10. Grants ──────────────────────────────────────────────────────────────
-- A new function is callable by NOBODY until its own migration grants it
-- (§7.87); PUBLIC is its own grantee and must be revoked separately (§7.35).
-- Only the two NEW signatures need spelling out — every CREATE OR REPLACE
-- above keeps its ACL — but the ones the apply-time probe re-checks are listed
-- so a reader sees the full intended surface in one place.

REVOKE ALL ON FUNCTION public.cancel_lesson(uuid, date, text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_lesson(uuid, date)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_lesson(uuid, date, text)  FROM anon, service_role;
REVOKE EXECUTE ON FUNCTION public.restore_lesson(uuid, date)       FROM anon, service_role;
GRANT  EXECUTE ON FUNCTION public.cancel_lesson(uuid, date, text)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.restore_lesson(uuid, date)       TO authenticated;


-- ── 11. Apply-time probes (§7.87, §7.123, §7.200) — RAISE, do not warn ──────
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'cancel_lesson'  AND pronamespace = 'public'::regnamespace) <> 1
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'restore_lesson' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'cancel_lesson/restore_lesson has a stray overload — PostgREST resolution is ambiguous (§7.124)';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.cancel_lesson(uuid,date,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.restore_lesson(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a cancel RPC lost EXECUTE for authenticated — the admin UI would fail with permission denied (§7.87)';
  END IF;
  IF has_function_privilege('anon', 'public.cancel_lesson(uuid,date,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.restore_lesson(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a cancel RPC is EXECUTE-able by anon — see §7.82';
  END IF;
  -- The replaced booking RPCs must still hold their lock + is_active re-check
  -- (§7.198/§7.200) AND the new cancelled check must sit UNDER the lock.
  IF pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure) NOT LIKE '%FROM classes WHERE id%FOR UPDATE%'
     OR pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure) NOT LIKE '%FROM classes WHERE id%FOR UPDATE%' THEN
    RAISE EXCEPTION 'a booking RPC lost its FOR UPDATE class-row lock (§7.198, §7.200)';
  END IF;
  IF pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure) NOT LIKE '%WHERE id = p_class_id AND is_active%'
     OR pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure) NOT LIKE '%WHERE id = p_class_id AND is_active%' THEN
    RAISE EXCEPTION 'a booking RPC lost its under-lock is_active re-check (§7.200)';
  END IF;
  IF strpos(pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure), 'FROM classes WHERE id = p_class_id FOR UPDATE')
       > strpos(pg_get_functiondef('public.book_makeup(uuid,date,uuid,uuid)'::regprocedure), 'ls.cancelled_at IS NOT NULL')
     OR strpos(pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure), 'FROM classes WHERE id = p_class_id FOR UPDATE')
       > strpos(pg_get_functiondef('public.book_trial(uuid,date,uuid)'::regprocedure), 'ls.cancelled_at IS NOT NULL') THEN
    RAISE EXCEPTION 'a booking RPC checks cancelled_at BEFORE taking the lock — the cancel-vs-booking race is open (plan RISK 3)';
  END IF;
  IF pg_get_functiondef('public.guard_attendance_date()'::regprocedure) NOT LIKE '%cancelled_at IS NOT NULL%' THEN
    RAISE EXCEPTION 'guard_attendance_date() does not refuse a cancelled session — plan RISK 4 is unmet';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lesson_sessions_cancel_coherent') THEN
    RAISE EXCEPTION 'lesson_sessions_cancel_coherent is missing — status and cancelled_at can drift';
  END IF;
END $$;
