-- ============================================================
-- EXPAND: a coach can read the name of a child who WAS enrolled in a class they
-- own or are rostered on — not only one enrolled there now.
--
-- THE BUG (Wave 8 Bug-ledger row #2, found by the generated types). A coach sees
-- EVERY enrolment of a class they own (enrolments_select: coach_owns_class), but
-- saw the STUDENT only through an ACTIVE enrolment (students_select →
-- coach_serves_student / coach_rostered_with_student both require e.is_active).
-- So once a child was removed from the class, the marking screen's read returned
-- that enrolment with "students": null; for any lesson dated inside the closed
-- span, enrolledOn() read e.students.id → TypeError → the screen's spinner never
-- cleared. The billing engine still expects those lessons marked, so the month
-- could block. Prod 2026-10-06: 4 closed enrolments were hidden from their coach.
--
-- Decided 2026-10-06 (user): a coach may see the name of a child they taught —
-- any enrolment, active or closed, in a class they own or are rostered on.
--
-- Scope, deliberately narrow:
--   * READ only. coach_serves_student is NOT edited: set_students_active() uses
--     it to authorise a coach changing a child's active status, and that must stay
--     limited to children enrolled NOW. The new helper gates students_select only.
--   * Enrolments only (bookings are already covered by the existing arms, which
--     never looked at is_active).
--   * An ADD: one new function + one new OR arm on one policy (ALTER POLICY —
--     nothing dropped or renamed; Wave 8 RISK 4).
--
-- Grants: authenticated already holds SELECT on students (the policy only gains an
-- OR arm), so no table grant changes (§7.87). The helper gets EXECUTE for
-- authenticated + service_role only, never PUBLIC/anon (function_grants.test.sql).
-- After deploy, dump the REMOTE grants and confirm anon has no EXECUTE (§7.39):
--   supabase db dump --linked --schema public -f /tmp/d.sql
--   grep 'coach_taught_student' /tmp/d.sql | grep '"anon"'   # must print nothing
--
-- Rollback: supabase/rollback/20261006000600_coach_sees_past_pupils_DOWN.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.coach_taught_student(p_student_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM student_class_enrolments e
      JOIN classes c ON c.id = e.class_id
     WHERE e.student_id = p_student_id
       AND (c.coach_id = current_coach_id() OR coach_rostered_in_class(e.class_id))
  );
$$;

REVOKE ALL ON FUNCTION public.coach_taught_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_taught_student(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_taught_student(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.coach_taught_student(UUID) IS
  'RLS helper: the caller coaches (owns or is rostered on) a class this child was EVER enrolled in, active or closed. Read-only arm of students_select — never an authorisation for a write (that stays coach_serves_student).';

-- Live expression read from the database 2026-10-06 (§7.40); it gains one arm.
ALTER POLICY students_select ON public.students
  USING (
    is_platform_admin()
    OR ((created_by = auth.uid()) AND (NOT tenant_suspended(tenant_id)))
    OR parent_owns_student(id)
    OR has_admin_area(tenant_id, 'operations'::admin_area, 'view'::admin_level)
    OR coach_serves_student(id)
    OR coach_rostered_with_student(id)
    OR coach_taught_student(id)
  );
