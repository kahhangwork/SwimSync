#!/usr/bin/env bash
# Fails if any driver builds a human-readable date label anywhere but lib.mjs's
# sgLabel() / sgMonthLabel().
#
# WHY THIS IS A CI GUARD AND NOT A NOTE. Postgres `to_char(d,'Mon')` and Node's
# en-US both render September "Sep"; the apps render en-SG, whose CLDR month is
# "Sept". The other eleven months agree, so a driver comparing a label built the
# wrong way passes review, passes every nightly for months, and goes red the
# first time its date reaches September. Written down three times (§7.121,
# §7.215, §7.225) and hit a fourth (§7.302: invoice-admin + orphan-report red on
# 2026-10-01, the first run whose "last month" was September). Five more drivers
# were passing only because "26 Sep" happens to be a substring of "26 Sept".
# The rule is mechanical, so a failing build holds it, not a sentence.
#
# Two shapes are refused (comment lines are ignored):
#   1. SQL:  to_char(…, '…Mon…' | '…Dy…' | '…Day…')  — a month or weekday NAME.
#            Read the ISO date instead (`session_date::text`, 'YYYY-MM-DD',
#            'YYYY-MM') and label it in Node. ISO to_char formats are fine.
#   2. Node: a toLocale{Date,Time,}String / Intl.DateTimeFormat call outside
#            lib.mjs — a second copy of the formatter, in whatever locale. en-CA
#            (which yields an ISO "YYYY-MM-DD") is fine. toDateString/toUTCString
#            are refused too: both print "Sep".
#
# KNOWN BLIND SPOT: rule 1 needs `to_char(` and its format string on ONE line. A
# to_char split across lines passes. Widening the match catches lowercase weekday
# ENUM literals ('monday') instead; keep to_char calls on one line.
#
# A line that is NOT a screen label (a weekday ENUM, an SGT clock turned into an
# ISO date) opts out with a trailing `// date-label-ok: <why>` — visible in
# review, so the exemption is argued once per line rather than silently granted.
#
# Run locally:  .claude/skills/run-ui-playwright/drivers/check-driver-dates.sh

set -euo pipefail
cd "$(dirname "$0")"

# Drops comment lines and opted-out lines from grep -n output.
keep() { grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)' | grep -v 'date-label-ok:' || true; }

sql_hits=$(grep -nE "to_char\(.*'[^']*(Mon|Dy|Day)[^']*'" -- *.mjs | keep)
node_hits=$(grep -nE "toLocale(Date|Time)?String\(|Intl\.DateTimeFormat\(|to(Date|UTC)String\(" -- *.mjs \
  | grep -v '^lib\.mjs:' | grep -v '"en-CA"' | keep)

if [[ -n "$sql_hits$node_hits" ]]; then
  [[ -n "$sql_hits" ]] && { echo "✗ driver(s) build a month/weekday label in SQL:"; echo "$sql_hits" | sed 's/^/    /'; }
  [[ -n "$node_hits" ]] && { echo "✗ driver(s) build a month/weekday label outside lib.mjs:"; echo "$node_hits" | sed 's/^/    /'; }
  cat <<'MSG'

Read the ISO date from the database and label it with lib.mjs — the app's own
formatter (en-SG, so September is "Sept", not "Sep"):
  import { sgLabel, sgMonthLabel } from "./lib.mjs";
  const label = sgLabel(sql(`SELECT session_date::text FROM …`));     // "Sat, 26 Sept"
  const dayMon = sgLabel(iso, { day: "numeric", month: "short" });     // "26 Sept"
  const month = sgMonthLabel("2026-09");                               // "Sept 2026"
MSG
  exit 1
fi

echo "✓ no driver builds a date label outside lib.mjs (sgLabel / sgMonthLabel)"
