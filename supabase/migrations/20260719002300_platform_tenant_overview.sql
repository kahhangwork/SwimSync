-- Per-tenant operations overview for the PLATFORM admin.
--
-- WHY AN RPC AND NOT CLIENT-SIDE QUERIES.
-- PostgREST caps every response at `max_rows = 1000` (supabase/config.toml) and
-- does so SILENTLY — no error, just fewer rows. A platform admin reads every
-- tenant's rows, so aggregating `students`/`attendance`/`lesson_sessions` in the
-- browser is correct today (one tenant, no attendance) and quietly wrong later,
-- with nothing to mark the transition. That is the failure family of §7.17 and
-- §7.32: a measure that is vacuously right until it isn't. Aggregating in
-- Postgres has no such ceiling and replaces the page's N+1 count loop with one
-- round trip.
--
-- WHAT THIS DELIBERATELY DOES NOT RETURN: "unmarked lessons this month".
-- Deriving which lessons SHOULD have run needs the expected-lesson-dates rule
-- (from classes.day_of_week), which already exists in THREE hand-written copies
-- — SwimSyncAdmin/lib/lessonDates.ts, SwimSyncApp/lib/lessonDates.ts and
-- generate-invoices/dates.ts. §7.18 records what a fourth costs: the copies
-- drifted, the engine's was wrong, and it produced a live underbill that only
-- the admin UI caught. So this returns FACTS, not judgements:
--   • sessions_this_month / sessions_fully_marked count rows that EXIST
--   • last_attendance_date is the liveness signal, and needs no rule at all
-- A lesson nobody touched has no session row (PRD §7.5), so these cannot see it
-- — which is exactly why they must never be labelled "unmarked lessons".
--
-- SECURITY. SECURITY DEFINER runs as the owner and BYPASSES RLS, so this
-- function's own gate is the entire boundary. Without it any authenticated user
-- — a parent — could read every business's counts, billing state and JOIN CODE,
-- and possession of a join code is the only proof a family deals with a business
-- (PRD §5.1). Two layers, deliberately:
--   1. the REVOKE/GRANT below (CREATE FUNCTION grants EXECUTE to PUBLIC by
--      default, which includes anon), and
--   2. the is_platform_admin() gate as the first thing the body does.
-- It returns ZERO ROWS rather than raising: a support tool that 500s is
-- indistinguishable from an outage.

CREATE OR REPLACE FUNCTION public.platform_tenant_overview()
RETURNS TABLE (
  tenant_id             UUID,
  display_name          TEXT,
  kind                  TEXT,
  join_code             TEXT,
  active_students       INT,
  active_classes        INT,
  coaches               INT,
  coaches_without_rate  INT,
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
  -- The billing month a platform admin is actually asking about: the last
  -- COMPLETE one. Same rule the engine enforces (previousBillingMonth) and the
  -- admin's month picker caps to.
  bounds AS (
    SELECT
      to_char((date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')) - INTERVAL '1 month'), 'YYYY-MM') AS last_month,
      date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore'))::date AS this_month_start,
      (date_trunc('month', (now() AT TIME ZONE 'Asia/Singapore')) + INTERVAL '1 month')::date AS next_month_start
  )
  SELECT
    t.id,
    t.display_name,
    t.kind::TEXT,
    t.join_code,
    (SELECT COUNT(*)::INT FROM students s
       WHERE s.tenant_id = t.id AND s.is_active),
    (SELECT COUNT(*)::INT FROM classes c
       WHERE c.tenant_id = t.id AND c.is_active),
    (SELECT COUNT(*)::INT FROM coaches co
       WHERE co.tenant_id = t.id),
    -- A coach with no rate is deliberately NOT on payroll (PRD §7.13), so this
    -- is a prompt, not an error — but it is the reason payroll silently
    -- computes nothing, which is worth surfacing before month end.
    (SELECT COUNT(*)::INT FROM coaches co
       WHERE co.tenant_id = t.id
         AND NOT EXISTS (SELECT 1 FROM coach_rates r WHERE r.coach_id = co.id)),
    -- Liveness. NULL when nothing has ever been marked — the UI must render
    -- that as "never", not as a date and not as a zero.
    (SELECT MAX(ls.session_date) FROM attendance a
       JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id),
    (SELECT COUNT(*)::INT FROM lesson_sessions ls
       JOIN classes c ON c.id = ls.class_id
       WHERE c.tenant_id = t.id
         AND ls.session_date >= (SELECT this_month_start FROM bounds)
         AND ls.session_date <  (SELECT next_month_start FROM bounds)),
    -- "Fully marked" here means every ACTIVE enrolment in that class has an
    -- attendance row on that session — the cheap half of the completeness rule,
    -- and a fact about rows that exist. It says nothing about lessons that were
    -- never recorded; see the header.
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
    -- billing_periods is keyed (tenant_id, billing_month) since 20260718001100
    -- — keying on the month alone would read one tenant's seal as everyone's.
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
  'gated on is_platform_admin() internally because it bypasses RLS. Returns '
  'facts about recorded rows only — it deliberately does NOT derive which '
  'lessons should have run (that rule lives in lessonDates/dates.ts; a fourth '
  'copy is what §7.18 warns about).';

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, which includes anon.
-- The body's gate would still hold, but defence in depth is cheap here and the
-- default is a trap worth closing explicitly.
REVOKE ALL ON FUNCTION public.platform_tenant_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_tenant_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_tenant_overview() TO authenticated;

-- Parents who registered but never entered a join code: they belong to no
-- business, so no tenant admin can see them and nothing surfaces them today.
-- This is exactly the case reassign_student_tenant() exists to fix.
CREATE OR REPLACE FUNCTION public.platform_stranded_parents()
RETURNS TABLE (parent_id UUID, full_name TEXT, email TEXT, joined_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, pr.full_name, pr.email, p.created_at
  FROM parents p
  JOIN profiles pr ON pr.id = p.profile_id
  WHERE is_platform_admin()
    AND NOT EXISTS (SELECT 1 FROM parent_tenants pt WHERE pt.parent_id = p.id)
  ORDER BY p.created_at DESC;
$$;

COMMENT ON FUNCTION public.platform_stranded_parents() IS
  'Parents with no business at all — registered but never entered a join code. '
  'SECURITY DEFINER, gated on is_platform_admin().';

REVOKE ALL ON FUNCTION public.platform_stranded_parents() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_stranded_parents() FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_stranded_parents() TO authenticated;
