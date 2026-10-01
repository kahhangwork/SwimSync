#!/usr/bin/env bash
# Fails if a pgTAP test or UI fixture holds a LITERAL date (or billing month) that
# the marking floor has not yet passed — a date that will expire.
#
# WHY THIS IS A CI GUARD AND NOT A NOTE. On 2026-10-01 main went red with no code
# change: three pgTAP files wrote '2026-08-…' through guarded paths, and the floor
# (markable_floor() ≤ session_window_start() = the 1st of LAST month, SGT) passed
# them that morning (§7.303). The lesson of §7.302 is that a trap which recurs
# after being written down is a missing guard. This is that guard. The real fix is
# an injected clock (BACKLOG → "Inject the database clock"); this narrows the risk
# until then. Plan: docs/plans/TEST_DATE_EXPIRY_ALARM_PLAN.md. GOTCHAS §7.305.
#
# THE RULE. Compute the floor exactly as the database does — the 1st of last month
# in Asia/Singapore. For every quoted literal date ('YYYY-MM-DD', also with a
# ' hh:mm…' or 'T…' timestamp tail) and month ('YYYY-MM', read as its 1st):
#   literal <  floor → ignored. Had it gone through the floor guard, the test would
#                      already be red; it passes, so it does not.
#   literal >= floor → FAIL, unless that same line carries
#                      `-- date-literal-ok: <non-empty reason>`.
# The floor only moves forward, so a literal only ever LEAVES the flagged zone:
# this fires on the push that adds one, never on its own mid-month.
#
# THE MARKER is per line, never per file or block, and an empty reason is a hit.
# Give the gate that makes it safe ("superuser insert; guard skips
# non-authenticated", "pure function"). It is a claim about ONE clock: the alarm
# models only the floor, not today_sg()/now() horizons ("has not happened yet",
# future-booking checks), so an annotation must come from reading every function
# on the path with pg_get_functiondef (§7.40), not from an experiment alone.
#
# BLIND SPOTS — it is a text scan:
#   - dates built by concatenation ('2026-' || '09') or make_date();
#   - dates in double quotes inside a single-quoted JSON string;
#   - a `--` inside a string literal hides the rest of that line (comments are
#     stripped from the first `--`);
#   - seed.sql, and SQL inside driver .mjs files (out of scope);
#   - Deno tests (they already inject the clock — BillingScenario, test-helpers.ts);
#   - today_sg()-relative horizons (above).
#
# Usage:
#   scripts/check-test-dates.sh               # CI: every pgTAP file + UI fixture
#   scripts/check-test-dates.sh FILE...       # just these files (proofs)
#   CHECK_TEST_DATES_FLOOR=2026-07-01 scripts/check-test-dates.sh FILE...
#       # pretend the floor is that date — local proofs only; refused under CI.
# Exit: 0 clean · 1 a literal will expire · 2 the check itself is broken.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The 1st of the month before YYYY-MM. 10# because "08"/"09" are invalid octal —
# without it bash errors in August and September only.
floor_of() {
  local y m
  y=$((10#${1%%-*})); m=$((10#${1#*-}))
  m=$((m - 1))
  if ((m == 0)); then m=12; y=$((y - 1)); fi
  printf '%04d-%02d-01' "$y" "$m"
}

# Self-test on every run: a guard that cannot do its own arithmetic is not one.
for pair in 2026-01:2025-12-01 2026-08:2026-07-01 2026-09:2026-08-01 \
            2026-10:2026-09-01 2027-01:2026-12-01; do
  got=$(floor_of "${pair%%:*}")
  if [[ "$got" != "${pair#*:}" ]]; then
    echo "✗ check-test-dates self-test: floor_of ${pair%%:*} gave $got, want ${pair#*:}" >&2
    exit 2
  fi
done

if [[ -n "${CHECK_TEST_DATES_FLOOR:-}" ]]; then
  if [[ -n "${CI:-}" ]]; then
    echo "✗ CHECK_TEST_DATES_FLOOR is set under CI — the override is for local proofs only" >&2
    exit 2
  fi
  if ! [[ "$CHECK_TEST_DATES_FLOOR" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "✗ CHECK_TEST_DATES_FLOOR must be YYYY-MM-DD, got '$CHECK_TEST_DATES_FLOOR'" >&2
    exit 2
  fi
  FLOOR="$CHECK_TEST_DATES_FLOOR"
  echo "FLOOR OVERRIDDEN → $FLOOR"
else
  # A missing zoneinfo makes TZ=Asia/Singapore silently mean UTC — a floor up to
  # a month wrong on the 1st. Refuse rather than guess.
  if [[ "$(TZ=Asia/Singapore date +%z)" != "+0800" ]]; then
    echo "✗ TZ=Asia/Singapore does not resolve to +0800 here — install tzdata" >&2
    exit 2
  fi
  FLOOR=$(floor_of "$(TZ=Asia/Singapore date +%Y-%m)")
fi

DEFAULT_SCAN=1
if (($# > 0)); then
  DEFAULT_SCAN=0
  FILES=("$@")
else
  FILES=("$ROOT"/supabase/tests/*.sql "$ROOT"/.claude/skills/run-ui-playwright/drivers/fixtures-*.sql)
fi

P=0; F=0; L=0; E=0; hits=""
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "✗ no such file: $f" >&2; exit 2; }
  case "$f" in
    *supabase/tests/*) P=$((P + 1)) ;;
    *) F=$((F + 1)) ;;
  esac
  # Lines carrying a marker WITH a reason.
  ok_lines=" $(grep -nE -- '-- date-literal-ok:[[:space:]]*[^[:space:]]' "$f" | cut -d: -f1 | tr '\n' ' ' || true) "
  # Comments stripped, line numbers kept; then every literal as "line:'YYYY-MM…".
  matches=$(sed 's/--.*$//' "$f" | grep -noE "'[0-9]{4}-[0-9]{2}(-[0-9]{2}['T ]|')" || true)
  [[ -z "$matches" ]] && continue
  while IFS= read -r m; do
    n=${m%%:*}; lit=${m#*:}; lit=${lit:1}; lit=${lit%?}   # drop the quote and the closing char
    case "$lit" in
      ????-??-??) d=$lit ;;
      *) d="${lit:0:7}-01" ;;   # 'YYYY-MM' → its 1st
    esac
    L=$((L + 1))
    [[ "$d" < "$FLOOR" ]] && continue
    case "$ok_lines" in
      *" $n "*) E=$((E + 1)) ;;
      *) hits+="    ${f#"$ROOT"/}:$n: ${lit}"$'\n' ;;
    esac
  done <<< "$matches"
done

echo "scanned $P pgTAP + $F fixture files, $L literals, $E exemptions, floor $FLOOR"

# A guard that scanned nothing passes vacuously — refuse that (a broken glob,
# path or regex on the CI runner must fail, not go green).
if ((DEFAULT_SCAN)) && { ((P < 80)) || ((F < 40)) || ((L == 0)); }; then
  echo "✗ scanned too little (need ≥80 pgTAP, ≥40 fixtures, >0 literals) — the check is broken" >&2
  exit 2
fi

if [[ -n "$hits" ]]; then
  echo "✗ literal date(s) the marking floor ($FLOOR) has not passed yet — each will expire:"
  printf '%s' "$hits"
  cat <<'MSG'

A literal date that passes through a guard stops working the day the floor (the
1st of last month, SGT) passes it (§7.303). Either:
  - DERIVE it from the floor — a `td` temp table built from session_window_start(),
    as in supabase/tests/trial_onboarding.test.sql (GRANT SELECT to authenticated
    when probes run as that role); or
  - if nothing on its path gates on a clock (read every function with
    pg_get_functiondef — superuser insert past a role-gated guard, pure function),
    end the line with:   -- date-literal-ok: <the gate that makes it safe>
MSG
  exit 1
fi

echo "✓ no test or fixture holds a literal date the floor has not passed"
