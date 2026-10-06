#!/usr/bin/env bash
# G1 — every pgTAP file that touches a date or a clock PINS the clock, in the
# exact form. Wave 7 (docs/plans/WAVE7_DB_CLOCK_PLAN.md, "CI guards").
#
# WHY. On 2026-10-01 main went red with no code change: tests had two clocks,
# their own literal dates and the database's now() (§7.302–§7.305). Wave 7 adds
# app_now()/app_today(), which a transaction can pin with
#   SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
# A pinned test can never expire. This guard makes every NEW pgTAP file pin too.
#
# THE RULE. A supabase/tests/*.test.sql file that mentions a date literal, a raw
# clock (now(), CURRENT_DATE, …) or a clock helper (today_sg, session_window_start,
# markable_floor, markable_window_start, app_today, app_now) must pass
# pgtap_pin_errors (scripts/lib/pgtap-pin.sh — the form is documented there, and
# G4 uses the SAME predicate to skip pinned files; never fork it).
#
# OPT-OUT, per file: a line `-- clock-free: <non-empty reason>`, for a file that
# tests the clock itself (app_clock.test.sql) or reads no date at all. An empty
# reason is a failure.
#
# Usage:
#   scripts/check-pgtap-clock.sh            # CI: every supabase/tests/*.test.sql
#   scripts/check-pgtap-clock.sh FILE...    # just these (proofs)
#   G1_LIST=1 scripts/check-pgtap-clock.sh  # also print the hit list (files that need the pin)
#   G1_VERBOSE=1 …                          # every violation, not just the first per file
# Exit: 0 clean · 1 a file is unpinned or mis-pinned · 2 the check itself is broken.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/pgtap-pin.sh
source "$ROOT/scripts/lib/pgtap-pin.sh"

DEFAULT_SCAN=1
if (($# > 0)); then
  DEFAULT_SCAN=0
  FILES=("$@")
else
  FILES=("$ROOT"/supabase/tests/*.test.sql)
fi

T=0; HIT=0; OK=0; FREE=0; NONE=0; bad=""; list=""
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "✗ no such file: $f" >&2; exit 2; }
  T=$((T + 1))
  rel=${f#"$ROOT"/}
  if pgtap_clock_free_empty "$f"; then
    bad+="    $rel:0: '-- clock-free:' with no reason"$'\n'
    continue
  fi
  if pgtap_clock_free "$f"; then FREE=$((FREE + 1)); continue; fi
  if ! pgtap_needs_pin "$f"; then NONE=$((NONE + 1)); continue; fi
  HIT=$((HIT + 1)); list+="    $rel"$'\n'
  errs=$(pgtap_pin_errors "$f")
  if [[ -z "$errs" ]]; then OK=$((OK + 1)); continue; fi
  [[ -n "${G1_VERBOSE:-}" ]] || errs=$(head -1 <<< "$errs")
  while IFS= read -r e; do bad+="    $rel:$e"$'\n'; done <<< "$errs"
done

echo "scanned $T pgTAP files: $HIT need the pin ($OK pinned), $FREE clock-free, $NONE date-free"
[[ -n "${G1_LIST:-}" ]] && printf 'hit list:\n%s' "$list"

# A guard that scanned nothing passes vacuously — refuse that.
if ((DEFAULT_SCAN)) && { ((T < 80)) || ((HIT == 0)); }; then
  echo "✗ scanned too little (need ≥80 pgTAP files and >0 hits) — the check is broken" >&2
  exit 2
fi

if [[ -n "$bad" ]]; then
  echo "✗ pgTAP file(s) on the real clock, or pinned in the wrong form:"
  printf '%s' "$bad"
  cat <<'MSG'

Pin the clock, exactly this way (scripts/lib/pgtap-pin.sh has the full form):
  BEGIN;
  SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);
  CREATE EXTENSION IF NOT EXISTS pgtap;
  SELECT plan(N);
  SELECT is(app_today(), '2026-09-15'::date, 'clock pinned');
then read app_now()/app_today() or literals — no raw now()/CURRENT_DATE — unless
the line is a pure audit stamp marked `-- clock: stamp`. A file that tests the
clock itself opts out with a line `-- clock-free: <reason>`.
MSG
  exit 1
fi

echo "✓ every pgTAP file that touches a date pins the clock"
