-- ============================================================================
-- DROP THE assign_session_coach COMPAT SHIM, AND THE ENUM THAT ONLY IT USED
--
-- 20260812000200 left a 4-argument assign_session_coach(uuid, date, uuid,
-- session_coach_role) in place ON PURPOSE: migrations deploy before Vercel
-- builds `main`, so for the length of that window the deployed admin panel was
-- still calling the 4-arg form, and dropping it in the same migration would
-- have broken coach assignment in production — the same failure §7.123
-- already cost this repo once. The shim's job was to survive that window.
--
-- The window is CLOSED, and that was verified the way §11.10 requires — by
-- OPENING THE SCREEN, not by the push returning 200: the live admin panel's
-- Classes drawer shows the "Add a shadow" section (2026-08-12), and the served
-- Expo bundle greps for this wave's strings. The deployed caller passes three
-- named arguments, which bind the 3-arg function, so nothing can reach the
-- shim any more.
--
-- `session_coach_role` survives only as the shim's argument type — 20260812000200
-- dropped the `session_coaches.role` column it used to type. DROP TYPE refuses
-- while any signature still names it, and that refusal is the useful one: if
-- this migration's DROP FUNCTION ever misses a signature, the type is the
-- tripwire. Do not work around it by leaving the type.
--
-- Filed in BACKLOG.md BEFORE the shim shipped. Rollback (recreates both, with
-- their grants): supabase/rollback/20260812000300_drop_session_coach_shim_DOWN.sql
-- ============================================================================

DROP FUNCTION public.assign_session_coach(uuid, date, uuid, session_coach_role);

DROP TYPE public.session_coach_role;
