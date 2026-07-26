-- ============================================================
-- §7.39, caught by its own audit step on the 2026-07-27 deploy.
--
-- `20260727000100` shipped five functions. Two of them —
-- schedule_extra_lesson() and assert_class_runs_on() — carried an explicit
-- `REVOKE EXECUTE … FROM anon, service_role`, and the post-deploy remote dump
-- shows them clean. The other three carried only `REVOKE ALL … FROM PUBLIC`,
-- and the dump shows exactly what §7.39 says it would:
--
--   GRANT ALL ON FUNCTION "public"."today_sg"()               TO "anon";
--   GRANT ALL ON FUNCTION "public"."session_window_start"()   TO "anon";
--   GRANT ALL ON FUNCTION "public"."assert_markable_date"(…)  TO "anon";
--
-- PUBLIC is its own grantee, not an umbrella over anon/authenticated/
-- service_role, and Supabase CLOUD carries project-level ALTER DEFAULT
-- PRIVILEGES granting EXECUTE on new public functions to all three. The local
-- stack does not reproduce that, so `pg_proc` looked correct locally and was
-- wrong in production — which is the whole reason the remote dump is a deploy
-- step rather than a local assertion.
--
-- NOTHING WAS EXPOSED, and that is worth stating precisely rather than waving
-- at. All three are plain STABLE functions that read no application data:
-- two return a date derived from now(), and the third raises or returns void.
-- The only function in the batch that is SECURITY DEFINER and reads a table
-- (assert_class_runs_on) was already revoked, as was the only one that WRITES
-- (schedule_extra_lesson).
--
-- So this is hygiene, not a fix — but the audit in §7.39 is
--   supabase db dump … | grep -E '(GRANT|REVOKE).*ON FUNCTION' | grep '"anon"'
-- and a permanently non-empty result trains the next person to ignore it.
-- That is how the second layer goes missing in the first place.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.today_sg()                 FROM anon, service_role;
REVOKE EXECUTE ON FUNCTION public.session_window_start()     FROM anon, service_role;
REVOKE EXECUTE ON FUNCTION public.assert_markable_date(DATE) FROM anon, service_role;

-- `authenticated` must keep EXECUTE: the guard triggers call these three while
-- running as that role, and a trigger body's function calls ARE permission-
-- checked against the invoking role. Revoking it here would make every
-- attendance save fail with "permission denied for function".
GRANT EXECUTE ON FUNCTION public.today_sg()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_window_start()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_markable_date(DATE) TO authenticated;
