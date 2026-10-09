#!/usr/bin/env bash
# Take a LOCAL stack off a pinned clock — or, with --check, refuse to work on one.
# (docs/plans/PIN_DRIVER_CLOCK_PLAN.md, "run-all-drivers.sh --now" step 4 and RISK 6.)
#
# WHAT A PIN IS. `run-all-drivers.sh --now <ts>` pins the stack two ways for the
# length of a run:
#   • a database-level default — ALTER DATABASE postgres SET swimsync.now — set as
#     supabase_admin (postgres cannot set it), so every NEW session reads the pin
#     through app_now(): fixtures, driver SQL, PostgREST's fresh pool, the engine;
#   • the local-only row in private.clock_api_pin_enabled, without which app_now()
#     ignores the pin for API sessions (lock 2).
# A killed run leaves both behind, and the dev apps then silently run on a fake day.
#
# THE ORDER IS THE SAFETY PROPERTY. The API row goes FIRST: with it gone, lock 2
# returns the real clock to every pooled API session at once, even those that
# still carry the old default. The database-level RESET only reaches new sessions.
#
# Usage:
#   scripts/clock-unpin.sh            # unpin, then assert: no pin, 0 API rows, the API on real time
#   scripts/clock-unpin.sh --check    # READ-ONLY: exit 2 if any pin is on the stack
# The runner calls both; check-fixture-roundtrip.sh, generate-invoices/test.sh and
# app_clock_locks.sh call --check before they start.
#
# LOCAL ONLY, BY CONSTRUCTION: it reaches Postgres only through `docker exec` on
# the local supabase_db_* container and refuses an API_URL that is not
# http://127.0.0.1:* / http://localhost:*. It never reads SUPABASE_DB_URL and never
# talks to a linked project. No other tool may write a database-level swimsync.now
# (check-driver-clock.sh rule R3; this file may only RESET it).
#
# Exit: 0 unpinned · 1 the stack is still pinned after the unpin · 2 refused
# (not local, no stack, or — with --check — a pin is present).
# Bash, run with bash (§7.340).

set -euo pipefail
cd "$(dirname "$0")/.."

MODE=unpin
case "${1:-}" in
  "") ;;
  --check) MODE=check ;;
  -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0 ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

API_URL="${API_URL:-http://127.0.0.1:54321}"
if [[ ! $API_URL =~ ^http://(127\.0\.0\.1|localhost):[0-9]+/?$ ]]; then
  echo "✗ clock-unpin: API_URL=$API_URL is not a local stack — refusing" >&2
  exit 2
fi
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)"
if [[ -z $DB_CONTAINER ]]; then
  echo "✗ clock-unpin: no running supabase_db_* container — \`supabase start\` first" >&2
  exit 2
fi

as_postgres() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq -c "$1"; }

# "<database/role-level swimsync.now settings>|<API rows>". The table arrives with
# 20261009000200; on an older stack there is no row, by definition.
state() {
  local settings rows=0
  settings="$(as_postgres "SELECT count(*) FROM pg_db_role_setting WHERE array_to_string(setconfig, ',') ~ 'swimsync\.now'")"
  if [[ "$(as_postgres "SELECT to_regclass('private.clock_api_pin_enabled') IS NOT NULL")" == t ]]; then
    rows="$(as_postgres "SELECT count(*) FROM private.clock_api_pin_enabled")"
  fi
  echo "$settings|$rows"
}

if [[ $MODE == check ]]; then
  s="$(state)" || { echo "✗ could not read the stack's clock state — is the stack up?" >&2; exit 2; }
  if [[ $s != "0|0" ]]; then
    echo "✗ a stale clock pin is on this stack (swimsync.now settings|API rows = $s) — run scripts/clock-unpin.sh" >&2
    exit 2
  fi
  exit 0
fi

# ── unpin: the API row FIRST, then the database-level default ──
if [[ "$(as_postgres "SELECT to_regclass('private.clock_api_pin_enabled') IS NOT NULL")" == t ]]; then
  as_postgres "DELETE FROM private.clock_api_pin_enabled" > /dev/null
fi
docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -Atq \
  -c "ALTER DATABASE postgres RESET swimsync.now" > /dev/null

# ── assert ──
left=""
s="$(state)" || s="unreadable"
[[ $s == "0|0" ]] || left="swimsync.now settings|API rows = $s"

# Through the API as well, when it is up: PostgREST's pool may predate the RESET,
# so this is the check that lock 2 really closed. The service key, because anon
# holds no EXECUTE on app_now().
api_checked=""
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$API_URL/rest/v1/" || true)"
if [[ $code != 000 ]]; then
  key="${SERVICE_ROLE_KEY:-}"
  [[ -n $key ]] || key="$(supabase status -o env 2>/dev/null | sed -n 's/^SERVICE_ROLE_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
  got="$(curl -s --max-time 10 -X POST "$API_URL/rest/v1/rpc/app_now" \
    -H "apikey: $key" -H "Authorization: Bearer $key" -H "Content-Type: application/json" -d '{}' || true)"
  # Compared by Postgres, which parses PostgREST's timestamptz; the value goes in as a variable, never spliced.
  real="$(printf '%s\n' "SELECT abs(extract(epoch FROM ((:'v')::jsonb #>> '{}')::timestamptz - pg_catalog.now())) < 60;" \
    | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -Atq -v v="$got" 2>/dev/null || true)"
  api_checked=", rpc/app_now on the real clock"
  [[ $real == t ]] || left+="${left:+; }rpc/app_now is not the real time (got: ${got:0:80})"
else
  echo "– clock-unpin: the API is not answering at $API_URL; checked the database only"
fi

if [[ -n $left ]]; then
  echo "✗ STACK LEFT PINNED — run scripts/clock-unpin.sh ($left)" >&2
  exit 1
fi
echo "✓ clock unpinned: no swimsync.now default, 0 API rows$api_checked"
