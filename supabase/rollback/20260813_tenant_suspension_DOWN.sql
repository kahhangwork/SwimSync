-- ═══════════════════════════════════════════════════════════════════════════
-- DOWN for 20260813000300_tenant_suspension.sql (Wave 5 chunk 3).
-- Committed BEFORE the deploy, rehearsed both directions (§7.93 — running it
-- is the half that finds the bugs).
--
-- Every restored body/policy below is the LIVE pre-chunk definition captured
-- from pg_get_functiondef() / pg_policies on 2026-08-13, not a copy of an
-- old migration file (§7.115).
--
-- ORDER MATTERS: policies and function bodies that reference
-- tenant_suspended() are restored FIRST — Postgres tracks the dependency and
-- refuses to drop the predicate while anything still names it. The column
-- goes last, after the guard stops pinning it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The 15 policies, restored to their pre-chunk text ─────────────────────

DROP POLICY invoices_select ON public.invoices;
CREATE POLICY invoices_select ON public.invoices
  FOR SELECT TO authenticated
  USING (
    (parent_id = current_parent_id())
    OR is_platform_admin()
    OR is_tenant_admin(tenant_id)
    OR coach_serves_parent(parent_id)
  );

DROP POLICY invoice_items_select ON public.invoice_items;
CREATE POLICY invoice_items_select ON public.invoice_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = invoice_items.invoice_id
      AND ((i.parent_id = current_parent_id())
        OR is_platform_admin()
        OR is_tenant_admin(i.tenant_id)
        OR coach_serves_parent(i.parent_id))
  ));

DROP POLICY credit_notes_select ON public.credit_notes;
CREATE POLICY credit_notes_select ON public.credit_notes
  FOR SELECT TO authenticated
  USING (
    (parent_id = current_parent_id())
    OR is_platform_admin()
    OR is_tenant_admin(tenant_id)
    OR coach_serves_parent(parent_id)
  );

DROP POLICY credit_applications_select ON public.credit_applications;
CREATE POLICY credit_applications_select ON public.credit_applications
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM credit_notes cn
    WHERE cn.id = credit_applications.credit_note_id
      AND ((cn.parent_id = current_parent_id())
        OR is_platform_admin()
        OR is_tenant_admin(cn.tenant_id)
        OR coach_serves_parent(cn.parent_id))
  ));

DROP POLICY payment_records_select ON public.payment_records;
CREATE POLICY payment_records_select ON public.payment_records
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = payment_records.invoice_id
        AND ((i.parent_id = current_parent_id())
          OR is_tenant_admin(i.tenant_id)
          OR coach_serves_parent(i.parent_id))
    )
  );

DROP POLICY parent_packages_select ON public.parent_packages;
CREATE POLICY parent_packages_select ON public.parent_packages
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR can_admin_tenant(tenant_id)
    OR (parent_id = current_parent_id())
  );

DROP POLICY parent_packages_update ON public.parent_packages;
CREATE POLICY parent_packages_update ON public.parent_packages
  FOR UPDATE TO authenticated
  USING (can_admin_tenant(tenant_id) OR (parent_id = current_parent_id()))
  WITH CHECK (can_admin_tenant(tenant_id) OR (parent_id = current_parent_id()));

DROP POLICY parent_packages_insert ON public.parent_packages;
CREATE POLICY parent_packages_insert ON public.parent_packages
  FOR INSERT TO authenticated
  WITH CHECK (
    can_admin_tenant(tenant_id)
    OR ((parent_id = current_parent_id()) AND parent_in_tenant(tenant_id))
  );

DROP POLICY package_applications_select ON public.package_applications;
CREATE POLICY package_applications_select ON public.package_applications
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM parent_packages pp
    WHERE pp.id = package_applications.parent_package_id
      AND (is_platform_admin() OR can_admin_tenant(pp.tenant_id)
        OR (pp.parent_id = current_parent_id()))
  ));

DROP POLICY parent_students_select ON public.parent_students;
CREATE POLICY parent_students_select ON public.parent_students
  FOR SELECT TO authenticated
  USING (
    (parent_id = current_parent_id())
    OR is_platform_admin()
    OR tenant_serves_parent(parent_id)
    OR coach_serves_parent(parent_id)
  );

DROP POLICY parent_tenants_select ON public.parent_tenants;
CREATE POLICY parent_tenants_select ON public.parent_tenants
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR (parent_id = current_parent_id())
    OR (tenant_id = current_tenant_id())
  );

DROP POLICY parent_tenant_balances_select ON public.parent_tenant_balances;
CREATE POLICY parent_tenant_balances_select ON public.parent_tenant_balances
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR (parent_id = current_parent_id())
    OR (tenant_id = current_tenant_id())
  );

DROP POLICY student_claims_select ON public.student_claims;
CREATE POLICY student_claims_select ON public.student_claims
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR (parent_id = current_parent_id())
    OR is_tenant_admin(tenant_id)
  );

DROP POLICY students_select ON public.students;
CREATE POLICY students_select ON public.students
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR (created_by = auth.uid())
    OR parent_owns_student(id)
    OR is_tenant_admin(tenant_id)
    OR coach_serves_student(id)
    OR coach_rostered_with_student(id)
  );

DROP POLICY students_update ON public.students;
CREATE POLICY students_update ON public.students
  FOR UPDATE TO authenticated
  USING (
    is_platform_admin()
    OR (created_by = auth.uid())
    OR parent_owns_student(id)
    OR is_tenant_admin(tenant_id)
  )
  WITH CHECK (
    is_platform_admin()
    OR (created_by = auth.uid())
    OR parent_owns_student(id)
    OR is_tenant_admin(tenant_id)
  );

-- ── 2. Function bodies back to their pre-chunk definitions ───────────────────

CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'tenant_admin'
      AND tenant_id = p_tenant_id
      AND admin_disabled_at IS NULL
  );
$$;

COMMENT ON FUNCTION public.is_tenant_admin(uuid) IS
  'Is the caller an ACTIVE admin of this tenant? Deliberately not true for '
  'the platform admin (sites spell that out via can_admin_tenant), and false '
  'while admin_disabled_at is set — deactivation suspends every admin policy '
  'through this one clause (20260806000100).';

CREATE OR REPLACE FUNCTION public.current_coach_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id FROM coaches WHERE profile_id = auth.uid() AND disabled_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.parent_owns_student(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM parent_students
    WHERE student_id = p_student_id
      AND parent_id = current_parent_id()
  );
$$;

COMMENT ON FUNCTION public.parent_owns_student(uuid) IS NULL;

CREATE OR REPLACE FUNCTION public.parent_in_tenant(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM parent_tenants
    WHERE tenant_id = p_tenant_id AND parent_id = current_parent_id()
  );
$$;

COMMENT ON FUNCTION public.parent_in_tenant(uuid) IS NULL;

CREATE OR REPLACE FUNCTION public.parent_has_child_in_class(p_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM student_class_enrolments e
    JOIN parent_students ps ON ps.student_id = e.student_id
    WHERE e.class_id = p_class_id
      AND ps.parent_id = current_parent_id()
  ) OR EXISTS (
    -- Trying one lesson counts as being in the class, for reading.
    SELECT 1
    FROM trial_bookings tb
    JOIN parent_students ps ON ps.student_id = tb.student_id
    WHERE tb.class_id = p_class_id
      AND ps.parent_id = current_parent_id()
  ) OR EXISTS (
    -- A make-up lesson counts the same way.
    SELECT 1
    FROM makeup_bookings mb
    JOIN parent_students ps ON ps.student_id = mb.student_id
    WHERE mb.class_id = p_class_id
      AND ps.parent_id = current_parent_id()
  );
$$;

COMMENT ON FUNCTION public.parent_has_child_in_class(uuid) IS
  'Does this parent have a child in this class — by ENROLMENT or by TRIAL '
  'BOOKING? Feeds classes_select and sessions_select. SECURITY DEFINER so '
  'reading trial_bookings here cannot make the two policies mutually '
  'recursive.';

CREATE OR REPLACE FUNCTION public.claim_invoice_paid(p_invoice_id uuid)
RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_row  invoices%ROWTYPE;
  v_when TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- The caller must BE the invoice's parent — not an admin, not a coach.
  -- A claim is the family speaking for itself.
  SELECT i.* INTO v_row
    FROM invoices i
    JOIN parents p ON p.id = i.parent_id
   WHERE i.id = p_invoice_id
     AND p.profile_id = v_uid
     FOR UPDATE OF i;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'invoice not found';
  END IF;

  -- Idempotent: claiming twice keeps the FIRST timestamp — when the parent
  -- first said "paid" is the fact the admin checks the bank against.
  IF v_row.paid_claimed_at IS NOT NULL THEN
    RETURN v_row.paid_claimed_at;
  END IF;

  IF v_row.status <> 'outstanding' THEN
    RAISE EXCEPTION 'invoice is not outstanding';
  END IF;

  UPDATE invoices
     SET paid_claimed_at = NOW()
   WHERE id = p_invoice_id
  RETURNING paid_claimed_at INTO v_when;

  RETURN v_when;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_tenant_by_code(p_code text)
RETURNS TABLE(tenant_id uuid, display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_parent_id UUID;
  v_tenant    RECORD;
  v_code      TEXT;
BEGIN
  v_parent_id := current_parent_id();
  IF v_parent_id IS NULL THEN
    -- Coaches and admins have no business joining a tenant as a customer.
    RAISE EXCEPTION 'only a parent account can join with a code';
  END IF;

  -- Normalised so a code read off a phone screen still works: codes are
  -- generated uppercase with no ambiguous characters, and people type them
  -- with stray spaces and lowercase.
  v_code := UPPER(TRIM(COALESCE(p_code, '')));
  IF v_code = '' THEN
    RAISE EXCEPTION 'enter a join code';
  END IF;

  SELECT t.id, t.display_name INTO v_tenant
    FROM tenants t WHERE UPPER(t.join_code) = v_code;

  IF v_tenant.id IS NULL THEN
    -- Deliberately identical wording for "no such code": distinguishing
    -- "wrong code" from "code exists but something else failed" would let a
    -- caller probe which codes are real.
    RAISE EXCEPTION 'that join code was not recognised';
  END IF;

  -- ON CONFLICT names the CONSTRAINT rather than the columns: this function
  -- RETURNS TABLE (tenant_id …), so a bare `tenant_id` in the conflict target
  -- is ambiguous between the OUT parameter and the column.
  INSERT INTO parent_tenants (parent_id, tenant_id)
  VALUES (v_parent_id, v_tenant.id)
  ON CONFLICT ON CONSTRAINT parent_tenants_parent_id_tenant_id_key
  DO UPDATE SET is_active = TRUE, inactivated_at = NULL;

  RETURN QUERY SELECT v_tenant.id, v_tenant.display_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_tenants_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND OLD.owner_profile_id IS DISTINCT FROM NEW.owner_profile_id THEN
    RAISE EXCEPTION
      'tenants.owner_profile_id cannot be changed by a client — there is no '
      'owner-transfer path yet (20260806000100)';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. The overview back to 15 columns, WITH its grants ──────────────────────

DROP FUNCTION public.platform_tenant_overview();

CREATE FUNCTION public.platform_tenant_overview()
RETURNS TABLE(
  tenant_id             UUID,
  display_name          TEXT,
  shape                 TEXT,
  join_code             TEXT,
  active_students       INTEGER,
  active_classes        INTEGER,
  coaches               INTEGER,
  staff_without_rate    INTEGER,
  last_attendance_date  DATE,
  sessions_this_month   INTEGER,
  sessions_fully_marked INTEGER,
  last_month_billing    TEXT,
  active_families       INTEGER,
  admin_email           TEXT,
  admin_status          TEXT
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
    (SELECT pr.email FROM profiles pr WHERE pr.id = t.owner_profile_id),
    COALESCE((
      SELECT CASE WHEN u.last_sign_in_at IS NULL THEN 'invited' ELSE 'active' END
      FROM profiles pr
      JOIN auth.users u ON u.id = pr.id
      WHERE pr.id = t.owner_profile_id
    ), 'none')
  FROM tenants t, me
  WHERE me.ok                      -- THE GATE. No rows for anyone else.
  ORDER BY t.display_name;
$$;

COMMENT ON FUNCTION public.platform_tenant_overview() IS
  'Per-tenant operations overview for the platform admin. SECURITY DEFINER: '
  'gated on is_platform_admin() internally because it bypasses RLS. `shape` '
  'is DERIVED from whether the only coach is also the tenant admin — never '
  'from tenants.kind, which nothing maintains. Returns facts about recorded '
  'rows only; it deliberately does NOT derive which lessons should have run '
  '(§7.18). admin_status comes from auth.users.last_sign_in_at: ''none'' '
  'means the business has no admin at all and is still joinable — treat it '
  'as a fault.';

REVOKE ALL ON FUNCTION public.platform_tenant_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_tenant_overview()
  FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.platform_tenant_overview() TO authenticated;

-- ── 4. The new objects, gone — predicate LAST among functions ────────────────

DROP FUNCTION public.suspend_tenant(UUID);
DROP FUNCTION public.unsuspend_tenant(UUID);
DROP FUNCTION public.tenant_suspended(UUID);

-- ── 5. The column ────────────────────────────────────────────────────────────

ALTER TABLE public.tenants DROP COLUMN suspended_at;
