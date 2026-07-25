-- ============================================================
-- MATCH ON THE PARENT'S EMAIL TOO — the strongest signal available.
--
-- From the same production feedback that made the phone compulsory: matching
-- on a child's NAME is inherently unreliable, because a name is written many
-- ways. "Ethan Tan Ah Beng" and "Tan Ah Beng Ethan" are one child; so are
-- "Ethan" and his full name; so are an English name and a dialect one. The
-- token rule handles reordering, but it is still guessing at a string.
--
-- A CONTACT DETAIL IS NOT A GUESS. The coach writes down the parent's phone
-- and email at the poolside; the parent later registers with that same email.
-- That is not a similarity score, it is the same person.
--
-- Email is ranked ABOVE phone because it is exact and unique: two families can
-- share a household number, and a number can be re-issued, but the address a
-- parent signs in with is their account.
--
-- ⚠ NAME MATCHING STAYS, AND MUST. Every unclaimed child created before this
-- has no contact details at all — production has several — so removing the
-- name fallback would strand exactly the records that most need claiming. The
-- name is now the LAST resort rather than the ordinary path.
--
-- §7.40: body taken from pg_get_functiondef() on the live database, not from
-- 20260726000800. The only changes are the new 'email' branch and its place in
-- the ORDER BY.
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
  v_email  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'only a parent can look for their own child';
  END IF;

  IF NOT parent_in_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'you have not joined that business';
  END IF;

  SELECT normalize_phone(pr.phone), lower(btrim(pr.email))
    INTO v_phone, v_email
    FROM profiles pr WHERE pr.id = auth.uid();

  RETURN QUERY
  WITH unclaimed AS (
    SELECT s.*
      FROM students s
     WHERE s.tenant_id = p_tenant_id
       AND s.is_active
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
             -- Exact, unique, and not a guess: the address they sign in with.
             WHEN v_email IS NOT NULL
              AND v_email <> ''
              AND lower(btrim(u.provisional_contact_email)) = v_email
               THEN 'email'
             WHEN v_phone IS NOT NULL
              AND normalize_phone(u.provisional_contact_phone) = v_phone
               THEN 'phone'
             WHEN p_dob IS NOT NULL
              AND u.date_of_birth = p_dob
              AND lower(btrim(u.full_name)) = lower(btrim(p_full_name))
               THEN 'name_dob'
             -- Last resort. A conflicting date of birth disqualifies it; a
             -- MISSING one does not (20260726000800).
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
  -- Strongest first, so the cap of 3 keeps the best evidence.
  ORDER BY CASE sc.reason
             WHEN 'email'    THEN 1
             WHEN 'phone'    THEN 2
             WHEN 'name_dob' THEN 3
             ELSE 4
           END,
           sc.full_name
  LIMIT 3;
END;
$$;

COMMENT ON FUNCTION public.find_student_candidates(UUID, TEXT, DATE) IS
  'Masked, capped-at-3 lookup of UNCLAIMED children a parent might own. Ranked email > phone > name+dob > name. Gated on parent_in_tenant. Never returns a full name.';
