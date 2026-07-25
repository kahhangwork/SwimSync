-- ============================================================
-- A CONFLICTING DATE OF BIRTH DISQUALIFIES A NAME MATCH.
--
-- Reported from production 2026-07-26, and the reporter was right to be
-- suspicious: a parent typing "Ethan" was offered a candidate on the strength
-- of the given name ALONE, with the child's date of birth never consulted.
--
-- Worse, the two matchers in this codebase DISAGREED, and the wrong one was
-- looser. `findDuplicatePairs()` (the admin's duplicate detector) already
-- skipped any pair whose dates of birth conflict:
--
--     if (a.date_of_birth && b.date_of_birth && a.date_of_birth !== b.date_of_birth) continue;
--
-- while this function — the PARENT-facing one, the one that decides what a
-- stranger holding a join code gets shown — ignored the date entirely for a
-- name match. The security-relevant matcher was the permissive one.
--
-- ⚠ A MISSING DATE IS NOT A CONFLICTING ONE, AND THAT DISTINCTION IS THE WHOLE
-- FEATURE. Half the children this exists for have NO date of birth — a coach
-- adding a walk-in at the poolside rarely has it, which is exactly why
-- students_identity_uniq (which exempts NULL) lets the duplicate form in the
-- first place. So the rule is: refuse only when BOTH sides have a date and the
-- dates differ. Two children genuinely called "Ethan Tan" born on different
-- days are namesakes or siblings, not one child recorded twice.
--
-- The phone signal is deliberately NOT subject to this. It is name-independent
-- and stronger than either name or date; a family whose number the coach wrote
-- down is the same family whatever was typed.
--
-- §7.40: this body was taken from `pg_get_functiondef()` on the live database,
-- not retyped from 20260726000200 — that gotcha has now fired twice on this
-- codebase. The ONLY change is the two added lines in the CASE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_student_candidates(
  p_tenant_id UUID,
  p_full_name TEXT,
  p_dob       DATE DEFAULT NULL
)
RETURNS TABLE (
  student_id    UUID,
  masked_name   TEXT,
  match_reason  TEXT,
  last_lesson   DATE,
  class_title   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent UUID := current_parent_id();
  v_phone  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'only a parent can look for their own child';
  END IF;

  -- RULE 1. The whole boundary. Refuse, do not return empty.
  IF NOT parent_in_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'you have not joined that business';
  END IF;

  SELECT normalize_phone(pr.phone) INTO v_phone
    FROM profiles pr WHERE pr.id = auth.uid();

  RETURN QUERY
  WITH unclaimed AS (
    SELECT s.*
      FROM students s
     WHERE s.tenant_id = p_tenant_id
       AND s.is_active
       -- RULE 3: nobody has claimed them yet.
       AND NOT EXISTS (SELECT 1 FROM parent_students ps WHERE ps.student_id = s.id)
       AND NOT EXISTS (
         SELECT 1 FROM student_claims sc
          WHERE sc.student_id = s.id
            AND sc.parent_id = v_parent
            AND sc.status = 'pending'
       )
  ),
  scored AS (
    SELECT u.id,
           u.full_name,
           CASE
             WHEN v_phone IS NOT NULL
              AND normalize_phone(u.provisional_contact_phone) = v_phone
               THEN 'phone'
             WHEN p_dob IS NOT NULL
              AND u.date_of_birth = p_dob
              AND lower(btrim(u.full_name)) = lower(btrim(p_full_name))
               THEN 'name_dob'
             -- ⚠ THE FIX. A name match is refused outright when both sides
             -- carry a date of birth and they disagree. NULL on either side is
             -- NOT a disagreement — see the header.
             WHEN names_match(u.full_name, p_full_name)
              AND NOT (
                u.date_of_birth IS NOT NULL
                AND p_dob IS NOT NULL
                AND u.date_of_birth <> p_dob
              )
               THEN 'name_only'
             ELSE NULL
           END AS reason
      FROM unclaimed u
  )
  SELECT
    sc.id,
    (
      initcap((name_tokens(sc.full_name))[1]) || COALESCE(
        (SELECT string_agg(' ' || upper(left(t, 1)) || '.', '')
           FROM unnest((name_tokens(sc.full_name))[2:]) AS t),
        ''
      )
    )::TEXT,
    sc.reason,
    (SELECT max(ls.session_date)
       FROM attendance a
       JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
      WHERE a.student_id = sc.id),
    (SELECT c.title
       FROM attendance a
       JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
       JOIN classes c ON c.id = ls.class_id
      WHERE a.student_id = sc.id
      ORDER BY ls.session_date DESC
      LIMIT 1)
  FROM scored sc
  WHERE sc.reason IS NOT NULL
  ORDER BY CASE sc.reason
             WHEN 'phone'    THEN 1
             WHEN 'name_dob' THEN 2
             ELSE 3
           END,
           sc.full_name
  LIMIT 3;
END;
$$;

COMMENT ON FUNCTION public.find_student_candidates(UUID, TEXT, DATE) IS
  'Masked, capped-at-3 lookup of UNCLAIMED children a parent might own. Gated on parent_in_tenant. A conflicting date of birth disqualifies a name match; a MISSING one does not. Never returns a full name.';
