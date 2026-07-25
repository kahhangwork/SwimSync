-- ============================================================
-- list_student_claims(): everything the admin's queue needs, in one read.
--
-- ⚠ WHY THIS EXISTS, AND WHY THE OBVIOUS JOIN DOES NOT WORK.
-- The Parent Requests page first read student_claims and embedded
-- `parents(profiles(full_name, email, phone))`. Under service role that
-- returns the parent's details; under the ADMIN's own RLS it returns NULL, and
-- the page showed "—" for the name, email and phone of every requester.
--
-- profiles_select lets a business's admin see a parent only through:
--
--     EXISTS (SELECT 1 FROM parents p
--              WHERE p.profile_id = profiles.id AND tenant_serves_parent(p.id))
--
-- and tenant_serves_parent() reaches a parent THROUGH THEIR CHILDREN'S
-- ENROLMENTS. A parent who has redeemed the join code but has no child yet is
-- served by nobody — which is precisely the parent who files a claim. So the
-- one screen whose entire job is "who is asking, and are they who they say?"
-- could not see who was asking.
--
-- Caught by the UI driver, not by pgTAP: the RPCs were all correct, and the
-- hole was in the page's READ path. Same shape as the two bugs slice 1's
-- driver found (§8.10).
--
-- WHY NOT WIDEN profiles_select. Adding "…or they have a claim in my tenant"
-- to a policy that already has five branches, and which every screen in both
-- apps depends on, is a large edit to the most load-bearing policy in the
-- schema for one page's benefit. A SECURITY DEFINER reader gated on
-- is_tenant_admin() exposes exactly this one screen's worth of data and
-- nothing else.
--
-- WHAT IT DELIBERATELY DOES NOT DO: it takes no tenant parameter. The rows are
-- filtered by is_tenant_admin() against each claim's OWN tenant, so a caller
-- cannot name a business they do not administer.
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_student_claims()
RETURNS TABLE (
  id            UUID,
  status        TEXT,
  certainty     TEXT,
  match_reason  TEXT,
  created_at    TIMESTAMPTZ,
  decided_at    TIMESTAMPTZ,
  claimed_name  TEXT,
  claimed_dob   DATE,
  student_id    UUID,
  student_name  TEXT,
  student_dob   DATE,
  lessons       INT,
  parent_name   TEXT,
  parent_email  TEXT,
  parent_phone  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    sc.id,
    sc.status::TEXT,
    sc.certainty::TEXT,
    sc.match_reason,
    sc.created_at,
    sc.decided_at,
    sc.claimed_name,
    sc.claimed_dob,
    sc.student_id,
    s.full_name,
    s.date_of_birth,
    -- The number that makes a wrong approval expensive, so it belongs on the
    -- decision screen rather than a click away.
    (SELECT count(*)::INT FROM attendance a WHERE a.student_id = s.id),
    pr.full_name,
    pr.email,
    pr.phone
  FROM student_claims sc
  JOIN students s  ON s.id = sc.student_id
  JOIN parents p   ON p.id = sc.parent_id
  JOIN profiles pr ON pr.id = p.profile_id
  -- The whole boundary. Per claim, against that claim's own tenant.
  WHERE is_tenant_admin(sc.tenant_id)
  ORDER BY sc.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.list_student_claims() IS
  'The admin queue in one read. Exists because profiles_select cannot show a parent who has joined but has no child yet — exactly the parent who files a claim.';

REVOKE ALL ON FUNCTION public.list_student_claims() FROM PUBLIC;
-- §7.39 — cloud default-grants new functions to anon and service_role, and the
-- local stack does not reproduce that. Revoke explicitly; verify on the remote.
REVOKE EXECUTE ON FUNCTION public.list_student_claims() FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_student_claims() TO authenticated;
