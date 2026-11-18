-- An admin can correct a family's details after the parent has an account (user feedback, 2026-11-18).
--
-- WHY. A tenant admin reported: "Once a parent is linked to a child, if key information is entered wrongly, we may
-- need to delete the whole child record and recreate it." Three gaps made that true:
--   1. A LINKED parent's name/phone were read-only to the admin (PRD §7.19) — only the parent could change them.
--   2. A wrong parent↔child link could be undone only from Claims → Undo, only for a claim-made link.
--   3. A child's date of birth could not be changed after the child was added, by anyone on the admin side.
--
--   set_parent_contact()           NEW — name + phone on the parent's OWN profile (the user's decision, 2026-11-18:
--                                  name + phone, NOT email — the email is the login, and stays the parent's)
--   unlink_parent_from_student()   NEW — removes one link; refused once that parent was billed for that child
--   set_student_date_of_birth()    NEW — model: rename_student / set_student_gender
--
-- ⚠ A PARENT IS GLOBAL (PRD §4.3). set_parent_contact edits the one profile every business sees. The user chose that
-- over a per-business copy (2026-11-18): a correct number is correct everywhere, and a second copy is the stale
-- duplicate §7.19 refused. The change is audited against the editing business.
--
-- ⚠ A PENDING CLAIM LOCKS all three, for the reason the Contact details screen already gives (§7.19, useContact.ts):
-- student_claims.match_reason is a snapshot, so editing underneath it makes the admin approve on a reason that has
-- stopped being true. ACCEPTED: set_parent_contact locks on a pending claim at the EDITING business only. A claim at
-- another business by the same parent is not that admin's to resolve; its reason was true when it was raised.
--
-- Unlinking a child's LAST parent makes their unbilled lessons unclaimed attendance, which the engine already reports
-- and does not block on (PRD §7.17) — the existing path for a child who has no parent yet.
--
-- NO TABLE GRANT CHANGES (§7.87): all three are SECURITY DEFINER; the body is the boundary. Each REVOKEs from
-- PUBLIC/anon/authenticated/service_role and GRANTs EXECUTE to authenticated only. After `db push`, dump the remote:
--   supabase db dump --linked -f /tmp/remote_dump.sql
--   grep -iE 'set_parent_contact|unlink_parent_from_student|set_student_date_of_birth' /tmp/remote_dump.sql | grep -iE 'grant|revoke'
--
-- Rollback: supabase/rollback/20261118000100_admin_edit_family_details_DOWN.sql (APPS FIRST — the admin calls these).

-- ── 1. set_parent_contact — a linked parent's name and phone ─────────────────────────────────────────────────────
CREATE FUNCTION public.set_parent_contact(p_parent_id UUID, p_full_name TEXT, p_phone TEXT)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  UUID := auth.uid();
  v_tenant UUID := current_tenant_id();
  v_prof   profiles%ROWTYPE;
  v_name   TEXT := btrim(COALESCE(p_full_name, ''));
  v_phone  TEXT := NULLIF(btrim(COALESCE(p_phone, '')), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- The admin's OWN business (a tenant admin has exactly one). Refuses a coach, a parent, a view-only role, a disabled
  -- admin, a suspended tenant and the platform admin (whose tenant is NULL).
  IF v_tenant IS NULL OR NOT has_admin_area(v_tenant, 'operations', 'edit') THEN
    RAISE EXCEPTION 'only a business''s admin may correct a parent''s details';
  END IF;

  SELECT pr.* INTO v_prof FROM parents p JOIN profiles pr ON pr.id = p.profile_id WHERE p.id = p_parent_id;
  IF v_prof.id IS NULL THEN
    RAISE EXCEPTION 'parent not found';
  END IF;

  -- Only a family of THIS business: a member (parent_tenants) or the parent of one of its children.
  IF NOT EXISTS (SELECT 1 FROM parent_tenants WHERE parent_id = p_parent_id AND tenant_id = v_tenant)
     AND NOT EXISTS (SELECT 1 FROM parent_students ps JOIN students s ON s.id = ps.student_id
                      WHERE ps.parent_id = p_parent_id AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'this parent is not a family of your business';
  END IF;

  -- A parent row's profile is a parent. Belt and braces: never let this path rename a coach or an admin.
  IF v_prof.role <> 'parent' THEN
    RAISE EXCEPTION 'only a parent''s details can be corrected here';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'a name is required' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM student_claims WHERE parent_id = p_parent_id AND tenant_id = v_tenant
                AND status = 'pending') THEN
    RAISE EXCEPTION 'This parent has a claim waiting in Parent Requests. Approve or decline it first.';
  END IF;

  IF v_name = btrim(v_prof.full_name) AND v_phone IS NOT DISTINCT FROM v_prof.phone THEN
    RETURN;
  END IF;

  UPDATE profiles SET full_name = v_name, phone = v_phone, updated_at = app_now() WHERE id = v_prof.id;

  -- 'ParentTenant': entity_id is the parent and the RPC supplies the tenant — a parent spans businesses, so the
  -- tenant is not derivable from the row (audit_log_tenant_of, 20260804000300).
  INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  VALUES (
    v_tenant, v_actor, 'parent_contact_corrected', 'ParentTenant', p_parent_id,
    jsonb_build_object('full_name', v_prof.full_name, 'phone', v_prof.phone),
    jsonb_build_object('full_name', v_name, 'phone', v_phone)
  );
END;
$function$;

COMMENT ON FUNCTION public.set_parent_contact(UUID, TEXT, TEXT) IS
  'Admin corrects a linked parent''s name + phone on their global profile (operations/edit, own business''s family only, not under a pending claim). Email is the login and is not editable here. Audited. 20261118000100.';

REVOKE ALL ON FUNCTION public.set_parent_contact(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_parent_contact(UUID, TEXT, TEXT) TO authenticated;

-- ── 2. unlink_parent_from_student — undo a wrong link ───────────────────────────────────────────────────────────
CREATE FUNCTION public.unlink_parent_from_student(p_parent_id UUID, p_student_id UUID)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor   UUID := auth.uid();
  v_student students%ROWTYPE;
  v_claim   UUID;
  v_billed  TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_student FROM students WHERE id = p_student_id;
  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'child not found';
  END IF;

  -- Tenant from the ROW (§7.42).
  IF NOT has_admin_area(v_student.tenant_id, 'operations', 'edit') THEN
    RAISE EXCEPTION 'only this business''s admin may unlink a parent';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM parent_students WHERE parent_id = p_parent_id AND student_id = p_student_id) THEN
    RAISE EXCEPTION 'this parent is not linked to this child';
  END IF;

  -- ⚠ THE BILLING GUARD (the user's decision, 2026-11-18: refuse once invoiced). An invoice line for this child on
  -- this parent's invoice, or a live package draw for this child from this parent's package, means money already
  -- moved on the link. Unlinking would leave that history pointing at a parent who is no longer the child's.
  SELECT i.billing_month INTO v_billed
    FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
   WHERE ii.student_id = p_student_id AND i.parent_id = p_parent_id
   LIMIT 1;
  IF v_billed IS NULL THEN
    SELECT pp.reference_number INTO v_billed
      FROM package_applications pa JOIN parent_packages pp ON pp.id = pa.parent_package_id
     WHERE pa.student_id = p_student_id AND pp.parent_id = p_parent_id AND pa.reversed_at IS NULL
     LIMIT 1;
  END IF;
  IF v_billed IS NOT NULL THEN
    RAISE EXCEPTION
      'This link cannot be removed: % has already been billed to this parent (%). Issue a credit note instead.',
      v_student.full_name, v_billed;
  END IF;

  -- A claim-made link goes through the claim's own undo: it also reverses what the approval wrote onto the child and
  -- marks the claim. The billing guard above runs first because undo_student_claim checks invoices only, not
  -- package draws. One definition of undoing a claim.
  SELECT id INTO v_claim FROM student_claims
   WHERE parent_id = p_parent_id AND student_id = p_student_id AND status = 'approved'
   ORDER BY decided_at DESC NULLS LAST LIMIT 1;
  IF v_claim IS NOT NULL THEN
    PERFORM undo_student_claim(v_claim);
    RETURN;
  END IF;

  DELETE FROM parent_students WHERE parent_id = p_parent_id AND student_id = p_student_id;

  INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, old_value)
  VALUES (v_student.tenant_id, v_actor, 'parent_unlinked', 'Student', p_student_id,
          jsonb_build_object('parent_id', p_parent_id));
END;
$function$;

COMMENT ON FUNCTION public.unlink_parent_from_student(UUID, UUID) IS
  'Admin removes one parent↔child link (operations/edit, tenant from the child). A claim-made link is routed to undo_student_claim. Refused once that parent was invoiced or drew a package for that child. Audited. 20261118000100.';

REVOKE ALL ON FUNCTION public.unlink_parent_from_student(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unlink_parent_from_student(UUID, UUID) TO authenticated;

-- ── 3. set_student_date_of_birth ─────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.set_student_date_of_birth(p_student_id UUID, p_dob DATE)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_row   students%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_row FROM students WHERE id = p_student_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'child not found';
  END IF;

  IF NOT has_admin_area(v_row.tenant_id, 'operations', 'edit') THEN
    RAISE EXCEPTION 'only this business''s admin may change a child''s date of birth';
  END IF;

  -- app_today(), never the raw clock (ARCHITECTURE §6af). NULL is allowed: the DOB is optional when a child is added.
  IF p_dob IS NOT NULL AND p_dob > app_today() THEN
    RAISE EXCEPTION 'a date of birth cannot be in the future' USING ERRCODE = 'check_violation';
  END IF;

  IF p_dob IS NOT DISTINCT FROM v_row.date_of_birth THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM student_claims WHERE student_id = p_student_id AND status = 'pending') THEN
    RAISE EXCEPTION 'A parent is claiming this child in Parent Requests. Approve or decline it first.';
  END IF;

  -- The same (name, DOB) probe as rename_student, including the NULL-DOB case the unique index cannot see.
  IF EXISTS (
    SELECT 1 FROM students s
     WHERE s.tenant_id = v_row.tenant_id AND s.id <> p_student_id AND s.is_active
       AND lower(btrim(s.full_name)) = lower(btrim(v_row.full_name))
       AND s.date_of_birth IS NOT DISTINCT FROM p_dob
  ) THEN
    RAISE EXCEPTION 'Another child called % with that date of birth is already registered with this business.',
      v_row.full_name USING ERRCODE = 'unique_violation';
  END IF;

  -- Audited by trg_audit_student_update against auth.uid().
  BEGIN
    UPDATE students SET date_of_birth = p_dob WHERE id = p_student_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Another child called % with that date of birth is already registered with this business.',
      v_row.full_name USING ERRCODE = 'unique_violation';
  END;
END;
$function$;

COMMENT ON FUNCTION public.set_student_date_of_birth(UUID, DATE) IS
  'Admin sets or clears a child''s date of birth (operations/edit, tenant from the row). Refuses a future date, a (name, DOB) duplicate, and a change under a pending claim. Audited by trg_audit_student_update. 20261118000100.';

REVOKE ALL ON FUNCTION public.set_student_date_of_birth(UUID, DATE) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_student_date_of_birth(UUID, DATE) TO authenticated;
