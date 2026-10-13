-- Remove the legacy package matcher — BACKLOG Wave 9 item 9 (filed 2026-10-10, un-gated 2026-10-12).
--
-- WHAT. A package pays for a lesson ONE way: drawn at marking by the attendance trigger (package_candidates_for is
-- the one matching rule — Wave 6, 20261006000100). The other way — the billing engine matching packages at the
-- monthly run when tenants.package_draw_at_marking was false — is gone: engine v36 stopped reading the switch and
-- this migration drops it, with everything that existed only to respect it:
--   • the switch's early-outs in attendance_package_draw(), guard_package_draw_order(), draw_package_backlog();
--   • single-child packages' D9 guards — assert_package_child()'s refusal, and guard_one_child_packages_flag() with
--     its trigger (20261010000100);
--   • package_live_balances()'s flag-off simulation (it now returns the stored balance — the draw already moved it);
--   • package_backfill_draws() — Wave 6 B's one-shot backfill, called by nothing since that migration ran;
--   • the column's "nobody" key in guard_tenant_columns().
--
-- WHY NOW. Every tenant has drawn at marking since Wave 6 B (all 3 on prod, re-read 2026-10-13), the column default
-- is true, and no client can change it. Little Orcas sealed Sep 2026 holding live draws, so B's rollback already
-- refuses (its header's limit) — removing the old path costs no rollback ability. Old invoices' "Paid by package"
-- lines and their invoice-time package_applications rows are stored data and are untouched; the credit-note path
-- that reverses them (package_corrections) keeps working.
--
-- BEHAVIOUR. With the switch on, every function below behaves exactly as before: each edit removes only the switch
-- test. Where the test also absorbed a missing row (COALESCE(..., false) on a NULL tenant), the NULL case keeps its
-- old outcome — guard_package_draw_order() still returns NEW when the session's tenant cannot be read.
--
-- ORDER (contract): engine v36 (reads no switch) is live BEFORE this runs — v35 fails closed on a missing column.
-- Bodies re-bodied from pg_get_functiondef() on the DB, never an older migration (§7.40); prod md5 = local md5 for
-- all 8 on 2026-10-13. CREATE OR REPLACE keeps each function's grants.
--
-- Rollback: supabase/rollback/20261013000100_remove_legacy_package_matcher_DOWN.sql.

-- ══ Drop what only the switch needed ════════════════════════════════════════════════════════════════════════════

DROP TRIGGER trg_guard_one_child_packages_flag ON public.tenants;
DROP FUNCTION public.guard_one_child_packages_flag();
DROP FUNCTION public.package_backfill_draws();

-- ══ The switch's readers, each minus the switch ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.attendance_package_draw()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                  WHERE ls.id = v_session) THEN
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
$function$;

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
    IF v_tenant IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT pp.id, pp.parent_id, pp.category_id, pp.start_date, pp.expires_on,
           pp.rate_per_lesson, pp.value_remaining, pp.student_id
      INTO v_pkg
      FROM package_candidates_for(NEW.lesson_session_id, NEW.student_id) c
      JOIN parent_packages pp ON pp.id = c.package_id
     WHERE c.value_remaining >= c.rate
     ORDER BY c.draw_rank
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
           -- Single-child packages (20261010000100): a one-child package is claimed by its own child only.
           AND (v_pkg.student_id IS NULL OR p.student_id = v_pkg.student_id)
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
$function$;

CREATE OR REPLACE FUNCTION public.draw_package_backlog(p_package uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.assert_package_child(p_tenant uuid, p_parent uuid, p_student uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM parent_students ps
                  WHERE ps.parent_id = p_parent AND ps.student_id = p_student) THEN
    RAISE EXCEPTION 'That child is not in this family.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM students s WHERE s.id = p_student AND s.tenant_id = p_tenant) THEN
    RAISE EXCEPTION 'That child belongs to another business.' USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;

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
    "credit_note_counter":"nobody","invoice_counter":"nobody","package_counter":"nobody"
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

CREATE OR REPLACE FUNCTION public.package_live_balances()
 RETURNS TABLE(parent_package_id uuid, parent_id uuid, tenant_id uuid, name text, category_id uuid, rate_per_lesson numeric, lesson_count integer, total_value numeric, expires_on date, value_remaining numeric, live_value_remaining numeric, live_lessons_remaining integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Every lesson a package pays for is drawn AT MARKING, so the stored balance IS the live one. The simulation of
  -- un-invoiced lessons this used to run served only the removed pay-at-the-run matcher. Invoker rights (RLS
  -- scopes the rows), FIFO order and the RETURNS TABLE shape are unchanged, so every caller reads it as before.
  SELECT pp.id, pp.parent_id, pp.tenant_id, pp.name, pp.category_id,
         pp.rate_per_lesson, pp.lesson_count, pp.total_value, pp.expires_on,
         pp.value_remaining,
         pp.value_remaining,
         floor(pp.value_remaining / pp.rate_per_lesson)::integer
    FROM parent_packages pp
   WHERE pp.status = 'active'
   ORDER BY pp.expires_on, pp.confirmed_at, pp.id
$function$;

-- ══ The switch itself ══════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tenants DROP COLUMN package_draw_at_marking;
