#!/usr/bin/env bash
# Loads every UI fixture, unloads it, and fails if either half does not work.
#
# WHY THIS EXISTS. No fixture was applied by CI until this script, so a fixture
# could rot for a week and nothing said so. Two classes of breakage shipped that
# way, and BOTH were found by accident:
#
#   §7.62  a migration moved the schema out from under two fixtures
#          (20260719000600 made students.tenant_id NOT NULL; two fixtures insert
#          students without it). Unloadable for a week.
#   §7.63  a fixture wrote rows it does not own — an unscoped CROSS JOIN in
#          fixtures-unmarked-lessons.sql enrolled and marked present EVERY
#          student in the database, 6 children instead of 2.
#
# What made both silent is psql's default: it aborts the ONE failing statement,
# prints into a wall of output, and carries on with the rest of the file. The
# fixture half-loads, the driver then scores low, and the low score reads as a
# PRODUCT regression — §7.62 is exactly why verify-attendance-window.mjs's 0/4
# sent someone hunting a bug in the attendance window that did not exist.
# So: ON_ERROR_STOP=1. A half-load is a failure here, loudly, on the day it lands.
#
# THE TWO PASSES, AND WHY THE SECOND ONE IS NOT OPTIONAL
#
#   Pass 1 — isolated.  For each fixture: snapshot every table's row count,
#            apply, apply the teardown, assert the counts came back identical.
#            This is the round-trip harness from docs/WORKTREES.md Phase 4; run
#            by hand once, it caught two teardown defects that looked correct by
#            reading (a stray parent_tenants row; a teardown that could not reach
#            a session its fixture deliberately leaves unmarked).
#
#   Pass 2 — stacked.  Apply all fixtures in sequence WITHOUT tearing down
#            between them, then tear down in reverse. §7.63 only appears with a
#            sibling's rows already present — testing each fixture on a clean
#            database is what missed it on the first manual pass.
#
#            The detector is the comparison between the passes. A fixture that
#            touches only its OWN rows produces the same per-table delta whether
#            it runs alone or on top of thirteen siblings. §7.63's signature is
#            precisely that the deltas DIVERGE: +2 enrolments isolated, +6
#            stacked. Any divergence fails the build and names the table.
#
# Run locally (the Supabase stack must be up):
#   .claude/skills/run-ui-playwright/drivers/check-fixture-roundtrip.sh
#   .claude/skills/run-ui-playwright/drivers/check-fixture-roundtrip.sh --only unmarked-lessons
#   .claude/skills/run-ui-playwright/drivers/check-fixture-roundtrip.sh --isolated-only
#
# It leaves the database exactly as it found it, so it is safe to run against the
# shared local Postgres while a sibling worktree is working (docs/GOTCHAS.md
# §7.55) — that is the property pass 1 asserts, not merely assumes.

set -euo pipefail
cd "$(dirname "$0")"

ONLY=""
ISOLATED_ONLY=0
while (($#)); do
  case "$1" in
    --only) ONLY="${2:-}"; shift 2 ;;
    --isolated-only) ISOLATED_ONLY=1; shift ;;
    # Print the header block above, however long it grows — a hardcoded line
    # range drifts into nonsense the first time someone edits a comment.
    -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ── reaching Postgres ────────────────────────────────────────────────────────
# There is no local psql on the dev machine, and the container name is derived
# from supabase/config.toml's project_id, which differs from the checkout name.
# Discover it rather than hardcoding either.
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "✗ no running supabase_db_* container — start the stack with \`supabase start\`" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Run a .sql FILE. ON_ERROR_STOP=1 is the whole point: a fixture that half-loads
# must fail here, not three weeks later inside someone else's driver score.
psql_file() {
  docker exec -i "$DB_CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$1"
}

psql_query() {
  docker exec -i "$DB_CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At -F'|' -c "$1"
}

# Exact row counts for every base table that a fixture could plausibly touch.
# n_live_tup is an ESTIMATE and would make this harness lie, so count for real
# via query_to_xml. `auth` is in scope because fixtures insert auth.users
# directly and let the handle_new_user trigger fan out into profiles/parents.
snapshot() {
  psql_query "
    SELECT n.nspname || '.' || c.relname,
           (xpath('/row/c/text()',
                  query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname),
                               false, true, '')))[1]::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname IN ('public', 'auth', 'storage')
    ORDER BY 1;"
}

# Per-table difference between two snapshots, one "table +n" line per change.
delta() {
  awk -F'|' '
    NR==FNR { before[$1] = $2; next }
    { d = $2 - before[$1]; if (d != 0) printf "%s %+d\n", $1, d }
  ' "$1" "$2"
}

# ── The one legitimate reason a footprint may move ───────────────────────────
# A fixture whose job is to build a COMPLETE billing month has to mark every
# student enrolled in the class, including children a sibling fixture enrolled —
# completeness is measured across the roster, so scoping to its own child would
# make the fixture stop testing what it exists to test.
#
# That is still the §7.63 hazard, so it is declared IN THE FIXTURE, echoed on
# every run, and it exempts the fixture from the pass-2 comparison ONLY. Pass 1
# still applies in full: whatever extra rows it writes, its teardown must remove.
# A silent allowance would read as "checked" when it was not.
exemption_of() {
  sed -n 's/^-- roundtrip-exempt: cross-fixture-writes *—* *//p' "$1" | head -1
}

FIXTURES=()
for f in fixtures-*.sql; do
  case "$f" in *-teardown.sql) continue ;; esac
  if [[ -n "$ONLY" && "$f" != "fixtures-$ONLY.sql" ]]; then continue; fi
  FIXTURES+=("$f")
done

if ((${#FIXTURES[@]} == 0)); then
  echo "✗ no fixtures matched${ONLY:+ --only $ONLY}" >&2
  exit 2
fi

FAILURES=0
fail() {
  FAILURES=$((FAILURES + 1))
  echo "  ✗ $*"
}

# ── Pass 1 — each fixture alone, and its teardown must restore the database ──
echo "── Pass 1: isolated round-trip (${#FIXTURES[@]} fixtures) ──"
for f in "${FIXTURES[@]}"; do
  teardown="${f%.sql}-teardown.sql"
  before="$WORK/before"; after="$WORK/after"; restored="$WORK/restored"

  snapshot > "$before"

  if ! psql_file "$f" > "$WORK/apply.log" 2>&1; then
    fail "$f did not load — the fixture is broken against the current schema (§7.62)"
    sed 's/^/      /' "$WORK/apply.log" | tail -15
    # Still attempt the teardown: a half-load leaves rows behind, and leaving
    # them would poison every fixture checked after this one.
    psql_file "$teardown" > /dev/null 2>&1 || true
    continue
  fi

  snapshot > "$after"
  delta "$before" "$after" > "$WORK/isolated-$f.delta"

  if [[ ! -s "$WORK/isolated-$f.delta" ]]; then
    fail "$f loaded but changed NO rows — it is not seeding what it claims to"
  fi

  if ! psql_file "$teardown" > "$WORK/teardown.log" 2>&1; then
    fail "$teardown did not run"
    sed 's/^/      /' "$WORK/teardown.log" | tail -15
  fi

  snapshot > "$restored"
  leftover="$(delta "$before" "$restored")"
  if [[ -n "$leftover" ]]; then
    fail "$teardown did not restore the database — rows left behind:"
    echo "$leftover" | sed 's/^/      /'
  else
    printf '  ✓ %-40s %s\n' "$f" "$(tr '\n' ' ' < "$WORK/isolated-$f.delta")"
  fi
done

# --only selects ONE fixture, which makes pass 2 degenerate: "stacked" on nothing
# is the same run as pass 1, compared against itself, passing by construction.
# Say so rather than printing a green line that claims siblings were involved.
if ((ISOLATED_ONLY)) || [[ -n "$ONLY" ]]; then
  echo
  [[ -n "$ONLY" ]] && ((!ISOLATED_ONLY)) && \
    echo "(pass 2 skipped: it needs siblings — re-run without --only)"
  ((FAILURES == 0)) && echo "✓ pass 1 clean" || echo "✗ $FAILURES failure(s)"
  exit $((FAILURES > 0))
fi

# ── Pass 2 — stacked, and the deltas must not move ───────────────────────────
# A fixture that writes only its own rows behaves identically on top of thirteen
# siblings. §7.63 is what it looks like when one does not.
echo
echo "── Pass 2: stacked (each fixture applied on top of the previous) ──"

STACK_BASE="$WORK/stack-base"
snapshot > "$STACK_BASE"
LOADED=()

# Pass 2 deliberately leaves fixtures loaded as it goes, so an early exit MUST
# still unwind them or the shared database is left seeded. Reverse order: a
# teardown may depend on rows an earlier fixture created.
unwind() {
  local i
  for ((i = ${#LOADED[@]} - 1; i >= 0; i--)); do
    psql_file "${LOADED[i]%.sql}-teardown.sql" > /dev/null 2>&1 || \
      echo "  ! ${LOADED[i]%.sql}-teardown.sql failed during unwind" >&2
  done
  LOADED=()
}
trap 'unwind; rm -rf "$WORK"' EXIT

for f in "${FIXTURES[@]}"; do
  before="$WORK/s-before"; after="$WORK/s-after"
  snapshot > "$before"

  # Queued for unwinding BEFORE it is applied, not after. A fixture that fails
  # part-way still leaves rows — ON_ERROR_STOP halts the file, it does not roll
  # back statements that already committed — and skipping its teardown makes the
  # harness itself leave the shared database dirty, which is the exact sin it
  # exists to catch. Reverse order is preserved either way.
  LOADED+=("$f")

  if ! psql_file "$f" > "$WORK/apply.log" 2>&1; then
    fail "$f did not load on top of $((${#LOADED[@]} - 1)) sibling fixture(s) — it loads alone, so it collides with a sibling"
    sed 's/^/      /' "$WORK/apply.log" | tail -15
    continue
  fi

  snapshot > "$after"
  delta "$before" "$after" > "$WORK/stacked-$f.delta"

  # No isolated baseline means pass 1 never got this fixture loaded, so there is
  # nothing to compare against. Say that, instead of letting `diff` fail on a
  # missing file and reporting it as §7.63 — misdiagnosing "did not load" as
  # "wrote rows it does not own" is exactly the confusion this script exists to
  # end. The build is already failing on the pass-1 error.
  if [[ ! -f "$WORK/isolated-$f.delta" ]]; then
    printf '  – %-40s skipped: no pass-1 baseline (it failed to load)\n' "$f"
  elif ! diff -q "$WORK/isolated-$f.delta" "$WORK/stacked-$f.delta" > /dev/null 2>&1; then
    reason="$(exemption_of "$f")"
    if [[ -n "$reason" ]]; then
      printf '  ⚠ %-40s writes beyond its own rows, DECLARED\n' "$f"
      echo "      reason:  $reason"
      echo "      alone:   $(tr '\n' ' ' < "$WORK/isolated-$f.delta")"
      echo "      stacked: $(tr '\n' ' ' < "$WORK/stacked-$f.delta")"
    else
      fail "$f writes rows it does not own (§7.63) — its footprint changes when siblings are present:"
      echo "      alone:   $(tr '\n' ' ' < "$WORK/isolated-$f.delta")"
      echo "      stacked: $(tr '\n' ' ' < "$WORK/stacked-$f.delta")"
      echo "      If this is deliberate AND the teardown removes the extra rows, declare it"
      echo "      in the fixture:  -- roundtrip-exempt: cross-fixture-writes — <why>"
    fi
  else
    printf '  ✓ %-40s same footprint as alone\n' "$f"
  fi
done

echo
echo "── Unwinding the stack in reverse ──"
unwind
trap 'rm -rf "$WORK"' EXIT

snapshot > "$WORK/stack-final"
stack_leftover="$(delta "$STACK_BASE" "$WORK/stack-final")"
if [[ -n "$stack_leftover" ]]; then
  fail "the stacked teardowns did not restore the database — rows left behind:"
  echo "$stack_leftover" | sed 's/^/      /'
else
  echo "  ✓ database restored to its pre-run state"
fi

echo
if ((FAILURES == 0)); then
  echo "✓ all ${#FIXTURES[@]} fixtures load, own only their own rows, and tear down clean"
  exit 0
fi
echo "✗ $FAILURES failure(s)"
exit 1
