#!/usr/bin/env bash
# Runs chosen UI drivers as if the SERVER's marking window belonged to a future
# calendar date — so a window-fragile fixture is found before the 1st, not
# after (BACKLOG → "Simulate a FUTURE date against the driver suite", §7.226).
#
# HOW. Takes a calendar date D and derives the floor the database would have on
# D: date_trunc('month', D) - 1 month (the expression in
# 20260727000100_attendance_window_guard.sql). Then, per driver, it calls
#   AFTER_RESET_SQL=<pin.sql> run-all-drivers.sh --only <name>
# so each driver gets run-all-drivers.sh's own reset → kong restart → pin →
# fixture_for() fixture → run. pin.sql is the LIVE session_window_start()
# definition (signature, volatility, SET search_path, grants all kept) with only
# its body swapped for SELECT DATE '<floor>', followed by an assertion block.
#
# TWO LIMITS — read these before believing a result:
#   1. It moves the SERVER floor only — not now(), not the browser clock. It is
#      blind to the other date-rot shape (§7.225's hardcoded month).
#   2. It cannot validate a fixture whose dates are CORRECTLY derived from
#      now(): moving the floor without moving now() makes fixture and floor
#      disagree by construction (§7.226).
# NO BY-CONSTRUCTION FINDINGS. A red on a fixture labelled "relative" is that
# expected disagreement — do NOT file it. Only a red on a "literal" fixture
# (one carrying 'YYYY-MM-DD' literals) is a finding.
#
# ONLY NEXT MONTH'S 1st MOVES ANYTHING (§7.277). Callers read
# markable_floor(tenant) = LEAST(session_window_start(), <month after the last
# seal, else the tenant's created_at>), and after a reset the seed tenant was
# created TODAY with nothing sealed — so any floor later than today clamps to
# today. After every pin the script asserts markable_floor(seed tenant) equals
# the pinned floor, and refuses otherwise ("floor clamped …").
#
# THE SHARED DB IS RESTORED ON EVERY EXIT PATH (§7.278). The next reset wipes a
# pin, but nothing resets after the LAST driver, on Ctrl-C or on a crash. So the
# live definition is captured first, `trap restore EXIT INT TERM` re-applies it,
# and the live value is asserted afterwards — a failure prints
# "DB LEFT PINNED — run supabase db reset".
#
# Guard rails: no --only → refused unless --all (a full sweep is USER-REQUESTED
# ONLY — CLAUDE.md); refused beside a sibling worktree (it resets per driver,
# §7.55); same prereqs as run-all-drivers.sh.
#
# Usage:
#   simulate-date.sh 2026-10-01 --only unmarked-lessons,class-students
#   simulate-date.sh 2026-10-01 --all          # full sweep — only when asked
#   RUN_DIR=/some/dir simulate-date.sh …       # keep the logs somewhere known
#
# Output: a table of driver | fixture | dates | result | score | meaning, and
# every run's logs under the work dir printed at start. Exit: 0 all PASS,
# 1 a red (or a pin that did not take), 2 usage/refusal, 3 floor clamped,
# 4 DB LEFT PINNED.
#
# Proofs (2026-09-26, DRIVER_BACKLOG_PLAN U12):
#   | mutation                                            | result                                  |
#   |-----------------------------------------------------|-----------------------------------------|
#   | PIN_BODY → today's floor, ignoring the date         | 2026-10-01: "PIN DID NOT TAKE: = 2026-08-01, expected 2026-09-01", exit 1 |
#   | restore.sql → SELECT 1 (restore does nothing)       | "DB LEFT PINNED" banner, exit 4          |
#   | kill -TERM mid-driver (schedule-week running)       | node + run-all stopped, restored to 2026-08-01, exit 143 |
#   | 2026-12-01                                          | refused "floor clamped …" (markable_floor 2026-09-26), exit 3 |

set -uo pipefail # not -e: one failing driver must not stop the loop
cd "$(dirname "$0")"
HERE="$(pwd)"
SEED_TENANT="70000000-0000-0000-0000-000000000001"

DATE="" ONLY="" ALL=0
while (($#)); do
  case "$1" in
    --only) ONLY="${2:-}"; shift 2 ;;
    --all) ALL=1; shift ;;
    -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$HERE/$(basename "$0")"; exit 0 ;;
    -*) echo "unknown argument: $1" >&2; exit 2 ;;
    *) [[ -z "$DATE" ]] || { echo "one date only (got $DATE and $1)" >&2; exit 2; }; DATE="$1"; shift ;;
  esac
done

[[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "usage: simulate-date.sh <YYYY-MM-DD> --only a,b | --all" >&2; exit 2; }
if [[ -n "$ONLY" && $ALL == 1 ]]; then echo "✗ --only and --all together — pick one" >&2; exit 2; fi
if [[ -z "$ONLY" && $ALL == 0 ]]; then
  echo "✗ refusing: no --only. A full sweep is user-requested only — pass --all if the user asked for it." >&2
  exit 2
fi
if (($(git worktree list | wc -l) > 1)); then
  echo "✗ refusing: more than one worktree — this resets the SHARED database per driver (§7.55)" >&2
  git worktree list >&2
  exit 2
fi

NAMES=()
if ((ALL)); then
  for f in verify-*.mjs; do n="${f#verify-}"; NAMES+=("${n%.mjs}"); done
else
  IFS=',' read -r -a NAMES <<< "$ONLY"
  for n in "${NAMES[@]}"; do
    [[ -f "verify-$n.mjs" ]] || { echo "✗ no driver verify-$n.mjs" >&2; exit 2; }
  done
fi

DB="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)"
[[ -n "$DB" ]] || { echo "✗ no running supabase_db_* container — supabase start first" >&2; exit 1; }
q() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

FLOOR="$(q -c "SELECT (date_trunc('month', DATE '$DATE') - INTERVAL '1 month')::date" 2>/dev/null)" \
  || { echo "✗ $DATE is not a date" >&2; exit 2; }
REAL_FLOOR_SQL="(date_trunc('month', today_sg()) - INTERVAL '1 month')::date"

WORK="${RUN_DIR:-$(mktemp -d)}"
mkdir -p "$WORK"

# ── Capture the live definition BEFORE anything can change it (§7.278) ───────
q -c "SELECT pg_get_functiondef('public.session_window_start'::regproc)" > "$WORK/original.def" \
  || { echo "✗ could not read session_window_start() from the DB" >&2; exit 1; }
# A definition that is already a pin means an earlier run left the DB pinned —
# "restoring" it would restore the pin. Refuse instead.
if ! grep -q 'now()' "$WORK/original.def"; then
  echo "✗ session_window_start() is ALREADY PINNED (its body does not read now()) — run supabase db reset" >&2
  cat "$WORK/original.def" >&2
  exit 1
fi
ORIG_ACL="$(q -c "SELECT proacl::text FROM pg_proc WHERE oid = 'public.session_window_start'::regproc")"
{ cat "$WORK/original.def"; echo ";"; } > "$WORK/restore.sql"

CHILD=""
RESTORED=0
kill_tree() { # children first, so run-all-drivers cannot start the next step
  local c
  for c in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$c"; done
  kill -TERM "$1" 2>/dev/null
}
restore() {
  local rc=$?
  ((RESTORED)) && return
  RESTORED=1
  trap - EXIT INT TERM
  if [[ -n "$CHILD" ]]; then
    echo "  … interrupted: stopping the running driver" >&2
    kill_tree "$CHILD"; wait "$CHILD" 2>/dev/null
    ((rc == 0)) && rc=130
  fi
  q < "$WORK/restore.sql" > "$WORK/restore.log" 2>&1
  q -c "SELECT pg_get_functiondef('public.session_window_start'::regproc)" > "$WORK/after.def" 2>/dev/null
  local ok
  ok="$(q -c "SELECT session_window_start() = $REAL_FLOOR_SQL" 2>/dev/null)"
  if [[ "$ok" == "t" ]] && cmp -s "$WORK/original.def" "$WORK/after.def"; then
    echo "restored: session_window_start() = $(q -c 'SELECT session_window_start()') (today's real floor)"
  else
    {
      echo
      echo "████████████████████████████████████████████████████████████████████"
      echo "██  DB LEFT PINNED — run supabase db reset"
      echo "██  session_window_start() = $(q -c 'SELECT session_window_start()' 2>&1),"
      echo "██  real floor = $(q -c "SELECT $REAL_FLOOR_SQL" 2>&1)  (restore log: $WORK/restore.log)"
      echo "████████████████████████████████████████████████████████████████████"
    } >&2
    rc=4
  fi
  exit "$rc"
}
trap restore EXIT INT TERM

# ── The pin: the live definition with ONLY the body swapped ──────────────────
PIN_BODY="SELECT DATE '$FLOOR'"
PIN_BODY="$PIN_BODY" perl -0pe 's/(AS \$function\$).*?(\$function\$)/$1\n  $ENV{PIN_BODY}\n$2/s' \
  "$WORK/original.def" > "$WORK/pin-body.sql"
grep -qF "$PIN_BODY" "$WORK/pin-body.sql" || { echo "✗ could not build the pin from the live definition" >&2; exit 1; }
cat >> "$WORK/pin-body.sql" <<SQL
;
-- Asserted on every pin, after every reset: the pin took, grants are the live
-- ones, and the floor callers actually read (markable_floor) is not clamped.
DO \$\$
DECLARE
  s date := public.session_window_start();
  m date := public.markable_floor('$SEED_TENANT');
  a text := (SELECT proacl::text FROM pg_proc WHERE oid = 'public.session_window_start'::regproc);
BEGIN
  RAISE NOTICE 'simulate-date: session_window_start() = %, markable_floor(seed) = %, pinned = $FLOOR', s, m;
  IF s IS DISTINCT FROM DATE '$FLOOR' THEN
    RAISE EXCEPTION 'PIN DID NOT TAKE: session_window_start() = %, expected $FLOOR', s;
  END IF;
  IF a IS DISTINCT FROM '$ORIG_ACL' THEN
    RAISE EXCEPTION 'pin changed the grants: % (was $ORIG_ACL)', a;
  END IF;
  IF m IS DISTINCT FROM DATE '$FLOOR' THEN
    RAISE EXCEPTION 'floor clamped by tenant created_at/sealed month: this date cannot be simulated (markable_floor = %, pinned floor = $FLOOR)', m;
  END IF;
END \$\$;
SQL
# One transaction: a failed assertion rolls the pin back instead of leaving it.
{ echo "BEGIN;"; cat "$WORK/pin-body.sql"; echo "COMMIT;"; } > "$WORK/pin.sql"

REAL_FLOOR="$(q -c "SELECT $REAL_FLOOR_SQL")"
echo "simulating $DATE → server floor $FLOOR (today's real floor: $REAL_FLOOR)"
echo "work dir: $WORK"

# Fast refusal against the current DB, rolled back so nothing is left behind.
# The per-driver assertion (after each reset) is the authoritative one.
if ! { echo "BEGIN;"; cat "$WORK/pin-body.sql"; echo "ROLLBACK;"; } | q > "$WORK/precheck.log" 2>&1; then
  if grep -q 'floor clamped' "$WORK/precheck.log"; then
    echo "✗ refusing: floor clamped by tenant created_at/sealed month: this date cannot be simulated (§7.277)" >&2
    grep -o 'markable_floor = .*' "$WORK/precheck.log" | head -1 | sed 's/^/    /' >&2
    exit 3
  fi
  echo "✗ the pin does not apply:" >&2; sed 's/^/    /' "$WORK/precheck.log" >&2
  exit 1
fi
echo

TABLE="$WORK/simulate-summary.md"
{
  echo "Simulated $DATE (server floor $FLOOR; real floor $REAL_FLOOR)"
  echo
  echo "| driver | fixture | dates | result | score | meaning |"
  echo "|---|---|---|---|---|---|"
} > "$TABLE"

FAILS=0
for name in "${NAMES[@]}"; do
  rd="$WORK/$name"
  printf '── %s ' "$name"
  AFTER_RESET_SQL="$WORK/pin.sql" RUN_DIR="$rd" "$HERE/run-all-drivers.sh" --only "$name" > "$rd.out" 2>&1 &
  CHILD=$!
  wait "$CHILD"
  CHILD=""

  if grep -qs 'floor clamped' "$rd/$name.after-reset.log"; then
    echo
    echo "✗ refusing: floor clamped by tenant created_at/sealed month: this date cannot be simulated (§7.277)" >&2
    grep -o 'markable_floor = .*' "$rd/$name.after-reset.log" | head -1 | sed 's/^/    /' >&2
    exit 3
  fi
  if grep -qs '| AFTER_RESET_SQL FAILED |' "$rd/summary.md"; then
    echo
    echo "✗ the post-pin assertion failed after the reset — every later driver would be meaningless:" >&2
    grep -E 'ERROR|NOTICE' "$rd/$name.after-reset.log" | sed 's/^/    /' >&2
    exit 1
  fi

  # The fixture exactly as run-all-drivers.sh's fixture_for() chose it.
  fixture="$(sed -nE 's/^── verify-.*\.mjs  \(\+ (.*)\)$/\1/p' "$rd.out" | head -1)"
  if [[ -z "$fixture" ]]; then
    fixture="—"; kind="none"
  else
    # Literal 'YYYY-MM-DD' dates in SQL, not in `--` comment lines (a comment
    # quoting an old date, as fixtures-unmarked-lessons.sql does, is not one).
    lits="$(grep -vE '^[[:space:]]*--' "$fixture" | grep -cE "'20[0-9]{2}-[0-9]{2}-[0-9]{2}" || true)"
    if ((lits > 0)); then kind="literal ($lits)"; else kind="relative"; fi
  fi
  row="$(grep -s "^| $name |" "$rd/summary.md" | head -1)"
  result="$(awk -F' \\| ' '{print $2}' <<< "$row")"
  score="$(awk -F' \\| ' '{print $3}' <<< "$row")"
  [[ -n "$result" ]] || result="NO SUMMARY (see $rd.out)"

  case "$result:$kind" in
    PASS:*) meaning="—" ;;
    "FIXTURE FAILED":*|ABORT*) meaning="environment/fixture failure, not a date result — see $rd.out" ;;
    *:relative) meaning="expected under a pin (§7.226) — NOT a finding" ;;
    *:literal*) meaning="FINDING — a literal-date fixture fell out of the window" ;;
    *) meaning="no fixture — check the driver's own dates by hand" ;;
  esac
  [[ "$result" == "PASS" ]] || FAILS=$((FAILS + 1))
  echo "$result ${score:-} [$kind]"
  echo "| $name | $fixture | $kind | $result | ${score:-—} | $meaning |" >> "$TABLE"
done

echo
cat "$TABLE"
echo
echo "logs: $WORK"
((FAILS == 0)) && exit 0 || exit 1
