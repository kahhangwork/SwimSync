-- ============================================================
-- A GUEST'S NAME MUST BE READABLE BY THE PEOPLE WHO HANDLE THE LESSON.
--
-- Two SECURITY DEFINER helpers widened, both re-derived from the LIVE
-- definitions (§7.40) with one EXISTS branch each added. CREATE OR REPLACE,
-- never DROP — a DROP takes the (default) grants with it (§7.35). Both are
-- read-only visibility helpers; neither grants any write.
--
-- 1. coach_serves_student() — gated students_select on an ACTIVE enrolment in
--    the coach's classes. A booked guest has no enrolment there, so the HOST
--    coach could not read their students row, and the roster query's
--    .filter(Boolean) silently dropped the child (verified by the Phase 0
--    probe: count = 0 as the real role). This was LATENT FOR TRIALS TOO —
--    masked in production only because the one live coach is also the tenant
--    admin — so both booking tables are added in the same change.
--
--    Cancelled bookings are deliberately NOT excluded: a booking cancelled
--    after the coach marked it must not strip the coach's read of a name
--    attached to existing attendance (the 20260726001300 reasoning).
--
-- 2. parent_has_child_in_class() — feeds classes_select AND sessions_select.
--    Without the makeup branch the parent's attendance history would render
--    the make-up row with a blank date and "Class" (RLS hides the embedded
--    session — a silently broken row, not an error), and the home card could
--    not name the host class.
--
-- ⚠ WIDENING IS EXISTS-ONLY, ANCHORED ON current_coach_id() /
-- current_parent_id(). No branch may reach another family's or tenant's data
-- without that anchor — pinned by the negative pgTAP probes
-- (makeup_bookings.test.sql).
-- ============================================================

CREATE OR REPLACE FUNCTION public.coach_serves_student(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM student_class_enrolments e
    JOIN classes c ON c.id = e.class_id
    WHERE e.student_id = p_student_id
      AND e.is_active
      AND c.coach_id = current_coach_id()
  ) OR EXISTS (
    -- A trial guest booked into one of this coach's lessons.
    SELECT 1 FROM trial_bookings tb
    JOIN classes c ON c.id = tb.class_id
    WHERE tb.student_id = p_student_id
      AND c.coach_id = current_coach_id()
  ) OR EXISTS (
    -- A make-up guest booked into one of this coach's lessons.
    SELECT 1 FROM makeup_bookings mb
    JOIN classes c ON c.id = mb.class_id
    WHERE mb.student_id = p_student_id
      AND c.coach_id = current_coach_id()
  );
$$;

COMMENT ON FUNCTION public.coach_serves_student(uuid) IS
  'A coach serves a student if they are ACTIVELY enrolled in one of the coach''s classes, OR booked (trial or make-up) into one of the coach''s lessons. Bookings grant READ of the student row only — cancelled ones included, so a name attached to already-marked attendance never disappears.';

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
