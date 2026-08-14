-- Rollback for 20260814000200_find_roster_duplicates.sql
-- Pure new read-only function; dropping it removes the Add-student duplicate
-- warning's data source. The admin UI fails OPEN (a missing/erroring RPC is
-- treated as "no warning"), so the app keeps working after this runs — the
-- warning simply stops appearing. students_identity_uniq remains the DB floor.

DROP FUNCTION IF EXISTS public.find_roster_duplicates(UUID, TEXT, TEXT, DATE);
