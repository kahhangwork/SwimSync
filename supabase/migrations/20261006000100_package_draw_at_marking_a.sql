-- Wave 6, migration A (EXPAND ONLY): package-funded lessons draw at MARKING, not at the monthly run.
-- docs/plans/WAVE6_PACKAGE_DRAW_AT_MARKING_PLAN.md (reviewed; decisions D1–D7 are the user's, 2026-10-06).
--
-- WHY. Today a package's stored balance moves only when the engine runs, so a package family's month needs a
-- Generate that issues an invoice which arrives already Paid (PRD §7.16). Little Orcas has never run billing.
-- After Wave 6 a covered lesson draws from the package the moment it is marked present; the monthly run bills
-- only ad-hoc lessons.
--
-- WHAT THIS MIGRATION CHANGES FOR USERS: NOTHING. Every behaviour below is gated on the per-tenant switch
-- tenants.package_draw_at_marking, which is created FALSE here and flipped by migration B (with the backfill,
-- in one transaction). The switch is the ONLY switch (§7.325): the triggers are created ENABLED and early-return
-- while it is false. Never add `ALTER TABLE … DISABLE TRIGGER`, an app_settings key, or an env var beside it.
--
--   1. tenants.package_draw_at_marking (BOOLEAN, default false) — "nobody" in guard_tenant_columns.
--   2. package_applications gains a MARKING-TIME shape: (lesson_session_id, student_id, lesson_date) with
--      invoice_item_id NULL. A CHECK allows exactly one shape; one LIVE marking-time row per lesson.
--   3. package_candidates_for — THE matcher (the engine's rule, core.ts:1320-1336, ported once). Every draw,
--      the D6 guard, the backlog preview/draw and B's backfill read it. No second copy.
--   4. package_draw_for / package_return_for + trg_attendance_package_draw (AFTER, row-level).
--   5. guard_invoice_item_not_drawn — the backstop the other way: no invoice line for a drawn lesson (PK002).
--   6. class_unmarked_lesson_pairs, and class_unmarked_lesson_dates redefined over it (one "expected").
--   7. guard_package_draw_order — the D6 out-of-order guard (PK001). FAILS OPEN (§7.324).
--   8. package_live_balances / unbilled_sealed_lessons — drawn lessons are paid; switch-on live = stored.
--   9. package_backlog_preview / draw_package_backlog (D5), package_usage (D3), package_month_funding (D2).
--
-- DEVIATION FROM THE PLAN (RISK 9's "only CASCADE is invoice_item_id_fkey"): lesson_session_id is ON DELETE
-- CASCADE. unmark_day_holiday DELETES the lesson session a void left empty; with NO ACTION, un-voiding a holiday
-- over a drawn lesson would fail. A CASCADE here can only ever remove REVERSED rows: a live marking-time row
-- needs an attendance row, attendance's own FK blocks deleting its session, and deleting the attendance row
-- returns the draw first (trigger 4). student_id stays NO ACTION (§7.327 — merge_students' census).
--
-- REMOTE CHECK after deploy (§7.39, §7.89) — expect anon false everywhere, authenticated true only on the four
-- RPCs in section 9:
--   scripts/prod-query-ro.sh "select p.proname, has_function_privilege('anon',p.oid,'EXECUTE') anon, has_function_privilege('authenticated',p.oid,'EXECUTE') authd from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('package_candidates_for','package_draw_for','package_return_for','class_unmarked_lesson_pairs','package_backlog_preview','draw_package_backlog','package_usage','package_month_funding','package_backlog_lessons') order by 1"
--
-- ROLLBACK: supabase/rollback/20261006000100_package_draw_at_marking_a_DOWN.sql — only while every tenant's
-- switch is false (i.e. before B). APPS FIRST.

-- ══ 1. The switch ══════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.tenants
  ADD COLUMN package_draw_at_marking BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.package_draw_at_marking IS
  'Wave 6: true = package lessons draw at marking and the engine never matches packages. The ONLY switch '
  '(§7.325). Set by migrations, never by a client (guard_tenant_columns: nobody).';

-- Body read from the DB (§7.40, newest 20260927000500); one key added: package_draw_at_marking → nobody.
CREATE OR REPLACE FUNCTION public.guard_tenant_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_map CONSTANT JSONB := '{
    "display_name":"profile","slug":"profile","logo_url":"profile","join_code":"profile",
    "paynow_qr_url":"billing","paynow_uen":"billing","paynow_mobile":"billing",
    "auto_invoice_enabled":"billing","invoice_run_day":"billing",
    "rain_pays_coach":"wages","wage_run_day":"wages",
    "low_package_lessons":"packages","package_expiry_warning_days":"packages",
    "default_package_product_id":"packages","holiday_extension_days":"packages",
    "referral_enabled":"packages","referral_discount_type":"packages",
    "referral_discount_value":"packages","referral_reward_expiry_days":"packages",
    "updated_at":"any",
    "id":"nobody","created_at":"nobody","owner_profile_id":"nobody","suspended_at":"nobody",
    "credit_note_counter":"nobody","invoice_counter":"nobody","package_counter":"nobody",
    "package_draw_at_marking":"nobody"
  }';
  v_old  JSONB := to_jsonb(OLD);
  v_new  JSONB := to_jsonb(NEW);
  v_col  TEXT;
  v_area TEXT;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  FOR v_col IN SELECT k FROM jsonb_object_keys(v_new) k WHERE v_new->k IS DISTINCT FROM v_old->k LOOP
    v_area := v_map->>v_col;
    IF v_area IS NULL THEN
      RAISE EXCEPTION 'tenants.% is not mapped to an area — add it to guard_tenant_columns() before a client may change it', v_col
        USING ERRCODE = 'insufficient_privilege';
    ELSIF v_area = 'any' THEN
      CONTINUE;
    ELSIF v_area = 'nobody' THEN
      -- guard_tenants_owner already refuses owner_profile_id with its own
      -- message; this also closes the counters and suspension.
      RAISE EXCEPTION 'tenants.% cannot be changed directly', v_col USING ERRCODE = 'insufficient_privilege';
    ELSIF NOT is_platform_admin() AND NOT has_admin_area(NEW.id, v_area::admin_area, 'edit') THEN
      RAISE EXCEPTION 'your role cannot change % settings (tenants.%)', v_area, v_col
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

-- ══ 2. The ledger gains a marking-time shape ═══════════════════════════════════════════════════════════════
ALTER TABLE public.package_applications
  ALTER COLUMN invoice_item_id DROP NOT NULL,
  ADD COLUMN lesson_session_id UUID REFERENCES public.lesson_sessions(id) ON DELETE CASCADE,
  ADD COLUMN student_id        UUID REFERENCES public.students(id) ON DELETE NO ACTION,
  ADD COLUMN lesson_date       DATE,
  ADD CONSTRAINT package_applications_one_shape CHECK (
       (invoice_item_id IS NOT NULL AND lesson_session_id IS NULL AND student_id IS NULL AND lesson_date IS NULL)
    OR (invoice_item_id IS NULL AND lesson_session_id IS NOT NULL AND student_id IS NOT NULL AND lesson_date IS NOT NULL));

-- One LIVE marking-time draw per lesson. Legacy rows have NULL here and stay governed by
-- package_applications_live_item_uniq.
CREATE UNIQUE INDEX package_applications_live_lesson_uniq
  ON public.package_applications (lesson_session_id, student_id)
  WHERE reversed_at IS NULL;

COMMENT ON COLUMN public.package_applications.lesson_session_id IS
  'Wave 6 marking-time draw (invoice_item_id NULL). Legacy invoice-time draws keep invoice_item_id.';

-- ══ 3. THE matcher ═════════════════════════════════════════════════════════════════════════════════════════
-- Packages that may fund (p_session, p_student), FIFO (expires_on, confirmed_at, id), WITHOUT the affordability
-- rule — callers apply `value_remaining >= rate` themselves, after locking (draw) or against a simulated
-- balance (preview). Empty when the lesson is not eligible: already invoiced, already drawn, or settled.
-- The engine's rule (core.ts:1320-1336) and package_live_balances' simulation: tenant from the CLASS; the
-- family is EVERY parent linked to the child; category = the make-up booking's snapshot, else the class's;
-- the lesson's own date inside start_date..expires_on.
CREATE FUNCTION public.package_candidates_for(p_session UUID, p_student UUID)
RETURNS TABLE (package_id UUID, rate NUMERIC, value_remaining NUMERIC, expires_on DATE, confirmed_at TIMESTAMPTZ,
               lesson_date DATE, tenant_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH les AS (
    SELECT ls.session_date, c.tenant_id,
           COALESCE((SELECT mb.category_id FROM makeup_bookings mb
                      WHERE mb.student_id = p_student AND mb.class_id = ls.class_id
                        AND mb.session_date = ls.session_date AND mb.cancelled_at IS NULL
                      ORDER BY mb.booked_at LIMIT 1),
                    c.category_id) AS category_id
      FROM lesson_sessions ls
      JOIN classes c ON c.id = ls.class_id
     WHERE ls.id = p_session
  )
  SELECT pp.id, pp.rate_per_lesson, pp.value_remaining, pp.expires_on, pp.confirmed_at,
         les.session_date, les.tenant_id
    FROM les
    JOIN parent_packages pp ON pp.tenant_id = les.tenant_id
   WHERE pp.status = 'active'
     AND pp.parent_id IN (SELECT ps.parent_id FROM parent_students ps WHERE ps.student_id = p_student)
     AND (pp.category_id IS NULL OR pp.category_id = les.category_id)
     AND les.session_date >= pp.start_date
     AND les.session_date <= pp.expires_on
     AND NOT EXISTS (SELECT 1 FROM invoice_items ii
                      WHERE ii.lesson_session_id = p_session AND ii.student_id = p_student)
     AND NOT EXISTS (SELECT 1 FROM package_applications pa
                      WHERE pa.lesson_session_id = p_session AND pa.student_id = p_student
                        AND pa.reversed_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM student_settlements ss
                      WHERE ss.student_id = p_student AND ss.reversed_at IS NULL
                        AND ss.settled_through >= les.session_date)
   ORDER BY pp.expires_on, pp.confirmed_at, pp.id
$$;

-- ══ 4. Draw and return ═════════════════════════════════════════════════════════════════════════════════════
-- Draws ONE lesson at the package's locked rate, or returns NULL (→ the lesson is ad-hoc). Does NOT read the
-- switch or the status — its callers (the trigger, the backlog draw, B's backfill) decide that.
CREATE FUNCTION public.package_draw_for(p_session UUID, p_student UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg  UUID;
  v_rate NUMERIC;
  v_date DATE;
  v_app  UUID;
BEGIN
  -- Lock EVERY candidate in the one fixed order first (two coaches marking siblings at once can neither
  -- overdraw nor deadlock), then choose against the post-lock balances.
  PERFORM 1
     FROM parent_packages pp
    WHERE pp.id IN (SELECT c.package_id FROM package_candidates_for(p_session, p_student) c)
    ORDER BY pp.expires_on, pp.confirmed_at, pp.id
      FOR UPDATE;

  SELECT c.package_id, c.rate, c.lesson_date
    INTO v_pkg, v_rate, v_date
    FROM package_candidates_for(p_session, p_student) c
   WHERE c.value_remaining >= c.rate
   ORDER BY c.expires_on, c.confirmed_at, c.package_id
   LIMIT 1;

  IF v_pkg IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO package_applications (parent_package_id, amount, lesson_session_id, student_id, lesson_date)
  VALUES (v_pkg, v_rate, p_session, p_student, v_date)
  RETURNING id INTO v_app;

  UPDATE parent_packages SET value_remaining = value_remaining - v_rate WHERE id = v_pkg;
  RETURN v_app;
END;
$$;

-- Returns a live marking-time draw to the package it came from — even an expired or cancelled one (PRD §7.16's
-- correction rule). Legacy invoice-time draws are NOT touched: handle_attendance_update owns those.
CREATE FUNCTION public.package_return_for(p_session UUID, p_student UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app UUID;
  v_pkg UUID;
  v_amt NUMERIC;
BEGIN
  UPDATE package_applications
     SET reversed_at = now(), reversed_by = auth.uid()
   WHERE lesson_session_id = p_session
     AND student_id = p_student
     AND reversed_at IS NULL
  RETURNING id, parent_package_id, amount INTO v_app, v_pkg, v_amt;

  IF v_app IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE parent_packages SET value_remaining = value_remaining + v_amt WHERE id = v_pkg;
  RETURN v_app;
END;
$$;

-- Acts only on a REAL crossing of the billable line (§7.323: `UPDATE OF status` fires for every upserted row,
-- changed or not). present ↔ trial_paid is not a crossing. Exits cheapest-first: switch, then transition.
CREATE FUNCTION public.attendance_package_draw()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session UUID;
  v_student UUID;
  v_old_b   BOOLEAN;
  v_new_b   BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_session := OLD.lesson_session_id; v_student := OLD.student_id;
  ELSE
    v_session := NEW.lesson_session_id; v_student := NEW.student_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM lesson_sessions ls
                   JOIN classes c ON c.id = ls.class_id
                   JOIN tenants t ON t.id = c.tenant_id
                  WHERE ls.id = v_session AND t.package_draw_at_marking) THEN
    RETURN NULL;
  END IF;

  v_old_b := TG_OP <> 'INSERT' AND OLD.status IN ('present', 'trial_paid');
  v_new_b := TG_OP <> 'DELETE' AND NEW.status IN ('present', 'trial_paid');
  IF v_old_b = v_new_b THEN
    RETURN NULL;
  END IF;

  IF v_new_b THEN
    PERFORM package_draw_for(v_session, v_student);
  ELSE
    PERFORM package_return_for(v_session, v_student);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_attendance_package_draw
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.attendance_package_draw();

-- ══ 5. Backstop: a drawn lesson can never also get an invoice line (PK002) ═════════════════════════════════
-- Serialises with a concurrent mark (FOR SHARE on the attendance row) before looking.
CREATE FUNCTION public.guard_invoice_item_not_drawn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lesson_session_id IS NULL OR NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM attendance a
    WHERE a.lesson_session_id = NEW.lesson_session_id AND a.student_id = NEW.student_id
    FOR SHARE;
  IF EXISTS (SELECT 1 FROM package_applications pa
              WHERE pa.lesson_session_id = NEW.lesson_session_id
                AND pa.student_id = NEW.student_id
                AND pa.reversed_at IS NULL) THEN
    RAISE EXCEPTION 'lesson % for student % is already paid by a package and cannot also be invoiced',
      NEW.lesson_session_id, NEW.student_id
      USING ERRCODE = 'PK002';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoice_item_not_drawn
  BEFORE INSERT ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_item_not_drawn();

-- ══ 6. One derivation of "expected but unmarked" ═══════════════════════════════════════════════════════════
-- The (date, student) core of class_unmarked_lesson_dates (body read from the DB, §7.40 — newest
-- 20260927000400), extracted unchanged so the D6 guard reads the same "expected" as the coach's NEEDS MARKING
-- list and the completeness gate. Do NOT write a third copy.
CREATE FUNCTION public.class_unmarked_lesson_pairs(p_class_id UUID)
RETURNS TABLE (session_date DATE, student_id UUID)
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
  SELECT x.session_date, x.student_id
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

CREATE OR REPLACE FUNCTION public.class_unmarked_lesson_dates(p_class_id UUID)
 RETURNS date[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Wave 6: the body moved into class_unmarked_lesson_pairs, unchanged. Same result, one derivation.
  SELECT COALESCE(
           array_agg(DISTINCT p.session_date ORDER BY p.session_date),
           '{}'::DATE[]
         )
    FROM class_unmarked_lesson_pairs(p_class_id) p;
$function$;

-- ══ 7. The D6 guard: earlier lessons get first claim on the last package lessons (PK001) ═══════════════════
-- REFUSE marking a child present on D when the package that would fund it would be left with fewer lessons
-- than there are EARLIER, still-markable, unmarked lessons it would also cover — this child's or a sibling's
-- (a package pools per family). The user's rule, 2026-10-06.
--
-- POLARITY: FAILS OPEN. Any error while deciding lets the mark through with a WARNING — a wrongful refusal
-- blocks a whole class's save with no override (§7.324), while a missed refusal only changes which lesson the
-- package pays for. The PK001 RAISE sits OUTSIDE the exception block so the guard's own refusal is never
-- swallowed. Do NOT invert this to "block on doubt".
--
-- Fires only when this write would create a NEW draw: billable now, and no row before (a real INSERT) or the
-- previous row non-billable. An upsert that resolves to an UPDATE fires BEFORE INSERT first (§7.57) — that
-- firing defers to the BEFORE UPDATE that follows. Named to sort AFTER guard_attendance_date_trg, so a
-- below-floor write gets the date message first (§7.167).
CREATE FUNCTION public.guard_package_draw_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      to_char(v_first_date, 'FMDD Mon'), v_left_now, CASE WHEN v_left_now = 1 THEN '' ELSE 's' END,
      COALESCE(v_first_kid, 'a sibling'), COALESCE(v_first_cls, 'another class'))
      USING ERRCODE = 'PK001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_package_draw_order_trg
  BEFORE INSERT OR UPDATE OF status ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.guard_package_draw_order();

-- ══ 8. Readers: a drawn lesson is paid ═════════════════════════════════════════════════════════════════════
-- package_live_balances (body from the DB, §7.40 — newest 20260814000400). Change: the simulation skips every
-- lesson of a switch-ON tenant (and any drawn lesson), so for those packages live = stored by construction —
-- the second matcher is gone for them (RISK 5). Switch-off tenants: today's simulation, unchanged.
CREATE OR REPLACE FUNCTION public.package_live_balances()
 RETURNS TABLE(parent_package_id uuid, parent_id uuid, tenant_id uuid, name text, category_id uuid, rate_per_lesson numeric, lesson_count integer, total_value numeric, expires_on date, value_remaining numeric, live_value_remaining numeric, live_lessons_remaining integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  pkg_ids        UUID[]    := '{}';
  pkg_parents    UUID[]    := '{}';
  pkg_tenants    UUID[]    := '{}';
  pkg_cats       UUID[]    := '{}';
  pkg_rates      NUMERIC[] := '{}';
  pkg_starts     DATE[]    := '{}';
  pkg_ends       DATE[]    := '{}';
  pkg_remaining  NUMERIC[] := '{}';
  r    RECORD;
  les  RECORD;
  i    INTEGER;
BEGIN
  -- Active packages, in exactly the engine's draw order.
  FOR r IN
    SELECT pp.id, pp.parent_id AS p_id, pp.tenant_id AS t_id, pp.category_id AS c_id,
           pp.rate_per_lesson AS rate, pp.expires_on AS ends, pp.value_remaining AS rem,
           pp.start_date AS starts
    FROM parent_packages pp
    WHERE pp.status = 'active'
    ORDER BY pp.expires_on, pp.confirmed_at, pp.id
  LOOP
    pkg_ids       := pkg_ids       || r.id;
    pkg_parents   := pkg_parents   || r.p_id;
    pkg_tenants   := pkg_tenants   || r.t_id;
    pkg_cats      := pkg_cats      || r.c_id;
    pkg_rates     := pkg_rates     || r.rate;
    pkg_starts    := pkg_starts    || r.starts;
    pkg_ends      := pkg_ends      || r.ends;
    pkg_remaining := pkg_remaining || r.rem;
  END LOOP;

  -- Billable, not-yet-invoiced lessons, chronological (the engine's item
  -- order). A lesson's CATEGORY is the make-up booking's snapshot when the row
  -- is a make-up guest's, else the class's live category — the engine's rule.
  -- Wave 6: a switch-ON tenant's lessons are never simulated (its stored balance
  -- already moved at marking), and a drawn lesson is already paid.
  FOR les IN
    SELECT ps.parent_id AS p_id, c.tenant_id AS t_id,
           COALESCE(mb.category_id, c.category_id) AS c_id,
           ls.session_date AS d
    FROM attendance a
    JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
    JOIN classes c          ON c.id = ls.class_id
    JOIN tenants t          ON t.id = c.tenant_id
    JOIN parent_students ps ON ps.student_id = a.student_id
    LEFT JOIN makeup_bookings mb
      ON mb.student_id = a.student_id
     AND mb.class_id = ls.class_id
     AND mb.session_date = ls.session_date
     AND mb.cancelled_at IS NULL
    WHERE a.status IN ('present', 'trial_paid')
      AND NOT t.package_draw_at_marking
      AND NOT EXISTS (
        SELECT 1 FROM invoice_items ii
        WHERE ii.lesson_session_id = a.lesson_session_id
          AND ii.student_id = a.student_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM package_applications pa
        WHERE pa.lesson_session_id = a.lesson_session_id
          AND pa.student_id = a.student_id
          AND pa.reversed_at IS NULL
      )
    ORDER BY ls.session_date, a.student_id
  LOOP
    FOR i IN 1 .. coalesce(array_length(pkg_ids, 1), 0) LOOP
      IF pkg_parents[i] = les.p_id
         AND pkg_tenants[i] = les.t_id
         AND (pkg_cats[i] IS NULL OR pkg_cats[i] = les.c_id)
         AND les.d >= pkg_starts[i]
         AND les.d <= pkg_ends[i]
         AND pkg_remaining[i] >= pkg_rates[i]
      THEN
        pkg_remaining[i] := pkg_remaining[i] - pkg_rates[i];
        EXIT;
      END IF;
    END LOOP;
  END LOOP;

  FOR i IN 1 .. coalesce(array_length(pkg_ids, 1), 0) LOOP
    RETURN QUERY
      SELECT pp.id, pp.parent_id, pp.tenant_id, pp.name, pp.category_id,
             pp.rate_per_lesson, pp.lesson_count, pp.total_value, pp.expires_on,
             pp.value_remaining,
             pkg_remaining[i],
             floor(pkg_remaining[i] / pp.rate_per_lesson)::integer
      FROM parent_packages pp WHERE pp.id = pkg_ids[i];
  END LOOP;
END;
$function$;

-- unbilled_sealed_lessons (body from the DB, §7.40 — newest 20260927000400). One clause added: a lesson with a
-- live marking-time draw is PAID, not orphaned — otherwise an admin settles a lesson the package already paid.
CREATE OR REPLACE FUNCTION public.unbilled_sealed_lessons(p_tenant uuid)
 RETURNS TABLE(student_id uuid, student_name text, billing_month text, lessons bigint, earliest_session_date date, latest_session_date date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (is_platform_admin() OR (is_platform_admin() OR has_admin_area(p_tenant, 'operations', 'view'))) THEN
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
    -- Wave 6: not paid by a package at marking.
    AND NOT EXISTS (
      SELECT 1 FROM package_applications pa
       WHERE pa.student_id = a.student_id
         AND pa.lesson_session_id = a.lesson_session_id
         AND pa.reversed_at IS NULL)
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

-- ══ 9. Backdated activation (D5), usage (D3), month funding (D2) ═══════════════════════════════════════════
-- The lessons a package's backlog could cover: its family's billable, marked lessons in its window that the
-- matcher would let it fund (so: un-invoiced, undrawn, unsettled, in category), EXCLUDING sealed months
-- (engine parity — those stay with unbilled_sealed_lessons and settlements). Oldest first.
CREATE FUNCTION public.package_backlog_lessons(p_package UUID)
RETURNS TABLE (lesson_session_id UUID, student_id UUID, session_date DATE, class_title TEXT, student_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.lesson_session_id, a.student_id, ls.session_date, c.title, s.full_name
    FROM parent_packages pp
    JOIN parent_students ps ON ps.parent_id = pp.parent_id
    JOIN attendance a       ON a.student_id = ps.student_id
    JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
    JOIN classes c          ON c.id = ls.class_id AND c.tenant_id = pp.tenant_id
    JOIN students s         ON s.id = a.student_id
   WHERE pp.id = p_package
     AND a.status IN ('present', 'trial_paid')
     AND ls.session_date BETWEEN pp.start_date AND pp.expires_on
     AND NOT EXISTS (SELECT 1 FROM billing_periods bp
                      WHERE bp.tenant_id = pp.tenant_id
                        AND bp.billing_month = to_char(ls.session_date, 'YYYY-MM'))
     AND EXISTS (SELECT 1 FROM package_candidates_for(a.lesson_session_id, a.student_id) pc
                  WHERE pc.package_id = p_package)
   ORDER BY ls.session_date, a.student_id
$$;

-- A DRY RUN of the draw over the backlog: which package each lesson would draw from, against simulated
-- balances, through the same matcher (RISK 8 — never a separate window/category query). Read by the admin's
-- confirm dialog AFTER the activation write succeeds: the package must be active to be a candidate.
CREATE FUNCTION public.package_backlog_preview(p_package UUID)
RETURNS TABLE (session_date DATE, student_id UUID, student_name TEXT, class_title TEXT,
               funding_package_id UUID, funding_package_name TEXT, funds_this BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_sim    JSONB := '{}';
  les      RECORD;
  c        RECORD;
  v_rem    NUMERIC;
  v_pick   UUID;
  v_rate   NUMERIC;
BEGIN
  SELECT pp.tenant_id INTO v_tenant FROM parent_packages pp WHERE pp.id = p_package;
  IF auth.uid() IS NULL OR v_tenant IS NULL
     OR NOT COALESCE(is_platform_admin() OR has_admin_area(v_tenant, 'packages', 'view'), false) THEN
    RAISE EXCEPTION 'not authorised to read this package' USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR les IN SELECT * FROM package_backlog_lessons(p_package) LOOP
    v_pick := NULL;
    FOR c IN SELECT * FROM package_candidates_for(les.lesson_session_id, les.student_id) pc
              ORDER BY pc.expires_on, pc.confirmed_at, pc.package_id LOOP
      v_rem := COALESCE((v_sim ->> c.package_id::text)::NUMERIC, c.value_remaining);
      IF v_rem >= c.rate THEN
        v_pick := c.package_id; v_rate := c.rate;
        v_sim := v_sim || jsonb_build_object(c.package_id::text, v_rem - c.rate);
        EXIT;
      END IF;
    END LOOP;
    session_date := les.session_date; student_id := les.student_id;
    student_name := les.student_name; class_title := les.class_title;
    funding_package_id := v_pick;
    funding_package_name := (SELECT name FROM parent_packages WHERE id = v_pick);
    funds_this := v_pick IS NOT DISTINCT FROM p_package;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Draws the backlog oldest first through package_draw_for. Takes no lesson list: it re-derives at call time, so
-- a double-click (or two admins) draws 0 the second time. Refused while the tenant's switch is off.
CREATE FUNCTION public.draw_package_backlog(p_package UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_status TEXT;
  v_n      INTEGER := 0;
  les      RECORD;
BEGIN
  SELECT pp.tenant_id, pp.status INTO v_tenant, v_status FROM parent_packages pp WHERE pp.id = p_package;
  IF auth.uid() IS NULL OR v_tenant IS NULL
     OR NOT COALESCE(is_platform_admin() OR has_admin_area(v_tenant, 'packages', 'edit'), false) THEN
    RAISE EXCEPTION 'not authorised to change this package' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (SELECT t.package_draw_at_marking FROM tenants t WHERE t.id = v_tenant) THEN
    RAISE EXCEPTION 'this business does not draw packages at marking yet';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'only an active package can draw lessons';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('draw_package_backlog:' || v_tenant::text, 0));
  FOR les IN SELECT * FROM package_backlog_lessons(p_package) LOOP
    IF package_draw_for(les.lesson_session_id, les.student_id) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

-- What the package paid for, dated: marking-time draws AND legacy invoice-time draws (history is complete),
-- returns included. Explicit gate (RISK 7/12) mirroring package_applications_select.
CREATE FUNCTION public.package_usage(p_package UUID)
RETURNS TABLE (lesson_date DATE, student_id UUID, student_name TEXT, class_title TEXT, amount NUMERIC,
               source TEXT, applied_at TIMESTAMPTZ, reversed_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_parent UUID;
BEGIN
  SELECT pp.tenant_id, pp.parent_id INTO v_tenant, v_parent FROM parent_packages pp WHERE pp.id = p_package;
  IF auth.uid() IS NULL OR v_tenant IS NULL
     -- COALESCE: for a non-parent current_parent_id() is NULL, the arm is NULL, and NOT (… OR NULL) is NULL —
     -- an IF on NULL does NOT raise. Caught by pgTAP 34–36 (a coach / another business / front desk read it).
     OR NOT COALESCE(is_platform_admin()
             OR has_admin_area(v_tenant, 'packages', 'view')
             OR (v_parent = current_parent_id() AND NOT tenant_suspended(v_tenant)), false) THEN
    RAISE EXCEPTION 'not authorised to read this package' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT pa.lesson_date, pa.student_id, s.full_name, c.title, pa.amount, 'marking'::TEXT,
         pa.applied_at, pa.reversed_at
    FROM package_applications pa
    JOIN lesson_sessions ls ON ls.id = pa.lesson_session_id
    JOIN classes c          ON c.id = ls.class_id
    JOIN students s         ON s.id = pa.student_id
   WHERE pa.parent_package_id = p_package
  UNION ALL
  SELECT ii.session_date, ii.student_id, ii.student_name, ii.class_title, pa.amount, 'invoice'::TEXT,
         pa.applied_at, pa.reversed_at
    FROM package_applications pa
    JOIN invoice_items ii ON ii.id = pa.invoice_item_id
   WHERE pa.parent_package_id = p_package
  ORDER BY 1 DESC, 3, 7 DESC;
END;
$$;

-- Per billing month: lessons the package paid at marking (drawn), billable lessons still waiting for a run (no
-- invoice line, no live draw, no live settlement), and expected-but-unmarked lessons — counted with
-- class_unmarked_lesson_pairs, the SAME derivation as the coach's NEEDS MARKING list and the D6 guard (only
-- dates from markable_floor to today can be unmarked; older ones can no longer be marked). The Billing months
-- card reads "Nothing to bill — all package-funded" only for an UNSEALED, ENDED month with drawn ≥ 1,
-- waiting = 0 and unmarked = 0. DEFINER + billing:view, because package_applications RLS is packages:view.
CREATE FUNCTION public.package_month_funding(p_tenant UUID)
RETURNS TABLE (billing_month TEXT, drawn_lessons INTEGER, waiting_lessons INTEGER, unmarked_lessons INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(is_platform_admin() OR has_admin_area(p_tenant, 'billing', 'view'), false) THEN
    RAISE EXCEPTION 'not authorised to read this business''s billing months' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH marks AS (
    SELECT to_char(ls.session_date, 'YYYY-MM') AS m,
           count(*) FILTER (WHERE pa.id IS NOT NULL)::INTEGER AS drawn,
           count(*) FILTER (
             WHERE pa.id IS NULL
               AND NOT EXISTS (SELECT 1 FROM invoice_items ii
                                WHERE ii.lesson_session_id = a.lesson_session_id AND ii.student_id = a.student_id)
               AND NOT EXISTS (SELECT 1 FROM student_settlements ss
                                WHERE ss.student_id = a.student_id AND ss.reversed_at IS NULL
                                  AND ss.settled_through >= ls.session_date))::INTEGER AS waiting
      FROM attendance a
      JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
      JOIN classes c          ON c.id = ls.class_id
      LEFT JOIN package_applications pa
        ON pa.lesson_session_id = a.lesson_session_id AND pa.student_id = a.student_id AND pa.reversed_at IS NULL
     WHERE c.tenant_id = p_tenant
       AND a.status IN ('present', 'trial_paid')
     GROUP BY 1
  ),
  unmarked AS (
    SELECT to_char(p.session_date, 'YYYY-MM') AS m, count(*)::INTEGER AS n
      FROM classes c
      CROSS JOIN LATERAL class_unmarked_lesson_pairs(c.id) p
     WHERE c.tenant_id = p_tenant
     GROUP BY 1
  )
  SELECT COALESCE(mk.m, u.m), COALESCE(mk.drawn, 0), COALESCE(mk.waiting, 0), COALESCE(u.n, 0)
    FROM marks mk
    FULL OUTER JOIN unmarked u ON u.m = mk.m
   ORDER BY 1;
END;
$$;

-- ══ Grants (§7.87, §7.78): internal functions are callable by NOBODY; four RPCs by authenticated ════════════
REVOKE ALL ON FUNCTION public.package_candidates_for(UUID, UUID)   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.package_draw_for(UUID, UUID)         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.package_return_for(UUID, UUID)       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.class_unmarked_lesson_pairs(UUID)    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.package_backlog_lessons(UUID)        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.attendance_package_draw()            FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_invoice_item_not_drawn()       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_package_draw_order()           FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.package_backlog_preview(UUID)        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.draw_package_backlog(UUID)           FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.package_usage(UUID)                  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.package_month_funding(UUID)          FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.package_backlog_preview(UUID)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.draw_package_backlog(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.package_usage(UUID)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.package_month_funding(UUID)       TO authenticated;
