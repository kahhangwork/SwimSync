-- ============================================================
-- Holiday attendance, step 4a: the event-driven reconcile.
--
-- Replaces the calendar-scan recompute (neutered in 20260818000600) with a
-- trigger that maintains each package's holiday extension from the 'holiday'
-- attendance rows themselves. Marking a lesson 'holiday' extends the covering
-- package by the tenant's holiday_extension_days; un-marking retracts it.
--
-- STATE vs AUDIT are separate (⚠ plan RISK 3):
--   package_holiday_extensions — dedup STATE. One row per (package, holiday_date);
--     inserted on apply, DELETED on retract. Its applied_days is the source of
--     truth for reversal, so a retract NEVER re-reads tenants.holiday_extension_days
--     and mark->unmark is exactly inverse even if the setting changed between.
--   package_extension_events    — append-only AUDIT (unchanged, no unique index).
--
-- DEDUP PER (package, date) (the user's sibling case): two children sharing one
-- package, one holiday, both lessons voided -> DISTINCT collapses them to one
-- desired row, so the package extends ONCE.
--
-- NO CASCADE: coverage is judged against the package's NOMINAL window
-- (start_date .. start_date + validity_weeks*7), never expires_on — identical to
-- the retired recompute (20260815000200), so an extension never pulls in more
-- holidays.
-- ============================================================

-- 1. Dedup state.
CREATE TABLE package_holiday_extensions (
  parent_package_id UUID  NOT NULL REFERENCES parent_packages(id) ON DELETE CASCADE,
  holiday_date      DATE  NOT NULL,
  applied_days      INTEGER NOT NULL CHECK (applied_days > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (parent_package_id, holiday_date)
);

COMMENT ON TABLE package_holiday_extensions IS
  'One row per (package, holiday date) that extended the package. applied_days is what was added (read at apply time); reversal deletes the row and never re-derives it. Maintained only by the reconcile trigger.';

ALTER TABLE package_holiday_extensions ENABLE ROW LEVEL SECURITY;

-- Read-only to app roles: the owning parent and the business's admins — the same
-- shape as package_extension_events (20260815000200). Writes arrive exclusively
-- via the SECURITY DEFINER reconcile (as postgres), so there is NO write policy
-- and NO write grant; table_grants.test.sql would go red on any grant a policy
-- does not permit (§7.87), and stranger_isolation.test.sql needs an RLS-filtered
-- 0 rows here, not a hard permission-denied.
CREATE POLICY package_holiday_extensions_select ON package_holiday_extensions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM parent_packages pp
      WHERE pp.id = package_holiday_extensions.parent_package_id
        AND (
          is_platform_admin()
          OR can_admin_tenant(pp.tenant_id)
          OR pp.parent_id = current_parent_id()
        )
    )
  );

GRANT SELECT ON package_holiday_extensions TO authenticated;
GRANT ALL    ON package_holiday_extensions TO service_role;

-- 2. Coverage resolver — the package a lesson for this student, on this date, in a
--    class of this category WOULD have drawn. TENANT + category + NOMINAL window +
--    active, FIFO by expiry — the engine's order (core.ts) minus its affordability
--    rule, so mark-before-bill and mark-after-bill resolve to the same package.
--    The tenant filter mirrors the engine's .eq("tenant_id", tenantId): a parent in
--    two businesses holding an all-classes (category NULL) package in one must not
--    have it extended by the OTHER business's holiday — the engine would never draw
--    it for that lesson.
CREATE FUNCTION holiday_covering_package(
  p_student_id  UUID,
  p_date        DATE,
  p_category_id UUID,
  p_tenant_id   UUID
) RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pp.id
  FROM parent_packages pp
  JOIN parent_students ps ON ps.parent_id = pp.parent_id
  WHERE ps.student_id = p_student_id
    AND pp.tenant_id = p_tenant_id
    AND pp.status = 'active'
    AND (pp.category_id IS NULL OR pp.category_id = p_category_id)
    AND p_date >= pp.start_date
    AND p_date <  pp.start_date + (pp.validity_weeks * 7)
  ORDER BY pp.expires_on, pp.confirmed_at, pp.id
  LIMIT 1;
$$;

-- 3. Reconcile a set of dates: sync the state table to the current 'holiday'
--    attendance on those dates, then recompute the touched packages' accumulator
--    and expires_on. Idempotent — it recomputes desired truth from scratch, so
--    firing twice in one statement (an upsert fires INSERT and UPDATE) converges.
CREATE FUNCTION apply_holiday_reconcile(p_dates DATE[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      pp.manual_extension_days)
  WHERE pp.id = ANY(v_touched)
    AND pp.start_date IS NOT NULL;
END;
$$;

-- 4. The trigger fan: three single-event triggers (transition tables are rejected
--    on a multi-event trigger), one shared function. Early-exit before any write
--    when no transition row is 'holiday' — the hot path is every ordinary save.
CREATE FUNCTION holiday_reconcile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dates DATE[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT ls.session_date) INTO v_dates
    FROM newtab n JOIN lesson_sessions ls ON ls.id = n.lesson_session_id
    WHERE n.status = 'holiday';
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT ls.session_date) INTO v_dates
    FROM oldtab o JOIN lesson_sessions ls ON ls.id = o.lesson_session_id
    WHERE o.status = 'holiday';
  ELSE  -- UPDATE
    SELECT array_agg(DISTINCT d) INTO v_dates FROM (
      SELECT ls.session_date AS d FROM newtab n JOIN lesson_sessions ls ON ls.id = n.lesson_session_id WHERE n.status = 'holiday'
      UNION
      SELECT ls.session_date     FROM oldtab o JOIN lesson_sessions ls ON ls.id = o.lesson_session_id WHERE o.status = 'holiday'
    ) u;
  END IF;

  IF v_dates IS NOT NULL THEN
    PERFORM apply_holiday_reconcile(v_dates);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_holiday_reconcile_ins
  AFTER INSERT ON attendance
  REFERENCING NEW TABLE AS newtab
  FOR EACH STATEMENT EXECUTE FUNCTION holiday_reconcile();

CREATE TRIGGER trg_holiday_reconcile_upd
  AFTER UPDATE ON attendance
  REFERENCING OLD TABLE AS oldtab NEW TABLE AS newtab
  FOR EACH STATEMENT EXECUTE FUNCTION holiday_reconcile();

CREATE TRIGGER trg_holiday_reconcile_del
  AFTER DELETE ON attendance
  REFERENCING OLD TABLE AS oldtab
  FOR EACH STATEMENT EXECUTE FUNCTION holiday_reconcile();
