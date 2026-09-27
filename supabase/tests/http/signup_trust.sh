#!/usr/bin/env bash
# HTTP test: a PUBLIC sign-up can never create a staff or platform account
# (20260927000200_staff_accounts_by_invitation).
#
# WHY THIS IS NOT pgTAP. The fix trusts auth.users inserts made by a direct SQL
# session (postgres / supabase_admin — seed, tests, fixtures) and requires a
# server-minted invitation for everything else, i.e. GoTrue. pgTAP runs as
# postgres and cannot `SET SESSION AUTHORIZATION supabase_auth_admin`, so it can
# only ever exercise the trusted branch. The hole was reached through GoTrue's
# /signup, so that is what this drives.
#
# PROVEN RED: against the handle_new_user body before 20260927000200, checks
# 1 and 2 fail (the probe becomes platform_admin / tenant_admin).
#
# Needs a running local stack. Leaves nothing behind (probe users and the
# invitation are deleted on exit, pass or fail).
set -euo pipefail

ENV="$(supabase status -o env 2>/dev/null)"
val() { printf '%s\n' "$ENV" | grep "^$1=" | cut -d'"' -f2; }
API="$(val API_URL)"; ANON="$(val ANON_KEY)"; SRK="$(val SERVICE_ROLE_KEY)"
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)"
[ -n "$API" ] && [ -n "$ANON" ] && [ -n "$SRK" ] && [ -n "$DB_CONTAINER" ] \
  || { echo "signup_trust: no running local stack"; exit 1; }

sql() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c "$1"; }
RUN="st$$"
TENANT="$(sql "SELECT id FROM tenants ORDER BY created_at LIMIT 1;")"
[ -n "$TENANT" ] || { echo "signup_trust: no tenant to target (seed missing?)"; exit 1; }

cleanup() {
  sql "DELETE FROM auth.users WHERE email LIKE 'signup-trust-${RUN}-%@test.local';" >/dev/null || true
  sql "DELETE FROM staff_invitations WHERE email LIKE 'signup-trust-${RUN}-%@test.local';" >/dev/null || true
}
trap cleanup EXIT

FAIL=0
pass() { echo "ok - $1"; }
fail() { echo "not ok - $1"; FAIL=1; }
role_of() { sql "SELECT COALESCE((SELECT role::text FROM profiles WHERE email = 'signup-trust-${RUN}-$1@test.local'), 'none');"; }
signup() {
  curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/v1/signup" \
    -H "apikey: $ANON" -H 'Content-Type: application/json' \
    -d "{\"email\":\"signup-trust-${RUN}-$1@test.local\",\"password\":\"Trust-123456\",\"data\":$2}"
}
admin_invite() {
  curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/v1/admin/generate_link" \
    -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H 'Content-Type: application/json' \
    -d "{\"type\":\"invite\",\"email\":\"signup-trust-${RUN}-$1@test.local\",\"data\":$2}"
}

# 1. platform_admin by sign-up metadata
signup pa '{"role":"platform_admin"}' >/dev/null
[ "$(role_of pa)" = none ] && pass "public signUp cannot become platform_admin" \
  || fail "public signUp became $(role_of pa) from role=platform_admin"

# 2. tenant_admin of a business by sign-up metadata
signup ta "{\"role\":\"tenant_admin\",\"tenant_id\":\"$TENANT\"}" >/dev/null
[ "$(role_of ta)" = none ] && pass "public signUp cannot become tenant_admin" \
  || fail "public signUp became $(role_of ta) from role=tenant_admin"

# 3. coach, with a forged nonce
signup co "{\"role\":\"coach\",\"tenant_id\":\"$TENANT\",\"invitation_nonce\":\"$(printf '0%.0s' $(seq 64))\"}" >/dev/null
[ "$(role_of co)" = none ] && pass "a forged invitation nonce is refused" \
  || fail "forged nonce produced $(role_of co)"

# 4. an ordinary parent still registers
code="$(signup pr '{"role":"parent","full_name":"Trust Parent"}')"
[ "$code" = 200 ] && [ "$(role_of pr)" = parent ] && pass "a parent still signs up" \
  || fail "parent signUp returned $code / role $(role_of pr)"

# 5. a real invitation works, and its ROW decides the role (metadata ignored)
NONCE="$(openssl rand -hex 32)"
sql "INSERT INTO staff_invitations (nonce, email, role, tenant_id, is_coach)
     VALUES ('$NONCE', 'signup-trust-${RUN}-in@test.local', 'tenant_admin', '$TENANT', TRUE);" >/dev/null
admin_invite in "{\"invitation_nonce\":\"$NONCE\",\"role\":\"platform_admin\"}" >/dev/null
[ "$(role_of in)" = tenant_admin ] && pass "an invited admin gets the invitation's role, not the metadata's" \
  || fail "invited user got $(role_of in)"
[ "$(sql "SELECT consumed_at IS NOT NULL FROM staff_invitations WHERE nonce = '$NONCE';")" = t ] \
  && pass "the invitation is consumed" || fail "the invitation was not consumed"

# 6. the same nonce cannot be used twice
admin_invite re "{\"invitation_nonce\":\"$NONCE\"}" >/dev/null
[ "$(role_of re)" = none ] && pass "a consumed invitation cannot be reused" \
  || fail "reused nonce produced $(role_of re)"

exit "$FAIL"
