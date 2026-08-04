-- ============================================================
-- RETIRE `parent_students_delete` — THE LAST CLIENT WRITE PATH INTO A FAMILY LINK.
--
-- 20260804000500 dropped the two INSERT policies that let a stranger forge a
-- family link. It deliberately left the DELETE policy alone, on the grounds
-- that §7.47 records it as a known property and warns against changing it here.
-- Re-examined on its own terms afterwards, the answer went the other way, and
-- the reason is not "nothing calls it".
--
-- ── THE DATABASE AND THE PRODUCT DISAGREED, AND THE PRODUCT WAS RIGHT ────────
-- `BACKLOG.md` states the product's actual position, and other reasoning leans
-- on it: *"once a claim is approved nothing in the product can unlink them
-- except that flow's own undo"*. That is the sentence that makes the audit gap
-- around `provisional_contact_*` matter, and it is why `undo_student_claim()`
-- had to ship in the same migration as approve (§7.47).
--
-- But `parent_students_delete` — `USING (parent_id = current_parent_id() OR
-- is_platform_admin())`, granted to `authenticated` — let a parent unlink
-- themselves from their own child with one `DELETE`. So the claim was
-- reversible by the claimant, quietly, outside the flow built to reverse it.
--
--   §7.47 IS NOT WRONG, and this does not contradict it. It describes what the
--   POLICY permits ("the parent can unlink and the platform admin can, but the
--   tenant admin cannot"); the backlog describes what the PRODUCT offers. Both
--   were true at once — no UI ever exposed it. This migration makes the
--   database say what the product already said. §7.47's actual warning was
--   against WIDENING the policy to tenant admins, to close a one-row problem
--   with a blanket delete. That warning stands and is untouched.
--
-- ── WHY REMOVING IT IS SAFE, CHECKED RATHER THAN ASSUMED (2026-08-04) ────────
--   • 21 references to `parent_students` across `SwimSyncApp/` and
--     `SwimSyncAdmin/`; NONE has `.delete()`/`.update()`/`.insert()`/`.upsert()`
--     within twelve lines. Every call site is a read.
--   • The admin's undo calls `supabase.rpc("undo_student_claim")`
--     (`SwimSyncAdmin/app/(admin)/claims/page.tsx`), not a table DELETE.
--   • Both SQL deleters — `undo_student_claim`, `merge_students` — are SECURITY
--     DEFINER owned by `postgres`, which owns the table, so they bypass RLS and
--     never consult `authenticated`'s grants. No table in `public` has FORCE
--     ROW LEVEL SECURITY, so owner-bypass holds.
--   • The two SECURITY INVOKER functions that touch the table
--     (`package_live_balances`, `student_package_coverage`) only READ it; the
--     SELECT grant is unchanged, so they are unaffected.
--   • The `is_platform_admin()` branch loses nothing: the platform admin's
--     unlink is the same definer RPC, and genuine data surgery runs as
--     `postgres` in the dashboard SQL editor (§11.6), not as `authenticated`.
--
-- ── THE GRANT MUST GO WITH THE POLICY, AND THE SUITE ENFORCES THAT ───────────
-- Dropping the policy alone would leave `authenticated` holding DELETE with no
-- policy to justify it, which is precisely what `table_grants.test.sql`
-- assertion 2 fails on. That is the invariant from 20260804000600 doing its job
-- on the first change made after it landed, rather than a rule anyone had to
-- remember. `parent_students` becomes SELECT-only for clients.
-- ============================================================

DROP POLICY parent_students_delete ON public.parent_students;

REVOKE DELETE ON public.parent_students FROM authenticated;

-- ── Prove it, and prove the reversal that replaces it still exists ───────────
DO $probe$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(policyname, ', ')
    INTO v_bad
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'parent_students'
     AND cmd IN ('DELETE', 'ALL')
     AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'a client-reachable DELETE policy remains on parent_students: %', v_bad;
  END IF;

  IF has_table_privilege('authenticated', 'public.parent_students', 'DELETE') THEN
    RAISE EXCEPTION
      'authenticated still holds DELETE on parent_students — the grant must go '
      'with the policy, or table_grants.test.sql assertion 2 will fail.';
  END IF;

  -- Reads must survive: two SECURITY INVOKER helpers depend on the SELECT grant.
  IF NOT has_table_privilege('authenticated', 'public.parent_students', 'SELECT') THEN
    RAISE EXCEPTION
      'SELECT on parent_students was revoked too — package_live_balances and '
      'student_package_coverage run as the caller and read this table.';
  END IF;

  -- The unlink path that REPLACES this policy must exist, or the claim flow has
  -- lost its reversal and a mis-approval becomes permanent (§7.47).
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'undo_student_claim' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'undo_student_claim is missing or no longer SECURITY DEFINER — '
                    'that is the only remaining way to unlink a parent from a child.';
  END IF;

  RAISE NOTICE 'parent_students is now SELECT-only for clients; undo RPC intact.';
END
$probe$;
