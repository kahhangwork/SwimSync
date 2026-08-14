-- ============================================================
-- rename_student(): the admin's sanctioned path to setting a child's name.
-- (STUDENT_RENAME_PLAN.md step 1.)
--
-- WHY THIS EXISTS. A parent who claims an existing child types the child's real
-- name into the claim (student_claims.claimed_name), but approve_student_claim()
-- deliberately never applies it — it "never overwrites what a coach recorded".
-- So the admin's roster keeps the coach's placeholder ("Anya (big)"). This gives
-- the admin one guarded way to set the name, used both from the Students page
-- (fixing children already linked) and from the claim-approval picker.
--
-- ⚠ THE COLLISION GUARD IS THE POINT, NOT DECORATION (plan ⚠ RISK 2).
-- students_identity_uniq is (tenant_id, lower(trim(full_name)), date_of_birth),
-- and a NULL date of birth is EXEMPT — Postgres treats NULLs as distinct. That
-- exemption is exactly why a coach-added child and a parent-added one become two
-- rows in the first place. So a rename into a same-name NULL-DOB row would
-- SUCCEED silently on the index alone and recreate the very duplicate this
-- subsystem exists to prevent — leaving the coach two identically-named children
-- they cannot tell apart on the attendance roster. The probe below closes it,
-- using `IS NOT DISTINCT FROM` (so NULL == NULL) exactly as add_child_or_claim
-- does; the index stays as the backstop for the non-NULL / inactive case.
--
-- Tenant is derived from the ROW, never a parameter (§7.42). is_tenant_admin()
-- already refuses a non-admin, a disabled admin, a suspended tenant and the
-- platform admin, so no extra check is needed here.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rename_student(
  p_student_id UUID,
  p_new_name   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_row   students%ROWTYPE;
  v_name  TEXT := btrim(COALESCE(p_new_name, ''));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_row FROM students WHERE id = p_student_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'child not found';
  END IF;

  -- Tenant from the ROW (§7.42). This one predicate refuses a non-admin, a
  -- disabled admin, a suspended tenant, and the platform admin.
  IF NOT is_tenant_admin(v_row.tenant_id) THEN
    RAISE EXCEPTION 'only this business''s admin may rename a child';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'a name is required' USING ERRCODE = 'check_violation';
  END IF;

  -- A resubmission of the exact same name is a clean no-op: the audit trigger
  -- would not fire anyway, and skipping avoids the self-referential probe.
  IF v_name = btrim(v_row.full_name) THEN
    RETURN;
  END IF;

  -- ⚠ RISK 2: refuse a name that would make TWO ACTIVE children of this business
  -- share (name, DOB) — INCLUDING the NULL-DOB case the unique index cannot see.
  -- Scoped to is_active because an inactive child is off the roster (the
  -- "cannot tell them apart" harm needs both live); a non-NULL collision against
  -- an inactive row is still caught by the index below.
  IF EXISTS (
    SELECT 1 FROM students s
     WHERE s.tenant_id = v_row.tenant_id
       AND s.id <> p_student_id
       AND s.is_active
       AND lower(btrim(s.full_name)) = lower(v_name)
       AND s.date_of_birth IS NOT DISTINCT FROM v_row.date_of_birth
  ) THEN
    RAISE EXCEPTION '% is already registered with this coach or school.', v_name
      USING ERRCODE = 'unique_violation';
  END IF;

  -- The write. The students audit trigger records it against auth.uid()
  -- automatically. The index is the backstop for a non-NULL (name, DOB)
  -- collision the probe above deliberately does not cover (an inactive row, or
  -- a race) — surfaced with the same friendly message rather than a raw 23505.
  BEGIN
    UPDATE students SET full_name = v_name WHERE id = p_student_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '% is already registered with this coach or school.', v_name
      USING ERRCODE = 'unique_violation';
  END;
END;
$$;

COMMENT ON FUNCTION public.rename_student(UUID, TEXT) IS
  'Set a child''s full_name. Admin-only (tenant from the row, §7.42). Refuses a '
  'name that would duplicate an active child''s (name, DOB) including the NULL-DOB '
  'case the unique index cannot see. STUDENT_RENAME_PLAN.md.';

REVOKE ALL ON FUNCTION public.rename_student(UUID, TEXT) FROM PUBLIC;
-- §7.39 — cloud default-grants EXECUTE to anon and service_role; local does not.
REVOKE EXECUTE ON FUNCTION public.rename_student(UUID, TEXT) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.rename_student(UUID, TEXT) TO authenticated;
