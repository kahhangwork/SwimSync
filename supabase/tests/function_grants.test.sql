-- pgTAP: no function in `public` grants EXECUTE to anon.
--
-- WHY THIS FILE IS THREE ASSERTIONS AND NOT NINETY. Every earlier grant check in
-- this suite names one function (tenant_provisioning.test.sql pins
-- provision_tenant, payment_collection.test.sql pins the payment RPCs). A named
-- assertion cannot fail for a function nobody thought to name — and that is
-- exactly how next_credit_note_ref went a year with the Postgres default of
-- EXECUTE TO PUBLIC while sitting on an unauthenticated write path
-- (20260804000200). These assertions are written over pg_proc instead, so a
-- function added next month is covered on the day it is created.
--
-- WHAT THIS CAN AND CANNOT PROVE. It catches the LOCAL half: a missing ACL that
-- falls back to PUBLIC, which is what bit us. It CANNOT catch the cloud half —
-- Supabase's project-level default privileges grant EXECUTE to anon on new
-- public functions and the local stack does not reproduce them, so this file
-- passes by construction for that case (§7.39). The honest check there is a dump
-- of the REMOTE after deploying; the migration header carries the command. Do
-- not let a green run here be read as "production is clean".
--
-- PROVEN RED. Against the schema immediately before 20260804000200 the first
-- assertion failed, naming next_credit_note_ref and the twenty read-only
-- helpers that had no ACL of their own (§7.25).

BEGIN;
SELECT plan(3);

-- ── 1. THE GENERAL RULE ───────────────────────────────────────────────────────
-- has_function_privilege() resolves a NULL proacl to the Postgres default
-- (EXECUTE TO PUBLIC), so this catches "nobody wrote a grant" as well as
-- "somebody wrote the wrong grant". Failures name the functions, because a bare
-- count tells you nothing about what to fix.
SELECT is(
  (SELECT COALESCE(string_agg(sig, ', ' ORDER BY sig), '')
     FROM (
       SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          -- Neither kind of trigger function is reachable: Postgres does not
          -- privilege-check them against the writing role and PostgREST does not
          -- expose them. `event_trigger` is named explicitly because production
          -- has one (`rls_auto_enable`) that the local stack does not — so
          -- without it this assertion would pass here and fail against a dump.
          AND pg_get_function_result(p.oid) NOT IN ('trigger', 'event_trigger')
          AND has_function_privilege('anon', p.oid, 'EXECUTE')
     ) q),
  '',
  'no function in public grants EXECUTE to anon');

-- ── 2. THE ONE THAT WAS ACTUALLY REACHABLE ────────────────────────────────────
-- Pinned by name as well as by the rule above. This function is SECURITY
-- DEFINER and WRITES (it increments tenants.credit_note_counter), and until
-- 2026-08-04 an unauthenticated POST to /rest/v1/rpc/next_credit_note_ref
-- incremented it. Nothing calls it from a client — its callers are inside other
-- definer functions, which run as the owner — so the correct grant is NOBODY,
-- not `authenticated`.
SELECT ok(
  NOT has_function_privilege('anon', 'public.next_credit_note_ref(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.next_credit_note_ref(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.next_credit_note_ref(uuid)', 'EXECUTE'),
  'next_credit_note_ref is callable by NOBODY — same posture as next_invoice_ref');

-- ── 3. THE CLONE THAT GOT IT RIGHT ────────────────────────────────────────────
-- next_invoice_ref was written as a copy of next_credit_note_ref and has had
-- the correct grants since 20260802000600. Asserted so the pair cannot drift
-- apart again in the other direction.
SELECT ok(
  NOT has_function_privilege('anon', 'public.next_invoice_ref(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.next_invoice_ref(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.next_invoice_ref(uuid,text)', 'EXECUTE'),
  'next_invoice_ref is callable by NOBODY');

SELECT * FROM finish();
ROLLBACK;
