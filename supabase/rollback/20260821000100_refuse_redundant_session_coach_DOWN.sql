-- Rollback for 20260821000100_refuse_redundant_session_coach.sql
-- Restores the pre-guard body of the 3-arg assign_session_coach (the definition
-- from 20260812000200 §10). Signature unchanged, so the grant carries forward.

CREATE OR REPLACE FUNCTION public.assign_session_coach(
  p_class_id     UUID,
  p_session_date DATE,
  p_coach_id     UUID
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
