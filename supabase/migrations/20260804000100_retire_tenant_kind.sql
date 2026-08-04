-- ============================================================
-- RETIRE tenants.kind.
--
-- WHY. `kind` (`tenant_kind` = 'private' | 'school', NOT NULL DEFAULT
-- 'private') has never been read by anything. It was written by the tenancy
-- backfill in July 2026, is set by provision_tenant() from a parameter the
-- caller supplies, and is read by NO policy, RPC, screen or report. The one
-- place it ever surfaced — a "Type" column on the platform page — was replaced
-- on 2026-07-19 with a value DERIVED from the data (one coach who is also the
-- admin = a private coach), precisely because the stored value would have read
-- 'private' for an actual swim school and nobody would have noticed.
--
-- A NOT NULL column that every new tenant gets, that no code reads and no UI
-- sets, is a trap: the next person to find it will reasonably assume it means
-- something. It has already misled one session into asserting the platform page
-- derived a business's shape from it, which it never did. PRD §4.4 now states
-- outright that SwimSync does not classify businesses this way — the difference
-- between a one-coach school and a private coach is INTENT, and intent is not
-- in the data (§7.13: the distinction is data, not a rule).
--
-- WHAT THIS DOES NOT TOUCH. platform_tenant_overview() still returns `shape`.
-- That column is DERIVED at read time, so it cannot go stale the way a stored,
-- unmaintained `kind` did — a different failure mode, and it is pinned by
-- platform_overview.test.sql. Retiring the stored column is the whole change.
--
-- WHY provision_tenant() IS DROPPED AND RECREATED. `tenant_kind` appears in its
-- SIGNATURE, so the type cannot be dropped while the function exists. This is a
-- parameter removal, which CREATE OR REPLACE cannot do either. The body below
-- was taken from pg_get_functiondef() against the running database — NOT from a
-- migration file — because this function has been redefined twice and building
-- it from the wrong source silently reverts the class-categories insert that
-- 20260725000500 added. The ONLY changes are: p_kind is gone, and the INSERT no
-- longer names `kind`. Nothing else moved.
--
-- ORDER IS LOAD-BEARING: function (signature holds the type) → column → type.
-- ============================================================

-- ── 1. provision_tenant() loses its p_kind parameter ──────────────────────────
DROP FUNCTION IF EXISTS public.provision_tenant(TEXT, tenant_kind);

CREATE FUNCTION public.provision_tenant(p_display_name TEXT)
RETURNS TABLE (tenant_id UUID, slug TEXT, join_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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

  INSERT INTO tenants (display_name, slug, join_code)
  VALUES (v_name, v_slug, v_code)
  RETURNING id INTO v_id;

  -- Without these the business cannot create a class at all, because
  -- classes.category_id is NOT NULL (20260725000400).
  INSERT INTO class_categories (tenant_id, name)
  VALUES (v_id, 'Default Private'), (v_id, 'Default Group');

  RETURN QUERY SELECT v_id, v_slug, v_code;
END;
$function$;

COMMENT ON FUNCTION public.provision_tenant(TEXT) IS
  'Creates a business and its two default class categories. The ONLY INSERT '
  'path into tenants. SECURITY DEFINER: gated on is_platform_admin() in-body '
  'because it bypasses RLS. Took a p_kind argument until 2026-08-04; the '
  'column it wrote was never read by anything and has been dropped — a '
  'business''s shape is DERIVED from its data, never declared (PRD §4.4).';

-- The DROP took the grants with it. Restore them exactly as 20260721000300
-- left them: authenticated only. §7.39 — REVOKE FROM PUBLIC does not remove
-- the role-specific grants that Supabase cloud's default privileges add.
REVOKE ALL ON FUNCTION public.provision_tenant(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_tenant(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.provision_tenant(TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.provision_tenant(TEXT) TO authenticated;

-- ── 2. The column ─────────────────────────────────────────────────────────────
ALTER TABLE public.tenants DROP COLUMN kind;

-- ── 3. The type, now unreferenced ─────────────────────────────────────────────
DROP TYPE public.tenant_kind;
