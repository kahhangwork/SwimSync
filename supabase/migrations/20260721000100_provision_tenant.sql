-- ============================================================
-- Provision a new business (tenant) — the PLATFORM admin's onboarding tool.
--
-- THE GAP THIS CLOSES. Everything downstream of a tenant existing was built
-- (RLS, join codes, per-tenant billing, wages, packages) but nothing could
-- CREATE one: 20260718000500 grants only SELECT/UPDATE on `tenants`, there is
-- no tenants_insert policy, and no create_tenant RPC. Every tenant alive today
-- came from seed.sql, the 20260718000600 backfill, or manual dashboard SQL.
--
-- WHY AN RPC AND NOT AN INSERT GRANT. Granting INSERT on `tenants` would let any
-- authenticated user mint a business — and a tenant is the top of the isolation
-- hierarchy, so that is the largest blast radius in the schema. Keeping the RPC
-- as the only door is the same arrangement as close_student_enrolment() and
-- set_students_active(): one operation, one gate, audit-shaped.
--   DO NOT add `GRANT INSERT ON tenants` or a `tenants_insert` policy later.
--
-- WHY THIS RAISES INSTEAD OF RETURNING ZERO ROWS. platform_tenant_overview()
-- deliberately returns zero rows when the caller is not a platform admin — a
-- READ tool that 500s is indistinguishable from an outage. This is a WRITE, and
-- a silent no-op on a write reads as success to the caller. So it raises.
--
-- SECURITY. SECURITY DEFINER runs as the owner and BYPASSES RLS, so the gate in
-- the body is the entire boundary. Two layers, deliberately:
--   1. the REVOKE/GRANT at the bottom — CREATE FUNCTION grants EXECUTE to
--      PUBLIC by default, and PUBLIC includes `anon` (the sibling of the
--      "a new table does NOT inherit RLS" gotcha), and
--   2. the is_platform_admin() check as the first statement in the body.
-- ============================================================

/**
 * Create a business and return the three things its onboarding needs:
 * its id, its slug, and the join code its parents will type.
 *
 * The caller must be the platform admin. A TENANT admin is refused too — they
 * run one business and have no authority to create another.
 *
 * The auth user for its first admin is created SEPARATELY, afterwards, by the
 * provision-tenant API route: the auth trigger (handle_new_user) REFUSES to
 * create a tenant_admin without a tenant_id rather than guessing, so the tenant
 * must exist first. That ordering is load-bearing — see the route, which
 * compensates by deleting this row if the invite then fails.
 */
CREATE OR REPLACE FUNCTION public.provision_tenant(
  p_display_name TEXT,
  p_kind         tenant_kind DEFAULT 'private'
)
RETURNS TABLE (tenant_id UUID, slug TEXT, join_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name  TEXT;
  v_base  TEXT;
  v_slug  TEXT;
  v_code  TEXT;
  v_n     INT := 1;
  v_id    UUID;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'only the platform admin may create a business';
  END IF;

  v_name := trim(COALESCE(p_display_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'a business needs a name';
  END IF;

  -- ----------------------------------------------------------
  -- Slug. Nothing reads it today (no route, no query — it is NOT NULL UNIQUE
  -- and otherwise inert), so it is derived rather than asked for. The fallback
  -- is load-bearing, NOT defensive padding: a business named entirely in
  -- non-Latin script — wholly plausible in Singapore — reduces to the empty
  -- string here, which would violate NOT NULL and fail provisioning outright.
  -- ----------------------------------------------------------
  v_base := lower(v_name);
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := trim(BOTH '-' FROM v_base);

  IF v_base = '' THEN
    v_base := 'tenant-' || substr(gen_random_uuid()::TEXT, 1, 8);
  END IF;

  -- Two businesses may legitimately share a name; the slug disambiguates.
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM tenants t WHERE t.slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;

  -- Join code: same retry-against-UNIQUE loop regenerate_join_code() uses.
  LOOP
    v_code := generate_join_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants t WHERE t.join_code = v_code);
  END LOOP;

  INSERT INTO tenants (display_name, slug, kind, join_code)
  VALUES (v_name, v_slug, p_kind, v_code)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_slug, v_code;
END;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC, which includes anon. Revoke first,
-- then grant narrowly. The is_platform_admin() gate in the body is the real
-- boundary, but an anon EXECUTE grant on a SECURITY DEFINER function is not a
-- thing to leave lying around.
REVOKE ALL ON FUNCTION public.provision_tenant(TEXT, tenant_kind) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_tenant(TEXT, tenant_kind) TO authenticated;

-- NOTE THE OMISSION, IT IS DELIBERATE: `service_role` is NOT granted EXECUTE.
--
-- is_platform_admin() resolves auth.uid(), which is NULL for the service role —
-- so a service-role call would evaluate the gate against nobody and the
-- function's entire boundary would rest on the API route remembering to use the
-- caller's token instead. Withholding the grant turns that from a rule someone
-- must remember into a loud "permission denied for function provision_tenant".
--
-- So if you ever see that error: the caller is using the SERVICE-ROLE client
-- when it must use the signed-in user's. Fix the caller. DO NOT add
-- `GRANT EXECUTE ... TO service_role` — that re-opens the hole this closes,
-- and it is the same family as the gate that the only live caller bypassed.

COMMENT ON FUNCTION public.provision_tenant(TEXT, tenant_kind) IS
  'Platform-admin-only: create a business + its join code. The ONLY INSERT path '
  'into tenants — do not add an INSERT grant or a tenants_insert policy. Its '
  'first admin is invited separately by the provision-tenant API route, which '
  'must delete this row if that invite fails (an operator-less tenant is still '
  'joinable by parents).';
