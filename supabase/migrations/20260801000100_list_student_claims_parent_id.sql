-- ============================================================
-- list_student_claims(): add parent_id to the return set.
--
-- WHY: the admin Claims queue is gaining a family-level payment-method chip
-- ("Package · N left" / "Ad-hoc"). The chip is keyed by parent_id against
-- package_live_balances(), and this function was the queue's only read path —
-- it returned the parent's name/email/phone but not their id, so the page had
-- nothing to join on.
--
-- A changed RETURNS TABLE cannot go through CREATE OR REPLACE — DROP/CREATE.
-- That mints a NEW pg_proc row, so the grant block below is restated in full:
-- cloud's project-level default privileges re-grant anon EXECUTE on creation,
-- and only an explicit revoke + a remote grant dump catches it (§7.39).
--
-- Everything else — the SECURITY DEFINER rationale, the is_tenant_admin()
-- boundary per claim, why profiles_select cannot serve this screen — is
-- unchanged from 20260726000700_list_student_claims.sql; read that header.
-- ============================================================

DROP FUNCTION public.list_student_claims();

CREATE FUNCTION public.list_student_claims()
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
  parent_id     UUID,
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
    sc.parent_id,
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
  'The admin queue in one read. Exists because profiles_select cannot show a parent who has joined but has no child yet — exactly the parent who files a claim. parent_id added 2026-08-01 for the payment-method chip.';

REVOKE ALL ON FUNCTION public.list_student_claims() FROM PUBLIC;
-- §7.39 — cloud default-grants new functions to anon and service_role, and the
-- local stack does not reproduce that. Revoke explicitly; verify on the remote.
REVOKE EXECUTE ON FUNCTION public.list_student_claims() FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_student_claims() TO authenticated;
