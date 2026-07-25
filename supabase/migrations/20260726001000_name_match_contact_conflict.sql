-- ============================================================
-- A NAME MATCH WHOSE PHONE DISAGREES IS STILL A MATCH — BUT A WEAKER ONE, AND
-- THE ADMIN IS TOLD.
--
-- Asked from production 2026-07-26: if the child has a contact number and the
-- parent's number is DIFFERENT, why does the name still match?
--
-- ⚠ WHY THIS IS NOT TREATED LIKE THE DATE-OF-BIRTH CONFLICT (20260726000800),
-- WHICH DISQUALIFIES OUTRIGHT. The two look symmetrical and are not:
--
--   A DATE OF BIRTH IS A FACT ABOUT THE CHILD. One value. A different value
--   means it is a different child, full stop.
--
--   A PHONE NUMBER IS A FACT ABOUT WHOEVER BROUGHT THEM. A family can have
--   several, all legitimate:
--     • the mother's number was taken at the poolside and the FATHER registers
--       — parent_students is many-to-many exactly because a child has two
--       parents, and this is the common case, not an edge one;
--     • a grandparent or helper brought the child and gave their own number;
--     • the parent changed number between the trial and registering.
--
-- Hard-blocking would therefore mean a father can never claim his own child,
-- and it would fail SILENTLY — no candidate, no explanation, straight to a
-- duplicate record. That is a worse outcome than the noise it prevents.
--
-- So the match survives, is ranked LAST, and carries its own reason so the
-- admin queue can say "the number on file is different — check carefully".
-- The person deciding gets the evidence; the rule does not pre-empt them.
--
-- ⚠ THE PARENT IS NOT TOLD. Their popup reads exactly as an ordinary name
-- match. Saying "the number we hold for this child is different from yours"
-- discloses something about another family's record to someone who has not
-- been approved for it.
--
-- Only 'name_only' is demoted. 'name_dob' — where the full name AND the date
-- of birth both match — is strong enough on its own that a second parent's
-- phone number should not weaken it.
--
-- §7.40: body from pg_get_functiondef() on the live database.
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
             WHEN names_match(u.full_name, p_full_name)
              AND NOT (
                u.date_of_birth IS NOT NULL
                AND p_dob IS NOT NULL
                AND u.date_of_birth <> p_dob
              )
               THEN
                 -- Both sides have a number and they disagree: still offered
                 -- (it may be the child's other parent), but marked, ranked
                 -- last, and flagged to the admin. See the header.
                 CASE
                   WHEN v_phone IS NOT NULL
                    AND normalize_phone(u.provisional_contact_phone) IS NOT NULL
                    AND normalize_phone(u.provisional_contact_phone) <> v_phone
                     THEN 'name_only_phone_differs'
                   ELSE 'name_only'
                 END
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
             WHEN 'email'    THEN 1
             WHEN 'phone'    THEN 2
             WHEN 'name_dob' THEN 3
             WHEN 'name_only' THEN 4
             ELSE 5
           END,
           sc.full_name
  LIMIT 3;
END;
$$;

COMMENT ON FUNCTION public.find_student_candidates(UUID, TEXT, DATE) IS
  'Masked, capped-at-3 lookup of UNCLAIMED children a parent might own. Ranked email > phone > name+dob > name > name-with-a-differing-phone. A conflicting DATE OF BIRTH disqualifies; a conflicting PHONE only demotes, because a child can have two parents.';
