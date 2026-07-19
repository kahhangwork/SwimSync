-- Two corrections to platform_tenant_overview(), both the same mistake: showing
-- a STORED value where the honest answer is a DERIVED one.
--
-- 1. `kind` → `shape`. `tenants.kind` is an enum defaulting to 'private' that
--    NOTHING in the app ever sets or changes — the tenancy backfill hardcoded
--    it and no screen, RPC or admin control has touched it since. It is
--    reserved for future pricing and, per HANDOVER §6, exists for copy and must
--    never reach an RLS policy. Displaying it presented an unmaintained default
--    as a fact, and it would have read "private" for an actual swim school.
--    The real answer is the shape the data is in: a business whose only coach
--    is also its admin is a private coach — "a tenant of one" — and anything
--    else is a school. That self-corrects the day someone hires a second coach.
--
-- 2. `coaches_without_rate` → `staff_without_rate`. The old column counted EVERY
--    rate-less coach, which flagged an amber warning on every private coach's
--    row forever — for the state PRD §7.13 says is CORRECT:
--
--      "A coach is on payroll when they have a rate. There is no
--       private-vs-school flag: a private coach simply has no rate, because
--       their income IS their parents' invoices and there is nobody upstream
--       to pay them."
--
--    A coach who owns the business is paying themselves; no rate is right and
--    needs no prompt. A coach who does NOT own it and has no rate will be paid
--    NOTHING by payroll — that is the signal worth surfacing before month end,
--    and it is now the only one shown.
--
-- Both discriminate on whether the coach is the tenant's admin, NOT on
-- tenants.kind — coach *type* is never a rule in this codebase (§6), and the
-- column it would branch on is the unmaintained default described above.
--
-- DROP before CREATE: the return type changes, and CREATE OR REPLACE cannot
-- change a function's return type.

DROP FUNCTION IF EXISTS public.platform_tenant_overview();

CREATE FUNCTION public.platform_tenant_overview()
RETURNS TABLE (
  tenant_id             UUID,
  display_name          TEXT,
  shape                 TEXT,   -- DERIVED: 'private coach' | 'school'
  join_code             TEXT,
  active_students       INT,
  active_classes        INT,
  coaches               INT,
  staff_without_rate    INT,    -- coaches who are NOT the owner and have no rate
  last_attendance_date  DATE,
  sessions_this_month   INT,
  sessions_fully_marked INT,
  last_month_billing    TEXT,   -- 'sealed' | 'open' | 'never run'
  active_families       INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT is_platform_admin() AS ok),
  bounds AS (
    SELECT
      to_char((date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')) - INTERVAL '1 month'), 'YYYY-MM') AS last_month,
      date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))::date AS this_month_start,
      (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')) + INTERVAL '1 month')::date AS next_month_start
  )
  SELECT
    t.id,
    t.display_name,
    CASE
      WHEN (SELECT COUNT(*) FROM coaches co WHERE co.tenant_id = t.id) = 1
       AND EXISTS (
             SELECT 1 FROM coaches co
             JOIN profiles pr ON pr.id = co.profile_id
             WHERE co.tenant_id = t.id
               AND pr.role = 'tenant_admin' AND pr.tenant_id = t.id)
        THEN 'private coach'
      ELSE 'school'
    END,
    t.join_code,
    (SELECT COUNT(*)::INT FROM students s
       WHERE s.tenant_id = t.id AND s.is_active),
    (SELECT COUNT(*)::INT FROM classes c
       WHERE c.tenant_id = t.id AND c.is_active),
    (SELECT COUNT(*)::INT FROM coaches co
       WHERE co.tenant_id = t.id),
    (SELECT COUNT(*)::INT FROM coaches co
       JOIN profiles pr ON pr.id = co.profile_id
       WHERE co.tenant_id = t.id
         AND NOT (pr.role = 'tenant_admin' AND pr.tenant_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM coach_rates r WHERE r.coach_id = co.id)),
    (SELECT MAX(ls.session_date) FROM attendance a
       JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id),
    (SELECT COUNT(*)::INT FROM lesson_sessions ls
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id
         AND ls.session_date >= (SELECT this_month_start FROM bounds)
         AND ls.session_date <  (SELECT next_month_start FROM bounds)),
    (SELECT COUNT(*)::INT FROM lesson_sessions ls
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id
         AND ls.session_date >= (SELECT this_month_start FROM bounds)
         AND ls.session_date <  (SELECT next_month_start FROM bounds)
         AND (SELECT COUNT(*) FROM attendance a WHERE a.lesson_session_id = ls.id)
             >= (SELECT COUNT(*) FROM student_class_enrolments e
                   WHERE e.class_id = ls.class_id AND e.is_active)
         AND (SELECT COUNT(*) FROM student_class_enrolments e
                WHERE e.class_id = ls.class_id AND e.is_active) > 0),
    CASE
      WHEN EXISTS (SELECT 1 FROM billing_periods bp
                     WHERE bp.tenant_id = t.id
                       AND bp.billing_month = (SELECT last_month FROM bounds))
        THEN 'sealed'
      WHEN EXISTS (SELECT 1 FROM invoices i
                     WHERE i.tenant_id = t.id
                       AND i.billing_month = (SELECT last_month FROM bounds))
        THEN 'open'
      ELSE 'never run'
    END,
    (SELECT COUNT(*)::INT FROM parent_tenants pt
       WHERE pt.tenant_id = t.id AND pt.is_active)
  FROM tenants t, me
  WHERE me.ok                      -- THE GATE. No rows for anyone else.
  ORDER BY t.display_name;
$$;

COMMENT ON FUNCTION public.platform_tenant_overview() IS
  'Per-tenant operations overview for the platform admin. SECURITY DEFINER: '
  'gated on is_platform_admin() internally because it bypasses RLS. Business '
  'shape and staff-without-a-rate are DERIVED from whether each coach is also '
  'the tenant admin — never from tenants.kind, which nothing maintains. Returns '
  'facts about recorded rows only; it does not derive which lessons should have '
  'run (§7.18).';

-- The DROP took the grants with it, so re-apply both layers. CREATE FUNCTION
-- grants EXECUTE to PUBLIC by default, which includes anon (§7.35).
REVOKE ALL ON FUNCTION public.platform_tenant_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_tenant_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_tenant_overview() TO authenticated;
