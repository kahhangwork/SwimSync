-- ============================================================
-- SECURITY: a public sign-up can no longer make itself staff.
--
-- Found 2026-09-27 while planning Roles (step 1), confirmed on the local
-- stack: handle_new_user() took `role` and `tenant_id` from
-- raw_user_meta_data — the `data` a CLIENT passes to supabase.auth.signUp().
-- Public sign-up is on (parents register themselves), so one anonymous call
--   signUp({ email, password, options: { data: { role: 'platform_admin' } } })
-- produced a PLATFORM ADMIN (every business), and
--   data: { role: 'tenant_admin', tenant_id: '<any business>' }
-- produced an active co-admin of that business (invoices, credit notes,
-- parent contact data). Both probes returned 200 and a live session.
--
-- The fix — staff accounts exist only by INVITATION:
--   * staff_invitations: a row minted by an admin API route (service_role)
--     immediately before it creates the auth user, keyed by a random nonce.
--     The route puts the nonce in the user's metadata; the row carries the
--     role, the business and is_coach. RLS on, no policies, no client grant —
--     a client can neither read a nonce nor mint a row.
--   * handle_new_user(): an auth-API insert (anything but a direct SQL
--     session — see below) is a PARENT unless it presents the nonce of an
--     unconsumed, unexpired invitation for the SAME email. Then the role,
--     business and is_coach come from the ROW, never from metadata. A
--     privileged metadata role without a valid invitation is REFUSED (loud),
--     not silently downgraded — a staff invite that lost its row must fail
--     visibly, not become a parent.
--   * platform_admin is never granted through the auth API at all.
--
-- WHY "direct SQL session" is trusted: seed.sql, migrations, pgTAP and the
-- driver fixtures insert auth.users as postgres / supabase_admin. Those roles
-- can already write profiles directly; trusting their metadata gives nothing
-- away. The test is FAIL-CLOSED: only those two session users are trusted, so
-- GoTrue (supabase_auth_admin) and anything unforeseen need an invitation.
--
-- The nonce matters, not just the email: an invitation matched on email
-- alone could be claimed by someone who signs up with the invitee's address
-- inside the 15-minute window. The nonce never leaves the server except in
-- the invitation link's user metadata.
--
-- DEPLOY ORDER — the usual one, with a short known gap: this migration
-- first (the table must exist before a route can write to it), then the
-- admin app, whose invite-admin / provision-tenant / create-coach routes
-- mint the invitation. Between the two, a STAFF invite from the old app is
-- refused loudly and can simply be retried after the app deploy. Parents
-- are unaffected throughout. The resend routes are unaffected: they
-- re-link an auth user that already exists, which fires no insert trigger.
--
-- Rollback: supabase/rollback/20260927000200_staff_accounts_by_invitation_DOWN.sql
--   (restores the hole — only ever with the app rolled back too).
-- ============================================================

CREATE TABLE public.staff_invitations (
  nonce        TEXT        PRIMARY KEY CHECK (length(nonce) >= 32),
  email        TEXT        NOT NULL,
  role         user_role   NOT NULL CHECK (role IN ('coach', 'tenant_admin')),
  tenant_id    UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_coach     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by   UUID        NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 minutes',
  consumed_at  TIMESTAMPTZ NULL,
  consumed_by  UUID        NULL
);

COMMENT ON TABLE public.staff_invitations IS
  'Server-minted proof that a staff (coach / tenant_admin) auth user is invited. handle_new_user consumes it. service_role only. 20260927000200.';

ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_invitations TO service_role;

-- Body read from the database 2026-09-27 (§7.40). Unchanged from there on:
-- the profile insert, the parent/coach rows, the first-admin-is-owner rule.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role       user_role;
  v_tenant     UUID;
  v_is_coach   BOOLEAN;
  v_meta_role  TEXT := NULLIF(NEW.raw_user_meta_data->>'role', '');
  v_nonce      TEXT := NULLIF(NEW.raw_user_meta_data->>'invitation_nonce', '');
  v_inv        staff_invitations%ROWTYPE;
BEGIN
  IF session_user IN ('postgres', 'supabase_admin') THEN
    -- Direct SQL (seed, migrations, tests, fixtures): trusted, as before.
    v_role := COALESCE(v_meta_role::user_role, 'parent');
    v_tenant := NULLIF(NEW.raw_user_meta_data->>'tenant_id', '')::UUID;
    v_is_coach := COALESCE((NEW.raw_user_meta_data->>'is_coach')::boolean, FALSE);
  ELSIF v_nonce IS NOT NULL THEN
    SELECT * INTO v_inv FROM staff_invitations
     WHERE nonce = v_nonce
       AND lower(email) = lower(NEW.email)
       AND consumed_at IS NULL
       AND expires_at > now()
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'this staff invitation is invalid, used or expired — ask the admin to send a new one'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE staff_invitations SET consumed_at = now(), consumed_by = NEW.id WHERE nonce = v_nonce;
    v_role := v_inv.role;
    v_tenant := v_inv.tenant_id;
    v_is_coach := v_inv.is_coach;
  ELSIF v_meta_role IS NULL OR v_meta_role = 'parent' THEN
    v_role := 'parent';
    v_tenant := NULL;
    v_is_coach := FALSE;
  ELSE
    RAISE EXCEPTION 'staff accounts are created by invitation only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_role IN ('coach', 'tenant_admin') AND v_tenant IS NULL THEN
    RAISE EXCEPTION
      'creating a % requires tenant_id in user_metadata — refusing to guess which business they belong to',
      v_role;
  END IF;

  INSERT INTO profiles (id, email, role, full_name, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    v_role,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    CASE WHEN v_role IN ('parent', 'platform_admin') THEN NULL ELSE v_tenant END
  );

  IF v_role = 'parent' THEN
    INSERT INTO parents (profile_id, signup_join_code)
    VALUES (NEW.id, NULLIF(NEW.raw_user_meta_data->>'join_code', ''));
  ELSIF v_role = 'coach' THEN
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  ELSIF v_role = 'tenant_admin' AND v_is_coach THEN
    INSERT INTO coaches (profile_id, tenant_id) VALUES (NEW.id, v_tenant);
  END IF;

  IF v_role = 'tenant_admin' THEN
    UPDATE tenants SET owner_profile_id = NEW.id
     WHERE id = v_tenant AND owner_profile_id IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;
