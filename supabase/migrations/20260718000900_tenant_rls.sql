-- ============================================================
-- Multi-tenancy, step 4 of 4: the RLS rewrite.
--
-- Every policy that said "superadmin sees everything" now says "the platform
-- admin sees everything, and a tenant admin sees their own tenant". All 37
-- policies are recreated here rather than patched, so this file is the single
-- readable statement of who can see what.
--
-- `is_superadmin()` IS DROPPED, NOT REDEFINED. A function with the old name and
-- new meaning is how a call site gets missed; a hard error at every one of its
-- 45 uses is the point. It is dropped LAST, after every policy that referenced
-- it has been replaced.
--
-- ALSO CLOSES THREE CROSS-TENANT LEAKS that are live today (TENANCY_DESIGN.md
-- §7). Each was a reasonable shortcut for a one-business app and becomes a data
-- breach the moment a second business exists:
--
--   coaches_select   USING (TRUE)  — every coach record, platform-wide
--   classes_select   USING (TRUE)  — every class, platform-wide
--   profiles_select  ... OR role = 'coach' — every coach's NAME, EMAIL, PHONE
--
-- The third is the worst and was recorded nowhere before this work. A parent
-- legitimately needs their OWN coach's name and QR; that need is now scoped to
-- the tenants they actually deal with instead of granted globally.
--
-- Coaches see ONLY THEIR OWN CLASSES, not their colleagues' — the user's call.
-- Restrictive → permissive is a one-line widening later; permissive →
-- restrictive means taking away access people have built habits on, after the
-- data has already been over-shared.
-- ============================================================

-- ------------------------------------------------------------
-- Helpers. SECURITY DEFINER so they read profiles/coaches/parents WITHOUT
-- triggering RLS on those tables — the same recursion-avoidance the original
-- helpers use.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'platform_admin'
  );
$$;

/** The caller's tenant. NULL for parents (global) and the platform admin. */
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid();
$$;

/**
 * Is the caller the admin OF this tenant?
 *
 * Deliberately NOT true for the platform admin: policies spell that out as
 * `is_platform_admin() OR is_tenant_admin(...)`, so every site reads as an
 * explicit choice about whether platform access applies, rather than hiding it
 * inside a helper.
 */
CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_tenant_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'tenant_admin'
      AND tenant_id = p_tenant_id
  );
$$;

/** Shorthand: platform admin, or admin of this tenant. */
CREATE OR REPLACE FUNCTION public.can_admin_tenant(p_tenant_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_platform_admin() OR is_tenant_admin(p_tenant_id);
$$;

/**
 * Does the caller's TENANT serve this parent? True when one of the parent's
 * children is enrolled in a class of that tenant — generalising
 * coach_serves_parent() from the coach to the business.
 *
 * This is what replaces the global reads: a parent's name is visible to a
 * business because that business teaches their child, not because everyone
 * signed in can see every parent.
 */
CREATE OR REPLACE FUNCTION public.tenant_serves_parent(p_parent_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM parent_students ps
    JOIN students s ON s.id = ps.student_id
    WHERE ps.parent_id = p_parent_id
      AND s.tenant_id = current_tenant_id()
  );
$$;

-- ── Lookups that MUST be SECURITY DEFINER ───────────────────────────────────
-- A policy that reaches another table with a plain EXISTS runs that subquery
-- under RLS too. Scoping `classes` by tenant made that mutually recursive:
-- classes_select consults enrolments, and enrolments_select consults classes.
-- Postgres detects it and fails with "infinite recursion detected in policy".
--
-- It could not happen before because classes_select was `USING (TRUE)` — the
-- leak was also, accidentally, what kept the graph acyclic. These helpers read
-- the parent row WITHOUT RLS and break the cycle, exactly as the original
-- is_superadmin()/current_parent_id() helpers do.

/** The tenant a class belongs to. */
CREATE OR REPLACE FUNCTION public.class_tenant(p_class_id UUID)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM classes WHERE id = p_class_id;
$$;

/** The tenant a lesson session belongs to, via its class. */
CREATE OR REPLACE FUNCTION public.session_tenant(p_session_id UUID)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.tenant_id
  FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
  WHERE ls.id = p_session_id;
$$;

/** Does the calling parent have a child enrolled in this class? */
CREATE OR REPLACE FUNCTION public.parent_has_child_in_class(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM student_class_enrolments e
    JOIN parent_students ps ON ps.student_id = e.student_id
    WHERE e.class_id = p_class_id
      AND ps.parent_id = current_parent_id()
  );
$$;

/** Has this PARENT joined the given tenant (via a join code)? */
CREATE OR REPLACE FUNCTION public.parent_in_tenant(p_tenant_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM parent_tenants
    WHERE tenant_id = p_tenant_id AND parent_id = current_parent_id()
  );
$$;

-- ------------------------------------------------------------
-- Drop every existing policy, then rebuild.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS profiles_select              ON profiles;
DROP POLICY IF EXISTS profiles_update              ON profiles;
DROP POLICY IF EXISTS parents_select               ON parents;
DROP POLICY IF EXISTS parents_update               ON parents;
DROP POLICY IF EXISTS coaches_select               ON coaches;
DROP POLICY IF EXISTS coaches_update               ON coaches;
DROP POLICY IF EXISTS students_select              ON students;
DROP POLICY IF EXISTS students_insert              ON students;
DROP POLICY IF EXISTS students_update              ON students;
DROP POLICY IF EXISTS parent_students_select       ON parent_students;
DROP POLICY IF EXISTS parent_students_insert       ON parent_students;
DROP POLICY IF EXISTS parent_students_delete       ON parent_students;
DROP POLICY IF EXISTS classes_select               ON classes;
DROP POLICY IF EXISTS classes_write                ON classes;
DROP POLICY IF EXISTS enrolments_select            ON student_class_enrolments;
DROP POLICY IF EXISTS enrolments_write             ON student_class_enrolments;
DROP POLICY IF EXISTS sessions_select              ON lesson_sessions;
DROP POLICY IF EXISTS sessions_write               ON lesson_sessions;
DROP POLICY IF EXISTS attendance_select            ON attendance;
DROP POLICY IF EXISTS attendance_write             ON attendance;
DROP POLICY IF EXISTS invoices_select              ON invoices;
DROP POLICY IF EXISTS invoices_update              ON invoices;
DROP POLICY IF EXISTS invoice_items_select         ON invoice_items;
DROP POLICY IF EXISTS credit_notes_select          ON credit_notes;
DROP POLICY IF EXISTS payment_records_select       ON payment_records;
DROP POLICY IF EXISTS payment_records_insert       ON payment_records;
DROP POLICY IF EXISTS audit_log_select             ON audit_log;
DROP POLICY IF EXISTS billing_periods_select       ON billing_periods;
DROP POLICY IF EXISTS app_settings_select          ON app_settings;
DROP POLICY IF EXISTS app_settings_update          ON app_settings;
DROP POLICY IF EXISTS credit_applications_select   ON credit_applications;

-- ------------------------------------------------------------
-- TENANTS
--   Readable by its own members, and by a parent who has joined it (they need
--   the name, logo and PayNow QR to pay). NOT browsable: there is no policy
--   that lets anyone enumerate tenants, which is what makes join codes the only
--   way in (TENANCY_DESIGN.md §6).
-- ------------------------------------------------------------

CREATE POLICY tenants_select ON tenants FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR id = current_tenant_id()
    OR parent_in_tenant(id)
  );

CREATE POLICY tenants_update ON tenants FOR UPDATE TO authenticated
  USING (can_admin_tenant(id))
  WITH CHECK (can_admin_tenant(id));

-- ------------------------------------------------------------
-- PARENT_TENANTS — a parent's own memberships; the tenant sees who joined it.
-- ------------------------------------------------------------

CREATE POLICY parent_tenants_select ON parent_tenants FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR parent_id = current_parent_id()
    OR tenant_id = current_tenant_id()
  );

-- A parent joins a tenant by entering its code. The app resolves the code to a
-- tenant id first; this only allows a parent to link THEMSELVES.
CREATE POLICY parent_tenants_insert ON parent_tenants FOR INSERT TO authenticated
  WITH CHECK (parent_id = current_parent_id() OR is_platform_admin());

-- ------------------------------------------------------------
-- PARENT_TENANT_BALANCES — read-only to users; written by the engine.
-- ------------------------------------------------------------

CREATE POLICY parent_tenant_balances_select ON parent_tenant_balances FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR parent_id = current_parent_id()
    OR tenant_id = current_tenant_id()
  );

-- ------------------------------------------------------------
-- PROFILES
--   Own profile always. A tenant sees its own members. A parent sees the
--   profiles of coaches in tenants they have joined — replacing the blanket
--   `role = 'coach'` read that exposed every coach's contact details.
-- ------------------------------------------------------------

CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR is_platform_admin()
    OR (tenant_id IS NOT NULL AND tenant_id = current_tenant_id())
    OR (tenant_id IS NOT NULL AND parent_in_tenant(tenant_id))
    -- A tenant admin/coach needs the names of parents they serve (invoice
    -- labels, rosters).
    OR EXISTS (
      SELECT 1 FROM parents p
      WHERE p.profile_id = profiles.id AND tenant_serves_parent(p.id)
    )
  );

CREATE POLICY profiles_update ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR is_platform_admin() OR can_admin_tenant(tenant_id))
  WITH CHECK (id = auth.uid() OR is_platform_admin() OR can_admin_tenant(tenant_id));

-- ------------------------------------------------------------
-- PARENTS  (global rows; visible to a tenant that serves them)
-- ------------------------------------------------------------

CREATE POLICY parents_select ON parents FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR is_platform_admin()
    OR tenant_serves_parent(id)
  );

CREATE POLICY parents_update ON parents FOR UPDATE TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- ------------------------------------------------------------
-- COACHES  (was USING (TRUE) — leak #1)
-- ------------------------------------------------------------

CREATE POLICY coaches_select ON coaches FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR tenant_id = current_tenant_id()
    OR parent_in_tenant(tenant_id)   -- parents see their own business's coaches
  );

CREATE POLICY coaches_update ON coaches FOR UPDATE TO authenticated
  USING (profile_id = auth.uid() OR can_admin_tenant(tenant_id))
  WITH CHECK (profile_id = auth.uid() OR can_admin_tenant(tenant_id));

-- ------------------------------------------------------------
-- STUDENTS
-- ------------------------------------------------------------

CREATE POLICY students_select ON students FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR created_by = auth.uid()
    OR parent_owns_student(id)
    OR is_tenant_admin(tenant_id)
    OR coach_serves_student(id)      -- a coach sees only their own class's students
  );

CREATE POLICY students_insert ON students FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin()
    -- A parent may only create a child in a tenant they have joined.
    OR (current_parent_id() IS NOT NULL AND parent_in_tenant(tenant_id))
    OR is_tenant_admin(tenant_id)
  );

CREATE POLICY students_update ON students FOR UPDATE TO authenticated
  USING (
    is_platform_admin() OR created_by = auth.uid()
    OR parent_owns_student(id) OR is_tenant_admin(tenant_id)
  )
  WITH CHECK (
    is_platform_admin() OR created_by = auth.uid()
    OR parent_owns_student(id) OR is_tenant_admin(tenant_id)
  );

-- ------------------------------------------------------------
-- PARENT_STUDENTS
-- ------------------------------------------------------------

CREATE POLICY parent_students_select ON parent_students FOR SELECT TO authenticated
  USING (
    parent_id = current_parent_id()
    OR is_platform_admin()
    OR tenant_serves_parent(parent_id)
    OR coach_serves_parent(parent_id)
  );

CREATE POLICY parent_students_insert ON parent_students FOR INSERT TO authenticated
  WITH CHECK (parent_id = current_parent_id() OR is_platform_admin());

CREATE POLICY parent_students_delete ON parent_students FOR DELETE TO authenticated
  USING (parent_id = current_parent_id() OR is_platform_admin());

-- ------------------------------------------------------------
-- CLASSES  (was USING (TRUE) — leak #2)
--   A coach sees only their OWN classes. Cross-class visibility within a school
--   is the tenant admin's, deliberately.
-- ------------------------------------------------------------

CREATE POLICY classes_select ON classes FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR is_tenant_admin(tenant_id)
    OR coach_id = current_coach_id()
    -- A parent sees a class their child is enrolled in.
    OR parent_has_child_in_class(id)
  );

CREATE POLICY classes_write ON classes FOR ALL TO authenticated
  USING (can_admin_tenant(tenant_id))
  WITH CHECK (can_admin_tenant(tenant_id));

-- ------------------------------------------------------------
-- STUDENT_CLASS_ENROLMENTS
-- ------------------------------------------------------------

CREATE POLICY enrolments_select ON student_class_enrolments FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR parent_owns_student(student_id)
    OR coach_owns_class(class_id)
    OR is_tenant_admin(class_tenant(class_id))
  );

CREATE POLICY enrolments_write ON student_class_enrolments FOR ALL TO authenticated
  USING (can_admin_tenant(class_tenant(class_id)))
  WITH CHECK (can_admin_tenant(class_tenant(class_id)));

-- ------------------------------------------------------------
-- LESSON_SESSIONS
-- ------------------------------------------------------------

CREATE POLICY sessions_select ON lesson_sessions FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR coach_owns_class(class_id)
    OR is_tenant_admin(class_tenant(class_id))
    OR parent_has_child_in_class(class_id)
  );

CREATE POLICY sessions_write ON lesson_sessions FOR ALL TO authenticated
  USING (coach_owns_class(class_id) OR can_admin_tenant(class_tenant(class_id)))
  WITH CHECK (coach_owns_class(class_id) OR can_admin_tenant(class_tenant(class_id)));

-- ------------------------------------------------------------
-- ATTENDANCE
-- ------------------------------------------------------------

CREATE POLICY attendance_select ON attendance FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR parent_owns_student(student_id)
    OR coach_owns_session(lesson_session_id)
    OR is_tenant_admin(session_tenant(lesson_session_id))
  );

CREATE POLICY attendance_write ON attendance FOR ALL TO authenticated
  USING (
    coach_owns_session(lesson_session_id)
    OR can_admin_tenant(session_tenant(lesson_session_id))
  )
  WITH CHECK (
    coach_owns_session(lesson_session_id)
    OR can_admin_tenant(session_tenant(lesson_session_id))
  );

-- ------------------------------------------------------------
-- INVOICES  (now per parent PER TENANT per month)
-- ------------------------------------------------------------

CREATE POLICY invoices_select ON invoices FOR SELECT TO authenticated
  USING (
    parent_id = current_parent_id()
    OR is_platform_admin()
    OR is_tenant_admin(tenant_id)
    OR coach_serves_parent(parent_id)
  );

CREATE POLICY invoices_update ON invoices FOR UPDATE TO authenticated
  USING (can_admin_tenant(tenant_id) OR coach_serves_parent(parent_id))
  WITH CHECK (can_admin_tenant(tenant_id) OR coach_serves_parent(parent_id));

CREATE POLICY invoice_items_select ON invoice_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_items.invoice_id
        AND (
          i.parent_id = current_parent_id()
          OR is_platform_admin()
          OR is_tenant_admin(i.tenant_id)
          OR coach_serves_parent(i.parent_id)
        )
    )
  );

-- ------------------------------------------------------------
-- CREDIT_NOTES  (immutable: no update/delete policy, by design)
-- ------------------------------------------------------------

CREATE POLICY credit_notes_select ON credit_notes FOR SELECT TO authenticated
  USING (
    parent_id = current_parent_id()
    OR is_platform_admin()
    OR is_tenant_admin(tenant_id)
    OR coach_serves_parent(parent_id)
  );

-- ------------------------------------------------------------
-- PAYMENT_RECORDS
-- ------------------------------------------------------------

CREATE POLICY payment_records_select ON payment_records FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = payment_records.invoice_id
        AND (
          i.parent_id = current_parent_id()
          OR is_tenant_admin(i.tenant_id)
          OR coach_serves_parent(i.parent_id)
        )
    )
  );

CREATE POLICY payment_records_insert ON payment_records FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = payment_records.invoice_id
        AND (is_tenant_admin(i.tenant_id) OR coach_serves_parent(i.parent_id))
    )
  );

-- ------------------------------------------------------------
-- AUDIT_LOG / BILLING_PERIODS / APP_SETTINGS
-- ------------------------------------------------------------

CREATE POLICY audit_log_select ON audit_log FOR SELECT TO authenticated
  USING (is_platform_admin() OR is_tenant_admin(tenant_id));

CREATE POLICY billing_periods_select ON billing_periods FOR SELECT TO authenticated
  USING (is_platform_admin() OR is_tenant_admin(tenant_id));

-- app_settings is now PLATFORM-level only. Per-tenant billing schedule lives on
-- `tenants` (auto_invoice_enabled / invoice_run_day); a tenant admin changes it
-- there, via tenants_update. The engine still reads app_settings until phase 2.
CREATE POLICY app_settings_select ON app_settings FOR SELECT TO authenticated
  USING (is_platform_admin());

CREATE POLICY app_settings_update ON app_settings FOR UPDATE TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- ------------------------------------------------------------
-- CREDIT_APPLICATIONS (ledger; immutable to app users)
-- ------------------------------------------------------------

CREATE POLICY credit_applications_select ON credit_applications FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM credit_notes cn
      WHERE cn.id = credit_applications.credit_note_id
        AND (
          cn.parent_id = current_parent_id()
          OR is_platform_admin()
          OR is_tenant_admin(cn.tenant_id)
          OR coach_serves_parent(cn.parent_id)
        )
    )
  );

-- ------------------------------------------------------------
-- STORAGE: the PayNow QR bucket is now namespaced by TENANT, not by coach.
--
-- The QR belongs to the business (a three-coach school shows one payee), so the
-- folder is the tenant id and only that tenant's admin may write it. A private
-- coach is their own tenant admin, so nothing is lost for them.
--
-- Existing objects stay at paynow-qr/<coach_id>/… and keep working: read is
-- public, and tenants.paynow_qr_url was copied verbatim by the backfill. Only
-- NEW uploads use the tenant folder.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "paynow_qr_coach_insert" ON storage.objects;
DROP POLICY IF EXISTS "paynow_qr_coach_update" ON storage.objects;
DROP POLICY IF EXISTS "paynow_qr_coach_delete" ON storage.objects;

CREATE POLICY "paynow_qr_tenant_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'paynow-qr'
    AND (
      is_platform_admin()
      OR is_tenant_admin(NULLIF((storage.foldername(name))[1], '')::uuid)
    )
  );

CREATE POLICY "paynow_qr_tenant_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'paynow-qr'
    AND (
      is_platform_admin()
      OR is_tenant_admin(NULLIF((storage.foldername(name))[1], '')::uuid)
    )
  );

CREATE POLICY "paynow_qr_tenant_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'paynow-qr'
    AND (
      is_platform_admin()
      OR is_tenant_admin(NULLIF((storage.foldername(name))[1], '')::uuid)
    )
  );

-- ------------------------------------------------------------
-- close_student_enrolment(): tenant-aware.
--
-- A FUNCTION BODY, so Postgres does NOT track it as a dependency of
-- is_superadmin() — dropping the function would not error here, it would fail
-- at RUNTIME the first time an admin tried to remove a student. Rewritten
-- explicitly. It is SECURITY DEFINER and therefore bypasses every policy above,
-- which is exactly why its own check has to be right.
-- ------------------------------------------------------------

-- Signature MUST stay (UUID, BOOLEAN) — a different one creates an overload and
-- leaves the original, still calling the dropped is_superadmin(), in place.
CREATE OR REPLACE FUNCTION public.close_student_enrolment(
  p_student_id   UUID,
  p_set_inactive BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  UUID := auth.uid();
  v_old    JSONB;
  v_tenant UUID;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT tenant_id INTO v_tenant FROM students WHERE id = p_student_id;

  -- Checked BEFORE the enrolment is closed: coach_serves_student() reads the
  -- active enrolment, so it would return false immediately afterwards.
  IF NOT (
    is_platform_admin()
    OR is_tenant_admin(v_tenant)
    OR coach_serves_student(p_student_id)
  ) THEN
    RAISE EXCEPTION 'not permitted to change this student''s enrolment';
  END IF;

  SELECT to_jsonb(s) INTO v_old FROM students s WHERE s.id = p_student_id;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'student not found';
  END IF;

  UPDATE student_class_enrolments
     SET is_active = FALSE, unenrolled_at = NOW()
   WHERE student_id = p_student_id AND is_active;

  UPDATE students
     SET assignment_status = CASE WHEN p_set_inactive
                                  THEN 'inactive'::assignment_status
                                  ELSE 'unassigned'::assignment_status END,
         -- Only ever set FALSE here. "Remove from class" on an already
         -- inactive child must not quietly reactivate them.
         is_active = CASE WHEN p_set_inactive THEN FALSE ELSE students.is_active END,
         updated_at = NOW()
   WHERE id = p_student_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id,
                         old_value, new_value, tenant_id)
  VALUES (
    v_actor,
    CASE WHEN p_set_inactive THEN 'student_set_inactive'
         ELSE 'student_removed_from_class' END,
    'Student',
    p_student_id,
    v_old,
    (SELECT to_jsonb(s) FROM students s WHERE s.id = p_student_id),
    v_tenant
  );
END;
$$;

-- ------------------------------------------------------------
-- Now that nothing references it, retire the old global-superadmin check.
--
-- The DROP is load-bearing, not tidiness: it is what turned the three storage
-- policies, the credit_applications policy and this function into hard errors
-- during development instead of silent wrong answers in production.
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.is_superadmin();
DROP FUNCTION IF EXISTS public.coach_serves_parent_profile(UUID);

GRANT SELECT ON parent_tenant_balances TO authenticated;
