-- Rollback for 20260814000100_rename_student.sql
-- rename_student() is a brand-new function, so the DOWN simply drops it. No
-- earlier definition existed to restore, and it grants nothing to anyone else.
DROP FUNCTION IF EXISTS public.rename_student(UUID, TEXT);
