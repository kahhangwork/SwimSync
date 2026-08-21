-- ============================================================================
-- REFUSE A NO-OP SUBSTITUTE — assigning the coach who already teaches the lesson
--
-- assign_session_coach() installs a per-lesson substitute (a session_coaches
-- row, one per session). When the coach chosen is the one the class rate ALREADY
-- pays on that date, the row records NO cover — lessonAttribution's is_cover is
-- `subCoach != termsCoach`, which is false — and the only thing it produces is a
-- dead-end "Remove substitute" control on the lesson page. A private coach hit
-- exactly that assigning themselves: "Teaching: <me>" with no "(Sub)" tag but a
-- red Remove button that looked like a stuck error.
--
-- The UI already hides that coach from the picker; this is the DB half, so the
-- refusal holds for any caller (the Substitutes page assigns through the same
-- RPC). The predicate is class_rate_on().paid_coach_id — the SAME money axis
-- is_cover reads, NOT classes.coach_id — so a genuine handover-correction cover
-- (pinning a coach who is not the paid one on that date) is still allowed. To go
-- back to the class's own coach you REMOVE the substitute; you never assign them.
--
-- Placed BEFORE the resolve-or-create, so a refused assignment leaves no
-- lesson_sessions row behind. The class already exists by here: class_tenant()
-- in the auth check returns NULL for a missing class and can_admin_tenant(NULL)
-- refuses it first.
--
-- CREATE OR REPLACE of the existing 3-arg function — signature unchanged (no
-- §7.123 exposure), grant carries forward, no new object so no grant-dump cell
-- changes. Rollback (restores the pre-guard body):
-- supabase/rollback/20260821000100_refuse_redundant_session_coach_DOWN.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assign_session_coach(
  p_class_id     UUID,
  p_session_date DATE,
  p_coach_id     UUID
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session     UUID;
  v_terms_coach UUID;
BEGIN
  IF NOT can_admin_tenant(class_tenant(p_class_id)) THEN
    RAISE EXCEPTION 'not permitted to assign coaches for this business';
  END IF;

  -- The no-op guard (see header). class_rate_on() returns exactly one row for a
  -- date that has terms in force, and every class has terms from 2000-01-01.
  SELECT paid_coach_id INTO v_terms_coach
    FROM class_rate_on(p_class_id, p_session_date);
  IF v_terms_coach IS NOT NULL AND p_coach_id = v_terms_coach THEN
    RAISE EXCEPTION
      'that coach already teaches this lesson — a substitute must be a different '
      'coach (to go back to the class''s own coach, remove the substitute)';
  END IF;

  SELECT ls.id INTO v_session
    FROM lesson_sessions ls
   WHERE ls.class_id = p_class_id AND ls.session_date = p_session_date;

  IF v_session IS NULL THEN
    -- Refuse a date the class does not run on. A roster row against a
    -- fabricated date is a lesson that will be marked, paid and BILLED on a day
    -- the class never met. An existing row is honoured either way, because a
    -- rescheduled or extra lesson is legitimately off-pattern.
    PERFORM assert_class_runs_on(p_class_id, p_session_date);

    INSERT INTO lesson_sessions (class_id, session_date)
    VALUES (p_class_id, p_session_date)
    ON CONFLICT (class_id, session_date) DO NOTHING;

    SELECT ls.id INTO v_session
      FROM lesson_sessions ls
     WHERE ls.class_id = p_class_id AND ls.session_date = p_session_date;
  END IF;

  PERFORM set_session_main_coach(v_session, p_coach_id);

  RETURN v_session;
END;
$$;
