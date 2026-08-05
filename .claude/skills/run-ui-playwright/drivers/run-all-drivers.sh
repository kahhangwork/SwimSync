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
#   TIMEOUT_SECS=1200 run-all-drivers.sh
#
# Output: per-driver logs + screenshots under $RUN_DIR (printed at start),
# summary.md alongside them — the CI job posts that file into the rolling
# rot issue.

set -uo pipefail # not -e: one failing driver must not stop the sweep
cd "$(dirname "$0")"
ROOT="$(git rev-parse --show-toplevel)"

ONLY=""
while (($#)); do
  case "$1" in
    --only) ONLY="${2:-}"; shift 2 ;;
    -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

TIMEOUT_SECS="${TIMEOUT_SECS:-900}"
API_URL="${API_URL:-http://127.0.0.1:54321}"

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

echo "run dir: $RUN_DIR"
echo "running ${#DRIVERS[@]} driver(s), ${TIMEOUT_SECS}s timeout each"
echo

SUMMARY="$RUN_DIR/summary.md"
{
  echo "| driver | result | score | secs |"
  echo "|---|---|---|---|"
} > "$SUMMARY"

FAILED=()
for name in "${DRIVERS[@]}"; do
  driver="verify-$name.mjs"
  fixture="$(fixture_for "$name")"
  log="$RUN_DIR/$name.log"
  export SHOT_DIR="$RUN_DIR/shots-$name"
  mkdir -p "$SHOT_DIR"
  started=$SECONDS

  printf '── %s%s\n' "$driver" "${fixture:+  (+ $fixture)}"

  if ! (cd "$ROOT" && supabase db reset) > "$RUN_DIR/$name.reset.log" 2>&1; then
    echo "  ✗ supabase db reset failed — the stack is broken, aborting the sweep" >&2
    tail -15 "$RUN_DIR/$name.reset.log" | sed 's/^/      /' >&2
    echo "| $name | ABORT (db reset failed) | — | $((SECONDS - started)) |" >> "$SUMMARY"
    FAILED+=("$name (db reset failed)")
    break
  fi
  docker restart "$KONG_CONTAINER" > /dev/null
  wait_for_auth || { FAILED+=("$name (auth 502 after reset)"); echo "| $name | ABORT (auth) | — | $((SECONDS - started)) |" >> "$SUMMARY"; break; }

  if [[ -n "$fixture" ]]; then
    if ! psql_file "$fixture" > "$RUN_DIR/$name.fixture.log" 2>&1; then
      echo "  ✗ $fixture did not load (§7.62) — driver skipped, this is a FIXTURE failure"
      tail -15 "$RUN_DIR/$name.fixture.log" | sed 's/^/      /'
      echo "| $name | FIXTURE FAILED | — | $((SECONDS - started)) |" >> "$SUMMARY"
      FAILED+=("$name (fixture)")
      continue
    fi
  fi

  run_with_timeout "$log" node "$driver"
  rc=$?
  secs=$((SECONDS - started))

  # For the summary only: the last score the driver printed — either the
  # "N/M checks" or the "N passed, M failed" format. The exit code is the
  # verdict; this is the human-readable size of it.
  score="$(grep -oE '[0-9]+/[0-9]+|[0-9]+ passed(, [0-9]+ failed)?' "$log" | tail -1 || true)"

  if ((rc == 0)); then
    printf '  ✓ PASS  %s  (%ss)\n' "${score:-—}" "$secs"
    echo "| $name | PASS | ${score:-—} | $secs |" >> "$SUMMARY"
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
if ((${#FAILED[@]} == 0)); then
  echo "✓ all ${#DRIVERS[@]} driver(s) passed"
  exit 0
fi
echo "✗ ${#FAILED[@]} of ${#DRIVERS[@]} driver(s) failed:"
printf '    %s\n' "${FAILED[@]}"
echo
echo "logs + screenshots: $RUN_DIR"
exit 1
