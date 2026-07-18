-- ============================================================
-- close_student_enrolment(): remove a child from their class, optionally
-- marking them inactive. Callable by the SUPERADMIN or by the COACH whose
-- class the child is currently in.
--
-- Why this exists: invoice generation is now BLOCKED while any lesson has
-- unmarked attendance, with no override. The completeness gate builds its
-- student list from ACTIVE ENROLMENTS and never consults students.is_active,
-- so a child who has left but whose enrolment is still open keeps their class
-- permanently incomplete — which would block ALL billing, with dashboard SQL
-- as the only way out. Closing the enrolment is that way out, so it must be
-- reachable in-app by the person who notices: the coach.
--
-- Why a SECURITY DEFINER function rather than an RLS policy: the operation
-- needs to touch students.assignment_status, and students_update is
-- (superadmin OR creator OR owning parent). Granting coaches UPDATE on
-- students would let them edit names, DOBs and notes too — RLS is row-level,
-- not column-level. A function exposes exactly this one operation instead,
-- keeps the three writes together, and cannot be bypassed by a client.
--
-- Deliberately NOT offered: creating an enrolment (assignment stays a
-- superadmin action, PRD 5.2) and deleting one (history must survive,
-- PRD 11.5; credit must be untouched, PRD 11.8 — so enrolments are closed,
-- never removed).
--
-- Interim permission model. Once coach type exists (BACKLOG: private vs
-- school), this splits: a PRIVATE coach keeps it, while for a SCHOOL coach it
-- moves to their tenant admin.
-- ============================================================

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
  v_actor UUID := auth.uid();
  v_old   JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Checked BEFORE the enrolment is closed: coach_serves_student() reads the
  -- active enrolment, so it would return false immediately afterwards.
  IF NOT (is_superadmin() OR coach_serves_student(p_student_id)) THEN
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
                         old_value, new_value)
  VALUES (
    v_actor,
    CASE WHEN p_set_inactive THEN 'student_set_inactive'
         ELSE 'student_removed_from_class' END,
    'Student',
    p_student_id,
    v_old,
    (SELECT to_jsonb(s) FROM students s WHERE s.id = p_student_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_student_enrolment(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_student_enrolment(UUID, BOOLEAN)
  TO authenticated, service_role;
