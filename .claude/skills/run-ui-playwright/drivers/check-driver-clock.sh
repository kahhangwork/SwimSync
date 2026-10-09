#!/usr/bin/env bash
# Fails if a UI driver or fixture reads "now" any way but through the pinnable
# clock — lib.mjs's nowSg()/todaySg() and the DB's app_now()/app_today().
# (docs/plans/PIN_DRIVER_CLOCK_PLAN.md, "CI guards" 2 and "Future drivers".)
#
# WHY THIS IS A CI GUARD AND NOT A NOTE. `run-all-drivers.sh --now <ts>` replays a
# past moment across the browser, PostgREST, the drivers' SQL, the fixtures and
# the engine. ONE stray `new Date()` or `now()` puts that driver back on the real
# clock while the rest is pinned — a world that never existed, and a PASS that
# means nothing. The rule is mechanical, so a failing build holds it.
#
# THE RULES (comment lines ignored; exit 1 on any):
#   M  every verify-*.mjs carries, in its first 40 lines, EXACTLY one of
#        // clock: pinnable      reads now only through lib.mjs
#        // clock: own-literal   pins its own literal world, ignores DRIVER_NOW
#      — matched exactly, so a typo is "no marker". Until the sweep finishes, a
#      driver on UNSWEPT may be unmarked; nothing else may.
#   O  own-literal is a CLOSED list of three (OWN_LITERAL). A fourth is red until
#      this file is edited — which shows in review.
#   P  in a pinnable driver (and _TEMPLATE.mjs):
#        P1 no `new Date()` with no arguments      → nowSg()
#        P2 no `Date.now()`                        → nowSg().getTime()
#        P3 no `clock.install` / `setFixedTime` / `setSystemTime` → lib.mjs pins the browser
#        P4 no raw SQL clock (now(), CURRENT_DATE, 'today', … — G2's list) → app_now()/app_today()
#   L  in EVERY marked driver: no `chromium.launch(` and no `playwright` import —
#      every browser is launch()'s wrapped one, so every context on it is pinned.
#   F  in every fixtures-*.sql (teardowns too) and _TEMPLATE-fixture.sql: no raw
#      SQL clock token (P4's list). Until the sweep finishes, UNSWEPT_FIXTURES may.
#   U  the UNSWEPT ratchets: a listed file that is now converted (or gone) must be
#      removed from its list, and each list's length must equal its constant —
#      lower the constant as you sweep; raising it is the edit review must refuse.
#   R  prod reach — the local-only API pin can never ship:
#        R1 in supabase/migrations, supabase/seed.sql, scripts/: only
#           <ts>_api_clock_pin.sql (at most one) and scripts/clock-unpin.sh name
#           clock_api_pin_enabled;
#        R2 nothing there INSERTs into it;
#        R3 nothing there writes a database/role/system-level swimsync.now
#           (clock-unpin.sh may only RESET it), nothing GRANTs ON PARAMETER, and no
#           migration or seed.sql calls set_config('swimsync.now', …).
#
# The per-line opt-out is `// clock-real: <why>` (driver) / `-- clock-real: <why>`
# (fixture) — e.g. elapsed timing, or a REAL-TIME window (§6af) — argued once per
# line, in review.
#
# BLIND SPOTS — a text scan: a clock read split across lines; a `--` inside a SQL
# string hides the rest of its line; a clock built at run time (eval, a helper in
# another file — only lib.mjs is trusted, and lib.mjs is not scanned).
#
# Run locally:  .claude/skills/run-ui-playwright/drivers/check-driver-clock.sh
# Exit: 0 clean · 1 a rule is broken · 2 the check itself is broken.
# Bash, run with bash (§7.340); no `cmd | grep -q` under pipefail (§7.339).

set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../../../.. && pwd)"

OWN_LITERAL=(verify-edit-child.mjs verify-student-identity.mjs verify-tz-saturday.mjs)

# ⚠ THE SWEEP RATCHETS. Remove a file the commit that converts it; lower the
# constant with it. Both lists — and both constants — are deleted at the close of
# the sweep, after which an unmarked driver or a raw-clock fixture is simply red.
UNSWEPT_MAX=60
UNSWEPT=(
  verify-app-auth.mjs
  verify-app-coach-settings.mjs
  verify-app-home-writes.mjs
  verify-app-money.mjs
  verify-assessment.mjs
  verify-bulk-setall.mjs
  verify-cancel-lesson.mjs
  verify-class-admin.mjs
  verify-class-deactivation.mjs
  verify-class-edit.mjs
  verify-class-students.mjs
  verify-class-terms.mjs
  verify-coach-disable.mjs
  verify-coach-marking.mjs
  verify-coach-remove-student.mjs
  verify-coach-roster.mjs
  verify-coach-schedule-roles.mjs
  verify-coach-wages.mjs
  verify-contact-details.mjs
  verify-edit-child.mjs
  verify-enrolment-start.mjs
  verify-front-desk-role.mjs
  verify-grading-admin.mjs
  verify-invoice-admin.mjs
  verify-invoice-controls.mjs
  verify-join-code.mjs
  verify-lesson-detail-guests.mjs
  verify-level-skills.mjs
  verify-levels-table.mjs
  verify-levels.mjs
  verify-locations.mjs
  verify-money-admin.mjs
  verify-multi-class.mjs
  verify-orphan-report.mjs
  verify-package-draw-at-marking.mjs
  verify-package-renewal.mjs
  verify-packages-admin.mjs
  verify-packages.mjs
  verify-parent-address.mjs
  verify-parent-attendance.mjs
  verify-parent-claim.mjs
  verify-parent-pay-claim.mjs
  verify-payment-collection.mjs
  verify-paynow-fallback.mjs
  verify-platform-admin-scope.mjs
  verify-platform-admin.mjs
  verify-platform-controls.mjs
  verify-referrals.mjs
  verify-roles.mjs
  verify-smoke-admin.mjs
  verify-smoke-app.mjs
  verify-stale-screen.mjs
  verify-student-identity.mjs
  verify-tenant-admin.mjs
  verify-tenant-branding.mjs
  verify-tenant-provisioning.mjs
  verify-tenant-suspension.mjs
  verify-trial-visibility.mjs
  verify-trials.mjs
  verify-tz-saturday.mjs
)
UNSWEPT_FIXTURES_MAX=33
UNSWEPT_FIXTURES=(
  fixtures-app-auth.sql
  fixtures-app-home-writes.sql
  fixtures-app-money.sql
  fixtures-assessment.sql
  fixtures-class-admin.sql
  fixtures-class-deactivation.sql
  fixtures-class-students.sql
  fixtures-coach-disable.sql
  fixtures-coach-marking.sql
  fixtures-coach-remove-student.sql
  fixtures-coach-roster.sql
  fixtures-coach-schedule-roles.sql
  fixtures-contact-details.sql
  fixtures-enrolment-start.sql
  fixtures-front-desk-role.sql
  fixtures-grading-admin.sql
  fixtures-invoice-admin.sql
  fixtures-lesson-detail-guests.sql
  fixtures-money-admin.sql
  fixtures-multi-class.sql
  fixtures-orphan-report.sql
  fixtures-package-draw-at-marking.sql
  fixtures-packages-admin.sql
  fixtures-packages.sql
  fixtures-parent-claim.sql
  fixtures-payment-collection.sql
  fixtures-paynow-fallback.sql
  fixtures-phase4-billing.sql
  fixtures-platform-controls.sql
  fixtures-roles.sql
  fixtures-student-identity.sql
  fixtures-tenant-suspension.sql
  fixtures-trial-visibility.sql
)

# The rules' patterns. SQL_RE is G2's token list (scripts/check-migration-clock.sh)
# and the pgTAP census's; app_now()/app_today() never match.
SQL_RE="(^|[^a-z0-9_])now[[:space:]]*\([[:space:]]*\)|(^|[^a-z0-9_])current_date([^a-z0-9_]|$)|(^|[^a-z0-9_])current_timestamp([^a-z0-9_]|$)|(^|[^a-z0-9_])current_time([^a-z0-9_]|$)|(^|[^a-z0-9_])localtimestamp([^a-z0-9_]|$)|(^|[^a-z0-9_])clock_timestamp([^a-z0-9_]|$)|(^|[^a-z0-9_])statement_timestamp([^a-z0-9_]|$)|(^|[^a-z0-9_])transaction_timestamp([^a-z0-9_]|$)|'now'|'today'"
P1_RE='new[[:space:]]+Date[[:space:]]*\([[:space:]]*\)'
P2_RE='Date\.now[[:space:]]*\('
P3_RE='clock\.install|setFixedTime|setSystemTime'
L_RE="chromium\.launch[[:space:]]*\(|(from|import|require)[[:space:]]*\(?[[:space:]]*[\"']playwright"
MARK_RE='^// clock: (pinnable|own-literal)$'
OPT_MJS='// clock-real:[[:space:]]*[^[:space:]]'
OPT_SQL='-- clock-real:[[:space:]]*[^[:space:]]'
API_TABLE='clock_api_pin_enabled'
R2_RE="insert[[:space:]]+into[[:space:]]+(\"?private\"?[[:space:]]*\.[[:space:]]*)?\"?$API_TABLE"
R3_ALTER_RE='alter[[:space:]]+(database|role|user|system)[^;]*swimsync\.now'
R3_GRANT_RE='on[[:space:]]+parameter[^;]*swimsync\.now'
R3_SETCFG_RE="set_config[[:space:]]*\([[:space:]]*'swimsync\.now'"

# ── Self-test on every run: a guard that cannot see its own tokens is not one. ──
st() { # st <hit|miss> <ERE> <flags: -E|-iE> <probe>
  local want=$1 re=$2 fl=$3 probe=$4 got=miss
  if grep -q $fl -- "$re" <<< "$probe"; then got=hit; fi
  [[ $got == "$want" ]] || { echo "✗ check-driver-clock self-test: want $want, got $got — /$re/ on: $probe" >&2; exit 2; }
}
for p in "now()" "NOW ( )" "current_date" "Current_Timestamp" "CURRENT_TIME" "localtimestamp" \
         "clock_timestamp()" "statement_timestamp()" "transaction_timestamp()" "'now'" "'TODAY'"; do
  st hit "$SQL_RE" -iE "x := $p;"
done
for p in "app_now()" "app_today()" "snow()" "current_dates" "updated_at" "nowSg()"; do st miss "$SQL_RE" -iE "x := $p;"; done
st hit "$P1_RE" -E "const d = new Date();";      st hit "$P1_RE" -E "x(new Date( ))"
st miss "$P1_RE" -E "new Date(PIN_MS)";          st miss "$P1_RE" -E 'new Date(`${iso}T00:00:00Z`)'
st hit "$P2_RE" -E "const t = Date.now();";      st miss "$P2_RE" -E "nowSg().getTime()"
st hit "$P3_RE" -E "await ctx.clock.install({ time });"
st hit "$P3_RE" -E "await c.clock.setFixedTime(1)"; st hit "$P3_RE" -E "await c.clock.setSystemTime(1)"
st miss "$P3_RE" -E "await pinBrowser(ctx)"
st hit "$L_RE" -E "const b = await chromium.launch({ headless });"
st hit "$L_RE" -E 'import { chromium } from "playwright-core";'
st hit "$L_RE" -E "const pw = require('playwright');"; st hit "$L_RE" -E 'await import("playwright")'
st miss "$L_RE" -E 'import { launch } from "./lib.mjs";'
st hit "$MARK_RE" -E "// clock: pinnable";       st hit "$MARK_RE" -E "// clock: own-literal"
for p in "// clock: pinable" "// clock: pinnable " "//clock: pinnable" " // clock: pinnable" "// Clock: pinnable"; do
  st miss "$MARK_RE" -E "$p"
done
st hit "$OPT_MJS" -E "x(new Date()); // clock-real: elapsed timing"; st miss "$OPT_MJS" -E "x; // clock-real:"
st hit "$R2_RE" -iE "INSERT INTO private.clock_api_pin_enabled VALUES (true);"
st hit "$R2_RE" -iE 'insert  into "private"."clock_api_pin_enabled" values (true)'
st miss "$R2_RE" -iE "DELETE FROM private.clock_api_pin_enabled;"
st hit "$R3_ALTER_RE" -iE "ALTER DATABASE postgres SET swimsync.now = '2026-01-01T00:00:00Z';"
st hit "$R3_ALTER_RE" -iE "alter role authenticator set swimsync.now to 'x'"
st hit "$R3_GRANT_RE" -iE "GRANT SET ON PARAMETER swimsync.now TO postgres;"
st hit "$R3_SETCFG_RE" -iE "SELECT set_config('swimsync.now', '2026-09-15 10:00+08', true);"

# ── helpers ──
in_list() { local x=$1; shift; local e; for e in "$@"; do [[ $e == "$x" ]] && return 0; done; return 1; }
FAIL=""
flag() { FAIL+="    [$1] $2"$'\n'; }
# Numbered non-comment lines of a .mjs matching ERE $2 (-E) and not opted out.
mjs_hits() {
  grep -n '' -- "$1" | grep -E -- "^[0-9]+:.*($2)" \
    | grep -vE '^[0-9]+:[[:space:]]*(//|\*|/\*)' | grep -vE -- "$OPT_MJS" || true
}
# Same, for raw SQL clock tokens (case-insensitive; Date.now() is P2's, not P4's).
mjs_sql_hits() {
  grep -n '' -- "$1" | sed -E 's/Date\.now[[:space:]]*\([[:space:]]*\)//g' | grep -iE -- "^[0-9]+:.*($SQL_RE)" \
    | grep -vE '^[0-9]+:[[:space:]]*(//|\*|/\*)' | grep -vE -- "$OPT_MJS" || true
}
# Numbered raw-clock lines of a .sql, -- comments stripped, opted-out lines dropped.
sql_hits() {
  grep -vnE -- "$OPT_SQL" "$1" | sed -E 's/--.*$//' | grep -iE -- "^[0-9]+:.*($SQL_RE)" || true
}
report() { # report <rule> <file> <hits>
  local l
  while IFS= read -r l; do
    if [[ -n $l ]]; then flag "$1" "$2:${l%%:*}: $(sed -E 's/^[0-9]+:[[:space:]]*//' <<< "$l" | cut -c1-100)"; fi
  done <<< "$3"
}
check_pinnable_rules() { # P1–P4 on one file
  report P1 "$1" "$(mjs_hits "$1" "$P1_RE")"
  report P2 "$1" "$(mjs_hits "$1" "$P2_RE")"
  report P3 "$1" "$(mjs_hits "$1" "$P3_RE")"
  report P4 "$1" "$(mjs_sql_hits "$1")"
}
marker_of() { # prints pinnable | own-literal | none | many
  local m n
  m=$(head -n 40 -- "$1" | grep -E -- "$MARK_RE" || true)
  n=$(grep -c . <<< "$m" || true)
  if ((n == 0)); then echo none; elif ((n > 1)); then echo many; else echo "${m#// clock: }"; fi
}

# ── canary: a scanner that sees too little is broken, not green (§7.283) ──
shopt -s nullglob
DRIVERS=(verify-*.mjs)
FIXTURES=(fixtures-*.sql)
shopt -u nullglob
((${#DRIVERS[@]} >= 73)) || { echo "✗ scanned ${#DRIVERS[@]} drivers (need ≥73) — the check is broken" >&2; exit 2; }
((${#FIXTURES[@]} > 0)) || { echo "✗ scanned 0 fixtures — the check is broken" >&2; exit 2; }
for t in _TEMPLATE.mjs _TEMPLATE-fixture.sql; do
  [[ -f $t ]] || { echo "✗ $t is missing — the template a new driver copies must exist" >&2; exit 2; }
done

# ── U: the ratchets ──
((${#UNSWEPT[@]} == UNSWEPT_MAX)) \
  || flag U "UNSWEPT holds ${#UNSWEPT[@]} drivers but UNSWEPT_MAX=$UNSWEPT_MAX — lower the constant with the list; never raise it"
((${#UNSWEPT_FIXTURES[@]} == UNSWEPT_FIXTURES_MAX)) \
  || flag U "UNSWEPT_FIXTURES holds ${#UNSWEPT_FIXTURES[@]} but UNSWEPT_FIXTURES_MAX=$UNSWEPT_FIXTURES_MAX — lower the constant with the list; never raise it"
for u in "${UNSWEPT[@]}"; do [[ -f $u ]] || flag U "UNSWEPT names $u, which does not exist — remove it"; done
for u in "${UNSWEPT_FIXTURES[@]}"; do [[ -f $u ]] || flag U "UNSWEPT_FIXTURES names $u, which does not exist — remove it"; done

# ── M, O, P, L: the drivers ──
NP=0; NO=0; NU=0
for f in "${DRIVERS[@]}"; do
  m=$(marker_of "$f")
  if in_list "$f" "${UNSWEPT[@]}"; then
    if [[ $m == none ]]; then NU=$((NU + 1)); continue; fi
    flag U "$f is marked but still on UNSWEPT — remove it from the list (and lower UNSWEPT_MAX)"
  fi
  case $m in
    none) flag M "$f has no clock marker — add '// clock: pinnable' in its first 40 lines (see _TEMPLATE.mjs)"; continue ;;
    many) flag M "$f has more than one clock marker"; continue ;;
    own-literal)
      NO=$((NO + 1))
      in_list "$f" "${OWN_LITERAL[@]}" \
        || flag O "$f is 'own-literal', a closed list of ${#OWN_LITERAL[@]} (${OWN_LITERAL[*]}) — make it pinnable" ;;
    pinnable)
      NP=$((NP + 1))
      check_pinnable_rules "$f" ;;
  esac
  report L "$f" "$(mjs_hits "$f" "$L_RE")"
done

# The template a future author copies must itself pass every driver rule.
[[ $(marker_of _TEMPLATE.mjs) == pinnable ]] || flag M "_TEMPLATE.mjs must carry exactly '// clock: pinnable'"
check_pinnable_rules _TEMPLATE.mjs
report L _TEMPLATE.mjs "$(mjs_hits _TEMPLATE.mjs "$L_RE")"

# ── F: the fixtures (teardowns too) ──
NFU=0
for f in "${FIXTURES[@]}" _TEMPLATE-fixture.sql; do
  h=$(sql_hits "$f")
  if in_list "$f" "${UNSWEPT_FIXTURES[@]}"; then
    if [[ -n $h ]]; then NFU=$((NFU + 1)); continue; fi
    flag U "$f reads no raw clock any more but is still on UNSWEPT_FIXTURES — remove it (and lower UNSWEPT_FIXTURES_MAX)"
    continue
  fi
  report F "$f" "$h"
done

# ── R: prod reach — the local-only API pin can never ship ──
# Code lines only: .sql loses `--` comments, everything else loses `#` comment lines.
code_lines() {
  if [[ $1 == *.sql ]]; then grep -n '' -- "$1" | sed -E 's/--.*$//' || true
  else grep -n '' -- "$1" | grep -vE '^[0-9]+:[[:space:]]*#' || true; fi
}
REACH=("$ROOT"/supabase/migrations/*.sql "$ROOT"/supabase/seed.sql)
while IFS= read -r f; do REACH+=("$f"); done < <(find "$ROOT/scripts" -type f | sort)
((${#REACH[@]} >= 100)) || { echo "✗ prod-reach scan saw ${#REACH[@]} files (need ≥100) — the check is broken" >&2; exit 2; }
NMIG=0
for f in "${REACH[@]}"; do
  rel=${f#"$ROOT"/}
  # Every R pattern names the table or swimsync.now — one grep skips the other ~190 files.
  grep -qiE -- "$API_TABLE|swimsync\.now" "$f" || continue
  if grep -q -- "$API_TABLE" "$f"; then
    if [[ $rel =~ ^supabase/migrations/[0-9]{14}_api_clock_pin\.sql$ ]]; then NMIG=$((NMIG + 1))
    elif [[ $rel != scripts/clock-unpin.sh ]]; then
      flag R1 "$rel names $API_TABLE — only the api_clock_pin migration and scripts/clock-unpin.sh may"
    fi
  fi
  c=$(code_lines "$f")
  report R2 "$rel" "$(grep -iE -- "^[0-9]+:.*$R2_RE" <<< "$c" || true)"
  report R3 "$rel" "$(grep -iE -- "^[0-9]+:.*$R3_GRANT_RE" <<< "$c" || true)"
  a=$(grep -iE -- "^[0-9]+:.*$R3_ALTER_RE" <<< "$c" || true)
  [[ $rel == scripts/clock-unpin.sh ]] && a=$(grep -viE -- 'reset[[:space:]]+swimsync\.now' <<< "$a" || true)
  report R3 "$rel" "$a"
  [[ $rel == scripts/* ]] || report R3 "$rel" "$(grep -iE -- "^[0-9]+:.*$R3_SETCFG_RE" <<< "$c" || true)"
done
((NMIG <= 1)) || flag R1 "$NMIG migrations named *_api_clock_pin.sql name $API_TABLE — there is exactly one"

echo "scanned ${#DRIVERS[@]} drivers ($NP pinnable, $NO own-literal, $NU unswept), ${#FIXTURES[@]} fixtures ($NFU unswept), ${#REACH[@]} prod-reach files"

if [[ -n $FAIL ]]; then
  echo "✗ a UI driver or fixture reads the clock outside the pinnable path:"
  printf '%s' "$FAIL"
  cat <<'MSG'

A driver reads "now" only through lib.mjs, so `run-all-drivers.sh --now` can pin it:
  // clock: pinnable
  import { launch, nowSg, todaySg, addDaysIso, sql } from "./lib.mjs";
  const today = todaySg();                                   // not new Date()
  const n = sql("SELECT count(*) FROM … WHERE d >= app_today()");  // not now() / CURRENT_DATE
A fixture derives every date from app_now() / app_today().
Copy drivers/_TEMPLATE.mjs. A line that must read the REAL clock (elapsed timing, a
REAL-TIME window) ends with  // clock-real: <why>  /  -- clock-real: <why>
MSG
  exit 1
fi

echo "✓ every UI driver and fixture reads the clock through the pinnable path (lib.mjs / app_now)"
