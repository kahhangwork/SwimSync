-- Rollback for 20261006000600_coach_sees_past_pupils.sql.
-- Restores students_select to its 2026-10-06 expression, then drops the helper.
-- Valid at any time: nothing else references coach_taught_student.

ALTER POLICY students_select ON public.students
  USING (
    is_platform_admin()
    OR ((created_by = auth.uid()) AND (NOT tenant_suspended(tenant_id)))
    OR parent_owns_student(id)
    OR has_admin_area(tenant_id, 'operations'::admin_area, 'view'::admin_level)
    OR coach_serves_student(id)
    OR coach_rostered_with_student(id)
  );

DROP FUNCTION IF EXISTS public.coach_taught_student(UUID);
