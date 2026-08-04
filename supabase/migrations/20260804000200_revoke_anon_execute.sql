-- ============================================================
-- ANON HOLDS NO EXECUTE ON ANY SECURITY DEFINER FUNCTION.
--
-- §7.39 recorded half of this: Supabase CLOUD carries project-level default
-- privileges that grant EXECUTE on every new public function to anon,
-- authenticated and service_role, and `REVOKE ... FROM PUBLIC` does not remove
-- a role-specific grant. The repo has been fixing that one function at a time
-- since 2026-07-21 (provision_tenant, platform_tenant_overview, the claim RPCs,
-- the payment RPCs). This finishes the job for everything else.
--
-- BUT THE AUDIT FOUND A HOLE THAT IS NOT A CLOUD ARTEFACT, AND IT WAS LIVE.
--
--   next_credit_note_ref(p_tenant_id) had NO ACL AT ALL, so it fell back to the
--   Postgres default of EXECUTE TO PUBLIC — which includes anon, on the LOCAL
--   stack as well as on cloud. It is SECURITY DEFINER and it WRITES:
--
--     UPDATE tenants SET credit_note_counter = credit_note_counter + 1
--
--   Reproduced on 2026-08-04 against the local stack with no login at all —
--   POST /rest/v1/rpc/next_credit_note_ref with only the anon key returned
--   "CN-2026-0001" and left tenants.credit_note_counter incremented from 0 to 1.
--   An unauthenticated caller who knows a tenant's UUID could burn that
--   business's credit-note numbers indefinitely: the references parents see on
--   documents would jump, and each call takes a row lock on the tenant row.
--   Not a data breach — the function returns only the number it just minted —
--   but an unauthenticated write that RLS cannot see, because SECURITY DEFINER
--   is exactly what bypasses it.
--
--   Nothing calls it from a client. Its only callers are the credit-note paths
--   INSIDE other SECURITY DEFINER functions (20260718001200 and its three later
--   redefinitions), which run as the owner and need no grant. So it is granted
--   to NOBODY here — the same posture next_invoice_ref has had since it was
--   written as a clone of this function (20260802000600). The clone got the
--   grants right and the original never had them.
--
-- THREE POSTURES, AND THE DIFFERENCE MATTERS.
--
--   1. NOBODY          — internal counters. No client calls them; their callers
--                        are definer functions running as the owner.
--   2. authenticated   — the action RPCs. Every one is invoked from the browser
--                        or the app as the signed-in user; each gates itself
--                        in-body on that user. service_role is revoked too: an
--                        audit of every .rpc() call site (2026-08-04) found all
--                        of them use the CALLER's client, never the admin one,
--                        which is what makes each in-body gate actually fire —
--                        the reasoning provision_tenant already carries.
--   3. authenticated + service_role — the read-only helpers that RLS policies
--                        call. service_role KEEPS EXECUTE deliberately: it holds
--                        these today only via the PUBLIC default, and revoking
--                        PUBLIC would silently take it away. service_role has
--                        BYPASSRLS, so this grants it nothing it cannot already
--                        do, and it removes a way for this migration to break
--                        the invoice engine in production for no security gain.
--
-- WHAT IS DELIBERATELY NOT TOUCHED.
--
--   * TRIGGER functions (9 of them). Postgres does not check EXECUTE on a
--     trigger function against the writing role — the trigger mechanism calls
--     it — and PostgREST does not expose a function returning `trigger`. There
--     is no caller to revoke from, so a REVOKE here would be theatre.
--
--   * The blanket `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS
--     FROM anon`. Refused on 2026-07-21 and refused again here, for the same
--     reason: it changes the grant for every FUTURE function at once, including
--     any that legitimately needs anon, and the failure would appear far from
--     this file. The pgTAP test added alongside this migration
--     (function_grants.test.sql) covers new functions instead — it fails the
--     build rather than pre-deciding their ACL.
--
--   * anon's REFERENCES / TRIGGER / TRUNCATE on 37 tables. Real, and NOT from
--     this repo — 20260309000800_grants.sql grants anon nothing and says so.
--     They come from the Supabase image's own template. anon cannot reach them:
--     `rolcanlogin` is false, so the only path in is PostgREST, which has no
--     TRUNCATE verb and no DDL. Recorded rather than fixed, because a table-
--     grant change is a different blast radius from a function-grant change and
--     §7.55 says one at a time.
--
-- VERIFICATION. Local pg_proc is NOT the proof for the cloud half — it passes by
-- construction (§7.39). After deploying, dump the REMOTE and check:
--   supabase db dump --linked -f dump.sql
--   grep -E '(GRANT|REVOKE).*ON FUNCTION' dump.sql | grep '"anon"'
-- The next_credit_note_ref half IS locally provable, and the new pgTAP file
-- proves it — it was RED before this migration.
-- ============================================================

-- ── 1. NOBODY: internal reference counters ────────────────────────────────────
REVOKE ALL ON FUNCTION public.next_credit_note_ref(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_credit_note_ref(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.next_credit_note_ref(UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.next_credit_note_ref(UUID) FROM service_role;

COMMENT ON FUNCTION public.next_credit_note_ref(UUID) IS
  'Mints the next CN-YYYY-NNNN for a tenant, incrementing its counter under a '
  'row lock. Granted to NOBODY: its only callers are the credit-note paths '
  'inside other SECURITY DEFINER functions, which run as the owner. It held '
  'the Postgres default of EXECUTE TO PUBLIC until 2026-08-04, which let an '
  'unauthenticated caller burn a business''s credit-note numbers (20260804000200).';

-- ── 2. authenticated ONLY: the action RPCs ────────────────────────────────────
-- Each is called from the browser or the app as the signed-in user and gates
-- itself in-body on that user. Written out one per function rather than looped:
-- a DO block over pg_proc would silently cover a function added later that
-- wants a different posture, and this list is meant to be read and argued with.
DO $$
DECLARE
  fn TEXT;
  authenticated_only TEXT[] := ARRAY[
    'public.add_child_or_claim(uuid, text, date, text, text, add_child_mode, uuid)',
    'public.add_unclaimed_student(uuid, text, unclaimed_student_kind, date, attendance_status, date, text, text, text)',
    'public.book_makeup(uuid, date, uuid)',
    'public.book_trial(uuid, date, uuid)',
    'public.close_student_enrolment(uuid, boolean)',
    'public.family_active_children(uuid)',
    'public.find_student_candidates(uuid, text, date)',
    'public.generate_coach_payouts(uuid, text)',
    'public.join_tenant_by_code(text)',
    'public.link_invited_parent(uuid, uuid)',
    'public.mark_payout_paid(uuid)',
    'public.reassign_student_tenant(uuid, uuid)',
    'public.regenerate_join_code(uuid)',
    'public.schedule_extra_lesson(uuid, date, text)',
    'public.set_class_terms(uuid, text, day_of_week, time, time, text, numeric, uuid, date, boolean, text)',
    'public.set_parent_tenant_active(uuid, uuid, boolean, uuid[])',
    'public.set_students_active(uuid[], boolean)'
  ];
BEGIN
  FOREACH fn IN ARRAY authenticated_only LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

-- ── 3. authenticated + service_role: read-only helpers RLS policies call ───────
-- These are evaluated inside policy expressions, so `authenticated` genuinely
-- needs EXECUTE — a revoke here would break ordinary reads, not tighten them.
-- service_role is granted explicitly for the reason in the header: it holds
-- these today only via PUBLIC, it has BYPASSRLS anyway, and taking it away by
-- accident is the failure mode with real cost.
DO $$
DECLARE
  fn TEXT;
  helpers TEXT[] := ARRAY[
    'public.assert_class_runs_on(uuid, date)',
    'public.can_admin_tenant(uuid)',
    'public.class_rate_on(uuid, date)',
    'public.class_tenant(uuid)',
    'public.coach_owns_class(uuid)',
    'public.coach_owns_session(uuid)',
    'public.coach_serves_parent(uuid)',
    'public.coach_serves_student(uuid)',
    'public.current_coach_id()',
    'public.current_parent_id()',
    'public.current_tenant_id()',
    'public.is_platform_admin()',
    'public.is_tenant_admin(uuid)',
    'public.parent_has_child_in_class(uuid)',
    'public.parent_in_tenant(uuid)',
    'public.parent_owns_student(uuid)',
    'public.session_pay_amount(uuid)',
    'public.session_pays_coach(uuid)',
    'public.session_tenant(uuid)',
    'public.tenant_serves_parent(uuid)',
    -- Not SECURITY DEFINER, but it also sat on the PUBLIC default and anon has
    -- no business minting join codes.
    'public.generate_join_code()'
  ];
BEGIN
  FOREACH fn IN ARRAY helpers LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- ── 4. The one the general rule caught that a named audit would not have ──────
-- package_live_balances() is SECURITY INVOKER, so RLS still applies to it and
-- anon — which holds no SELECT on any table (20260309000800) — could never have
-- read a balance through it. It is here because 20260720000100 granted
-- authenticated and service_role WITHOUT revoking the PUBLIC that
-- CREATE FUNCTION hands out by default, so the explicit grants read as the
-- whole ACL while PUBLIC sat underneath them. That is the same shape as the
-- next_credit_note_ref hole with the teeth removed, and it is worth closing
-- while the file is open: the day someone changes this function to SECURITY
-- DEFINER, the leftover PUBLIC becomes the hole.
--
-- It is also the reason the new pgTAP file asserts over pg_proc rather than
-- over a list. A named audit would have checked the definer functions and
-- walked straight past this one.
REVOKE ALL ON FUNCTION public.package_live_balances() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.package_live_balances() FROM anon;
GRANT EXECUTE ON FUNCTION public.package_live_balances() TO authenticated, service_role;
