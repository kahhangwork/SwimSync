-- ============================================================================
-- ROLLBACK for 20260812000300_drop_session_coach_shim.sql.
--
-- Committed BEFORE the deploy and REHEARSED by running it — §7.93, where
-- actually running the DOWN file is the half that finds the bugs.
--
-- Recreates the 4-arg compat shim and the enum that types its last argument,
-- exactly as 20260812000200 left them. The shim body below was DUMPED from
-- pg_get_functiondef() on a database at 20260812000200 and pasted — not
-- retyped, and not copied from the migration that created it (§7.115). Proven
-- byte-identical: migration applied, this file applied, re-dumped, diffed —
-- empty.
--
-- ORDER MATTERS: the type must exist before the function that names it.
--
-- GRANTS ARE PART OF THE RESTORE (§7.124 — CREATE does not carry a grant):
-- the shim held EXECUTE for authenticated AND service_role; the enum needs no
-- grant. Without the explicit GRANTs the restored shim is callable by NOBODY,
-- which defeats the only reason to restore it.
--
-- SAFE TO RUN ANY TIME. Nothing here drops or writes a row; the 3-arg
-- function, the roster tables and every policy are untouched.
-- ============================================================================

CREATE TYPE public.session_coach_role AS ENUM ('main', 'shadow');

CREATE OR REPLACE FUNCTION public.assign_session_coach(p_class_id uuid, p_session_date date, p_coach_id uuid, p_role session_coach_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Compat shim for the deployed admin panel across the §7.123 window. Dropped
  -- by the follow-up migration once Vercel has built main. 'shadow' is no
  -- longer a lesson-level concept, so it is REFUSED LOUDLY, never ignored —
  -- silently treating it as a main assignment would move a lesson's pay.
  IF p_role <> 'main' THEN
    RAISE EXCEPTION
      'shadows are now assigned to the whole class, not to one lesson — '
      'reload this page and use the Classes page';
  END IF;

  RETURN assign_session_coach(p_class_id, p_session_date, p_coach_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.assign_session_coach(uuid, date, uuid, session_coach_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_session_coach(uuid, date, uuid, session_coach_role) TO service_role;
