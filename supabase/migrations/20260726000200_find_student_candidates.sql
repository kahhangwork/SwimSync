-- ============================================================
-- find_student_candidates(): "has my coach already added my child?"
-- (PARENT_CLAIM_PLAN.md phase 2, §6.)
--
-- WHY THIS MUST BE SECURITY DEFINER. A parent who has just joined a business
-- matches NO branch of students_select — not creator, not owning parent — so
-- they cannot see an unclaimed child at all. Without a definer function there
-- is no way to tell them their child is already on the roster, which is the
-- entire feature.
--
-- ⚠ THIS FUNCTION IS A DISCLOSURE SURFACE, AND ITS ONLY CREDENTIAL IS A JOIN
-- CODE. Everything keeping one family's children away from another passes
-- through here, and a join code travels over WhatsApp. Four rules, all load
-- bearing, none of them optional:
--
--   1. parent_in_tenant() IS THE BOUNDARY. This function takes a tenant id as
--      a parameter (§7.42's derive-don't-accept rule governs WRITERS; this is a
--      reader), which means an ungated version would let any parent enumerate
--      any business on the platform. It REFUSES rather than returning zero
--      rows, because an empty set is what a legitimately empty business looks
--      like and the two must not be confusable.
--   2. MASKING HAPPENS HERE, IN SQL. The function never returns a full name, so
--      no future screen — and no network tab — can reveal one. A full name sent
--      to the client and masked in JavaScript is not masking.
--   3. UNCLAIMED ONLY. A child who already has a parent is never a candidate;
--      that case is a merge (admin-side), not a claim.
--   4. CAPPED AT 3, IN THE FUNCTION. The cap is the privacy rule, not a
--      pagination convenience, so it must not be something a caller can raise.
-- ============================================================

-- ⚠ THE LAST EIGHT DIGITS, NOT ALL OF THEM. Stripping punctuation alone is not
-- enough: a parent types "+65 9111 2222" at registration while the coach writes
-- "91112222" on a poolside form, and those normalise to 6591112222 vs 91112222
-- — DIFFERENT, so the strongest non-name signal in the system silently never
-- fires. Singapore numbers are 8 digits, so comparing the last 8 makes the
-- country code, spaces and dashes all irrelevant.
--
-- Returns NULL below 8 digits: a short fragment would match half a roster, and
-- a weak signal that silently behaves like a strong one is worse than none.
-- (SwimSync is Singapore-only — PRD §1. If it ever is not, this needs a real
-- country-aware normaliser, not a longer suffix.)
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN length(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g')) >= 8
           THEN right(regexp_replace(p_phone, '\D', '', 'g'), 8)
           ELSE NULL
         END;
$$;

-- Lowercased, punctuation-stripped, single-spaced name tokens.
-- Tokens of one character are dropped: a middle initial is not evidence.
CREATE OR REPLACE FUNCTION public.name_tokens(p_name TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(t) FILTER (WHERE length(t) >= 2),
    ARRAY[]::TEXT[]
  )
  FROM unnest(
    string_to_array(
      btrim(regexp_replace(lower(COALESCE(p_name, '')), '[^a-z0-9]+', ' ', 'g')),
      ' '
    )
  ) AS t
  WHERE t <> '';
$$;

-- ⚠ THE MATCH RULE, AND WHY IT IS NOT "ANY SHARED TOKEN".
--
-- Naive token overlap is a disaster in Singapore: every Tan matches every other
-- Tan, and the popup becomes a directory of the business's unclaimed children —
-- exactly the disclosure this feature is supposed to avoid. So a name matches
-- when EITHER:
--   • the GIVEN NAME (first token) is equal — which is what makes
--     "Ethan" ↔ "Ethan Tan Wei Ming" work, the real nickname case; or
--   • at least TWO tokens are shared — which catches a reordered or
--     dialect-vs-English rendering ("Tan Wei Ming Ethan" ↔ "Ethan Tan").
-- A surname alone satisfies neither.
CREATE OR REPLACE FUNCTION public.names_match(p_a TEXT, p_b TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH a AS (SELECT name_tokens(p_a) AS t), b AS (SELECT name_tokens(p_b) AS t)
  SELECT CASE
    WHEN cardinality(a.t) = 0 OR cardinality(b.t) = 0 THEN FALSE
    WHEN a.t[1] = b.t[1] THEN TRUE
    ELSE (SELECT count(*) FROM unnest(a.t) x WHERE x = ANY(b.t)) >= 2
  END
  FROM a, b;
$$;

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
       -- Not already claimed by THIS parent and awaiting a decision — offering
       -- it again would let them file the same request twice.
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
             WHEN names_match(u.full_name, p_full_name)
               THEN 'name_only'
             ELSE NULL
           END AS reason
      FROM unclaimed u
  )
  SELECT
    sc.id,
    -- RULE 2. First name in full, every following token reduced to an initial:
    -- "Ethan Tan Wei Ming" → "Ethan T. W. M.". The parent has already typed a
    -- matching name, so the given name is near enough to information they
    -- supplied; the family name is not.
    (
      (name_tokens(sc.full_name))[1] || COALESCE(
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
  -- Strongest signal first, so the cap keeps the best evidence rather than an
  -- arbitrary three.
  ORDER BY CASE sc.reason
             WHEN 'phone'    THEN 1
             WHEN 'name_dob' THEN 2
             ELSE 3
           END,
           sc.full_name
  -- RULE 4.
  LIMIT 3;
END;
$$;

COMMENT ON FUNCTION public.find_student_candidates(UUID, TEXT, DATE) IS
  'Masked, capped-at-3 lookup of UNCLAIMED children a parent might own. Gated on parent_in_tenant. Never returns a full name — do not add a mode that does.';

REVOKE ALL ON FUNCTION public.normalize_phone(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.name_tokens(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.names_match(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_student_candidates(UUID, TEXT, DATE) FROM PUBLIC;

-- §7.39: Supabase CLOUD default-grants EXECUTE on new public functions to anon,
-- authenticated and service_role, and the local stack does NOT reproduce that —
-- so a grant verified with pg_proc locally can be wrong in production. Revoke
-- both roles EXPLICITLY, and re-check against a dump of the remote after push.
REVOKE EXECUTE ON FUNCTION public.normalize_phone(TEXT) FROM anon, service_role;
REVOKE EXECUTE ON FUNCTION public.name_tokens(TEXT) FROM anon, service_role;
REVOKE EXECUTE ON FUNCTION public.names_match(TEXT, TEXT) FROM anon, service_role;
REVOKE EXECUTE ON FUNCTION public.find_student_candidates(UUID, TEXT, DATE)
  FROM anon, service_role;

GRANT EXECUTE ON FUNCTION public.normalize_phone(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.name_tokens(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.names_match(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_student_candidates(UUID, TEXT, DATE) TO authenticated;
