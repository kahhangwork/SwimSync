-- ============================================================
-- find_roster_duplicates(): "before I add this child, is a look-alike already
-- on my roster?" — the ADMIN's Add-student duplicate warning.
-- Plan: docs/plans/ADD_STUDENT_DUP_WARNING_PLAN.md
--
-- WHY THIS EXISTS. add_unclaimed_student() (20260725000200) only hard-errors on
-- an EXACT name + DOB collision, and students_identity_uniq is NULL-DOB-exempt
-- (20260719001400) — so with a blank DOB, which is the usual case at the
-- poolside, nothing catches a placeholder for a child a registered family
-- already has. Post-§8.55 that duplicate's HISTORY is unrecoverable in the UI:
-- the "possible duplicate" banner no longer compares a claimed child against an
-- unclaimed one, and the merge dialog only opens for a pair the banner flags. So
-- the catch has to happen AT CREATION — this is the read the dialog runs first.
--
-- ⚠ THIS IS A DISCLOSURE SURFACE — a SECURITY DEFINER function bypasses RLS,
-- exactly like find_student_candidates (20260726000200). Four rules hold the
-- line, none optional:
--   1. is_tenant_admin(p_tenant_id) IS THE GATE. It REFUSES rather than
--      returning empty (an empty roster and a refusal must not be confusable),
--      and it is false for a coach and for a foreign-tenant admin — so this
--      function is admin-only by construction. A coach-side add UI, if ever
--      built, warns via a SEPARATE path; do not wire this one into it.
--   2. TENANT-SCOPED, ALWAYS. Every student read is `tenant_id = p_tenant_id`,
--      and the claiming-parent phone is resolved only for THOSE students. A
--      parent in two businesses has one global profiles row; an unscoped phone
--      join would surface tenant B's child inside tenant A.
--   3. UNMASKED IS DELIBERATE, AND SAFE ONLY BECAUSE OF THE GATE. Unlike the
--      parent-facing find_student_candidates, this returns the full name and the
--      claiming parent's name — the admin already sees both in-tenant (the
--      Students list and the contact modal). It is safe ONLY because rule 1
--      confines the caller to their own business. Do not lift the gate.
--   4. CAPPED AT 5, IN THE FUNCTION.
--
-- ⚠ INACTIVE ROWS ARE INCLUDED — ON PURPOSE, and NOT the same call the banner
-- makes. duplicateStudents.ts excludes inactive because its banner has no
-- dismiss, so an inactive pair would be permanent noise. This is a one-shot,
-- dismissable creation prompt, and a family that LEFT and returns (re-added with
-- no DOB) is the exact silent duplicate this feature targets. Excluding inactive
-- here would miss it. The row carries is_active so the UI can label it.
--
-- ⚠ NAME-ONLY MATCHES AGAINST CLAIMED CHILDREN FIRE HERE — which is what §8.55
-- turned OFF for the persistent banner. Correct at creation: it is dismissable,
-- and the mom/dad case (dad's account, mom's number keyed) IS a name-only match
-- against a claimed child, so suppressing it would reopen the very gap this
-- closes. Noise is handled by ORDER (phone before name) + the UI's weaker "same
-- name" grouping, not by suppression.
--
-- ⚠ ADVISORY ONLY. This never blocks a write. The caller treats an error or a
-- refusal as "no warning" and adds anyway; students_identity_uniq is the real
-- floor. A phone match must never hard-block — siblings share a parent phone.
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_roster_duplicates(
  p_tenant_id UUID,
  p_full_name TEXT,
  p_phone     TEXT DEFAULT NULL,
  p_dob       DATE DEFAULT NULL
)
RETURNS TABLE (
  student_id   UUID,
  full_name    TEXT,
  parent_name  TEXT,
  is_active    BOOLEAN,
  reason       TEXT,
  last_lesson  DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT := normalize_phone(p_phone);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- RULE 1. The whole boundary. Refuse, do not return empty. False for a coach
  -- and for a foreign-tenant admin.
  IF NOT is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'not an admin of this business';
  END IF;

  RETURN QUERY
  WITH roster AS (
    -- RULE 2: this tenant only. Active AND inactive.
    SELECT s.id, s.full_name, s.date_of_birth, s.is_active,
           s.provisional_contact_phone
      FROM students s
     WHERE s.tenant_id = p_tenant_id
  ),
  -- Claiming parents of THIS tenant's students only (rule 2).
  parented AS (
    SELECT ps.student_id,
           pr.full_name              AS parent_name,
           normalize_phone(pr.phone) AS parent_phone
      FROM roster r
      JOIN parent_students ps ON ps.student_id = r.id
      JOIN parents         pa ON pa.id = ps.parent_id
      JOIN profiles        pr ON pr.id = pa.profile_id
  ),
  scored AS (
    SELECT r.id, r.full_name, r.is_active,
           (SELECT p.parent_name FROM parented p
             WHERE p.student_id = r.id
             ORDER BY p.parent_name LIMIT 1) AS parent_name,
           CASE
             -- Phone always wins, regardless of DOB. Either the child's own
             -- provisional contact number, or any claiming parent's account.
             WHEN v_phone IS NOT NULL AND (
                    normalize_phone(r.provisional_contact_phone) = v_phone
                    OR EXISTS (SELECT 1 FROM parented p
                                WHERE p.student_id = r.id
                                  AND p.parent_phone = v_phone)
                  )
               THEN 'phone'
             -- Name is the weaker signal, and a KNOWN different DOB kills it:
             -- two "Ethan Tan" born on different days are namesakes, not a dup.
             WHEN names_match(r.full_name, p_full_name)
              AND NOT (p_dob IS NOT NULL
                       AND r.date_of_birth IS NOT NULL
                       AND r.date_of_birth <> p_dob)
               THEN 'name'
             ELSE NULL
           END AS reason
      FROM roster r
  )
  SELECT
    sc.id,
    sc.full_name,
    sc.parent_name,
    sc.is_active,
    sc.reason,
    (SELECT max(ls.session_date)
       FROM attendance a
       JOIN lesson_sessions ls ON ls.id = a.lesson_session_id
      WHERE a.student_id = sc.id)
  FROM scored sc
  WHERE sc.reason IS NOT NULL
  -- Strongest signal first, active before inactive, then name for stability.
  ORDER BY CASE sc.reason WHEN 'phone' THEN 1 ELSE 2 END,
           sc.is_active DESC,
           sc.full_name
  -- RULE 4.
  LIMIT 5;
END;
$$;

COMMENT ON FUNCTION public.find_roster_duplicates(UUID, TEXT, TEXT, DATE) IS
  'Admin-only, tenant-scoped, capped-at-5 lookup of roster children a new add '
  'might duplicate. Gated on is_tenant_admin (refuses a coach / foreign tenant). '
  'Returns UNMASKED names — safe only because of that gate. Advisory: never '
  'blocks a write; a phone match must never hard-block (siblings share a phone).';

REVOKE ALL ON FUNCTION public.find_roster_duplicates(UUID, TEXT, TEXT, DATE) FROM PUBLIC;

-- §7.39: Supabase CLOUD default-grants EXECUTE on new public functions to anon,
-- authenticated and service_role; the local stack does not. Revoke both
-- EXPLICITLY and re-check a remote pg_proc dump after push.
REVOKE EXECUTE ON FUNCTION public.find_roster_duplicates(UUID, TEXT, TEXT, DATE)
  FROM anon, service_role;

GRANT EXECUTE ON FUNCTION public.find_roster_duplicates(UUID, TEXT, TEXT, DATE)
  TO authenticated;
