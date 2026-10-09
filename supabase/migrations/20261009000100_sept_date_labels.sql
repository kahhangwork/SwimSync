-- ============================================================
-- Every date a DB message shows reads "Sept", not "Sep" — the way both apps do.
--
-- THE DRIFT (BACKLOG *The guard message says "Sep" where the apps say "Sept"*,
-- widened 2026-10-09). Postgres `to_char(…, 'Mon')` writes September as "Sep";
-- every app label is en-SG Intl, which writes "Sept" (§7.302's display split).
-- The backlog item named only guard_package_draw_order, but 13 functions build
-- a user-facing date this way — 31 calls — and the coach app is about to show
-- assert_markable_date's text verbatim too. Fixing one would leave the DB's own
-- messages disagreeing with each other. Decided 2026-10-09 (user): all 13.
--
-- Shape:
--   * ONE helper, sg_date_label(date, format) = to_char, with the standalone
--     word "Sep" widened to "Sept". Every other month and every format token is
--     untouched, so each call keeps its exact format ('DD Mon YYYY',
--     'FMDD Mon YYYY', 'FMDD Mon', 'Mon YYYY'). "September" (a 'Month' token)
--     is not a whole-word "Sep" and is left alone. NULL in → NULL out, as before.
--   * The 13 bodies are pg_get_functiondef() output read from the database on
--     2026-10-09 (§7.40), with only the 31 Mon-format to_char calls renamed.
--     Nothing else in any body changed — diff it against the rollback file.
--     The YYYY-MM to_char calls are billing-month KEYS, not display: untouched.
--   * Signatures, owners, SECURITY mode and ACLs are unchanged (CREATE OR
--     REPLACE keeps them).
--
-- Grants: assert_markable_date and guard_attendance_date are SECURITY INVOKER
-- and run as `authenticated`, so the helper needs EXECUTE for authenticated.
-- The other 11 are SECURITY DEFINER and reach it as the owner. No anon, no
-- service_role, no PUBLIC (function_grants.test.sql). After deploy, dump the
-- REMOTE grants and confirm anon has no EXECUTE (§7.39):
--   supabase db dump --linked --schema public -f /tmp/d.sql
--   grep 'sg_date_label' /tmp/d.sql | grep '"anon"'   # must print nothing
--
-- Rollback: supabase/rollback/20261009000100_sept_date_labels_DOWN.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.sg_date_label(p_date DATE, p_format TEXT)
RETURNS TEXT LANGUAGE SQL STABLE SET search_path = public AS $$
  SELECT regexp_replace(to_char(p_date, p_format), '\mSep\M', 'Sept', 'g');
$$;

REVOKE ALL ON FUNCTION public.sg_date_label(DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sg_date_label(DATE, TEXT) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.sg_date_label(DATE, TEXT) TO authenticated;

COMMENT ON FUNCTION public.sg_date_label(DATE, TEXT) IS
  'Display only: to_char(date, format) with September as "Sept", matching the apps'' en-SG labels. Use for any date inside a user-facing message. Never for a key or a comparison (billing_month stays to_char(…, ''YYYY-MM'')). 20261009000100.';

-- ── assert_class_retirable ──
CREATE OR REPLACE FUNCTION public.assert_class_retirable(p_class_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_title  TEXT;
  v_floor  DATE;
  v_names  TEXT;
  v_dates  DATE[];
BEGIN
  SELECT c.tenant_id, c.title
    INTO v_tenant, v_title
    FROM classes c
   WHERE c.id = p_class_id;

  -- No row (a DELETE, or a bad id): nothing to strand, nothing to assert.
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  v_floor := markable_floor(v_tenant);

  -- ── Refusal 1: children still enrolled ───────────────────────────────────
  -- NOT `WHERE is_active` (§7.66 — that is a point-in-time flag, not a span).
  -- An enrolment closed YESTERDAY still has lessons this month that need marks,
  -- and retiring the class hides them.
  SELECT string_agg(DISTINCT s.full_name, ', ' ORDER BY s.full_name)
    INTO v_names
    FROM student_class_enrolments e
    JOIN students s ON s.id = e.student_id
   WHERE e.class_id = p_class_id
     AND (e.unenrolled_at IS NULL
          OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= v_floor);

  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION
      '% still has children on its roster: %. Remove each of them from the class first (Students → Remove from class), which records the date they left. Nothing is closed for you — the leave date decides what they are billed.',
      v_title, v_names;
  END IF;

  -- ── Refusal 2: guests booked into a lesson that has not happened ─────────
  -- Both booking tables. book_makeup() already refuses an inactive host class,
  -- but nothing guarded retiring a class that ALREADY holds bookings — the
  -- guest is expected there and nowhere else.
  SELECT string_agg(b.label, ', ' ORDER BY b.label)
    INTO v_names
    FROM (
      SELECT s.full_name || ' on ' || sg_date_label(tb.session_date, 'DD Mon YYYY') AS label
        FROM trial_bookings tb
        JOIN students s ON s.id = tb.student_id
       WHERE tb.class_id = p_class_id
         AND tb.cancelled_at IS NULL
         AND tb.session_date >= today_sg()
      UNION ALL
      SELECT s.full_name || ' on ' || sg_date_label(mb.session_date, 'DD Mon YYYY')
        FROM makeup_bookings mb
        JOIN students s ON s.id = mb.student_id
       WHERE mb.class_id = p_class_id
         AND mb.cancelled_at IS NULL
         AND mb.session_date >= today_sg()
    ) b;

  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION
      '% has guests booked into lessons that have not happened yet: %. Cancel those bookings first, or wait until the lessons have been taught and marked.',
      v_title, v_names;
  END IF;

  -- ── Refusal 3: lessons still owed a mark ─────────────────────────────────
  -- The structural one. Without it the deadlock is reachable by an admin doing
  -- nothing unreasonable: retire a class mid-month with last week unmarked, and
  -- the month blocks on a lesson the coach can no longer see.
  v_dates := class_unmarked_lesson_dates(p_class_id);

  IF array_length(v_dates, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      '% has lessons still waiting to be marked: %. Mark them before retiring the class — an unmarked lesson blocks the whole month from being billed, with no override, and an inactive class disappears from the coach''s screens.',
      v_title,
      (SELECT string_agg(sg_date_label(d, 'DD Mon YYYY'), ', ' ORDER BY d)
         FROM unnest(v_dates) AS d);
  END IF;
END;
$function$

;

-- ── assert_class_runs_on ──
CREATE OR REPLACE FUNCTION public.assert_class_runs_on(p_class_id uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      v_title, v_class_day, sg_date_label(p_date, 'DD Mon YYYY'), v_date_day;
  END IF;
END $function$

;

-- ── assert_markable_date ──
CREATE OR REPLACE FUNCTION public.assert_markable_date(p_date date, p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_floor DATE := markable_floor(p_tenant_id);
  v_today DATE := today_sg();
BEGIN
  IF p_date < v_floor THEN
    RAISE EXCEPTION
      'That lesson (%) is closed. Attendance can be marked back to %; an earlier lesson sits behind an invoice already sent, so it needs a credit note rather than a late mark.',
      sg_date_label(p_date, 'DD Mon YYYY'), sg_date_label(v_floor, 'DD Mon YYYY');
  END IF;

  IF p_date > v_today THEN
    RAISE EXCEPTION
      'That lesson (%) has not happened yet — attendance cannot be marked ahead of time.',
      sg_date_label(p_date, 'DD Mon YYYY');
  END IF;
END $function$

;

-- ── book_makeup ──
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
  IF NOT has_admin_area(v_tenant, 'operations', 'edit') THEN
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
      v_class_title, v_class_day, sg_date_label(p_session_date, 'DD Mon YYYY');
  END IF;

  -- ── Floor: never into an already-billed month ────────────────────────────
  -- A booking below the attendance window can neither be marked nor bill — it
  -- would be silently lost. Future dates are allowed, no ceiling: the picker's
  -- window is an affordance, this is the guard.
  IF p_session_date < markable_floor(v_tenant) THEN
    RAISE EXCEPTION
      'A make-up cannot be booked before % — that month has been billed.',
      sg_date_label(markable_floor(v_tenant), 'DD Mon YYYY');
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
      v_class_title, sg_date_label(p_session_date, 'DD Mon YYYY');
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
      v_class_title, sg_date_label(p_session_date, 'DD Mon YYYY'),
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

-- ── book_trial ──
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
  IF NOT has_admin_area(v_tenant, 'operations', 'edit') THEN
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
      sg_date_label(markable_floor(v_tenant), 'DD Mon YYYY');
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
      sg_date_label(p_session_date, 'DD Mon YYYY'),
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
      v_class_title, sg_date_label(p_session_date, 'DD Mon YYYY');
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
      v_class_title, sg_date_label(p_session_date, 'DD Mon YYYY'),
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

-- ── cancel_lesson ──
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
  IF NOT has_admin_area(v_tenant, 'operations', 'edit') THEN
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
      sg_date_label(p_date, 'DD Mon YYYY');
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
      v_title, sg_date_label(p_date, 'DD Mon YYYY');
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
      v_title, sg_date_label(p_date, 'DD Mon YYYY'), v_guests;
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
$function$

;

-- ── enrolment_start_at ──
CREATE OR REPLACE FUNCTION public.enrolment_start_at(p_tenant_id uuid, p_starts_on date)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today DATE := today_sg();
  v_floor DATE := markable_floor(p_tenant_id);
BEGIN
  IF p_starts_on IS NULL OR p_starts_on = v_today THEN
    RETURN app_now();
  END IF;

  -- D6: a future start is a different feature.
  IF p_starts_on > v_today THEN
    RAISE EXCEPTION 'A class can''t start in the future — pick today or an earlier date.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- D3: earlier than the floor is unmarkable anyway.
  IF p_starts_on < v_floor THEN
    RAISE EXCEPTION 'The earliest start date allowed is %.', sg_date_label(v_floor, 'FMDD Mon YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  -- D10: 12:00 Singapore — the UTC date and the SGT date are the same day.
  RETURN (p_starts_on + TIME '12:00') AT TIME ZONE 'Asia/Singapore';
END;
$function$

;

-- ── guard_attendance_date ──
CREATE OR REPLACE FUNCTION public.guard_attendance_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
      sg_date_label(v_date, 'DD Mon YYYY');
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

-- ── guard_package_draw_order ──
CREATE OR REPLACE FUNCTION public.guard_package_draw_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant     UUID;
  v_date       DATE;
  v_pkg        RECORD;
  v_left_now   INTEGER;
  v_left_after INTEGER;
  v_found      INTEGER := 0;
  v_first_date DATE;
  v_first_kid  TEXT;
  v_first_cls  TEXT;
  v_refuse     BOOLEAN := false;
BEGIN
  IF NEW.status NOT IN ('present', 'trial_paid') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM attendance a
                WHERE a.lesson_session_id = NEW.lesson_session_id AND a.student_id = NEW.student_id) THEN
      RETURN NEW;
    END IF;
  ELSIF OLD.status IN ('present', 'trial_paid') THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT c.tenant_id, ls.session_date INTO v_tenant, v_date
      FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
     WHERE ls.id = NEW.lesson_session_id;
    IF NOT COALESCE((SELECT t.package_draw_at_marking FROM tenants t WHERE t.id = v_tenant), false) THEN
      RETURN NEW;
    END IF;

    SELECT pp.id, pp.parent_id, pp.category_id, pp.start_date, pp.expires_on,
           pp.rate_per_lesson, pp.value_remaining
      INTO v_pkg
      FROM package_candidates_for(NEW.lesson_session_id, NEW.student_id) c
      JOIN parent_packages pp ON pp.id = c.package_id
     WHERE c.value_remaining >= c.rate
     ORDER BY c.expires_on, c.confirmed_at, c.package_id
     LIMIT 1;
    IF v_pkg.id IS NULL THEN
      RETURN NEW;                                   -- nothing would draw: ad-hoc, no claim to protect
    END IF;

    v_left_now   := floor(v_pkg.value_remaining / v_pkg.rate_per_lesson)::INTEGER;
    v_left_after := v_left_now - 1;

    -- Earlier unmarked (date, child) pairs this package would also cover. Stops at left_after + 1. The
    -- earliest one is named in the message FROM THE SAME ROWS — a separate lookup would name a lesson the
    -- filters excluded (caught by pgTAP case 19).
    SELECT count(*),
           (array_agg(q.session_date ORDER BY q.session_date, q.full_name, q.title))[1],
           (array_agg(q.full_name    ORDER BY q.session_date, q.full_name, q.title))[1],
           (array_agg(q.title        ORDER BY q.session_date, q.full_name, q.title))[1]
      INTO v_found, v_first_date, v_first_kid, v_first_cls
      FROM (
        SELECT p.session_date, s.full_name, c.title
          FROM classes c
          CROSS JOIN LATERAL class_unmarked_lesson_pairs(c.id) p
          JOIN students s ON s.id = p.student_id
         WHERE c.tenant_id = v_tenant
           -- RISK 10: only classes the family is in (enrolled or booked) — never every class of the business.
           AND (EXISTS (SELECT 1 FROM student_class_enrolments e JOIN parent_students ps ON ps.student_id = e.student_id
                         WHERE e.class_id = c.id AND ps.parent_id = v_pkg.parent_id)
                OR EXISTS (SELECT 1 FROM makeup_bookings mb JOIN parent_students ps ON ps.student_id = mb.student_id
                            WHERE mb.class_id = c.id AND ps.parent_id = v_pkg.parent_id AND mb.cancelled_at IS NULL)
                OR EXISTS (SELECT 1 FROM trial_bookings tb JOIN parent_students ps ON ps.student_id = tb.student_id
                            WHERE tb.class_id = c.id AND ps.parent_id = v_pkg.parent_id AND tb.cancelled_at IS NULL))
           AND (c.deactivated_at IS NULL
                OR p.session_date <= (c.deactivated_at AT TIME ZONE 'Asia/Singapore')::date)
           AND EXISTS (SELECT 1 FROM parent_students ps
                        WHERE ps.student_id = p.student_id AND ps.parent_id = v_pkg.parent_id)
           AND p.session_date <  v_date
           AND p.session_date >= markable_floor(v_tenant)
           AND p.session_date >= v_pkg.start_date
           AND p.session_date <= v_pkg.expires_on
           AND NOT EXISTS (SELECT 1 FROM lesson_sessions lx
                            WHERE lx.class_id = c.id AND lx.session_date = p.session_date
                              AND lx.cancelled_at IS NOT NULL)
           AND (v_pkg.category_id IS NULL
                OR v_pkg.category_id = COALESCE(
                     (SELECT mb.category_id FROM makeup_bookings mb
                       WHERE mb.student_id = p.student_id AND mb.class_id = c.id
                         AND mb.session_date = p.session_date AND mb.cancelled_at IS NULL
                       ORDER BY mb.booked_at LIMIT 1),
                     c.category_id))
         ORDER BY p.session_date, s.full_name, c.title
         LIMIT v_left_after + 1
      ) q;

    v_refuse := v_found > v_left_after;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'guard_package_draw_order failed open for lesson % student %: % (%)',
      NEW.lesson_session_id, NEW.student_id, SQLERRM, SQLSTATE;
    RETURN NEW;
  END;

  IF v_refuse THEN
    RAISE EXCEPTION '%', format(
      'Mark %s first — the package has %s lesson%s left. (%s · %s) Nothing was saved.',
      sg_date_label(v_first_date, 'FMDD Mon'), v_left_now, CASE WHEN v_left_now = 1 THEN '' ELSE 's' END,
      COALESCE(v_first_kid, 'a sibling'), COALESCE(v_first_cls, 'another class'))
      USING ERRCODE = 'PK001';
  END IF;
  RETURN NEW;
END;
$function$

;

-- ── record_package_refund ──
CREATE OR REPLACE FUNCTION public.record_package_refund(p_package uuid, p_amount numeric, p_refunded_on date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pp        parent_packages%ROWTYPE;
  v_paid_on   DATE;
  v_id        UUID;
  v_note      TEXT := NULLIF(btrim(p_note), '');
BEGIN
  -- Lock the package first: a double-click or two admins collapse to one refund.
  SELECT * INTO v_pp FROM parent_packages WHERE id = p_package FOR UPDATE;
  IF v_pp.id IS NULL THEN
    RAISE EXCEPTION 'That package could not be found.';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(v_pp.tenant_id, 'packages'::admin_area, 'edit'::admin_level)) THEN
    RAISE EXCEPTION 'Your role cannot record refunds for this business.';
  END IF;

  IF v_pp.status <> 'cancelled' OR v_pp.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Only a cancelled package that was paid for can be refunded.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter a refund amount above S$0.';
  END IF;
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'A refund amount can have at most two decimal places.';
  END IF;
  IF p_amount > v_pp.amount_payable THEN
    RAISE EXCEPTION 'A refund cannot be more than the family paid (S$%).', to_char(v_pp.amount_payable, 'FM999999990.00');
  END IF;

  -- Dates in SGT (§7.7/§7.227): today_sg(), and the confirmation instant read in Asia/Singapore.
  v_paid_on := (v_pp.confirmed_at AT TIME ZONE 'Asia/Singapore')::date;
  IF p_refunded_on IS NULL THEN
    RAISE EXCEPTION 'Choose the date the refund was paid.';
  END IF;
  IF p_refunded_on > today_sg() THEN
    RAISE EXCEPTION 'A refund cannot be dated in the future.';
  END IF;
  IF p_refunded_on < v_paid_on THEN
    RAISE EXCEPTION 'A refund cannot be dated before the package was paid (%).', sg_date_label(v_paid_on, 'FMDD Mon YYYY');
  END IF;
  IF EXISTS (SELECT 1 FROM billing_periods bp
              WHERE bp.tenant_id = v_pp.tenant_id
                AND bp.billing_month = to_char(p_refunded_on, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'That month is closed — refunds can only be dated in an open month.';
  END IF;

  IF EXISTS (SELECT 1 FROM package_refunds pr WHERE pr.parent_package_id = v_pp.id AND pr.reversed_at IS NULL) THEN
    RAISE EXCEPTION 'This package already has a refund recorded. Reverse it first to record a different one.';
  END IF;

  INSERT INTO package_refunds (tenant_id, parent_package_id, amount, refunded_on, note, recorded_by)
  VALUES (v_pp.tenant_id, v_pp.id, p_amount, p_refunded_on, v_note, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), 'package_refund', 'parent_package', v_pp.id,
          jsonb_build_object('refund_id', v_id, 'amount', p_amount, 'refunded_on', p_refunded_on, 'note', v_note));

  RETURN v_id;
END;
$function$

;

-- ── restore_lesson ──
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

  IF NOT has_admin_area(v_tenant, 'operations', 'edit') THEN
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
      v_title, sg_date_label(p_date, 'DD Mon YYYY');
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
      sg_date_label(p_date, 'Mon YYYY');
  END IF;

  -- ── …nor below the marking floor ──────────────────────────────────────────
  -- Below the floor nobody can record attendance (assert_markable_date), so a
  -- restored lesson there is expected, unmarkable, and blocks its month with no
  -- override and no screen able to clear it (§7.109's shape).
  v_floor := markable_floor(v_tenant);
  IF p_date < v_floor THEN
    RAISE EXCEPTION
      'That lesson (%) cannot be restored — attendance can only be recorded back to %, so it could never be marked or billed.',
      sg_date_label(p_date, 'DD Mon YYYY'), sg_date_label(v_floor, 'DD Mon YYYY');
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
$function$

;

-- ── schedule_extra_lesson ──
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

  IF NOT has_admin_area(v_tenant, 'operations', 'edit') THEN
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
      sg_date_label(markable_floor(v_tenant), 'DD Mon YYYY');
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
      v_title, sg_date_label(p_date, 'DD Mon YYYY');
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

-- ── set_enrolment_start ──
CREATE OR REPLACE FUNCTION public.set_enrolment_start(p_student_id uuid, p_class_id uuid, p_starts_on date, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor      UUID := auth.uid();
  v_tenant     UUID;
  v_class      TEXT;
  v_day        TEXT;
  v_stu_tenant UUID;
  v_child      TEXT;
  v_start      DATE := COALESCE(p_starts_on, today_sg());
  v_row        student_class_enrolments%ROWTYPE;
  v_old_start  DATE;
  v_prev_end   DATE;
  v_marked     DATE;
  v_dropped    DATE[] := '{}';
  v_old        JSONB;
  v_new        JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- ⚠ RISK 2: the mode is EXPLICIT. Never "a row exists, so edit" — that turns a
  -- duplicate Add into a silent start-date rewrite.
  IF p_mode IS NULL OR p_mode NOT IN ('add', 'change') THEN
    RAISE EXCEPTION 'mode must be add or change';
  END IF;

  -- ⚠ RISK 4: SECURITY DEFINER, so RLS does not run here — this IS the check.
  -- The tenant comes from the CLASS. No coach arm: every child is added by the
  -- admin (§7.202) — unlike close_student_enrolment, which admits the coach.
  SELECT c.tenant_id, c.title, c.day_of_week::text
    INTO v_tenant, v_class, v_day
    FROM classes c
   WHERE c.id = p_class_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  IF NOT (is_platform_admin() OR has_admin_area(v_tenant, 'operations', 'edit')) THEN
    RAISE EXCEPTION 'not permitted to change this child''s classes';
  END IF;

  SELECT s.tenant_id, s.full_name INTO v_stu_tenant, v_child
    FROM students s WHERE s.id = p_student_id;
  IF v_stu_tenant IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;
  IF v_stu_tenant <> v_tenant THEN
    RAISE EXCEPTION 'that child belongs to a different business';
  END IF;

  SELECT * INTO v_row
    FROM student_class_enrolments e
   WHERE e.student_id = p_student_id
     AND e.class_id   = p_class_id
     AND e.is_active
     FOR UPDATE;

  -- D8 (corrected, RISK 7): not BEFORE the previous window's end. EQUAL is allowed —
  -- the two windows share a day, which every span reader de-duplicates, and refusing
  -- it would break today's same-day remove → re-add.
  SELECT max((e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date)
    INTO v_prev_end
    FROM student_class_enrolments e
   WHERE e.student_id = p_student_id
     AND e.class_id   = p_class_id
     AND NOT e.is_active
     AND e.unenrolled_at IS NOT NULL;
  IF v_prev_end IS NOT NULL AND v_start < v_prev_end THEN
    RAISE EXCEPTION '% was last in % until % — the new start can''t be earlier than that.',
      v_child, v_class, sg_date_label(v_prev_end, 'FMDD Mon YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_mode = 'add' THEN
    IF v_row.id IS NOT NULL THEN
      RAISE EXCEPTION '% is already in % (since %). To change when they started, use Change on the class roster.',
        v_child, v_class,
        sg_date_label((v_row.enrolled_at AT TIME ZONE 'Asia/Singapore')::date, 'FMDD Mon YYYY')
        USING ERRCODE = 'unique_violation';
    END IF;

    INSERT INTO student_class_enrolments (student_id, class_id, enrolled_at)
    VALUES (p_student_id, p_class_id, enrolment_start_at(v_tenant, p_starts_on))
    RETURNING * INTO v_row;

    -- Only ever TOWARD assigned (close_student_enrolment owns the other way).
    UPDATE students
       SET assignment_status = 'assigned', updated_at = NOW()
     WHERE id = p_student_id
       AND assignment_status <> 'assigned';

    v_new := to_jsonb(v_row);
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_value, new_value)
    VALUES (v_actor, 'enrolment_added', 'Student', p_student_id, NULL, v_new);

  ELSE  -- 'change'
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION '% is not in %.', v_child, v_class;
    END IF;

    v_old_start := (v_row.enrolled_at AT TIME ZONE 'Asia/Singapore')::date;
    v_old := to_jsonb(v_row);

    IF v_start > v_old_start THEN
      -- D7: a later start may not strand a lesson that was already marked.
      SELECT min(ls.session_date) INTO v_marked
        FROM attendance a
        JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
       WHERE a.student_id = p_student_id
         AND ls.class_id = p_class_id
         AND ls.session_date >= v_old_start
         AND ls.session_date <  v_start;
      IF v_marked IS NOT NULL THEN
        RAISE EXCEPTION '% already has a mark on % — the start can''t move past a marked lesson.',
          v_child, sg_date_label(v_marked, 'FMDD Mon YYYY')
          USING ERRCODE = 'check_violation';
      END IF;

      -- ⚠ RISK 6: a later start is NOT a way to clear the unmarked block. Record
      -- exactly which expected lessons stop being expected.
      SELECT COALESCE(array_agg(d ORDER BY d), '{}') INTO v_dropped
        FROM (
          SELECT g::date AS d
            FROM generate_series(v_old_start, v_start - 1, INTERVAL '1 day') g
           WHERE (ARRAY['sunday','monday','tuesday','wednesday','thursday',
                        'friday','saturday'])[EXTRACT(DOW FROM g)::int + 1] = v_day
          UNION
          SELECT ls.session_date
            FROM lesson_sessions ls
           WHERE ls.class_id = p_class_id
             AND ls.session_date >= v_old_start
             AND ls.session_date <  v_start
        ) x
       WHERE NOT EXISTS (
         SELECT 1 FROM lesson_sessions ls
          WHERE ls.class_id = p_class_id
            AND ls.session_date = x.d
            AND ls.cancelled_at IS NOT NULL
       );
    END IF;

    UPDATE student_class_enrolments
       SET enrolled_at = enrolment_start_at(v_tenant, p_starts_on)
     WHERE id = v_row.id
    RETURNING * INTO v_row;

    v_new := to_jsonb(v_row) || jsonb_build_object('dropped_dates', to_jsonb(v_dropped));
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_value, new_value)
    VALUES (v_actor, 'enrolment_start_changed', 'Student', p_student_id, v_old, v_new);
  END IF;

  RETURN jsonb_build_object(
    'enrolment_id',    v_row.id,
    'starts_on',       (v_row.enrolled_at AT TIME ZONE 'Asia/Singapore')::date,
    'in_sealed_month', EXISTS (
      SELECT 1 FROM billing_periods bp
       WHERE bp.tenant_id = v_tenant
         AND bp.billing_month >= to_char(v_start, 'YYYY-MM')
    )
  );
END;
$function$

;

