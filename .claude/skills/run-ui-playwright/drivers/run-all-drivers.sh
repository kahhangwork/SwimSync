#!/usr/bin/env bash
# Runs EVERY verify-*.mjs UI driver end to end — the entry point for the
# nightly ui-drivers CI job, and runnable locally the same way.
#
# WHY THIS EXISTS. check-fixture-roundtrip.sh closed the *loading* half of the
# driver-rot gap; this closes the *asserting* half. Five drivers rotted silently
# before it, every one found by accident — the decisive case being
# verify-parent-claim.mjs, red from 58 MINUTES after it was written until
# 2026-08-04 while the product was correct the whole time. No static check can
# catch "nobody ran it"; the only cure is running them (BACKLOG → Run the UI
# drivers in CI, HANDOVER §8.29).
#
# THE PROTOCOL, PER DRIVER — uniform, deliberately:
#
#   1. supabase db reset           — most drivers document a reset prereq, and
#                                    several mutate state through the real UI
#                                    (parent-claim files+approves a claim,
#                                    makeups books, tenant-provisioning creates
#                                    a business). Fixture teardowns cannot undo
#                                    UI writes; the next reset is the cleanup,
#                                    so teardowns are deliberately not run here.
#   2. docker restart kong         — §7.44: a reset leaves kong pointing at a
#                                    dead auth container; every /auth/v1 call
#                                    502s while docker reports both healthy.
#   3. load the driver's fixture   — ON_ERROR_STOP=1 (§7.62: a half-loaded
#                                    fixture reads as a product regression).
#   4. node verify-<name>.mjs      — the driver's own exit code is the verdict,
#                                    under a hard timeout so one hang cannot eat
#                                    the whole sweep.
#
# Uniformity is the point: no per-driver "does this one need a reset?" judgment
# to rot. The price is wall clock, which a nightly job has to spend.
#
# DO NOT run this beside a sibling worktree — it resets the shared database
# repeatedly (§7.55). In CI nothing shares the stack.
#
# Prereqs (the script verifies all four and refuses to start otherwise):
#   supabase start
#   supabase functions serve --env-file supabase/functions/.env --no-verify-jwt
#     (all functions: public-invoice for payment-collection §7.84,
#      generate-invoices for the drivers that press Generate)
#   SwimSyncAdmin: npm run dev         (or ADMIN_URL=...)
#   SwimSyncApp:   npx expo start --web (or EXPO_URL=...)
#
# Usage:
#   run-all-drivers.sh                 # the full sweep
#   run-all-drivers.sh --only parent-claim
#   run-all-drivers.sh --only schedule-week --now '2026-10-01 07:59+08'
#   TIMEOUT_SECS=1200 run-all-drivers.sh
#
# --now '<ts WITH an offset>' — REPLAY A PAST MOMENT (docs/plans/PIN_DRIVER_CLOCK_PLAN.md).
# The browser, PostgREST, the drivers' SQL, the fixtures and the engine all run
# at that instant. Without it everything is on the real clock, exactly as before
# (the nightly is unchanged; summary.md heads "Real clock").
#   • The pin is validated and canonicalised by POSTGRES, once, to …Z: an offset
#     is required (§7.337) and a FUTURE pin is refused (a frozen browser ahead of
#     the real clock sees every fresh JWT as expired and refresh-loops).
#   • Per driver: UNPIN → db reset → PIN (ALTER DATABASE … SET swimsync.now as
#     supabase_admin; the local-only API row as postgres) → restart rest, then
#     kong (§7.44) → auth up → PROOF: 3 consecutive rpc/app_now calls with the
#     service key return the pin, else the driver is CANNOT SAY, never PASS →
#     fixture → DRIVER_NOW=<pin> node … (lib.mjs pins every browser context and
#     refuses a half-pinned stack).
#   • Unpin BEFORE every reset: migrations run before seed.sql restores lock 1, so
#     a pinned session mid-reset RAISEs.
#   • Only a driver marked `// clock: pinnable` runs pinned. One with no marker is
#     SKIPPED (not pinnable) — `--only` on it exits 2. An `own-literal` driver
#     runs under --only (its pinned proof) and in a sweep only once listed in
#     OWN_LITERAL_PROVEN below. Any SKIPPED makes the sweep exit 3, never 0.
#   • A trap on EXIT/INT/TERM runs scripts/clock-unpin.sh (API row first, then
#     RESET) and asserts the stack is back on the real clock.
#   • Refused (exit 2): together with AFTER_RESET_SQL (two clock mechanisms); an
#     API_URL that is not http://127.0.0.1:* / http://localhost:* (any mode).
#   ⚠ Never beside a sibling worktree, `supabase test db` or the Deno suite — it
#     changes database-level state on the shared stack.
#
# Exit: 0 all passed · 1 a failure · 2 refused · 3 (--now) nothing failed but a
# driver was SKIPPED (not pinnable).
#
# Output: per-driver logs + screenshots under $RUN_DIR (printed at start),
# summary.md alongside them — the CI job posts that file into the rolling
# rot issue.

set -uo pipefail # not -e: one failing driver must not stop the sweep
# Absolute path to this script, resolved BEFORE the cd: `--help` awks "$SELF",
# and a relative $0 is wrong once we have moved into the drivers directory.
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")"
ROOT="$(git rev-parse --show-toplevel)"

ONLY=""
NOW_IN=""
while (($#)); do
  case "$1" in
    --only) ONLY="${2:-}"; shift 2 ;;
    --now) NOW_IN="${2:-}"; [[ -n "$NOW_IN" ]] || { echo "--now needs a timestamp with an offset" >&2; exit 2; }; shift 2 ;;
    -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$SELF"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

TIMEOUT_SECS="${TIMEOUT_SECS:-900}"
API_URL="${API_URL:-http://127.0.0.1:54321}"

# Prod is unreachable by construction: every DB write here is a `docker exec` on
# the local container, and the API must be local too.
if [[ ! "$API_URL" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+/?$ ]]; then
  echo "✗ API_URL=$API_URL is not a local stack — refusing" >&2
  exit 2
fi
if [[ -n "$NOW_IN" && -n "${AFTER_RESET_SQL:-}" ]]; then
  echo "✗ --now and AFTER_RESET_SQL together: two clock mechanisms — use one" >&2
  exit 2
fi
# A driver stays SKIPPED in a pinned SWEEP until its own pinned --only run has
# proven it; add it here in the commit that records that run.
OWN_LITERAL_PROVEN=()

# Some drivers seed through the service role (verify-platform-admin.mjs).
# Export the stack's own keys so a driver never needs a hand-exported secret.
eval "$(cd "$(git rev-parse --show-toplevel)" && supabase status -o env 2>/dev/null | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=')"
export ANON_KEY SERVICE_ROLE_KEY
export ADMIN_URL="${ADMIN_URL:-http://localhost:3000}"
export EXPO_URL="${EXPO_URL:-http://localhost:8081}"
RUN_DIR="${RUN_DIR:-$(mktemp -d)}"
mkdir -p "$RUN_DIR"

# ── Which fixture feeds which driver ─────────────────────────────────────────
# Default: fixtures-<driver-name>.sql if it exists. The exceptions below are
# drivers that reuse a sibling's fixture (verified against each driver's own
# header, 2026-08-05). A driver with no fixture runs on bare seed data.
fixture_for() {
  case "$1" in
    bulk-setall|parent-attendance) echo "fixtures-unmarked-lessons.sql" ;;
    edit-child|levels|level-skills) echo "fixtures-student-identity.sql" ;;
    # parent-pay-claim needs an OUTSTANDING, UNCLAIMED invoice held by a parent
    # who can log into the app — which fixtures-payment-collection.sql already
    # builds (pay-driver-parent@swimsync.test, INV-2026-9901). A second fixture
    # would be a second copy of the same rows to keep in step.
    parent-pay-claim) echo "fixtures-payment-collection.sql" ;;
    # smoke-app opens the parent's child, invoice and public invoice page once
    # each; the same fixture already holds all three with known ids.
    smoke-app) echo "fixtures-payment-collection.sql" ;;
    # schedule-week needs two classes running today plus ONE unmarked lesson a
    # week back — which fixtures-stale-screen.sql already builds, and builds
    # weekday-agnostically (it derives the class weekday from today).
    schedule-week) echo "fixtures-stale-screen.sql" ;;
    # The lesson page driver marks, covers and books INTO the calendar fixture's
    # classes (and its CN001 billed lesson); the two drivers share one fixture.
    admin-lesson-detail) echo "fixtures-admin-calendar.sql" ;;
    # cancel-lesson cancels and restores NEXT WEEK's Rose lesson of the same
    # fixture (Rose runs on today's weekday); it deletes the bare row it made.
    cancel-lesson) echo "fixtures-admin-calendar.sql" ;;
    # tenant-branding registers its parent through the REAL UI first and loads
    # fixtures-phase4-billing.sql itself afterwards. Pre-loading that fixture
    # here seeds the same email and the UI registration dies on a duplicate —
    # 0/5, found on the first full sweep (2026-08-05). Leave it to the driver.
    tenant-branding) ;;
    *) [[ -f "fixtures-$1.sql" ]] && echo "fixtures-$1.sql" || true ;;
  esac
}

# ── Reaching the stack ───────────────────────────────────────────────────────
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)"
KONG_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_kong_' || true)"
if [[ -z "$DB_CONTAINER" || -z "$KONG_CONTAINER" ]]; then
  echo "✗ no running supabase_db_*/supabase_kong_* container — \`supabase start\` first" >&2
  exit 1
fi

psql_file() {
  docker exec -i "$DB_CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$1"
}

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1"; }

# Wait until auth answers through kong. 502 here is §7.44 — the exact state the
# kong restart exists to clear — so this wait is what makes step 2 provable
# rather than hopeful.
wait_for_auth() {
  local i code
  for ((i = 0; i < 60; i++)); do
    code="$(http_code "$API_URL/auth/v1/health")"
    # GoTrue answers 200 with an apikey and 401 without one; either proves the
    # container behind kong is alive. 502/503/000 mean it is not.
    [[ "$code" == "200" || "$code" == "401" ]] && return 0
    sleep 2
  done
  echo "✗ auth never came back through kong (last code: $code)" >&2
  return 1
}

# ── Refuse to start against a half-up environment ────────────────────────────
# §7.84: a missing server makes a driver failure read as a product regression.
# Every check here names its fix, so a red preflight is a one-line repair.
preflight() {
  local ok=0 code
  # One clear line beats 32 identical crashes — the first cloud run failed every
  # driver on a missing playwright-core because nothing checked it up front.
  node -e "import('playwright-core').then(()=>process.exit(0),()=>process.exit(1))" 2>/dev/null || \
    { echo "✗ playwright-core not installed — run: npm ci  (in drivers/)" >&2; ok=1; }
  code="$(http_code "$ADMIN_URL")"
  [[ "$code" == "000" ]] && { echo "✗ admin not answering at $ADMIN_URL — cd SwimSyncAdmin && npm run dev" >&2; ok=1; }
  code="$(http_code "$EXPO_URL")"
  [[ "$code" == "000" ]] && { echo "✗ expo not answering at $EXPO_URL — cd SwimSyncApp && npx expo start --web" >&2; ok=1; }
  # 503 = edge runtime not serving (§7.84). Anything else (400/404/…) proves it is.
  code="$(http_code "$API_URL/functions/v1/public-invoice?token=preflight")"
  [[ "$code" == "503" || "$code" == "000" ]] && { echo "✗ edge functions not served (public-invoice → $code) — supabase functions serve --env-file supabase/functions/.env --no-verify-jwt" >&2; ok=1; }
  code="$(http_code "$API_URL/functions/v1/generate-invoices")"
  [[ "$code" == "503" || "$code" == "000" ]] && { echo "✗ edge functions not served (generate-invoices → $code) — same fix as above" >&2; ok=1; }
  return $ok
}

# ── One driver under a hard timeout ──────────────────────────────────────────
# Portable (macOS has no `timeout`). SIGTERM first so Playwright's finally
# blocks can close Chrome; SIGKILL five seconds later for a truly wedged one.
run_with_timeout() {
  local log="$1"; shift
  "$@" > "$log" 2>&1 &
  local pid=$!
  (
    local i
    for ((i = 0; i < TIMEOUT_SECS; i++)); do
      sleep 1
      kill -0 "$pid" 2>/dev/null || exit 0
    done
    kill "$pid" 2>/dev/null
    sleep 5
    kill -9 "$pid" 2>/dev/null
  ) &
  local watcher=$!
  wait "$pid"
  local rc=$?
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  return $rc
}

# ── The clock ────────────────────────────────────────────────────────────────
# Both modes: a stale pin (a killed --now run) is cleared first, loudly — left on
# the stack it would put the dev apps and every unpinned driver on a fake day.
UNPIN="$ROOT/scripts/clock-unpin.sh"
if ! "$UNPIN" --check 2> /dev/null; then
  "$UNPIN" > /dev/null || { echo "✗ a stale clock pin could not be cleared — run scripts/clock-unpin.sh" >&2; exit 1; }
  echo "⚠ cleared a stale clock pin"
fi

PIN=""
if [[ -n "$NOW_IN" ]]; then
  REST_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_rest_' || true)"
  [[ -n "$REST_CONTAINER" ]] || { echo "✗ no running supabase_rest_* container — \`supabase start\` first" >&2; exit 1; }
  [[ -n "${SERVICE_ROLE_KEY:-}" ]] || { echo "✗ no SERVICE_ROLE_KEY from \`supabase status\` — the pin proof needs it" >&2; exit 1; }

  # Validated and canonicalised by POSTGRES (BSD and GNU `date` differ; V8 calls
  # "…T07:59+08" an Invalid Date). The input is a psql variable, never spliced.
  # Its offset regex is app_now()'s own (§7.337).
  PIN="$(printf '%s\n' "SELECT CASE
      WHEN :'pin' !~ '([+-][0-9]{2}(:?[0-9]{2})?|Z)\$' THEN 'ERR no UTC offset'
      WHEN (:'pin')::timestamptz > pg_catalog.now() THEN 'ERR in the future'
      ELSE to_char((:'pin')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') END;" \
    | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -Atq -v ON_ERROR_STOP=1 -v pin="$NOW_IN" 2>&1)" \
    || { echo "✗ --now '$NOW_IN' is not a timestamp: $PIN" >&2; exit 2; }
  if [[ ! "$PIN" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
    echo "✗ --now '$NOW_IN' refused: ${PIN#ERR } — give a PAST moment with an offset, e.g. '2026-10-01 07:59+08'" >&2
    exit 2
  fi

  # From here on the stack may be pinned: every exit path takes it off again.
  # The unpin script deletes the API row FIRST (lock 2 closes for every pooled
  # API session at once), then RESETs, then asserts the stack is on real time.
  on_exit() {
    "$UNPIN" > "$RUN_DIR/clock-unpin.log" 2>&1 \
      || { echo "✗ STACK LEFT PINNED — run scripts/clock-unpin.sh" >&2; sed 's/^/    /' "$RUN_DIR/clock-unpin.log" >&2; }
  }
  trap on_exit EXIT
  trap 'exit 130' INT TERM
fi

pin_stack() {
  docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q \
    -c "ALTER DATABASE postgres SET swimsync.now = '$PIN'" \
  && docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
    -c "INSERT INTO private.clock_api_pin_enabled VALUES (true) ON CONFLICT DO NOTHING"
}

# rpc/app_now through the API, compared with the pin by Postgres. The service
# key: anon holds no EXECUTE on app_now().
rpc_is_pin() {
  local got
  got="$(curl -s --max-time 10 -X POST "$API_URL/rest/v1/rpc/app_now" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -d '{}' || true)"
  echo "$got" >> "$1"
  [[ "$(printf '%s\n' "SELECT ((:'v')::jsonb #>> '{}')::timestamptz = (:'pin')::timestamptz;" \
    | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -Atq -v v="$got" -v pin="$PIN" 2>> "$1")" == t ]]
}

# PostgREST answers again after its restart (any 2xx on the rpc), then THREE
# CONSECUTIVE calls must return the pin — a pool still holding a pre-pin
# connection would show up as one real-time answer among them.
prove_pin() {
  local log="$1" i n=0
  for ((i = 0; i < 30; i++)); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST "$API_URL/rest/v1/rpc/app_now" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" -d '{}')" == 2?? ]] && break
    sleep 1
  done
  for ((i = 0; i < 3; i++)); do rpc_is_pin "$log" && n=$((n + 1)); done
  ((n == 3))
}

# "pinnable" | "own-literal" | "" — the exact header marker, first 40 lines
# (check-driver-clock.sh enforces the same spelling).
marker_of() {
  head -n 40 "$1" | sed -n -E 's#^// clock: (pinnable|own-literal)$#\1#p' | head -1
}

# ── The sweep ────────────────────────────────────────────────────────────────
DRIVERS=()
for f in verify-*.mjs; do
  name="${f#verify-}"; name="${name%.mjs}"
  if [[ -n "$ONLY" && "$name" != "$ONLY" ]]; then continue; fi
  DRIVERS+=("$name")
done
if ((${#DRIVERS[@]} == 0)); then
  echo "✗ no drivers matched${ONLY:+ --only $ONLY}" >&2
  exit 2
fi

# --only on a driver that cannot run pinned is refused before anything moves.
if [[ -n "$PIN" && -n "$ONLY" && -f "verify-$ONLY.mjs" && -z "$(marker_of "verify-$ONLY.mjs")" ]]; then
  echo "✗ verify-$ONLY.mjs has no '// clock: pinnable' marker — it cannot run under --now (it would run half-pinned)" >&2
  exit 2
fi

echo "run dir: $RUN_DIR"
echo "running ${#DRIVERS[@]} driver(s), ${TIMEOUT_SECS}s timeout each"
if [[ -n "$PIN" ]]; then echo "Pinned at: $PIN  (--now '$NOW_IN')"; else echo "Real clock"; fi
echo

SUMMARY="$RUN_DIR/summary.md"
{
  if [[ -n "$PIN" ]]; then echo "Pinned at: $PIN"; else echo "Real clock"; fi
  echo
  echo "| driver | result | score | secs |"
  echo "|---|---|---|---|"
} > "$SUMMARY"

FAILED=()
SKIPPED=()
PASSED=0
for name in "${DRIVERS[@]}"; do
  driver="verify-$name.mjs"
  fixture="$(fixture_for "$name")"
  log="$RUN_DIR/$name.log"

  # Pinned: only a driver that reads now through lib.mjs may run. Never PASS
  # for one that would run half-pinned.
  if [[ -n "$PIN" ]]; then
    m="$(marker_of "$driver")"
    proven=0
    for p in "${OWN_LITERAL_PROVEN[@]+"${OWN_LITERAL_PROVEN[@]}"}"; do [[ "$p" == "$name" ]] && proven=1; done
    if [[ -z "$m" ]] || [[ "$m" == own-literal && -z "$ONLY" && $proven == 0 ]]; then
      printf '── %s\n  – SKIPPED (not pinnable%s)\n' "$driver" "${m:+: own-literal, not yet proven pinned}"
      echo "| $name | SKIPPED (not pinnable) | — | 0 |" >> "$SUMMARY"
      SKIPPED+=("$name")
      continue
    fi
  fi
  export SHOT_DIR="$RUN_DIR/shots-$name"
  mkdir -p "$SHOT_DIR"
  started=$SECONDS

  printf '── %s%s\n' "$driver" "${fixture:+  (+ $fixture)}"

  # Pinned: UNPIN before the reset — its migrations run before seed.sql restores
  # lock 1, so a pinned session mid-reset RAISEs.
  if [[ -n "$PIN" ]] && ! "$UNPIN" > "$RUN_DIR/$name.unpin.log" 2>&1; then
    echo "  ✗ could not unpin before the reset — aborting the sweep" >&2
    sed 's/^/      /' "$RUN_DIR/$name.unpin.log" >&2
    echo "| $name | ABORT (unpin failed) | — | $((SECONDS - started)) |" >> "$SUMMARY"
    FAILED+=("$name (unpin failed)")
    break
  fi
  if ! (cd "$ROOT" && supabase db reset) > "$RUN_DIR/$name.reset.log" 2>&1; then
    echo "  ✗ supabase db reset failed — the stack is broken, aborting the sweep" >&2
    tail -15 "$RUN_DIR/$name.reset.log" | sed 's/^/      /' >&2
    echo "| $name | ABORT (db reset failed) | — | $((SECONDS - started)) |" >> "$SUMMARY"
    FAILED+=("$name (db reset failed)")
    break
  fi
  if [[ -n "$PIN" ]]; then
    # PIN, then a fresh PostgREST pool (its connections predate the database
    # default), then kong, whose upstream may have moved (§7.44).
    if ! pin_stack > "$RUN_DIR/$name.pin.log" 2>&1; then
      echo "  ✗ could not pin the stack — aborting the sweep" >&2
      sed 's/^/      /' "$RUN_DIR/$name.pin.log" >&2
      echo "| $name | ABORT (pin failed) | — | $((SECONDS - started)) |" >> "$SUMMARY"
      FAILED+=("$name (pin failed)")
      break
    fi
    docker restart "$REST_CONTAINER" > /dev/null
  fi
  docker restart "$KONG_CONTAINER" > /dev/null
  wait_for_auth || { FAILED+=("$name (auth 502 after reset)"); echo "| $name | ABORT (auth) | — | $((SECONDS - started)) |" >> "$SUMMARY"; break; }
  if [[ -n "$PIN" ]] && ! prove_pin "$RUN_DIR/$name.proof.log"; then
    echo "  ✗ CANNOT SAY — rpc/app_now did not return the pin 3 times in a row (log: $name.proof.log)"
    echo "| $name | CANNOT SAY (clock proof) | — | $((SECONDS - started)) |" >> "$SUMMARY"
    FAILED+=("$name (cannot say: the API did not prove the pin)")
    continue
  fi

  # Opt-in hook for simulate-date.sh (§7.277): SQL applied to the fresh DB after
  # the reset and BEFORE the fixture — e.g. a pinned session_window_start().
  # Unset (the nightly, every normal run) this block does nothing. A failure
  # skips the driver loudly: a half-applied pin reads as a product regression.
  if [[ -n "${AFTER_RESET_SQL:-}" ]]; then
    if ! psql_file "$AFTER_RESET_SQL" > "$RUN_DIR/$name.after-reset.log" 2>&1; then
      echo "  ✗ AFTER_RESET_SQL ($AFTER_RESET_SQL) did not apply — driver skipped"
      tail -15 "$RUN_DIR/$name.after-reset.log" | sed 's/^/      /'
      echo "| $name | AFTER_RESET_SQL FAILED | — | $((SECONDS - started)) |" >> "$SUMMARY"
      FAILED+=("$name (AFTER_RESET_SQL)")
      continue
    fi
  fi

  if [[ -n "$fixture" ]]; then
    if ! psql_file "$fixture" > "$RUN_DIR/$name.fixture.log" 2>&1; then
      echo "  ✗ $fixture did not load (§7.62) — driver skipped, this is a FIXTURE failure"
      tail -15 "$RUN_DIR/$name.fixture.log" | sed 's/^/      /'
      echo "| $name | FIXTURE FAILED | — | $((SECONDS - started)) |" >> "$SUMMARY"
      FAILED+=("$name (fixture)")
      continue
    fi
  fi

  if [[ -n "$PIN" ]]; then
    run_with_timeout "$log" env DRIVER_NOW="$PIN" node "$driver"
  else
    run_with_timeout "$log" node "$driver"
  fi
  rc=$?
  secs=$((SECONDS - started))

  # For the summary only: the last score the driver printed — either the
  # "N/M checks" or the "N passed, M failed" format. The exit code is the
  # verdict; this is the human-readable size of it.
  score="$(grep -oE '[0-9]+/[0-9]+|[0-9]+ passed(, [0-9]+ failed)?' "$log" | tail -1 || true)"

  if ((rc == 0)); then
    printf '  ✓ PASS  %s  (%ss)\n' "${score:-—}" "$secs"
    echo "| $name | PASS | ${score:-—} | $secs |" >> "$SUMMARY"
    PASSED=$((PASSED + 1))
  elif ((rc == 143 || rc == 137)); then
    printf '  ✗ TIMEOUT after %ss\n' "$TIMEOUT_SECS"
    tail -20 "$log" | sed 's/^/      /'
    echo "| $name | TIMEOUT | ${score:-—} | $secs |" >> "$SUMMARY"
    FAILED+=("$name (timeout)")
  else
    printf '  ✗ FAIL  %s  (exit %s, %ss)\n' "${score:-—}" "$rc" "$secs"
    tail -20 "$log" | sed 's/^/      /'
    echo "| $name | FAIL | ${score:-—} | $secs |" >> "$SUMMARY"
    FAILED+=("$name")
  fi
done

echo
if [[ -n "$PIN" ]]; then
  # A pinned sweep with a skip is never "all passed": the skipped drivers were
  # not tested at this moment at all.
  ((${#FAILED[@]})) && { echo "✗ failed:"; printf '    %s\n' "${FAILED[@]}"; }
  ((${#SKIPPED[@]})) && echo "– skipped (not pinnable): ${SKIPPED[*]}"
  echo "logs + screenshots: $RUN_DIR"
  echo "Pinned at $PIN: $PASSED passed (pinned), ${#SKIPPED[@]} skipped (not pinnable), ${#FAILED[@]} failed"
  ((${#FAILED[@]})) && exit 1
  ((${#SKIPPED[@]})) && exit 3
  exit 0
fi
if ((${#FAILED[@]} == 0)); then
  echo "✓ all ${#DRIVERS[@]} driver(s) passed"
  exit 0
fi
echo "✗ ${#FAILED[@]} of ${#DRIVERS[@]} driver(s) failed:"
printf '    %s\n' "${FAILED[@]}"
echo
echo "logs + screenshots: $RUN_DIR"
exit 1
