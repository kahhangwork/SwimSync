-- ============================================================================
-- WAVE 3 FOLLOW-UP — the guard 20260811000200 owed, and the batch roster gate
--
-- Two things, one migration, because BACKLOG.md said to bundle them and one
-- schema change is in flight at a time (§7.55).
--
-- 1. assign_session_coach()'s shadow branch could DEMOTE the lesson's main.
--    `ON CONFLICT (lesson_session_id, coach_id) DO UPDATE SET role = 'shadow'`
--    turned the main into a shadow if an admin added that same coach as a
--    shadow. The lesson was then left with NO main, the absence rule took over,
--    and pay reverted to the class's own coach — a silent re-attribution of
--    money nobody asked for. set_session_main_coach() refuses ON CONFLICT DO
--    NOTHING for the mirror of exactly this reason, so the asymmetry was an
--    oversight, not a design. Only a CLIENT-SIDE re-check guarded it
--    (SwimSyncAdmin/app/(admin)/lesson-coaches/page.tsx), so every non-UI
--    caller and every second tab was unprotected.
--
-- 2. sessions_i_am_main_on(uuid[]) — one round trip instead of one per session.
--    §7.134 forces a SECURITY DEFINER probe because session_coaches_select
--    hides the row naming the substitute from the coach who was replaced, and
--    theirs is the screen that must stop nagging. Latency insurance, not a fix.
--
-- Plan, with the ranked risk review this was built from:
-- docs/plans/WAVE_3_FOLLOWUP_PLAN.md
-- ============================================================================


-- ============================================================================
-- 1. THE GUARD — two halves, because a lesson has two ways to have a main
--
-- The ROW main (a session_coaches row with role = 'main') and the ABSENCE main
-- (no roster main at all, so the class's own coach teaches it — 20260811000200
-- calls this the absence rule). BOTH are demotable by the shadow branch and
-- both produce the same bug, so both are refused here.
--
-- The client already refuses both: assignableShadows() (SwimSyncAdmin/lib/
-- sessionRoster.ts) filters by the EFFECTIVE main's coach id, absence included.
-- That filter stays — it is what a real admin meets, and it names the coach.
-- This is what covers the second tab, the stale dropdown and every caller that
-- is not that page.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assign_session_coach(
  p_class_id     UUID,
  p_session_date DATE,
  p_coach_id     UUID,
  p_role         session_coach_role
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    -- Untouched. Promoting an existing shadow to main is legitimate, and
    -- set_session_main_coach() deletes the old main before upserting.
    PERFORM set_session_main_coach(v_session, p_coach_id);
  ELSE
    -- ── The ABSENCE-RULE main ────────────────────────────────────────────
    -- There is no row to conflict with, so this half cannot be atomic. The
    -- race is bounded and benign: the only way to lose it is for somebody to
    -- install a real main in the same instant, after which a shadow row for
    -- the class's coach is legitimate. The row-main half below is the one that
    -- had to be race-free.
    --
    -- ⚠ NOT coach_is_main_on_session(). That answers about current_coach_id(),
    -- and the caller here is the ADMIN, not the coach being assigned — it
    -- would return FALSE for every admin and the guard would never fire. A
    -- check that cannot see what it is checking is §7.125's shape exactly.
    IF NOT EXISTS (
          SELECT 1 FROM session_coaches sc
           WHERE sc.lesson_session_id = v_session AND sc.role = 'main')
       AND EXISTS (
          SELECT 1 FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
           WHERE ls.id = v_session AND c.coach_id = p_coach_id)
    THEN
      RAISE EXCEPTION 'that coach already teaches this lesson as the class''s coach — '
                      'adding them as a shadow would say two different things about one person';
    END IF;

    -- ── The ROW main ─────────────────────────────────────────────────────
    -- ⚠ THE GUARD IS THE STATEMENT'S OWN `WHERE`, NOT A PRE-CHECK BEFORE IT.
    -- An `IF EXISTS (… role = 'main') THEN RAISE` is TOCTOU by construction and
    -- the race is the exact bug being fixed: admin A promotes X to main while
    -- admin B adds X as a shadow; B's EXISTS cannot see A's uncommitted row, so
    -- it passes, B's INSERT then blocks on the unique index, A commits, and the
    -- DO UPDATE demotes the main B was just told did not exist. ON CONFLICT
    -- waits on the conflicting row's LOCK, so this WHERE is evaluated against
    -- the committed row.
    --
    -- ⚠ NOTHING MAY BE INSERTED BETWEEN THIS STATEMENT AND ITS `IF NOT FOUND`.
    -- FOUND is clobbered by the next SELECT / PERFORM / assignment-with-query,
    -- and a clobbered FOUND is a guard that still looks like a guard.
    --
    -- Re-adding an EXISTING shadow sets role to the value it already holds, so
    -- FOUND is true and nothing raises — idempotence survives.
    INSERT INTO session_coaches (tenant_id, lesson_session_id, coach_id, role, assigned_by)
    VALUES ('00000000-0000-0000-0000-000000000000', v_session, p_coach_id, 'shadow', auth.uid())
    ON CONFLICT (lesson_session_id, coach_id) DO UPDATE
      SET role = 'shadow'
      WHERE session_coaches.role <> 'main';

    IF NOT FOUND THEN
      -- Without this the excluded row simply would not update and the RPC would
      -- return success having done nothing — ON CONFLICT DO NOTHING wearing a
      -- different hat, which set_session_main_coach()'s own comment refuses.
      --
      -- This message reaches the admin verbatim: lesson-coaches/page.tsx renders
      -- `Could not assign: ${error.message}`.
      RAISE EXCEPTION 'that coach is already the main coach for this lesson — '
                      'change the main coach first, or the lesson would be left with none';
    END IF;
  END IF;

  RETURN v_session;
END;
$$;


-- ============================================================================
-- 2. THE BATCH ROSTER GATE
--
-- ⚠ THE BODY IS coach_is_main_on_session() AND NOTHING ELSE. Two copies of
-- "who is main" is the bug waiting to happen (§7.129, which cost this wave a
-- double-payment), and the absence rule is subtle enough that a second copy
-- would drift. The win here is ONE ROUND TRIP, not one query.
--
-- ⚠ NEVER ADD A LIMIT, AN ORDER BY, A p_since OR ANY OTHER FILTER. The caller
-- computes "covered out" as ASKED MINUS RETURNED, so every way this function
-- can return less than the truth hides a lesson that needs marking — and
-- unmarked attendance blocks the billing month with NO OVERRIDE (§8i) and
-- nothing on any screen saying why. Narrowing the answer set is the unsafe
-- direction by construction. If the probe set ever needs bounding, bound it at
-- the CALLER (SwimSyncApp/lib/sessionMainCoach.ts's MAX_PROBE), where returning
-- nothing is the loud outcome.
--
-- SECURITY DEFINER is not optional: §7.134 is the whole reason a probe exists.
-- ============================================================================

-- ⚠ THE BOUND IS A REFUSAL, NOT A LIMIT, AND THAT DISTINCTION IS THE POINT.
-- coach_is_main_on_session() is SECURITY DEFINER SQL and therefore NOT
-- inlinable, so this is N function calls with nothing else to stop them. A
-- LIMIT would narrow the answer the caller subtracts from — silent, and the
-- unsafe direction. Raising is loud and cannot hide a lesson. The client's own
-- MAX_PROBE (200) means an honest caller never approaches this.
CREATE OR REPLACE FUNCTION public.sessions_i_am_main_on(p_session_ids UUID[])
RETURNS SETOF UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(array_length(p_session_ids, 1), 0) > 1000 THEN
    RAISE EXCEPTION 'too many sessions in one probe (% > 1000)', array_length(p_session_ids, 1);
  END IF;

  RETURN QUERY
  SELECT DISTINCT s.id
    FROM unnest(p_session_ids) AS s(id)
   WHERE s.id IS NOT NULL
     AND coach_is_main_on_session(s.id);
END;
$$;

COMMENT ON FUNCTION public.sessions_i_am_main_on(UUID[]) IS
  'The subset of the given lesson_sessions the CALLER is the main coach of — '
  'roster main, or the class''s coach under the absence rule. One round trip '
  'in place of one coach_is_main_on_session() call per session (§7.134). '
  'Returns a subset of its argument, deduplicated, and never anything else: '
  'the caller subtracts it from what it asked, so a short answer would hide a '
  'lesson that needs marking. Never add a LIMIT or a filter.';


-- ============================================================================
-- 3. GRANTS — §7.87
--
-- A new function is callable by NOBODY until its own migration grants it, and
-- a blanket re-grant is never the fix (supabase/tests/table_grants.test.sql
-- goes red on any privilege no policy permits).
--
-- assign_session_coach already holds its grant and CREATE OR REPLACE preserves
-- it — re-asserted anyway, because that is cheaper than being wrong.
-- ============================================================================

DO $$
DECLARE
  fn TEXT;
  fns TEXT[] := ARRAY[
    'public.assign_session_coach(uuid,date,uuid,session_coach_role)',
    'public.sessions_i_am_main_on(uuid[])'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;
