-- ============================================================
-- Retiring a class, and what `classes.is_active` is allowed to mean.
--
-- Wave 1 item #6 (docs/plans/WAVE_1_PLAN.md, Chunk 4). Two halves that MUST
-- ship together:
--
--   1. The invoice engine stops filtering on `is_active` (core.ts). A class
--      retired at month end used to drop its already-taught lessons out of the
--      run silently — a hole exactly where someone is tidying up.
--   2. This migration: the RPCs that retire and un-retire a class, which is
--      what makes (1) load-bearing. No UI deactivates a class today, which is
--      the only reason this has never bitten.
--
-- From here `is_active` means SCHEDULING, never billing.
--
-- ── THE RISK THIS FILE EXISTS TO CONTAIN ────────────────────────────────────
-- `core.ts`'s class scan does not only decide what gets TALLIED; it decides
-- which classes enter the COMPLETENESS GATE. Widen it naively and an inactive
-- class with a live enrolment and no recorded sessions expects a lesson on
-- every weekly date, finds nobody marked, and blocks the whole month. There is
-- no override on that block by design (§8a), and the class is invisible to
-- every role who could clear it — the coach class list, the coach Schedule tab
-- and the admin Classes page all filter `is_active`. That is §8.32's deadlock
-- reached along a VISIBILITY axis instead of a date axis, so markable_floor()
-- does not rescue it: that is a date gate, and the obstruction is visibility.
--
-- It is closed three times over, deliberately, because the failure is a whole
-- business unbilled for a month:
--   * `classes.deactivated_at` (below) lets the engine keep expecting lessons
--     up to the day the class stopped running and none after it — so the
--     unclearable expectation is never generated.
--   * `deactivate_class()` refuses to retire a class that still owes marks, so
--     the state cannot be entered from the product at all.
--   * The admin Classes page gains a "show inactive" affordance in the SAME
--     deploy, so `reactivate_class()` always has a screen to be called from.
--
-- ── NO GRANT IN THIS FILE, AND THAT IS THE FEATURE FLAG ─────────────────────
-- §7.87: a function is callable by NOBODY until its own migration grants it.
-- Between this migration and the engine deploy, the OLD engine is still live —
-- and a deactivation in that window would silently drop that class's billable
-- lessons from the month against the old `.eq("is_active", true)` scan. That is
-- a PERMANENT underbill (§7.8/§7.13/§7.32) and sealing is irreversible, so
-- there would be nothing to unwind afterwards. The `GRANT` therefore lives in
-- its own separately-numbered migration (20260809000400) pushed only after
-- `supabase functions list` confirms the new engine. Do NOT merge the two
-- files: `supabase db push` applies everything pending, so two files pushed
-- together are one deploy and the ordering written down did not happen
-- (§7.49, §7.30).
-- ============================================================


-- ── 1. WHEN a class stopped being schedulable ───────────────────────────────
-- A bare boolean cannot answer "was this class running on the 13th?", and that
-- is the question the engine's expected-dates half has to ask. A class retired
-- on the 20th still owes marks for the 6th and the 13th; one retired before
-- this column existed owes nothing, because nothing is known about when it
-- stopped — see the three cases spelled out in core.ts.
--
-- Written ONLY by the two RPCs below. Nothing backfills it: production has
-- zero inactive classes (audited 2026-08-09, all three RISK 1/7 queries
-- returned zero), so every existing row is correctly NULL.

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

COMMENT ON COLUMN classes.deactivated_at IS
  'When this class stopped being schedulable. NULL while active, and also NULL for a class made inactive before deactivate_class() existed — the invoice engine treats that second case as "expects no lessons at all", the conservative side of the RISK 1 deadlock. Written only by deactivate_class()/reactivate_class().';


-- ── 2. Lessons this class still owes marks for ──────────────────────────────
-- The refusal in deactivate_class() below is a DESTRUCTIVE-ACTION guard, not a
-- display filter (§7.69): what it protects is a billing month, so it must read
-- what the ENGINE reads, not what a screen shows.
--
-- Extracted as its own function rather than inlined, on purpose. §7.18: four
-- hand-written copies of "who was expected at this lesson" caused a live
-- underbill. There is exactly ONE copy of this union in SQL — this one — and
-- `class_deactivation.test.sql` tests it directly.
--
-- It is allowed to diverge from attendanceCompleteness.ts in exactly one
-- direction: toward naming MORE dates. An over-strict guard refuses a
-- deactivation the admin wanted, which is a nuisance; an under-strict one lets
-- a month become unbillable, which is not recoverable.
--
-- Both halves of "expected" are here:
--   * enrolments, by SPAN — not `is_active`. §7.66:
--     one_active_enrolment_per_student is a PARTIAL unique index, so is_active
--     is a point-in-time flag and not a span. A child unenrolled yesterday was
--     still expected at last week's lesson.
--   * uncancelled trial and make-up bookings, which expect a guest at exactly
--     one lesson and block the month like anyone else.
--
-- Dates are Singapore-local throughout (§7.7): enrolled_at/unenrolled_at are
-- TIMESTAMPTZ, and taking their UTC date would start a span a day early for
-- anything written between 00:00 and 08:00 SGT.

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

COMMENT ON FUNCTION public.class_unmarked_lesson_dates(UUID) IS
  'Dates at or after the business markable_floor where this class still owes an attendance mark — expected students (enrolment SPANS, not is_active, plus uncancelled trial and make-up bookings) with no attendance row. The single SQL copy of that union (§7.18); may only ever err toward naming MORE dates. Used by deactivate_class() as a destructive-action guard.';


-- ── 3. Retire a class ───────────────────────────────────────────────────────
-- Three refusals, all settled at planning time (WAVE_1_PLAN.md), and NONE of
-- them takes an override. Each names what is in the way, because "cannot
-- deactivate" with no subject is a dead end rather than an instruction.
--
-- They are evaluated in order, and refusal 3 leans on that: with no open
-- enrolments (1) and no future bookings (2) already established, what it has
-- left to find is genuinely just unmarked history. Each still stands alone.
--
-- ON THE EMPTY CLASS, stated because §7.17 says a guard made only of "nothing
-- went wrong" negatives is vacuously satisfied on empty input, and all three
-- refusals here are of exactly that shape. A class with zero enrolments, zero
-- bookings and zero sessions PASSES all three and is deactivated. That is the
-- decision, not an oversight: an empty class is precisely the one an admin
-- wants to retire, and there is nothing left to strand. `class_deactivation.
-- test.sql` asserts it explicitly so it can never become accidental.
--
-- COUNTED IN SQL, never by the client (§7.70): PostgREST silently caps a
-- response at max_rows = 1000, so a UI deciding by `.length` on a fetched array
-- would report "no enrolments" for a large class and sail straight through.

CREATE OR REPLACE FUNCTION public.deactivate_class(p_class_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID;
  v_title  TEXT;
  v_active BOOLEAN;
  v_floor  DATE;
  v_names  TEXT;
  v_dates  DATE[];
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
      SELECT s.full_name || ' on ' || to_char(tb.session_date, 'DD Mon YYYY') AS label
        FROM trial_bookings tb
        JOIN students s ON s.id = tb.student_id
       WHERE tb.class_id = p_class_id
         AND tb.cancelled_at IS NULL
         AND tb.session_date >= today_sg()
      UNION ALL
      SELECT s.full_name || ' on ' || to_char(mb.session_date, 'DD Mon YYYY')
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
      (SELECT string_agg(to_char(d, 'DD Mon YYYY'), ', ' ORDER BY d)
         FROM unnest(v_dates) AS d);
  END IF;

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
END $$;

COMMENT ON FUNCTION public.deactivate_class(UUID) IS
  'Retire a class: is_active = FALSE and deactivated_at = NOW(). Refuses, naming what is in the way, while the class has children on its roster (by enrolment SPAN, not is_active), guests booked into future lessons (trials AND make-ups), or lessons still owed a mark. NONE of the three takes an override — each one, bypassed, can make a billing month permanently unbillable. An EMPTY class passes all three and is deactivated: that is deliberate (§7.17). Tenant admin only. Idempotent, and re-deactivating never moves deactivated_at.';


-- ── 4. Un-retire a class ────────────────────────────────────────────────────
-- TAKES NO REFUSALS, AND MUST NOT GROW ONE. This is the emergency exit from the
-- RISK 1 deadlock — the thing an admin reaches for when a class they cannot see
-- is blocking their billing month. Anything that can refuse it can strand a
-- business, so its only checks are "does this class exist" and "is this your
-- business".
--
-- Reactivating restores the full expectation window, so a class that sat
-- inactive across a lesson date will now block on it. That is correct and is
-- not the deadlock: the class is visible again, so the coach can mark those
-- lessons cancelled — which is what the product says everywhere else about a
-- lesson that did not run (§8a: cancelled, never skipped).

CREATE OR REPLACE FUNCTION public.reactivate_class(p_class_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
END $$;

COMMENT ON FUNCTION public.reactivate_class(UUID) IS
  'Un-retire a class: is_active = TRUE, deactivated_at = NULL. Takes NO refusals and must never grow one — it is the only exit from a class that is blocking a billing month while being invisible to every screen that filters is_active. Tenant admin only. Idempotent.';


-- ── 5. Callable by NOBODY, deliberately, until 20260809000400 ───────────────
-- See the header. The grant is the deploy-ordering mechanism, not an oversight:
-- these RPCs must not be reachable until the engine that makes them safe is
-- live. `service_role` and `anon` are revoked explicitly rather than left to
-- cloud defaults — whatever a migration does not revoke, cloud grants
-- service_role (docs/DEPLOYMENT.md §11.7), and neither role has a caller here.

REVOKE ALL ON FUNCTION public.class_unmarked_lesson_dates(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.deactivate_class(UUID)            FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reactivate_class(UUID)            FROM PUBLIC, anon, authenticated, service_role;
