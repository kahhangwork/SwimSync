#!/usr/bin/env bash
# Lock 2 of the injectable clock (20261006000300_app_clock, Wave 7 M1): the API's login role never pins.
#
# WHY THIS IS NOT pgTAP. app_now() ignores swimsync.now when session_user = 'authenticator' — the role PostgREST
# and the edge functions log in as. pgTAP runs with session_user = postgres, and locally postgres is not a
# superuser, so SET SESSION AUTHORIZATION authenticator is refused and SET ROLE changes only current_user
# (§7.333). A pgTAP "proof" would be vacuous. This logs in AS authenticator, over TCP, the way the API does.
#
# The local flag row IS present (seed.sql), so lock 1 is open here: these checks pass only because of lock 2.
#
# PROVEN RED: with app_now() re-bodied without its `session_user = 'authenticator'` line, checks 1–3 fail
# (app_now() returns the 2001 pin). No skip path: a failed login fails the script.
#
# Needs a running local stack. Writes nothing.
set -euo pipefail

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)"
[ -n "$DB_CONTAINER" ] || { echo "app_clock_locks: no running local stack"; exit 1; }

# One psql session per check, logged in as authenticator. Prints one value; exits non-zero on any error,
# including a refused login.
as_authenticator() {
  docker exec -i -e PGPASSWORD=postgres "$DB_CONTAINER" \
    psql -h 127.0.0.1 -U authenticator -d postgres -At -q -v ON_ERROR_STOP=1 -c "$1"
}

FAIL=0
pass() { echo "ok - $1"; }
fail() { echo "not ok - $1"; FAIL=1; }

PIN="SELECT set_config('swimsync.now', '2001-01-01 00:00+08', false)"
WITHIN="SELECT abs(extract(epoch FROM app_now() - now())) < 60"

# 0. The login itself — the rest is meaningless without it.
who="$(as_authenticator "SELECT session_user")" || { echo "not ok - cannot log in as authenticator"; exit 1; }
[ "$who" = authenticator ] && pass "logged in as authenticator" \
  || { echo "not ok - session_user is '$who', not authenticator"; exit 1; }

# 1. authenticator as service_role — what the edge functions become with the service key. authenticator itself
#    holds no EXECUTE on app_now() (it only switches roles), so every check runs after SET ROLE, as the API does.
got="$(printf '%s\n' "$PIN;" "SET ROLE service_role;" "$WITHIN;" | docker exec -i -e PGPASSWORD=postgres "$DB_CONTAINER" \
  psql -h 127.0.0.1 -U authenticator -d postgres -At -q -v ON_ERROR_STOP=1 | tail -1)" || got="psql error"
[ "$got" = t ] && pass "authenticator as service_role: a 2001 pin is ignored — app_now() is within a minute of now()" \
  || fail "authenticator as service_role: app_now() followed the pin (got '$got')"

# 2. The same after SET ROLE authenticated — what PostgREST does per request. session_user stays authenticator.
got="$(printf '%s\n' "$PIN;" "SET ROLE authenticated;" "$WITHIN;" | docker exec -i -e PGPASSWORD=postgres "$DB_CONTAINER" \
  psql -h 127.0.0.1 -U authenticator -d postgres -At -q -v ON_ERROR_STOP=1 | tail -1)" || got="psql error"
[ "$got" = t ] && pass "authenticator as authenticated: the pin is ignored" \
  || fail "authenticator as authenticated: app_now() followed the pin (got '$got')"

# 3. And through the helpers a request actually reaches: today_sg() is the real SGT date.
got="$(printf '%s\n' "$PIN;" "SET ROLE authenticated;" \
  "SELECT today_sg() = (now() AT TIME ZONE 'Asia/Singapore')::date;" | docker exec -i -e PGPASSWORD=postgres "$DB_CONTAINER" \
  psql -h 127.0.0.1 -U authenticator -d postgres -At -q -v ON_ERROR_STOP=1 | tail -1)" || got="psql error"
[ "$got" = t ] && pass "authenticator as authenticated: today_sg() is today, not the pin" \
  || fail "authenticator as authenticated: today_sg() followed the pin (got '$got')"

exit $FAIL
