-- ============================================================
-- ADVANCE-CANCEL EXTENDS A COVERING PREPAID PACKAGE
-- (BACKLOG.md → "Advance-cancel follow-ups", decided 2026-08-21).
--
-- A public holiday void extends the covering package by the tenant's
-- holiday_extension_days (20260818000700, the reconcile trigger). An advance
-- cancel (20260821000700) took a lesson away too, but did NOT give the package
-- family that week back. The user's call: it should — the SAME amount as a
-- holiday, from the SAME tenant setting (a lost lesson is a lost lesson).
--
-- ── WHY A SEPARATE MECHANISM, NOT THE HOLIDAY ONE ─────────────────────────────
-- The holiday reconcile is DRIVEN BY 'holiday' ATTENDANCE ROWS — an immutable
-- fact once written, so recomputing "desired truth" from them is stable. A
-- cancelled lesson has NO attendance rows (cancel_lesson refuses a session that
-- already has any), so the covered set must come from the ENROLMENTS active on
-- the cancelled date, resolved through the SAME holiday_covering_package()
-- (tenant + category + NOMINAL window + active, FIFO). But enrolments are
-- TIME-VARYING, and that is the whole design problem this file has to get right.
--
-- ── SNAPSHOT: KEYED PER CANCELLED LESSON, SCOPED PER (class, date) ─────────────
-- The state table is keyed (parent_package_id, class_id, session_date): one row
-- per (package, cancelled LESSON). apply_cancel_reconcile() takes a SINGLE
-- (class, date) and syncs ONLY that lesson's rows against ITS OWN enrolments at
-- the moment it fires. It never re-reads any OTHER lesson's covered set. So:
--   • A family that ENROLS after a lesson is cancelled is never retro-extended —
--     nothing re-fires that lesson's reconcile (there is deliberately NO
--     enrolment trigger), so its snapshot stands.
--   • Cancelling or restoring a DIFFERENT lesson on the same date cannot perturb
--     this lesson's extension — each lesson owns its own rows.
--   • A package that is PENDING at cancel time and confirmed later is NOT
--     retro-extended: holiday_covering_package() resolves active packages only,
--     and nothing re-fires the reconcile on confirmation. This is DELIBERATE and
--     differs from the holiday late-buyer trigger (20260818001000): a holiday is
--     a fixed calendar event a buyer cannot foresee, whereas a cancel is the
--     admin's own timed act. Pinned by the test; revisit if the product wants
--     late-confirmed packages to pick up prior cancels.
--
-- ── DEDUP IS PER CANCELLED LESSON, NOT PER DATE ───────────────────────────────
-- Two children in ONE class on ONE cancelled lesson => that package extends ONCE
-- (DISTINCT over the covered set of that one lesson). Two SEPARATE lessons
-- cancelled — even on the same calendar date — extend SEPARATELY (+N each). This
-- DIFFERS from the holiday model's per-DATE dedup on purpose: a public holiday is
-- one calendar event (one class or five, the day is lost once), a cancel is
-- per-lesson (each lesson is individually called off, each is its own loss).
-- (Accepted asymmetry: a cancel + a holiday on the same date for one package sum
-- to +2N, because they are two different losses recorded by two mechanisms.)
--
-- ── NO CASCADE (inherited free) ───────────────────────────────────────────────
-- holiday_covering_package() only resolves inside the package's NOMINAL window
-- [start_date, start_date + validity_weeks*7). A cancel outside it draws no
-- package, so an extension can never pull the window over a later cancel.
--
-- ── NO ENGINE CHANGE ──────────────────────────────────────────────────────────
-- The engine reads expires_on as "the ONE effective end" (core.ts) and does no
-- pre-billing recompute. Moving expires_on is all that is needed — exactly like
-- the holiday extension. This migration is DB-only; the engine is untouched.
--
-- Rollback: supabase/rollback/20260821000800_cancel_package_extension_DOWN.sql
-- (rehearsed — §7.93). Remote grant dump after deploy (§7.39, §7.89): the DROP+
-- CREATE of package_effective_end re-defaults its ACL, and apply_cancel_reconcile
-- is a new function — the cloud grants anon EXECUTE on new functions and the
-- local stack does not (§7.39), so a dump is the only honest check.
-- ============================================================


-- ── 1. The cancel accumulator column ────────────────────────────────────────
-- The third extension source alongside holiday_extension_days and
-- manual_extension_days. System-owned: the lifecycle trigger seeds it 0 and pins
-- it against client writes (both edited below); the reconcile is its only writer.

ALTER TABLE parent_packages
  ADD COLUMN cancel_extension_days INTEGER NOT NULL DEFAULT 0
    CHECK (cancel_extension_days >= 0);

COMMENT ON COLUMN parent_packages.cancel_extension_days IS
  'Total days added to this package''s validity by advance-cancelled lessons. Maintained by apply_cancel_reconcile to equal SUM(applied_days) over package_cancel_extensions. System-owned; clients cannot write it.';


-- ── 2. The state table — one row per (package, cancelled LESSON) ─────────────
-- Keyed by the LESSON (class_id, session_date), NOT just the date: that is what
-- makes each cancelled lesson's extension an independent snapshot that a later
-- cancel/restore of another lesson cannot recompute. applied_days is what was
-- added, read at cancel time; reversal deletes the row and never re-derives it,
-- so a cancel->restore is exactly inverse even if the tenant setting changed.

CREATE TABLE package_cancel_extensions (
  parent_package_id UUID NOT NULL REFERENCES parent_packages(id) ON DELETE CASCADE,
  class_id          UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_date      DATE NOT NULL,
  applied_days      INTEGER NOT NULL CHECK (applied_days > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (parent_package_id, class_id, session_date)
);

COMMENT ON TABLE package_cancel_extensions IS
  'One row per (package, advance-cancelled lesson) that extended the package. applied_days is what was added (read at cancel time); reversal deletes the row and never re-derives it. Maintained only by apply_cancel_reconcile, scoped to a single (class, date) so each lesson''s extension is an independent snapshot.';

ALTER TABLE package_cancel_extensions ENABLE ROW LEVEL SECURITY;

-- Read-only to app roles: the owning parent and the business's admins — the same
-- shape as package_holiday_extensions. Writes arrive exclusively via the DEFINER
-- reconcile (as postgres), so there is NO write policy and NO write grant;
-- table_grants.test.sql goes red on any grant a policy does not permit (§7.87),
-- and stranger_isolation needs an RLS-filtered 0 rows here, not a hard denial.
CREATE POLICY package_cancel_extensions_select ON package_cancel_extensions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM parent_packages pp
      WHERE pp.id = package_cancel_extensions.parent_package_id
        AND (
          is_platform_admin()
          OR can_admin_tenant(pp.tenant_id)
          OR pp.parent_id = current_parent_id()
        )
    )
  );

GRANT SELECT ON package_cancel_extensions TO authenticated;
GRANT ALL    ON package_cancel_extensions TO service_role;


-- ── 3. package_effective_end gains the cancel term ──────────────────────────
-- A fourth spine input. Postgres cannot ADD a parameter via CREATE OR REPLACE,
-- so this is a DROP + CREATE (the exact move 20260818000600 made for the
-- weeks->days rename), and a recreated function is callable by nobody until
-- re-GRANTed (§7.87) — the lifecycle trigger is a PLAIN trigger (runs as the
-- invoking authenticated role), so without the grant every package sale breaks.
-- All three live callers (dumped from pg_get_functiondef, not the creating
-- migration — §7.115) are re-created below to pass the cancel term.
DROP FUNCTION package_effective_end(DATE, INTEGER, INTEGER, INTEGER);

CREATE FUNCTION package_effective_end(
  p_start_date      DATE,
  p_validity_weeks  INTEGER,
  p_holiday_days    INTEGER,
  p_cancel_days     INTEGER,
  p_manual_days     INTEGER
) RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_start_date
       + (p_validity_weeks * 7)
       + p_holiday_days
       + p_cancel_days
       + p_manual_days;
$$;

REVOKE ALL     ON FUNCTION package_effective_end(DATE, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION package_effective_end(DATE, INTEGER, INTEGER, INTEGER, INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION package_effective_end(DATE, INTEGER, INTEGER, INTEGER, INTEGER)
  TO authenticated, service_role;


-- ── 4. enforce_parent_package_lifecycle — seed, pin, and feed the cancel term ─
-- Verbatim the LIVE body (dumped) except: seed cancel_extension_days := 0 on
-- INSERT, add it to the system-owned pin, and pass it (0 on a fresh package)
-- into both package_effective_end calls.
CREATE OR REPLACE FUNCTION public.enforce_parent_package_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product package_products%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_product FROM package_products WHERE id = NEW.product_id;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Unknown package product.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_product.is_active THEN
      RAISE EXCEPTION 'That package is no longer offered.' USING ERRCODE = 'check_violation';
    END IF;

    NEW.tenant_id       := v_product.tenant_id;
    NEW.name            := v_product.name;
    NEW.category_id     := v_product.category_id;
    NEW.lesson_count    := v_product.lesson_count;
    NEW.rate_per_lesson := v_product.rate_per_lesson;
    NEW.validity_months := v_product.validity_months;
    NEW.validity_weeks  := v_product.validity_weeks;
    NEW.total_value     := v_product.lesson_count * v_product.rate_per_lesson;
    NEW.value_remaining := NEW.total_value;
    NEW.cancelled_at    := NULL;
    NEW.discount_amount    := 0;
    NEW.amount_payable     := NEW.total_value;
    NEW.referral_reward_id := NULL;
    NEW.holiday_extension_days := 0;
    NEW.cancel_extension_days  := 0;
    NEW.manual_extension_days  := 0;
    NEW.paid_claimed_at := NULL;
    NEW.superseded_by   := NULL;

    IF current_user = 'authenticated' AND NOT can_admin_tenant(NEW.tenant_id) THEN
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.start_date   := NULL;
      NEW.expires_on   := NULL;
      NEW.offered_by   := NULL;
      NEW.offered_at   := NULL;
    ELSIF NEW.status = 'active' THEN
      NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.start_date   := COALESCE(NEW.start_date,
                                   (NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date);
      NEW.expires_on   := package_effective_end(NEW.start_date, NEW.validity_weeks,
                                                 NEW.holiday_extension_days,
                                                 NEW.cancel_extension_days,
                                                 NEW.manual_extension_days);
    ELSE
      NEW.status       := 'pending';
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
      NEW.expires_on   := NULL;
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE ---------------------------------------------------------------

  IF NEW.product_id      IS DISTINCT FROM OLD.product_id
     OR NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id
     OR NEW.parent_id       IS DISTINCT FROM OLD.parent_id
     OR NEW.name            IS DISTINCT FROM OLD.name
     OR NEW.category_id     IS DISTINCT FROM OLD.category_id
     OR NEW.lesson_count    IS DISTINCT FROM OLD.lesson_count
     OR NEW.rate_per_lesson IS DISTINCT FROM OLD.rate_per_lesson
     OR NEW.total_value     IS DISTINCT FROM OLD.total_value
     OR NEW.validity_months IS DISTINCT FROM OLD.validity_months
     OR NEW.validity_weeks  IS DISTINCT FROM OLD.validity_weeks
     OR NEW.requested_at    IS DISTINCT FROM OLD.requested_at
  THEN
    RAISE EXCEPTION 'A package''s terms are a record of the sale and cannot be edited.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user = 'authenticated'
     AND (NEW.holiday_extension_days IS DISTINCT FROM OLD.holiday_extension_days
          OR NEW.cancel_extension_days IS DISTINCT FROM OLD.cancel_extension_days
          OR NEW.manual_extension_days IS DISTINCT FROM OLD.manual_extension_days)
  THEN
    RAISE EXCEPTION 'Package extension fields are set by the system, not edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user = 'authenticated'
     AND (NEW.offered_by         IS DISTINCT FROM OLD.offered_by
          OR NEW.offered_at      IS DISTINCT FROM OLD.offered_at
          OR NEW.paid_claimed_at IS DISTINCT FROM OLD.paid_claimed_at
          OR NEW.superseded_by   IS DISTINCT FROM OLD.superseded_by)
  THEN
    RAISE EXCEPTION 'Offer and payment-claim fields are set by the system, not edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user = 'authenticated'
     AND (NEW.discount_amount    IS DISTINCT FROM OLD.discount_amount
          OR NEW.amount_payable     IS DISTINCT FROM OLD.amount_payable
          OR NEW.referral_reward_id IS DISTINCT FROM OLD.referral_reward_id)
  THEN
    RAISE EXCEPTION 'Referral discount fields are set by the system, not edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user = 'authenticated'
     AND NEW.start_date IS DISTINCT FROM OLD.start_date
  THEN
    IF NOT can_admin_tenant(OLD.tenant_id) THEN
      RAISE EXCEPTION 'Only the business sets a package''s start date.'
        USING ERRCODE = 'check_violation';
    ELSIF OLD.status = 'active' THEN
      RAISE EXCEPTION 'A package''s start date is fixed once active — cancel and re-sell to change it.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.value_remaining IS DISTINCT FROM OLD.value_remaining
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION 'A package balance is moved by billing, never edited directly.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pending' AND NEW.status = 'active' THEN
      IF current_user = 'authenticated' AND NOT can_admin_tenant(OLD.tenant_id) THEN
        RAISE EXCEPTION 'Only the business can confirm a package purchase.'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.confirmed_at := COALESCE(NULLIF(NEW.confirmed_at, OLD.confirmed_at), NOW());
      NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
      NEW.start_date   := COALESCE(NEW.start_date, OLD.start_date,
                                   (NEW.confirmed_at AT TIME ZONE 'Asia/Singapore')::date);
      NEW.expires_on   := package_effective_end(NEW.start_date, NEW.validity_weeks,
                                                 NEW.holiday_extension_days,
                                                 NEW.cancel_extension_days,
                                                 NEW.manual_extension_days);
    ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    ELSIF OLD.status = 'active' AND NEW.status = 'cancelled' THEN
      IF current_user = 'authenticated' AND NOT can_admin_tenant(OLD.tenant_id) THEN
        RAISE EXCEPTION 'Only the business can cancel an active package.'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    ELSE
      RAISE EXCEPTION 'Illegal package status change (% -> %).', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF current_user = 'authenticated'
       AND (NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
            OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
            OR NEW.expires_on   IS DISTINCT FROM OLD.expires_on
            OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at)
    THEN
      RAISE EXCEPTION 'Confirmation fields are set by the status transition, not edited.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


-- ── 5. extend_package — pass the cancel term into the formula ────────────────
-- Verbatim the LIVE body except the package_effective_end call gains
-- cancel_extension_days. (The manual arm still only touches manual_extension_days.)
CREATE OR REPLACE FUNCTION public.extend_package(p_package_id uuid, p_days integer, p_reason text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  pp parent_packages%ROWTYPE;
BEGIN
  SELECT * INTO pp FROM parent_packages WHERE id = p_package_id;
  IF pp.id IS NULL THEN
    RAISE EXCEPTION 'Unknown package.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT can_admin_tenant(pp.tenant_id) THEN
    RAISE EXCEPTION 'Not authorized to extend this package.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF pp.status <> 'active' THEN
    RAISE EXCEPTION 'Only an active package can be extended.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'Extension must be between 1 and 365 days.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE parent_packages SET
    manual_extension_days = manual_extension_days + p_days,
    expires_on = package_effective_end(start_date, validity_weeks,
                                       holiday_extension_days,
                                       cancel_extension_days,
                                       manual_extension_days + p_days)
  WHERE id = p_package_id;

  INSERT INTO package_extension_events (parent_package_id, kind, delta_days, reason, created_by)
  VALUES (p_package_id, 'manual', p_days, COALESCE(NULLIF(trim(p_reason), ''), 'Manual extension'),
          auth.uid());
END;
$function$;


-- ── 6. apply_holiday_reconcile — pass the cancel term into the formula ───────
-- Verbatim the LIVE body (comments included, §7.115) except the UPDATE's
-- package_effective_end call now carries pp.cancel_extension_days, so a holiday
-- reconcile no longer clobbers a package's cancel-extended expiry.
CREATE OR REPLACE FUNCTION public.apply_holiday_reconcile(p_dates date[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_touched UUID[];
BEGIN
  IF p_dates IS NULL OR array_length(p_dates, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Remove state rows no longer justified by a holiday lesson; add newly-justified
  -- ones (applied_days = the tenant's current setting; 0 => write nothing, RISK 11).
  -- Collect every package whose state changed so we can recompute its expiry once.
  WITH del AS (
    DELETE FROM package_holiday_extensions phe
    WHERE phe.holiday_date = ANY(p_dates)
      AND NOT EXISTS (
        SELECT 1
        FROM attendance a
        JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
        JOIN classes c          ON c.id  = ls.class_id
        WHERE a.status = 'holiday'
          AND ls.session_date = phe.holiday_date
          AND holiday_covering_package(a.student_id, ls.session_date, c.category_id, c.tenant_id) = phe.parent_package_id
      )
    RETURNING phe.parent_package_id
  ),
  ins AS (
    INSERT INTO package_holiday_extensions (parent_package_id, holiday_date, applied_days)
    SELECT DISTINCT
           holiday_covering_package(a.student_id, ls.session_date, c.category_id, c.tenant_id) AS pkg,
           ls.session_date,
           t.holiday_extension_days
    FROM attendance a
    JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
    JOIN classes c          ON c.id  = ls.class_id
    JOIN parent_packages pp ON pp.id = holiday_covering_package(a.student_id, ls.session_date, c.category_id, c.tenant_id)
    JOIN tenants t          ON t.id  = pp.tenant_id
    WHERE a.status = 'holiday'
      AND ls.session_date = ANY(p_dates)
      AND t.holiday_extension_days > 0
    ON CONFLICT (parent_package_id, holiday_date) DO NOTHING
    RETURNING parent_package_id
  )
  SELECT array_agg(DISTINCT pid) INTO v_touched
  FROM (SELECT parent_package_id AS pid FROM del
        UNION
        SELECT parent_package_id FROM ins) u;

  IF v_touched IS NULL THEN
    RETURN;
  END IF;

  -- Serialize concurrent reconciles on the same package, then rewrite its
  -- accumulator = SUM(applied_days) and its expiry from the spine formula.
  -- ORDER BY so two overlapping reconciles lock in the same order (no deadlock).
  PERFORM 1 FROM parent_packages WHERE id = ANY(v_touched) ORDER BY id FOR UPDATE;

  UPDATE parent_packages pp SET
    holiday_extension_days = COALESCE(
      (SELECT SUM(applied_days) FROM package_holiday_extensions WHERE parent_package_id = pp.id), 0)::int,
    expires_on = package_effective_end(
      pp.start_date, pp.validity_weeks,
      COALESCE((SELECT SUM(applied_days) FROM package_holiday_extensions WHERE parent_package_id = pp.id), 0)::int,
      pp.cancel_extension_days,
      pp.manual_extension_days)
  WHERE pp.id = ANY(v_touched)
    AND pp.start_date IS NOT NULL;
END;
$function$;


-- ── 7. apply_cancel_reconcile — SINGLE (class, date), the snapshot unit ──────
-- Syncs ONLY this lesson's rows against ITS OWN enrolments right now. Because it
-- never reads any other lesson's covered set, each cancelled lesson's extension
-- is an independent snapshot: a later cancel/restore elsewhere, or an enrolment
-- that arrives after this cancel, cannot move it. DEFINER: it must see enrolments
-- and packages across RLS, and it is only ever reached from the DEFINER triggers.
CREATE FUNCTION apply_cancel_reconcile(p_class_id UUID, p_date DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_touched UUID[];
BEGIN
  IF p_class_id IS NULL OR p_date IS NULL THEN
    RETURN;
  END IF;

  WITH del AS (
    -- Drop rows for THIS lesson no longer justified: the lesson is no longer
    -- cancelled (a restore or a delete), or the covering enrolment is gone.
    DELETE FROM package_cancel_extensions pce
    WHERE pce.class_id = p_class_id
      AND pce.session_date = p_date
      AND NOT EXISTS (
        SELECT 1
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
        JOIN student_class_enrolments e
          ON e.class_id = ls.class_id
         AND (e.enrolled_at   AT TIME ZONE 'Asia/Singapore')::date <= ls.session_date
         AND (e.unenrolled_at IS NULL
              OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= ls.session_date)
        WHERE ls.class_id = p_class_id
          AND ls.session_date = p_date
          AND ls.cancelled_at IS NOT NULL
          AND holiday_covering_package(e.student_id, ls.session_date, c.category_id, c.tenant_id)
              = pce.parent_package_id
      )
    RETURNING pce.parent_package_id
  ),
  ins AS (
    -- Add rows for the packages covering THIS lesson's currently-enrolled kids,
    -- if it is cancelled and the tenant grants > 0 days. DISTINCT dedups siblings
    -- sharing one package on this one lesson.
    INSERT INTO package_cancel_extensions (parent_package_id, class_id, session_date, applied_days)
    SELECT DISTINCT
           holiday_covering_package(e.student_id, ls.session_date, c.category_id, c.tenant_id) AS pkg,
           p_class_id,
           p_date,
           t.holiday_extension_days
    FROM lesson_sessions ls
    JOIN classes c ON c.id = ls.class_id
    JOIN student_class_enrolments e
      ON e.class_id = ls.class_id
     AND (e.enrolled_at   AT TIME ZONE 'Asia/Singapore')::date <= ls.session_date
     AND (e.unenrolled_at IS NULL
          OR (e.unenrolled_at AT TIME ZONE 'Asia/Singapore')::date >= ls.session_date)
    JOIN parent_packages pp
      ON pp.id = holiday_covering_package(e.student_id, ls.session_date, c.category_id, c.tenant_id)
    JOIN tenants t ON t.id = c.tenant_id
    WHERE ls.class_id = p_class_id
      AND ls.session_date = p_date
      AND ls.cancelled_at IS NOT NULL
      AND t.holiday_extension_days > 0
    ON CONFLICT (parent_package_id, class_id, session_date) DO NOTHING
    RETURNING parent_package_id
  )
  SELECT array_agg(DISTINCT pid) INTO v_touched
  FROM (SELECT parent_package_id AS pid FROM del
        UNION
        SELECT parent_package_id FROM ins) u;

  IF v_touched IS NULL THEN
    RETURN;
  END IF;

  -- Serialize concurrent reconciles on the same package (ORDER BY => no
  -- deadlock), then rewrite its cancel accumulator (SUM over ALL its cancelled
  -- lessons) and expiry from the spine.
  PERFORM 1 FROM parent_packages WHERE id = ANY(v_touched) ORDER BY id FOR UPDATE;

  UPDATE parent_packages pp SET
    cancel_extension_days = COALESCE(
      (SELECT SUM(applied_days) FROM package_cancel_extensions WHERE parent_package_id = pp.id), 0)::int,
    expires_on = package_effective_end(
      pp.start_date, pp.validity_weeks,
      pp.holiday_extension_days,
      COALESCE((SELECT SUM(applied_days) FROM package_cancel_extensions WHERE parent_package_id = pp.id), 0)::int,
      pp.manual_extension_days)
  WHERE pp.id = ANY(v_touched)
    AND pp.start_date IS NOT NULL;
END;
$$;

-- Callable by NOBODY but its owner: the only callers are the DEFINER triggers
-- below, which reach it as postgres. Same posture as apply_holiday_reconcile
-- (postgres=X/postgres) — anon must not hold EXECUTE (function_grants.test.sql).
REVOKE ALL ON FUNCTION apply_cancel_reconcile(UUID, DATE) FROM PUBLIC, anon, authenticated, service_role;


-- ── 8. The reconcile triggers — react to a lesson's cancellation flip ────────
-- Three row-level triggers with WHEN clauses (the holiday twin's fan shape), so
-- the function is not even entered on an ordinary session write, and DELETE is
-- covered:
--   INSERT  — a lazy session created already cancelled (cancel_lesson).
--   UPDATE  — a session flagged or unflagged (cancel_lesson / restore_lesson),
--             or a cancelled session's (class, date) MOVED: reconcile the OLD
--             pair (retract there) and the NEW pair (apply there).
--   DELETE  — a cancelled session deleted raw (sessions_write is FOR ALL and
--             guard_session_date does not fire on DELETE): retract its rows, or
--             they strand with nothing ever firing that (class, date) again.
-- DEFINER for parity; the calling RPCs are already DEFINER.
CREATE FUNCTION cancel_package_reconcile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM apply_cancel_reconcile(NEW.class_id, NEW.session_date);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM apply_cancel_reconcile(OLD.class_id, OLD.session_date);
  ELSE  -- UPDATE
    PERFORM apply_cancel_reconcile(OLD.class_id, OLD.session_date);
    IF NEW.class_id IS DISTINCT FROM OLD.class_id
       OR NEW.session_date IS DISTINCT FROM OLD.session_date THEN
      PERFORM apply_cancel_reconcile(NEW.class_id, NEW.session_date);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION cancel_package_reconcile() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_cancel_package_reconcile_ins
  AFTER INSERT ON lesson_sessions
  FOR EACH ROW
  WHEN (NEW.cancelled_at IS NOT NULL)
  EXECUTE FUNCTION cancel_package_reconcile();

CREATE TRIGGER trg_cancel_package_reconcile_upd
  AFTER UPDATE ON lesson_sessions
  FOR EACH ROW
  WHEN ((NEW.cancelled_at IS NOT NULL OR OLD.cancelled_at IS NOT NULL)
        AND (NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
             OR NEW.session_date IS DISTINCT FROM OLD.session_date
             OR NEW.class_id IS DISTINCT FROM OLD.class_id))
  EXECUTE FUNCTION cancel_package_reconcile();

CREATE TRIGGER trg_cancel_package_reconcile_del
  AFTER DELETE ON lesson_sessions
  FOR EACH ROW
  WHEN (OLD.cancelled_at IS NOT NULL)
  EXECUTE FUNCTION cancel_package_reconcile();


-- ── 9. Apply-time probes (§7.87, §7.123) — RAISE, do not warn ────────────────
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc
       WHERE proname = 'package_effective_end' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'package_effective_end has a stray overload — a 4-arg copy survived the DROP (§7.124)';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.package_effective_end(date,integer,integer,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'package_effective_end lost EXECUTE for authenticated — every package sale would break (§7.87)';
  END IF;
  IF has_function_privilege('anon', 'public.package_effective_end(date,integer,integer,integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.apply_cancel_reconcile(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a new function is EXECUTE-able by anon — see §7.82';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgname IN ('trg_cancel_package_reconcile_ins',
                        'trg_cancel_package_reconcile_upd',
                        'trg_cancel_package_reconcile_del')) <> 3 THEN
    RAISE EXCEPTION 'the cancel-reconcile trigger fan is incomplete — cancels/restores/deletes would desync packages';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'parent_packages' AND column_name = 'cancel_extension_days') THEN
    RAISE EXCEPTION 'parent_packages.cancel_extension_days is missing';
  END IF;
END $$;
