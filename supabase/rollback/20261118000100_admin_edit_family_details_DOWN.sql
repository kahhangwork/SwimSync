-- DOWN for 20261118000100_admin_edit_family_details.
-- APPS FIRST: deploy an admin build that no longer calls these three RPCs, THEN run this. Dropping them under a live
-- admin that calls them turns each Save / Unlink into an error.
DROP FUNCTION IF EXISTS public.set_parent_contact(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.unlink_parent_from_student(UUID, UUID);
DROP FUNCTION IF EXISTS public.set_student_date_of_birth(UUID, DATE);
