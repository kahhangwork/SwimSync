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
# Checks 4–6 (20261009000200, PIN_DRIVER_CLOCK_PLAN): lock 2 opens ONLY while the local-only API row
# private.clock_api_pin_enabled exists — the row run-all-drivers.sh --now inserts for the length of a run.
# PROVEN RED: without the migration's `AND NOT EXISTS (… clock_api_pin_enabled)` line, check 4 fails.
#
# Needs a running local stack. Checks 1–3 write nothing; 4–6 insert the API row and delete the lock-1 row, and a
# trap puts both back on every exit path (API row gone, lock-1 row present) — the LAST line asserts 0 API rows.
set -euo pipefail

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)"
[ -n "$DB_CONTAINER" ] || { echo "app_clock_locks: no running local stack"; exit 1; }
# A stale clock pin (a killed run-all-drivers.sh --now) leaves the API row in place, and checks 1–3 would then
# test the wrong thing. Read-only check.
"$(cd "$(dirname "$0")/../../.." && pwd)/scripts/clock-unpin.sh" --check || exit 2

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

# ---- 4–6: the local-only API pin row ----------------------------------------------------------------------------
as_postgres() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -At -q -v ON_ERROR_STOP=1 -c "$1"
}
restore() {
  as_postgres "DELETE FROM private.clock_api_pin_enabled" >/dev/null 2>&1 || true
  as_postgres "INSERT INTO private.clock_override_enabled VALUES (true) ON CONFLICT DO NOTHING" >/dev/null 2>&1 || true
}
trap restore EXIT INT TERM

API_PIN="SELECT set_config('swimsync.now', '2001-01-01 00:00+08', false)"
as_postgres "INSERT INTO private.clock_api_pin_enabled VALUES (true) ON CONFLICT DO NOTHING" >/dev/null

# 4. With the API row, an API session follows the pin — what run-all-drivers.sh --now relies on.
got="$(printf '%s\n' "$API_PIN;" "SET ROLE authenticated;" "SELECT app_now() = '2001-01-01 00:00+08'::timestamptz;" \
  | docker exec -i -e PGPASSWORD=postgres "$DB_CONTAINER" \
  psql -h 127.0.0.1 -U authenticator -d postgres -At -q -v ON_ERROR_STOP=1 | tail -1)" || got="psql error"
[ "$got" = t ] && pass "API row present: authenticator as authenticated follows the pin" \
  || fail "API row present: app_now() ignored the pin (got '$got')"

# 6. API row present but NO pin — app_now() is the real clock (the prod path stays first).
got="$(printf '%s\n' "SET ROLE authenticated;" "$WITHIN;" | docker exec -i -e PGPASSWORD=postgres "$DB_CONTAINER" \
  psql -h 127.0.0.1 -U authenticator -d postgres -At -q -v ON_ERROR_STOP=1 | tail -1)" || got="psql error"
[ "$got" = t ] && pass "API row present, no pin: app_now() is within a minute of now()" \
  || fail "API row present, no pin: app_now() is not the real clock (got '$got')"

# 5. API row present but lock-1 row absent (prod shape + a stray API row) — a pin RAISEs, loud.
as_postgres "DELETE FROM private.clock_override_enabled" >/dev/null
got="$(printf '%s\n' "$API_PIN;" "SET ROLE authenticated;" "SELECT app_now();" | docker exec -i -e PGPASSWORD=postgres "$DB_CONTAINER" \
  psql -h 127.0.0.1 -U authenticator -d postgres -At -q -v ON_ERROR_STOP=1 2>&1)" || true   # whole output: CONTEXT follows ERROR
case "$got" in
  *"clock override is disabled"*) pass "API row without the lock-1 row: a pin RAISEs" ;;
  *) fail "API row without the lock-1 row: expected the lock-1 RAISE (got '$got')" ;;
esac

restore
trap - EXIT INT TERM
left="$(as_postgres "SELECT count(*) FROM private.clock_api_pin_enabled")"
[ "$left" = 0 ] && pass "no API-pin row left behind" || fail "an API-pin row was left behind ($left)"

exit $FAIL
