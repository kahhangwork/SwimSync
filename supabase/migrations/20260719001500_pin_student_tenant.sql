-- A student never changes business except through the platform admin's RPC.
--
-- THE HOLE THIS CLOSES (verified exploitable before the fix):
--   students_update's WITH CHECK is identical to its USING clause —
--     is_platform_admin() OR created_by = auth.uid()
--       OR parent_owns_student(id) OR is_tenant_admin(tenant_id)
--   Nothing in that expression mentions the NEW tenant_id, and
--   parent_owns_student(id) stays true after the business changes. So a parent
--   could rewrite their own child's tenant_id to ANY existing business and the
--   check still passed:
--
--     SET LOCAL ROLE authenticated;
--     SET LOCAL "request.jwt.claims" TO '{"sub":"<a parent>", ...}';
--     UPDATE students SET tenant_id = '<a rival business>' WHERE ...;
--     -- UPDATE 2
--
--   That injects a child onto a stranger's roster, where that business's admin
--   can see and bill them. It defeats the join code, which is the ONLY proof
--   that a family deals with a business (PRD §5.1) — possession of the code is
--   the whole gate, and this walked around it.
--
--   The hole is PRE-EXISTING and reachable today via a direct API call; it was
--   never reachable through the UI only because nothing in the app updates
--   students. The parent edit-child screen makes it an ordinary path, which is
--   why this lands first.
--
-- WHY A TRIGGER AND NOT COLUMN GRANTS:
--   `REVOKE UPDATE ON students` + `GRANT UPDATE (col, ...)` also works, and is
--   airtight, but it enumerates columns — so every column added later is
--   silently read-only until someone remembers to extend the grant. That is a
--   trap primed to fire on the next schema change (levels are next). A trigger
--   states the invariant once, needs no maintenance, and cannot be undone by a
--   future GRANT.
--
-- WHY current_user AND NOT auth.uid():
--   The three legitimate writers — reassign_student_tenant(),
--   set_students_active(), close_student_enrolment() — are SECURITY DEFINER
--   owned by postgres, so inside them current_user is 'postgres', not
--   'authenticated'. Ordinary client DML always arrives as 'authenticated'.
--   That is the seam, and it keeps the platform admin's rescue tool working.

CREATE OR REPLACE FUNCTION pin_student_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION
      'A student cannot be moved between businesses directly. Use reassign_student_tenant().'
      USING ERRCODE = 'check_violation';
  END IF;

  -- created_by feeds students_update's own USING clause, so letting a client
  -- rewrite it would let them grant themselves permission on the row.
  IF NEW.created_by IS DISTINCT FROM OLD.created_by
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION
      'students.created_by is not client-writable — it is part of the row''s own access rule.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pin_student_tenant ON students;
CREATE TRIGGER trg_pin_student_tenant
  BEFORE UPDATE ON students
  FOR EACH ROW
  EXECUTE FUNCTION pin_student_tenant();

COMMENT ON FUNCTION pin_student_tenant() IS
  'Keeps students.tenant_id and students.created_by out of client reach. The '
  'tenant boundary is not expressible in students_update''s WITH CHECK, which '
  'cannot see the OLD row. See migration 20260719001500.';
