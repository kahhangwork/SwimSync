-- ============================================================
-- "HAS A CHILD IN THIS CLASS" NOW INCLUDES A CHILD TRIALLING IN IT.
--
-- parent_has_child_in_class() asked only about ENROLMENTS. A trial is a
-- BOOKING, not an enrolment, so a parent whose child is trying one lesson had
-- no read access to that class at all — verified before fixing: SELECT
-- count(*) FROM classes as such a parent returns 0.
--
-- Found one level below the trial_bookings gap (20260726001300): with that
-- fixed the parent's home card could finally read the BOOKING, and still
-- rendered "their class" because the embedded classes(title) came back NULL.
-- Two policies, one feature, and each looked like the feature simply not
-- working.
--
-- ⚠ WHY THE SHARED HELPER RATHER THAN A NEW BRANCH ON classes_select.
-- Two reasons, and the second is the important one:
--
--   1. A bare EXISTS on trial_bookings inside classes_select would run UNDER
--      RLS, and trial_bookings_select itself reads `classes` (for the coach
--      branch) — mutually recursive policies, which is exactly the trap §6
--      records from the tenanting work. This helper is SECURITY DEFINER, so
--      its query bypasses RLS and the cycle cannot form.
--
--   2. The helper also feeds sessions_select. A parent whose child trials on
--      Saturday should be able to see that lesson on their Attendance screen
--      once the coach marks it — and without this they could read the
--      attendance row but not the session it hangs off. Fixing only
--      classes_select would have left that broken and much harder to spot.
--
-- ⚠ CANCELLED BOOKINGS ARE DELIBERATELY NOT EXCLUDED. If a booking is
-- cancelled AFTER the coach marked the lesson, the family keeps attendance in
-- that class — and hiding the class would leave them with a lesson they cannot
-- see. A cancelled booking grants only readability of a class title and its
-- session dates, which is not worth a second failure mode.
-- ============================================================

CREATE OR REPLACE FUNCTION public.parent_has_child_in_class(p_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  );
$function$;

COMMENT ON FUNCTION public.parent_has_child_in_class(uuid) IS
  'Does this parent have a child in this class — by ENROLMENT or by TRIAL BOOKING? Feeds classes_select and sessions_select. SECURITY DEFINER so reading trial_bookings here cannot make the two policies mutually recursive.';
