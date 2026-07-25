-- ============================================================
-- A newly provisioned business starts with its two categories.
--
-- WHY THIS IS NOT OPTIONAL. `classes.category_id` is now NOT NULL
-- (20260725000400), and provision_tenant() is the ONLY insert path into
-- `tenants` (§8.9). A business created without categories therefore cannot
-- create a class AT ALL -- and the failure surfaces later, on the classes
-- screen, looking like a bug in class creation rather than in provisioning.
--
-- Same transaction as the tenant, so a business can never exist without them.
-- The names match what 20260725000400 backfilled onto existing tenants, so
-- every business starts from the same two regardless of when it was created.
-- They are ordinary categories: renameable, and deletable once they hold no
-- classes and no trial rates.
--
-- ⚠ THE BODY BELOW WAS TAKEN FROM pg_get_functiondef() ON THE LIVE DATABASE,
-- not from 20260721000100. That is §7.40, and it fired AGAIN here: a
-- hand-reconstruction of this function silently replaced the slug's
-- disambiguating counter loop with a random suffix, changed an error message,
-- and dropped two declared variables. Only the diff against the live
-- definition caught it. The ONLY intended change is the INSERT marked below.
-- ============================================================

CREATE OR REPLACE FUNCTION public.provision_tenant(
  p_display_name TEXT,
  p_kind         tenant_kind DEFAULT 'private'::tenant_kind
)
 RETURNS TABLE(tenant_id uuid, slug text, join_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  -- ── THE ONLY CHANGE FROM THE PREVIOUS DEFINITION ──────────────────────────
  -- Without these the business cannot create a class at all, because
  -- classes.category_id is NOT NULL (20260725000400).
  INSERT INTO class_categories (tenant_id, name)
  VALUES (v_id, 'Default Private'), (v_id, 'Default Group');

  RETURN QUERY SELECT v_id, v_slug, v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_tenant(TEXT, tenant_kind) FROM PUBLIC;
-- §7.39: cloud default-grants new/replaced public functions to anon and
-- service_role where local does not. Re-stated explicitly on every redefinition.
REVOKE EXECUTE ON FUNCTION public.provision_tenant(TEXT, tenant_kind)
  FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.provision_tenant(TEXT, tenant_kind) TO authenticated;
