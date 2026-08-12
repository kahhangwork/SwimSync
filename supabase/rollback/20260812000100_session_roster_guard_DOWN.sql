-- ============================================================================
-- ROLLBACK for 20260812000100_session_roster_guard.sql.
--
-- Committed BEFORE the deploy and REHEARSED by running it — §7.93, where
-- actually running the DOWN file is the half that finds the bugs.
--
-- This file does DOUBLE DUTY: it is the production escape hatch AND the
-- instrument that proves the new pgTAP is not vacuous. A body that has drifted
-- by one line proves the wrong thing twice, so the assign_session_coach body
-- below was DUMPED from pg_get_functiondef() on a database at 20260811000200
-- and pasted — not retyped, and not copied from the migration that created it,
-- because CREATE OR REPLACE means the newest definition can live in any later
-- file and grep finds the oldest first (§7.115). Proven byte-identical:
-- migration applied, this file applied, re-dumped, diffed — empty.
--
-- SAFE TO RUN WITH ROSTER DATA PRESENT. Nothing here drops a table or a row.
-- What comes back is the pre-guard behaviour: adding a lesson's own main coach
-- as a shadow silently demotes them and the lesson falls back to the class's
-- coach for pay. That is the bug; this file restores it deliberately.
--
-- ⚠ THE DEPLOYED COACH APP CALLS sessions_i_am_main_on. Dropping it after the
-- app has shipped is SAFE and LOUD, not silent: PostgREST answers 404, the
-- client's `error` branch returns an EMPTY covered-out set, and every lesson
-- stays on NEEDS MARKING. Coaches over-report rather than under-report, the
-- database refuses the wrong saves visibly, and no billing month is blocked.
-- Rehearsed by hand on the Schedule tab, not assumed
-- (docs/plans/WAVE_3_FOLLOWUP_PLAN.md §1.4).
-- ============================================================================

-- ── the batch roster gate, gone ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.sessions_i_am_main_on(UUID[]);


-- ── assign_session_coach, back to its 20260811000200 body ───────────────────
-- Verbatim from pg_get_functiondef('public.assign_session_coach(uuid,date,uuid,
-- session_coach_role)'::regprocedure) taken before the migration was applied.
CREATE OR REPLACE FUNCTION public.assign_session_coach(p_class_id uuid, p_session_date date, p_coach_id uuid, p_role session_coach_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session UUID;
BEGIN
  IF NOT can_admin_tenant(class_tenant(p_class_id)) THEN
    RAISE EXCEPTION 'not permitted to assign coaches for this business';
  END IF;

  SELECT ls.id INTO v_session
    FROM lesson_sessions ls
   WHERE ls.class_id = p_class_id AND ls.session_date = p_session_date;

  IF v_session IS NULL THEN
    -- Refuse a date the class does not run on. A roster row against a
    -- fabricated date is a lesson that will be marked, paid and BILLED on a
    -- day the class never met. An existing row is honoured either way, because
    -- a rescheduled or extra lesson is legitimately off-pattern.
    PERFORM assert_class_runs_on(p_class_id, p_session_date);

    INSERT INTO lesson_sessions (class_id, session_date)
    VALUES (p_class_id, p_session_date)
    ON CONFLICT (class_id, session_date) DO NOTHING;

    SELECT ls.id INTO v_session
      FROM lesson_sessions ls
     WHERE ls.class_id = p_class_id AND ls.session_date = p_session_date;
  END IF;

  IF p_role = 'main' THEN
    PERFORM set_session_main_coach(v_session, p_coach_id);
  ELSE
    INSERT INTO session_coaches (tenant_id, lesson_session_id, coach_id, role, assigned_by)
    VALUES ('00000000-0000-0000-0000-000000000000', v_session, p_coach_id, 'shadow', auth.uid())
    ON CONFLICT (lesson_session_id, coach_id) DO UPDATE SET role = 'shadow';
  END IF;

  RETURN v_session;
END;
$function$;

-- The grant survives CREATE OR REPLACE, but re-assert it so this file leaves a
-- database that behaves exactly like one at 20260811000200 (§7.87 — a function
-- nobody can execute is a different kind of outage).
REVOKE ALL ON FUNCTION public.assign_session_coach(uuid,date,uuid,session_coach_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_session_coach(uuid,date,uuid,session_coach_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_session_coach(uuid,date,uuid,session_coach_role)
  TO authenticated, service_role;
