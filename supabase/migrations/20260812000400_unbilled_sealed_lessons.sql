-- ============================================================
-- Wave 4: a lesson recorded into an already-BILLED month is REPORTED.
-- (BACKLOG.md → "A lesson recorded into an already-BILLED month is reported,
-- and settled". Settlement itself needs nothing new — student_settlements
-- and its admin flow shipped in 20260725000100 and cover this case as-is.)
--
-- THE GAP THIS CLOSES. Sealing is final by design (§8a, §8.6) and the
-- completeness gate guarantees every lesson is marked AT GENERATION TIME. It
-- cannot cover a lesson that enters the month afterwards, and §8.32's reopened
-- marking window makes that a supported path, not an accident: bill July on
-- 2 August, and July stays markable all August (the floor is
-- LEAST(1 Jul, 1 Aug) = 1 Jul). Three ways a billable lesson lands behind the
-- seal: a backdated enrolment for a family that registered after billing; a
-- make-up or trial booked below the seal (book_makeup()/book_trial() check
-- markable_floor(), which the seal does not raise — see 20260810000100's
-- COMMENT on schedule_extra_lesson()); and an absent→present correction after
-- billing (present→absent auto-issues a credit note; this direction is
-- silent). The engine can never see any of them — sealed months short-circuit
-- — so without a standing report they are invisible, and the failure mode is
-- silence. Refusing to record was considered and rejected: a teaching record
-- is not only a billing record.
--
-- WHAT IT RETURNS. One row per (student, sealed month) with a count and the
-- earliest/latest orphan lesson date — the UnclaimedStudent shape (core.ts),
-- because the admin needs exactly the same thing here: enough to date a
-- settlement. DELIBERATELY NO DOLLAR AMOUNT: pricing lives in the engine's
-- effective-dated term logic, and a second implementation here could disagree
-- with it silently. The admin enters the amount when recording the
-- settlement, same as the unclaimed flow.
--
-- WHY per (student, lesson) AGAINST invoice_items, not "has an invoice".
-- invoice_items carries (student_id, lesson_session_id) for every billed
-- lesson, so the predicate catches the billed child who gained ONE extra
-- lesson after sealing, not just the never-billed child. attendance's UNIQUE
-- (lesson_session_id, student_id) makes the pair exact.
--
-- ACCEPTED EDGE: a lesson that was billed, then credited (present→absent),
-- then re-corrected to present keeps its invoice_items row, so it does not
-- appear here. The parent holds a credit note for a lesson that was in fact
-- taught; that is the credit-note flow's ledger to balance, not this report's.
--
-- SECURITY DEFINER because the report must see the whole tenant regardless of
-- which policies the caller's role narrows (§7.125 reasoning); the explicit
-- authorisation check below is therefore load-bearing. Grants follow §7.87:
-- callable by nobody until granted here — authenticated only, never anon.
-- ============================================================

CREATE FUNCTION public.unbilled_sealed_lessons(p_tenant UUID)
RETURNS TABLE (
  student_id            UUID,
  student_name          TEXT,
  billing_month         TEXT,
  lessons               BIGINT,
  earliest_session_date DATE,
  latest_session_date   DATE
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (is_platform_admin() OR can_admin_tenant(p_tenant)) THEN
    RAISE EXCEPTION 'not authorised to read this business''s billing reports';
  END IF;

  RETURN QUERY
  SELECT
    a.student_id,
    s.full_name,
    to_char(ls.session_date, 'YYYY-MM'),
    count(*),
    min(ls.session_date),
    max(ls.session_date)
  FROM attendance a
  JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
  JOIN classes c          ON c.id = ls.class_id
  JOIN students s         ON s.id = a.student_id
  WHERE c.tenant_id = p_tenant
    -- The engine's own billability rule (core.ts BILLABLE, PRD §5.4).
    AND a.status IN ('present', 'trial_paid')
    -- Only months this tenant has SEALED. An unsealed month is not orphaned:
    -- its lessons hold the month open and bill normally.
    AND EXISTS (
      SELECT 1 FROM billing_periods bp
       WHERE bp.tenant_id = p_tenant
         AND bp.billing_month = to_char(ls.session_date, 'YYYY-MM'))
    -- Never billed: no invoice line for THIS student on THIS lesson.
    AND NOT EXISTS (
      SELECT 1 FROM invoice_items ii
       WHERE ii.student_id = a.student_id
         AND ii.lesson_session_id = a.lesson_session_id)
    -- Not already settled: same rule the engine applies to unclaimed
    -- attendance — a live settlement covers lessons ON OR BEFORE its date.
    AND NOT EXISTS (
      SELECT 1 FROM student_settlements ss
       WHERE ss.student_id = a.student_id
         AND ss.reversed_at IS NULL
         AND ss.settled_through >= ls.session_date)
  GROUP BY a.student_id, s.full_name, to_char(ls.session_date, 'YYYY-MM')
  ORDER BY to_char(ls.session_date, 'YYYY-MM'), s.full_name;
END;
$$;

COMMENT ON FUNCTION public.unbilled_sealed_lessons(UUID) IS
  'Billable lessons sitting inside an already-sealed billing month that no invoice line covers and no live settlement clears. Standing admin report (Wave 4); the line persists until a student_settlements row covers it. Counts and dates only — pricing stays in the engine, deliberately.';

-- The REVOKE is not decorative: local default privileges already deny PUBLIC
-- (20260804000400), but Supabase's PROJECT-level defaults can still hand anon
-- EXECUTE on a new cloud function (§7.39). The post-deploy dump is the proof;
-- this line is the belt.
REVOKE ALL ON FUNCTION public.unbilled_sealed_lessons(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unbilled_sealed_lessons(UUID) TO authenticated;
