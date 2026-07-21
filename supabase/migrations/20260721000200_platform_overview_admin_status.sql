-- ============================================================
-- Surface each business's ADMIN on the platform overview.
--
-- WHY. Provisioning a tenant and inviting its first admin are two writes that
-- cannot share a transaction (the auth trigger refuses to create a tenant_admin
-- without an existing tenant_id, so the tenant must be committed first). The
-- window between them has a genuinely bad intermediate state: a business that
-- is LIVE and JOINABLE — its join code works — with nobody able to administer
-- it. The provision-tenant API route compensates by deleting the tenant when the
-- invite fails, but a compensation that silently misfires leaves no trace. These
-- columns are the backstop that makes such a tenant visible instead.
--
-- WHY DROP AND RECREATE. A RETURNS TABLE signature change cannot use
-- CREATE OR REPLACE.
--
-- !! THE BODY BELOW IS COPIED VERBATIM FROM 20260719002400 — *NOT* FROM 002300.
-- This function has been redefined twice. Building this migration from 002300
-- (the one whose filename you find first) silently REVERTS 002400's work: it
-- restores `kind` over the derived `shape`, and `coaches_without_rate` over
-- `staff_without_rate`. That mistake was made and caught while writing this
-- file, by diffing against pg_get_functiondef() rather than against a guessed
-- source file. Before editing this function again, get its CURRENT definition
-- from the DATABASE:
--   SELECT pg_get_functiondef('public.platform_tenant_overview()'::regprocedure);
--
-- The only changes from 002400 are the two output columns and the two
-- subqueries that fill them. Nothing else moved.
--   DO NOT "tidy" the aggregate subqueries while in here — their comments record
--   why they count rows-that-exist rather than deriving expected lessons, which
--   is the fourth-copy mistake that caused a live underbill (§7.18).
--
-- Reading auth.users is safe here: this function is already SECURITY DEFINER
-- owned by postgres, and its is_platform_admin() gate is unchanged.
-- ============================================================

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
  active_families       INT,
  -- The business's own admin, and whether they have ever actually signed in.
  -- last_sign_in_at is the honest signal: a profiles row proves an invite was
  -- issued, not that anyone can operate the business. 'none' means a tenant
  -- exists with NO admin at all — it is still joinable by parents via its join
  -- code, so the UI must render it as a fault, not a blank.
  admin_email           TEXT,
  admin_status          TEXT    -- 'none' | 'invited' | 'active'
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
       WHERE pt.tenant_id = t.id AND pt.is_active),
    (SELECT pr.email FROM profiles pr
       WHERE pr.tenant_id = t.id AND pr.role = 'tenant_admin'
       ORDER BY pr.created_at LIMIT 1),
    COALESCE((
      SELECT CASE WHEN u.last_sign_in_at IS NULL THEN 'invited' ELSE 'active' END
      FROM profiles pr
      JOIN auth.users u ON u.id = pr.id
      WHERE pr.tenant_id = t.id AND pr.role = 'tenant_admin'
      ORDER BY pr.created_at LIMIT 1
    ), 'none')
  FROM tenants t, me
  WHERE me.ok                      -- THE GATE. No rows for anyone else.
  ORDER BY t.display_name;
$$;

COMMENT ON FUNCTION public.platform_tenant_overview() IS
  'Per-tenant operations overview for the platform admin. SECURITY DEFINER: '
  'gated on is_platform_admin() internally because it bypasses RLS. `shape` is '
  'DERIVED from whether the only coach is also the tenant admin — never from '
  'tenants.kind, which nothing maintains. Returns facts about recorded rows '
  'only; it deliberately does NOT derive which lessons should have run (§7.18). '
  'admin_status comes from auth.users.last_sign_in_at: ''none'' means the '
  'business has no admin at all and is still joinable — treat it as a fault.';

-- The DROP above took the grants with it. Restore them exactly.
REVOKE ALL ON FUNCTION public.platform_tenant_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_tenant_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_tenant_overview() TO authenticated;
