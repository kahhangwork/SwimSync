-- ============================================================
-- A SIGNED-IN STRANGER COULD FORGE THE TWO LINKS THAT DEFINE A FAMILY.
--
-- Found 2026-08-04 while auditing whether `authenticated` deserved the sweep
-- `anon` got in 20260804000200/000400. It did not — `authenticated` is the app,
-- and its DML is load-bearing — but the audit asked a better question on the
-- way past: *which of its write grants is restrained by nothing but a policy
-- that checks only the caller's own id?* Two were, and both were reachable.
--
-- ── WHAT WAS REPRODUCED, ON THE LOCAL STACK, WITH A REAL ANON-KEY SESSION ────
-- Signup is open (`SwimSyncApp/app/(auth)/register.tsx` — a join code is asked
-- for later, never at signup), so the attacker is anyone with an email address.
--
--   1. POST /rest/v1/parent_tenants {parent_id: <own>, tenant_id: <any>}
--        → HTTP 201. Joined a business with no join code.
--      Policy was `parent_tenants_insert` WITH CHECK
--        (parent_id = current_parent_id() OR is_platform_admin())
--      — it constrained WHOSE row it was and never WHICH BUSINESS it named.
--      The table has no trigger and no CHECK constraint behind it.
--
--      What that bought: `tenants`, `coaches`, `profiles`, `class_categories`
--      and `tenant_levels` are all gated on `parent_in_tenant(tenant_id)`, so
--      forged membership reads the business row — INCLUDING ITS `join_code`,
--      i.e. the attack harvests the credential it bypassed — plus
--      `paynow_uen` / `paynow_mobile` and the coach's name and email.
--
--   2. POST /rest/v1/parent_students {parent_id: <own>, student_id: <any>}
--        → HTTP 201. Attached to someone else's child.
--      Policy was `parent_students_insert` WITH CHECK
--        (parent_id = current_parent_id() OR is_platform_admin())
--      — same shape, same omission: it never asked whether the CHILD had
--      anything to do with the caller.
--
--   3. PATCH /rest/v1/students?id=eq.<uuid> {full_name, is_active}
--        → HTTP 200. Renamed a child and deactivated them.
--      `students_update` legitimately includes `parent_owns_student(id)` — a
--      parent editing their own child is PRD §7.15. It is not the defect; (2)
--      is, because it let ownership be forged. Fixing (2) closes (3), which is
--      why `students_update` is deliberately NOT touched here.
--
--   (2) also bypasses the whole parent-claim flow (§8.12, PRD §7.18), whose
--   entire point is that claiming a child needs the business admin to approve.
--
-- ── WHY DROPPING THEM IS SAFE: NOTHING CLIENT-SIDE EVER USED THEM ────────────
-- Every call site of both tables in both apps is a SELECT. Checked
-- 2026-08-04 across `SwimSyncApp/` and `SwimSyncAdmin/`: seven files touch
-- them, none with .insert()/.upsert()/.update()/.delete().
--
-- The real writers are SECURITY DEFINER functions, all owned by `postgres`,
-- which owns these tables — so they bypass RLS entirely and do not consult
-- `authenticated`'s grants at all:
--     parent_tenants   ← join_tenant_by_code, link_invited_parent
--     parent_students  ← add_child_or_claim, link_invited_parent,
--                        merge_students, undo_student_claim
-- No table in `public` has FORCE ROW LEVEL SECURITY, so owner-bypass holds.
-- The join-code path is pinned green by four assertions already living in
-- `tenant_isolation.test.sql` (a valid code links and names the business, it is
-- idempotent, an unknown code is refused without disclosing anything).
--
-- ── WHAT IS DELIBERATELY LEFT ALONE ──────────────────────────────────────────
-- `parent_students_delete` — `USING (parent_id = current_parent_id() OR
-- is_platform_admin())`. No client calls it either, but §7.47 records it as a
-- known, deliberate property and warns specifically against widening it. It is
-- self-only, so it is not a breach; narrowing it is a separate decision with a
-- separate argument, and this migration is not the place to make it silently.
--
-- `is_platform_admin()` was a branch of both dropped policies. The platform
-- panel reads these tables and never writes them, and the platform admin's
-- write paths are the same definer functions, so nothing is lost.
-- ============================================================

DROP POLICY parent_tenants_insert  ON public.parent_tenants;
DROP POLICY parent_students_insert ON public.parent_students;

-- The grant is the other half. RLS with no INSERT policy already denies, but a
-- privilege no policy can justify is exactly what 20260804000600 makes illegal
-- repo-wide — leave it and that migration's whitelist would grant it straight
-- back, because the whitelist is derived from the policy set.
REVOKE INSERT ON public.parent_tenants  FROM authenticated;
REVOKE INSERT ON public.parent_students FROM authenticated;

-- ── Prove it here, on whatever database this is applied to ───────────────────
DO $probe$
DECLARE
  v_bad TEXT;
BEGIN
  -- No client-reachable INSERT policy may remain on either table. Named, not
  -- counted: a count tells you nothing about what to fix.
  SELECT string_agg(tablename || '.' || policyname, ', ')
    INTO v_bad
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('parent_tenants', 'parent_students')
     AND cmd IN ('INSERT', 'ALL')
     AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'client-reachable INSERT policy still present: %', v_bad;
  END IF;

  IF has_table_privilege('authenticated', 'public.parent_tenants', 'INSERT')
     OR has_table_privilege('authenticated', 'public.parent_students', 'INSERT') THEN
    RAISE EXCEPTION
      'authenticated still holds INSERT on a family-link table. The REVOKE did '
      'not take — check whether a default-privilege row regranted it '
      '(20260804000400 turned that off for anon only).';
  END IF;

  -- The legitimate paths must still exist, or this migration has traded a
  -- security hole for an onboarding outage. Existence is all that can be
  -- checked from here; tenant_isolation.test.sql exercises them for real.
  IF to_regprocedure('public.join_tenant_by_code(text)') IS NULL THEN
    RAISE EXCEPTION 'join_tenant_by_code is missing — the only route a new family has in';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'add_child_or_claim' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'add_child_or_claim is missing or no longer SECURITY DEFINER';
  END IF;

  RAISE NOTICE 'parent link forgery closed: both INSERT policies and grants gone.';
END
$probe$;
