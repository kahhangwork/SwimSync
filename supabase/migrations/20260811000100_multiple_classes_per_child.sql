-- ============================================================================
-- WAVE 2 — MULTIPLE CLASSES PER CHILD
--
-- Drops one_active_enrolment_per_student, the constraint that has shaped every
-- enrolment surface since 20260309000100. A keen swimmer taking two sessions a
-- week is an ordinary case the product could not represent; the workaround was
-- a second child profile.
--
-- Plan, decisions and the ranked risk review: docs/plans/WAVE_2_PLAN.md.
--
-- WHAT THE DROPPED INDEX WAS SILENTLY DOING FOR US. It was not only a product
-- rule. Three separate pieces of code were correct only because it held, and
-- all three are repaired here rather than left to be discovered:
--
--   1. book_makeup()'s home-class SELECT INTO was "deterministic" purely
--      because at most one row could match. It picks an ARBITRARY row on
--      multi-row and raises nothing — and both values it derives are money
--      (the make-up's price and its package category).
--   2. book_makeup()'s "that is the child's own class" refusal compared against
--      ONE class and thereby covered EVERY class the child was in. It now
--      covers only the one the admin named unless widened.
--   3. close_student_enrolment() closed "the" enrolment by closing all of them.
--
-- A fourth consumer is repaired in the test suite, not here: §7.63's fixture
-- detector relied on this index ABORTING an unscoped CROSS JOIN. See
-- docs/plans/WAVE_2_PLAN.md Step 5 — the roundtrip check must be re-proven.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. THE INDEXES
--
-- Same class twice is still nonsense, and it is still the thing that makes an
-- enrolment fixture idempotent under ON CONFLICT DO NOTHING (§7.53). What is
-- no longer refused is a SECOND class.
-- ────────────────────────────────────────────────────────────────────────────

DROP INDEX one_active_enrolment_per_student;

CREATE UNIQUE INDEX one_active_enrolment_per_student_class
  ON student_class_enrolments (student_id, class_id)
  WHERE is_active = TRUE;

COMMENT ON INDEX one_active_enrolment_per_student_class IS
  'A child may hold many active enrolments but only one per class. Replaced '
  'one_active_enrolment_per_student (Wave 2). Still PARTIAL, so closed '
  'enrolments may repeat — see §7.53 before writing a fixture against it.';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. THE SCHEDULE INVARIANT — a child cannot be in two places at once
--
-- WHY THIS IS NOT WRITTEN THE OBVIOUS WAY. The obvious form exempts the check
-- when either class is inactive, on the reasoning that a retired class runs no
-- lessons. That form is breakable and cannot be patched where you would want
-- to patch it:
--
--   deactivate_class() refusal 1 (20260809000300) guarantees no open enrolments
--   AT THE MOMENT a class is retired. Nothing stops one being added afterwards —
--   enrolments_write carries no is_active predicate on the class. Then
--   reactivate_class() restores it, and reactivate_class() TAKES NO REFUSALS by
--   standing prohibition (20260809000300:313, HANDOVER §3) because it is the
--   only exit from the RISK 1 deadlock. The overlap would then exist with
--   nothing having objected.
--
-- So the rule is inverted: refuse an enrolment into a RETIRED class, and compute
-- overlap without consulting the counterparty's is_active at all. An inactive
-- class then provably holds zero active enrolments, and reactivate_class() can
-- never introduce a clash — it needs no refusal and must never grow one.
--
-- ⚠ DO NOT add an is_active check on the counterparty class.
-- ⚠ DO NOT add a refusal to reactivate_class() to compensate.
--
-- SECURITY DEFINER IS LOAD-BEARING, NOT STYLE. A plain trigger function runs
-- under the caller's RLS, and enrolments_select (20260718000900:350) can hide a
-- sibling enrolment from the caller. A hidden row makes the overlap check
-- silently PASS — the exact failure this trigger exists to prevent.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_enrolment_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day        day_of_week;
  v_start      TIME;
  v_end        TIME;
  v_title      TEXT;
  v_own_active BOOLEAN;
  v_clash      TEXT;
BEGIN
  SELECT c.day_of_week, c.start_time, c.end_time, c.title, c.is_active
    INTO v_day, v_start, v_end, v_title, v_own_active
    FROM classes c
   WHERE c.id = NEW.class_id;

  IF v_day IS NULL THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  -- Half one of the inversion. Nothing may ENTER a retired class; the class
  -- guards added in 20260810000100 said the same thing for bookings.
  IF NOT v_own_active THEN
    RAISE EXCEPTION
      '% has been retired — restore it on the Classes page before enrolling anyone',
      v_title;
  END IF;

  -- Half two. Note the absence of `AND c2.is_active` — deliberate, see above.
  -- `e2.id <> NEW.id` handles the UPDATE case, and also the INSERT that an
  -- .upsert() resolves to an UPDATE (§7.57). Column defaults are applied before
  -- BEFORE-ROW triggers, so NEW.id is populated on INSERT.
  --
  -- `e2.class_id <> NEW.class_id` IS NOT REDUNDANT — it is the difference
  -- between two rules. This trigger owns "two DIFFERENT classes at the same
  -- time"; the SAME class twice is the unique index's job. Without this line a
  -- duplicate enrolment reaches the trigger first (BEFORE INSERT precedes the
  -- index check), the class overlaps ITSELF, and the admin is told
  -- "Mon 5pm clashes with Mon 5pm" instead of getting a 23505. Measured, not
  -- predicted — it is what the first version actually did.
  SELECT string_agg(c2.title, ', ' ORDER BY c2.title)
    INTO v_clash
    FROM student_class_enrolments e2
    JOIN classes c2 ON c2.id = e2.class_id
   WHERE e2.student_id = NEW.student_id
     AND e2.is_active
     AND e2.id       <> NEW.id
     AND e2.class_id <> NEW.class_id
     AND c2.day_of_week = v_day
     AND c2.start_time < v_end
     AND v_start       < c2.end_time;

  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION
      '% clashes with % — a child cannot be in two classes at the same time. '
      'Remove them from one first.',
      v_title, v_clash;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_enrolment_schedule() IS
  'Wave 2: refuses an enrolment into a retired class, and one that overlaps '
  'another of the child''s active enrolments. SECURITY DEFINER so RLS cannot '
  'hide a sibling row and make the check silently pass.';

-- Sorts after enrolment_tenant_guard (e < t), so tenant_id is stamped before
-- this runs. WHEN (NEW.is_active) keeps set_students_active()'s bulk close
-- (20260719001200:105) out of the check entirely — today every UPDATE in the
-- codebase sets is_active = FALSE, so in practice this fires only on INSERT.
CREATE TRIGGER trg_enrolment_schedule
  BEFORE INSERT OR UPDATE ON student_class_enrolments
  FOR EACH ROW
  WHEN (NEW.is_active)
  EXECUTE FUNCTION public.enforce_enrolment_schedule();


-- ────────────────────────────────────────────────────────────────────────────
-- 3. THE OTHER SIDE OF THE SAME RULE — moving a CLASS onto a clashing time
--
-- A trigger, not a check inside set_class_terms(), because set_class_terms() is
-- not the only writer: classes_write (20260718000900:342) still grants a tenant
-- admin a bare UPDATE classes SET start_time = … over PostgREST. An RPC-level
-- guard is a convention; a trigger is an invariant, and set_class_terms()
-- inherits it for free.
--
-- ⚠ THE WHEN CLAUSE IS THE PROHIBITION, EXPRESSED STRUCTURALLY. This must never
-- fire on an is_active transition — reactivate_class() takes no refusals. Because
-- the condition names the three schedule columns and nothing else, that cannot
-- regress by editing the body.
--
-- It also means a price-only correction can never deadlock: set_class_terms()
-- writes price through class_rates and early-returns for an unchanged schedule.
--
-- The message names the CHILD and the CLASS THEY CLASH WITH, because the fix is
-- to remove them from one of the two and the admin cannot guess which. That
-- removal writes unenrolled_at = NOW(), a billing-relevant fact — not a free undo.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_class_time_no_enrolment_clash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kids TEXT;
BEGIN
  SELECT string_agg(DISTINCT s.full_name || ' (already in ' || c2.title || ')', ', ')
    INTO v_kids
    FROM student_class_enrolments e1
    JOIN students s  ON s.id = e1.student_id
    JOIN student_class_enrolments e2
      ON e2.student_id = e1.student_id
     AND e2.is_active
     AND e2.class_id <> NEW.id
    JOIN classes c2 ON c2.id = e2.class_id
   WHERE e1.class_id = NEW.id
     AND e1.is_active
     AND c2.day_of_week = NEW.day_of_week
     AND c2.start_time  < NEW.end_time
     AND NEW.start_time < c2.end_time;

  IF v_kids IS NOT NULL THEN
    RAISE EXCEPTION
      'moving % to % at % clashes for: %. Remove them from one class first.',
      NEW.title, NEW.day_of_week, to_char(NEW.start_time, 'FMHH12:MIam'), v_kids;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_class_time_no_enrolment_clash() IS
  'Wave 2: the class-side half of the no-two-places-at-once rule. Fires only '
  'when day/start/end change — never on is_active, so reactivate_class() keeps '
  'taking no refusals.';

CREATE TRIGGER trg_class_time_no_enrolment_clash
  BEFORE UPDATE ON classes
  FOR EACH ROW
  WHEN (NEW.day_of_week IS DISTINCT FROM OLD.day_of_week
     OR NEW.start_time  IS DISTINCT FROM OLD.start_time
     OR NEW.end_time    IS DISTINCT FROM OLD.end_time)
  EXECUTE FUNCTION public.enforce_class_time_no_enrolment_clash();


-- ────────────────────────────────────────────────────────────────────────────
-- 4. close_student_enrolment() — WHICH class, and no default
--
-- THE DROP IS MANDATORY, NOT TIDINESS. A 3-arg overload sitting beside the
-- 2-arg one makes every existing call ambiguous at resolution time.
--
-- p_class_id HAS NO DEFAULT, DELIBERATELY. The tempting shape is
-- `p_class_id UUID DEFAULT NULL` meaning "close everything", which makes the
-- DANGEROUS value the DEFAULT: a caller who forgets the argument silently
-- removes a child from every class, including another coach's. With no default
-- a forgotten argument fails to resolve, and an explicitly-passed NULL is
-- refused below. Nothing needs the old behaviour — set_students_active() does
-- its own enrolment UPDATE inline (20260719001200:105) and never calls this.
--
-- ⚠ coach_serves_student() MUST NOT AUTHORIZE THE PER-CLASS PATH. It returns
-- true when the coach owns ANY class the child is actively in, which was sound
-- only while "any" meant "the one". With p_class_id, coach X could pass coach
-- Y's class id and close a row on Y's roster — a cross-coach write RLS never
-- sees, because this function is SECURITY DEFINER and enrolments_write is
-- admin-only, making this RPC the whole coach-side surface. The per-class check
-- is coach_owns_class(p_class_id).
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.close_student_enrolment(UUID, BOOLEAN);

CREATE FUNCTION public.close_student_enrolment(
  p_student_id   UUID,
  p_set_inactive BOOLEAN,
  p_class_id     UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

COMMENT ON FUNCTION public.close_student_enrolment(UUID, BOOLEAN, UUID) IS
  'Removes a child from ONE named class (Wave 2). p_class_id has no default and '
  'NULL is refused: there is no spelling that means "every class". Per-class '
  'authorization is coach_owns_class(), never coach_serves_student().';

-- §7.87: a re-created function is a new pg_proc row and is callable by NOBODY
-- until granted. Local and cloud disagree here by construction — take the
-- remote grant dump after deploy (§7.39, docs/DEPLOYMENT.md §11.7).
REVOKE ALL ON FUNCTION public.close_student_enrolment(UUID, BOOLEAN, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_student_enrolment(UUID, BOOLEAN, UUID)
  FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.close_student_enrolment(UUID, BOOLEAN, UUID)
  TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. book_makeup() — the admin names the home class, and every own class refuses
--
-- THE DROP IS THE POINT OF THIS SECTION. CREATE OR REPLACE with a fourth
-- defaulted parameter does NOT replace book_makeup(uuid, date, uuid) — it
-- creates a SECOND function beside it, and PostgREST (which calls by parameter
-- name) resolves to the surviving exact match. The OLD BODY then keeps running,
-- and its home-class SELECT INTO takes an arbitrary row with no ORDER BY and no
-- error. Both values it derives are money: home_class_id prices the make-up
-- line (core.ts:896) and category_id decides package coverage (core.ts:1205).
-- Wrong either way is a wrong amount on an invoice, unrecoverable once the
-- month seals.
--
-- The new parameter is appended LAST and defaulted so the existing positional
-- 3-arg calls in markable_floor.test.sql keep working.
--
-- TWO REFUSALS CHANGED, AND THE SECOND IS THE SUBTLE ONE:
--
--   a) Home class. Ambiguous now, so the admin names it. Exactly one enrolment
--      still derives silently — via INTO STRICT, so if that assumption ever
--      breaks again it raises instead of guessing.
--
--   b) "That is the child's own class." This compared v_home_class = p_class_id
--      and thereby covered EVERY class the child was in, because there was only
--      one. Left alone it would cover only the class the admin named, and
--      booking a make-up into the child's OTHER class would pass. That is not a
--      billing bug — enrolment-wins (core.ts:940) prices it correctly as a
--      member — it is worse: the make-up is SILENTLY VOID. The child attends the
--      lesson they were already attending, receives nothing replacing the missed
--      one, and the Makeups page reports the booking as arranged.
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.book_makeup(UUID, DATE, UUID);

CREATE FUNCTION public.book_makeup(
  p_class_id      uuid,
  p_session_date  date,
  p_student_id    uuid,
  p_home_class_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
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
$$;

COMMENT ON FUNCTION public.book_makeup(UUID, DATE, UUID, UUID) IS
  'Books a child as a guest into one lesson of a class they are NOT in. Wave 2: '
  'the home class is named by the admin when the child has more than one, and '
  'EVERY active class of the child is refused as a host — booking into their '
  'other class bills correctly but silently voids the make-up.';

-- §7.87 again — a changed signature is a new pg_proc row.
REVOKE ALL ON FUNCTION public.book_makeup(UUID, DATE, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.book_makeup(UUID, DATE, UUID, UUID)
  FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.book_makeup(UUID, DATE, UUID, UUID) TO authenticated;
