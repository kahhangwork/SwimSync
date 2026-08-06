-- ROLLBACK for 20260806000100_co_admins.sql (§8.31).
--
-- Committed, findable, and written BEFORE the deploy — the 2026-08-04 pattern
-- (a scratchpad backup nobody can find is not a rollback plan). Restores every
-- REPLACEd function to its pre-migration body and drops everything the
-- migration added. Run only if co-admin management must be backed out wholesale;
-- any co-admin accounts already invited will KEEP working as plain
-- tenant_admins (the RLS model always allowed N per tenant) — they just lose
-- the owner gate, the guards and the deactivation switch, so remove any
-- unwanted co-admin profiles FIRST or they become unmanageable.

BEGIN;

-- ── The RPCs and helpers this migration introduced ───────────────────────────
DROP FUNCTION IF EXISTS public.prepare_admin_delete(UUID);
DROP FUNCTION IF EXISTS public.remove_admin_role(UUID);
DROP FUNCTION IF EXISTS public.reactivate_admin(UUID);
DROP FUNCTION IF EXISTS public.deactivate_admin(UUID);
DROP FUNCTION IF EXISTS public.profile_reference_columns();
DROP FUNCTION IF EXISTS public.is_tenant_owner(UUID);

-- ── The guard triggers ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS profiles_guard_privileges ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profiles_privileges();
DROP TRIGGER IF EXISTS tenants_guard_owner ON public.tenants;
DROP FUNCTION IF EXISTS public.guard_tenants_owner();

-- ── is_tenant_admin: pre-migration body (20260718000900) ─────────────────────
CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_tenant_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'tenant_admin'
      AND tenant_id = p_tenant_id
  );
$$;

-- ── handle_new_user: pre-migration body (20260718000700) ─────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     user_role;
  v_tenant   UUID;
  v_is_coach BOOLEAN;
BEGIN
  v_role := COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'parent');
  v_tenant := NULLIF(NEW.raw_user_meta_data->>'tenant_id', '')::UUID;
  v_is_coach := COALESCE((NEW.raw_user_meta_data->>'is_coach')::boolean, FALSE);

  IF v_role IN ('coach', 'tenant_admin') AND v_tenant IS NULL THEN
    RAISE EXCEPTION
      'creating a % requires tenant_id in user_metadata — refusing to guess which business they belong to',
      v_role;
  END IF;

  INSERT INTO profiles (id, email, role, full_name, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    v_role,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    CASE WHEN v_role IN ('parent', 'platform_admin') THEN NULL ELSE v_tenant END
  );

  IF v_role = 'parent' THEN
    INSERT INTO parents (profile_id) VALUES (NEW.id);
  ELSIF v_role = 'coach' THEN
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  ELSIF v_role = 'tenant_admin' AND v_is_coach THEN
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  END IF;

  RETURN NEW;
END;
$$;

-- ── audit_log_tenant_of: pre-migration body (20260804000300, no 'Profile') ───
-- Any admin-management audit rows already written keep their tenant_id; only
-- NEW 'Profile' inserts would raise, and the writers are dropped above.
CREATE OR REPLACE FUNCTION public.audit_log_tenant_of(
  p_entity_type TEXT,
  p_entity_id   UUID
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  CASE p_entity_type
    WHEN 'Student' THEN
      SELECT s.tenant_id INTO v_tenant FROM students s WHERE s.id = p_entity_id;
    WHEN 'Class' THEN
      SELECT c.tenant_id INTO v_tenant FROM classes c WHERE c.id = p_entity_id;
    WHEN 'lesson_session' THEN
      SELECT c.tenant_id INTO v_tenant
        FROM lesson_sessions ls
        JOIN classes c ON c.id = ls.class_id
       WHERE ls.id = p_entity_id;
    WHEN 'ParentTenant' THEN
      v_tenant := NULL;
    ELSE
      RAISE EXCEPTION
        'audit_log: no tenant derivation for entity_type %. Add one to '
        'audit_log_tenant_of() — a row with no tenant is readable by the '
        'platform admin and by nobody else (20260804000300).', p_entity_type;
  END CASE;

  RETURN v_tenant;
END;
$$;

-- ── platform_tenant_overview: restore the created_at-ordered subqueries ──────
-- ONLY the two admin_* expressions differ from the deployed 20260806000100
-- body; take the rest from pg_get_functiondef against the live DB if this
-- section ever drifts (§7.40).
CREATE OR REPLACE FUNCTION public.platform_tenant_overview()
RETURNS TABLE(tenant_id uuid, display_name text, shape text, join_code text, active_students integer, active_classes integer, coaches integer, staff_without_rate integer, last_attendance_date date, sessions_this_month integer, sessions_fully_marked integer, last_month_billing text, active_families integer, admin_email text, admin_status text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
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
  WHERE me.ok
  ORDER BY t.display_name;
$$;

-- ── The columns, last (functions above stop referencing them first) ──────────
ALTER TABLE tenants  DROP COLUMN IF EXISTS owner_profile_id;
ALTER TABLE profiles DROP COLUMN IF EXISTS admin_disabled_at;

COMMIT;
