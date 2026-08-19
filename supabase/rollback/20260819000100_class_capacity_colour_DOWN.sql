-- DOWN for 20260819000100_class_capacity_colour.sql
--
-- Drops the three columns (any capacity/colour the admin has set is LOST —
-- export first if it matters:
--   SELECT id, title, capacity, colour FROM classes WHERE capacity IS NOT NULL OR colour IS NOT NULL;
--   SELECT id, name, default_capacity FROM class_categories WHERE default_capacity IS NOT NULL;
-- ) and restores audit_log_insert to its 20260804000300 body, after which a
-- pure tenant admin's attendance audit row is refused again (42501). Roll the
-- admin lesson page (Slice C) off main BEFORE running this, or admin saves will
-- fail at the audit step.

DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;
CREATE POLICY audit_log_insert ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND entity_type = 'lesson_session'
    AND coach_owns_session(entity_id)
  );

ALTER TABLE public.classes
  DROP COLUMN IF EXISTS colour,
  DROP COLUMN IF EXISTS capacity;

ALTER TABLE public.class_categories
  DROP COLUMN IF EXISTS default_capacity;
