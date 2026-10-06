# shellcheck shell=bash
# THE ONE "is this pgTAP file clock-pinned?" predicate — sourced by G1
# (scripts/check-pgtap-clock.sh) and G4 (scripts/check-test-dates.sh).
#
# WHY ONE PREDICATE (Wave 7 plan, RISK 9). G4 skips a pinned file because a
# pinned file's literals cannot expire. If G4 had its own looser "is pinned"
# test (say, "mentions swimsync.now"), a file with the pin in a comment, or with
# `false` for is_local, or before BEGIN, would skip G4 AND be on the real clock —
# expiring with nothing watching. So G4 may skip a file only if it passes
# EVERYTHING G1 checks. Do not add a second test anywhere.
#
# THE FORM (RISK 4 — the form, not the presence):
#   BEGIN;
#   SELECT set_config('swimsync.now', 'YYYY-MM-DD hh:mm[:ss]+08', true);   ← first statement after BEGIN
#   CREATE EXTENSION IF NOT EXISTS pgtap;                                   ← optional, here only
#   SELECT plan(N);                                                         ← exactly one
#   SELECT is(app_today(), 'YYYY-MM-DD'::date, 'clock pinned');            ← the pin's own date
# plan() sits between the pin and the 'clock pinned' assertion because pgTAP
# refuses any test before plan() ("You tried to run a test without a plan!").
# The assertion is what makes a silently-ignored pin red: without it, a pin the
# database dropped would leave the file passing on the real clock.
#
# Every other set_config('swimsync.now', …) in the file must have the same
# shape (offset + is_local true) — re-pinning mid-file is allowed (edge days).
#
# NO RAW CLOCK outside a line marked `-- clock: stamp`: the tokens below, and
# session_window_start() arithmetic. A pinned test reads app_now()/app_today()
# or literals; a raw now() in it is a second clock (§7.302–§7.305).
#
# BLIND SPOTS — text scan, line based: the five header statements must each sit
# on one line; a `--` inside a string literal hides the rest of its line.

# Raw clock tokens, case-insensitive. Same list as G2 and the pgTAP clock census.
# `now()` and `current_time` carry word boundaries so app_now() and
# current_timestamp do not double-count.
PGTAP_RAW_CLOCK_RE="(^|[^a-z0-9_])now[[:space:]]*\([[:space:]]*\)|(^|[^a-z0-9_])current_date([^a-z0-9_]|$)|(^|[^a-z0-9_])current_timestamp([^a-z0-9_]|$)|(^|[^a-z0-9_])current_time([^a-z0-9_]|$)|(^|[^a-z0-9_])localtimestamp([^a-z0-9_]|$)|(^|[^a-z0-9_])clock_timestamp([^a-z0-9_]|$)|(^|[^a-z0-9_])statement_timestamp([^a-z0-9_]|$)|(^|[^a-z0-9_])transaction_timestamp([^a-z0-9_]|$)|'now'|'today'"
# session_window_start() with + or - on either side.
PGTAP_SWS_ARITH_RE="session_window_start[[:space:]]*\([[:space:]]*\)[[:space:]]*[-+]|[-+][[:space:]]*session_window_start[[:space:]]*\("
# What makes a file need the pin: any date literal, raw clock, or clock-reading helper.
PGTAP_NEEDS_PIN_RE="'[0-9]{4}-[0-9]{2}|today_sg|session_window_start|markable_floor|markable_window_start|app_today|app_now|${PGTAP_RAW_CLOCK_RE}"

PGTAP_PIN_RE="^SELECT set_config\('swimsync\.now', '([0-9]{4}-[0-9]{2}-[0-9]{2}) [0-9]{2}:[0-9]{2}(:[0-9]{2})?[+-][0-9]{2}(:?[0-9]{2})?', true\);$"
PGTAP_PLAN_RE="^SELECT (plan\([0-9]+\)|\* FROM no_plan\(\));$"

# 0 if the file opts out with a non-empty reason.
pgtap_clock_free() {
  grep -qE -- '^--[[:space:]]*clock-free:[[:space:]]*[^[:space:]]' "$1"
}

# 0 if the opt-out is present but its reason is empty (a G1 failure).
pgtap_clock_free_empty() {
  grep -qE -- '^--[[:space:]]*clock-free:[[:space:]]*$' "$1"
}

# 0 if the file touches a date or a clock (comments stripped).
pgtap_needs_pin() {
  # Not `sed | grep -q`: under pipefail, grep -q exiting early SIGPIPEs sed and
  # the pipeline reads as "no match" — two real hits were missed that way.
  grep -qiE -- "$PGTAP_NEEDS_PIN_RE" <(sed 's/--.*$//' "$1")
}

# Prints every violation of the pinned form as "LINE: reason" (LINE 0 = file).
# Prints nothing iff the file is pinned in the exact form.
pgtap_pin_errors() {
  local f=$1 begin sig n line date="" stage=pin nl pl
  begin=$(grep -m1 -nE '^BEGIN;[[:space:]]*$' "$f" | cut -d: -f1)
  if [[ -z "$begin" ]]; then
    echo "0: no 'BEGIN;' line"
    return 0
  fi
  # Significant lines after BEGIN: not blank, not comment-only. "N:text".
  sig=$(awk -v b="$begin" 'NR > b && $0 !~ /^[[:space:]]*(--.*)?$/ { sub(/[[:space:]]+$/, ""); print NR ":" $0; if (++k == 4) exit }' "$f")
  while IFS= read -r nl && [[ "$stage" != done ]]; do
    n=${nl%%:*}; line=${nl#*:}
    case "$stage" in
      pin)
        if [[ "$line" =~ $PGTAP_PIN_RE ]]; then
          date=${BASH_REMATCH[1]}; stage=ext
        else
          echo "$n: first statement after BEGIN is not the pin — want: SELECT set_config('swimsync.now', 'YYYY-MM-DD hh:mm+08', true);"
          stage=done
        fi ;;
      ext)
        if [[ "$line" == "CREATE EXTENSION IF NOT EXISTS pgtap;" ]]; then
          stage=plan
        elif [[ "$line" =~ $PGTAP_PLAN_RE ]]; then
          stage=assert
        else
          echo "$n: after the pin, want 'SELECT plan(N);' (optionally after CREATE EXTENSION IF NOT EXISTS pgtap;)"
          stage=done
        fi ;;
      plan)
        if [[ "$line" =~ $PGTAP_PLAN_RE ]]; then
          stage=assert
        else
          echo "$n: want 'SELECT plan(N);' here"
          stage=done
        fi ;;
      assert)
        pl="SELECT is(app_today(), '$date'::date, 'clock pinned');"
        if [[ "$line" != "$pl" ]]; then
          echo "$n: want exactly: $pl"
        fi
        stage=done ;;
    esac
  done <<< "$sig"
  [[ "$stage" == done ]] || echo "0: file ends before the pin header is complete"

  # Every swimsync.now pin anywhere (outside comments) has the exact shape.
  grep -nE "set_config[[:space:]]*\([[:space:]]*'swimsync\.now'" "$f" | while IFS= read -r nl; do
    n=${nl%%:*}; line=${nl#*:}
    line=$(sed -E 's/[[:space:]]+$//; s/^[[:space:]]+//' <<< "$line")
    [[ "$line" =~ ^-- ]] && continue
    [[ "$line" =~ $PGTAP_PIN_RE ]] || echo "$n: swimsync.now pin not in the exact form (offset, is_local true, one line)"
  done || true

  # No raw clock outside `-- clock: stamp` lines.
  grep -vnE -- '-- clock: stamp' "$f" | sed -E 's/--.*$//' \
    | grep -iE -- "^[0-9]+:.*(${PGTAP_RAW_CLOCK_RE}|${PGTAP_SWS_ARITH_RE})" \
    | while IFS= read -r nl; do
        echo "${nl%%:*}: raw clock — read app_now()/app_today() or a literal, or mark the line '-- clock: stamp'"
      done || true
  return 0
}

# 0 iff the file passes G1's full form. THE predicate G4 uses to skip.
pgtap_pinned() {
  [[ -z "$(pgtap_pin_errors "$1")" ]]
}
