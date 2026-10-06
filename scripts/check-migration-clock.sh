#!/usr/bin/env bash
# G2 — a NEW migration may not read a raw clock. Wave 7
# (docs/plans/WAVE7_DB_CLOCK_PLAN.md, "CI guards", RISK 6).
#
# WHY. Wave 7 moved every date DECISION in the database onto app_now()/app_today(),
# which a pgTAP transaction can pin. A function written later with a raw now()
# is on the real clock again, and its tests expire again (§7.302–§7.305). This
# is the early warning; the frozen clock census in supabase/tests/app_clock.test.sql
# is the backstop that no route can bypass.
#
# THE RULE. In supabase/migrations/<ts>_*.sql with <ts> NEWER than CUTOFF, no
# line may contain a raw clock token (case-insensitive, comments stripped):
#   now()  CURRENT_DATE  CURRENT_TIMESTAMP  CURRENT_TIME  LOCALTIMESTAMP
#   clock_timestamp  statement_timestamp  transaction_timestamp  'now'  'today'
# — the same list as the pgTAP clock census. app_now()/app_today() never match.
# A line may keep a raw clock if it says why:
#   `-- clock: stamp`         a pure audit stamp, never read back to decide a date
#   `-- clock-real: <why>`    a security/delivery window (invitation expiry, email claim)
#
# BLIND SPOTS — a text scan: a `--` inside a string hides the rest of its line;
# /* block comments */ are scanned as code; a clock built by EXECUTE format().
#
# Usage:
#   scripts/check-migration-clock.sh           # CI: every migration newer than CUTOFF
#   scripts/check-migration-clock.sh FILE...   # just these (CUTOFF still applies by name)
# Exit: 0 clean · 1 a raw clock in a new migration · 2 the check itself is broken.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ⚠ THE ONE CONSTANT. Migrations with a timestamp > CUTOFF are checked.
# Set to M1 (20261006000300_app_clock), which holds raw now() by design.
# lane1 bumps it to M4's timestamp at T5, when G2 goes required: M2–M4 re-body
# functions mechanically and keep their audit-stamp now() calls verbatim.
CUTOFF=20261006000300

TOKENS_RE="(^|[^a-z0-9_])now[[:space:]]*\([[:space:]]*\)|(^|[^a-z0-9_])current_date([^a-z0-9_]|$)|(^|[^a-z0-9_])current_timestamp([^a-z0-9_]|$)|(^|[^a-z0-9_])current_time([^a-z0-9_]|$)|(^|[^a-z0-9_])localtimestamp([^a-z0-9_]|$)|(^|[^a-z0-9_])clock_timestamp([^a-z0-9_]|$)|(^|[^a-z0-9_])statement_timestamp([^a-z0-9_]|$)|(^|[^a-z0-9_])transaction_timestamp([^a-z0-9_]|$)|'now'|'today'"
MARK_RE='-- clock: stamp|-- clock-real:[[:space:]]*[^[:space:]]'

# Self-test on every run: a guard that cannot see its own tokens is not one.
for probe in "now()" "NOW ( )" "current_date" "Current_Timestamp" "CURRENT_TIME" "localtimestamp" \
             "clock_timestamp()" "statement_timestamp()" "transaction_timestamp()" "'now'" "'TODAY'"; do
  grep -qiE -- "$TOKENS_RE" <<< "x := $probe;" \
    || { echo "✗ check-migration-clock self-test: missed '$probe'" >&2; exit 2; }
done
for probe in "app_now()" "app_today()" "snow()" "current_dates" "updated_at"; do
  if grep -qiE -- "$TOKENS_RE" <<< "x := $probe;"; then
    echo "✗ check-migration-clock self-test: false hit on '$probe'" >&2; exit 2
  fi
done

DEFAULT_SCAN=1
if (($# > 0)); then
  DEFAULT_SCAN=0
  FILES=("$@")
else
  FILES=("$ROOT"/supabase/migrations/*.sql)
fi

T=0; N=0; hits=""
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "✗ no such file: $f" >&2; exit 2; }
  T=$((T + 1))
  ts=$(basename "$f"); ts=${ts%%_*}
  [[ "$ts" =~ ^[0-9]{14}$ ]] || { echo "✗ migration name has no 14-digit timestamp: $f" >&2; exit 2; }
  ((10#$ts > 10#$CUTOFF)) || continue
  N=$((N + 1))
  while IFS= read -r m; do
    hits+="    ${f#"$ROOT"/}:${m%%:*}: $(sed -E 's/^[0-9]+://; s/^[[:space:]]+//' <<< "$m" | cut -c1-100)"$'\n'
  done < <(grep -vnE -- "$MARK_RE" "$f" | sed -E 's/--.*$//' | grep -iE -- "^[0-9]+:.*($TOKENS_RE)" || true)
done

echo "scanned $T migrations, $N newer than $CUTOFF"

if ((DEFAULT_SCAN)) && ((T < 100)); then
  echo "✗ scanned too little (need ≥100 migrations) — the check is broken" >&2
  exit 2
fi

if [[ -n "$hits" ]]; then
  echo "✗ raw clock read(s) in a migration newer than $CUTOFF:"
  printf '%s' "$hits"
  cat <<'MSG'

A date DECISION reads app_now() / app_today() (Wave 7), so pgTAP can pin it.
If the line is a pure audit stamp, end it with      -- clock: stamp
If it is a security/delivery window (real time),    -- clock-real: <why>
MSG
  exit 1
fi

echo "✓ no new migration reads a raw clock"
