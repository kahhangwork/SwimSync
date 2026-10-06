#!/usr/bin/env bash
# G3-apps — neither app takes the UTC date of a timestamp. §7.7, extended from
# G3 (scripts/check-functions-sg-date.sh, edge functions only) to SwimSyncApp/
# and SwimSyncAdmin/ (BACKLOG "Extend G3 to the apps").
#
# WHY. PostgREST returns every timestamptz in UTC, so `issued_at.slice(0, 10)` /
# `.split("T")[0]` is the UTC date — a day behind SGT before 08:00. It shipped in
# three app screens at once (§8.141, Wave 8 Bug ledger #3–#5: Credit Notes + CSV
# 7e0469e, admin Claims 8530b86, the parent's "Waiting since" dc99646), and a
# `+08:00` test fixture hides it (§7.25).
#
# THE RULE. In every git-tracked .ts/.tsx/.js/.jsx/.mjs/.cjs under the two apps
# (not tests, not mocks, not e2e), no code may `slice(0, 10)`, `substring(0, 10)`
# or `substr(0, 10)`, or `split("T")` at all (any spacing, any quote). Matching
# is on ANY receiver, not just `*_at` names — dc99646's bug read `createdAtIso`,
# which a suffix match misses. Comments are stripped first, by a lexer that
# knows strings, template literals (`${…}` is code) and regex literals (§7.230).
#
# ALLOWED, per line only:  // sg-date-ok: <why this is not a UTC-cut timestamp>
# e.g. `rows.slice(0, 10) // sg-date-ok: first ten rows, not a date`, or a
# value that is already a bare YYYY-MM-DD (`date` column). There is no
# file-level allowlist (RISK 9 of the Wave 7 plan).
#
# The safe forms: toSgDate(x) for logic (guard a nullable first — toSgDate(null)
# is "1970-01-01", §7.229) and formatSgStamp(x, opts) for display.
#
# BLIND SPOTS — a text scan: a cut split across lines (`.slice(\n0, 10)`), a
# computed length (`.slice(0, n)`), Intl/toLocale* formatting without a timeZone
# (sgDisplay.drift.test.ts covers display), and a regex literal the lexer takes
# for a division (it guesses from the preceding character).
#
# Usage:
#   scripts/check-apps-sg-date.sh           # CI: every tracked non-test source file in both apps
#   scripts/check-apps-sg-date.sh FILE...   # just these (proofs; any path)
# Exit: 0 clean · 1 a UTC-date cut · 2 the check itself is broken.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DEFAULT_SCAN=1
if (($# > 0)); then
  DEFAULT_SCAN=0
  FILES=("$@")
else
  FILES=()
  while IFS= read -r f; do FILES+=("$ROOT/$f"); done < <(
    git -C "$ROOT" ls-files -- SwimSyncApp SwimSyncAdmin |
      grep -E '\.(ts|tsx|js|jsx|mjs|cjs)$' |
      grep -vE '\.(test|spec)\.[a-z]+$|(^|/)(__tests__|__mocks__|e2e)/|\.d\.ts$' | sort)
fi

# Prints "LINE:code" for every UTC-date cut in a file. Each line is matched
# after its comments are blanked to spaces (lengths preserved, §7.230);
# strings, template literals and regex literals are kept verbatim. With
# SG_DATE_STRIP=1 it prints the blanked file instead (to diff the lexer
# against TypeScript's scanner — it agreed on all 815 files, 2026-10-06).
scan() {
  awk -v strip="${SG_DATE_STRIP:-0}" '
    BEGIN { mode = "code"; sp = 0 }
    {
      s = $0; n = length(s); out = ""; i = 1
      if (mode == "sq" || mode == "dq" || mode == "re") mode = "code"  # never span a line
      prev = ""                                                     # last non-blank code char
      while (i <= n) {
        c = substr(s, i, 1); d = substr(s, i + 1, 1)
        if (mode == "block") {
          if (c == "*" && d == "/") { out = out "  "; i += 2; mode = "code"; continue }
          out = out " "; i++; continue
        }
        if (mode == "sq" || mode == "dq") {
          out = out c
          if (c == "\\") { out = out d; i += 2; continue }
          if ((mode == "sq" && c == "\047") || (mode == "dq" && c == "\"")) { mode = "code"; prev = c }
          i++; continue
        }
        if (mode == "re") {
          out = out c
          if (c == "\\") { out = out d; i += 2; continue }
          if (c == "[") incls = 1; else if (c == "]") incls = 0
          else if (c == "/" && !incls) { mode = "code"; prev = "a" }
          i++; continue
        }
        if (mode == "tmpl") {
          out = out c
          if (c == "\\") { out = out d; i += 2; continue }
          if (c == "`") { mode = "code"; prev = c; i++; continue }
          if (c == "$" && d == "{") { out = out d; i += 2; sp++; bc[sp] = 0; mode = "code"; prev = "{"; continue }
          i++; continue
        }
        # mode == "code"
        if (c == "/" && d == "/") { while (i <= n) { out = out " "; i++ }; break }
        if (c == "/" && d == "*") { out = out "  "; i += 2; mode = "block"; continue }
        if (c == "/" && (prev == "" || index("(,=:[!&|?{};+-*%~^", prev) > 0)) {
          out = out c; i++; mode = "re"; incls = 0; continue
        }
        if (c == "\047") { mode = "sq" } else if (c == "\"") { mode = "dq" } else if (c == "`") { mode = "tmpl" }
        else if (c == "{" && sp > 0) { bc[sp]++ }
        else if (c == "}" && sp > 0) {
          if (bc[sp] == 0) { sp--; out = out c; i++; mode = "tmpl"; continue }
          bc[sp]--
        }
        out = out c
        if (c != " " && c != "\t") prev = c
        i++
      }
      if (strip) { print out; next }
      if ($0 ~ /\/\/[ \t]*sg-date-ok:[ \t]*[^ \t]/) next
      if (out ~ /(slice|substring|substr)\([ \t]*0[ \t]*,[ \t]*10[ \t]*\)/ ||
          out ~ /split\([ \t]*["\047`]T["\047`][ \t]*\)/) {
        sub(/^[ \t]+/, "", out); sub(/[ \t]+$/, "", out)
        print NR ":" substr(out, 1, 110)
      }
    }' "$1"
}

# Canary: a broken awk prints nothing inside `< <(scan …)`, its exit status is
# lost, and every file reads clean (§7.230 — a vacuous guard is silent). One cut
# after a "//" inside a string must hit; a cut inside a comment must not.
canary=$(scan <(printf '%s\n' 'const u = "https://a"; const d = s.slice(0, 10);' '// s.split("T")[0]' '/* x.slice(0, 10) */') || true)
[[ "$canary" == "1:"* && "$canary" != *$'\n'* ]] || {
  echo "✗ the scanner failed its canary (got: ${canary:-nothing}) — the check is broken" >&2
  exit 2
}

T=0; H=0; hits=""
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "✗ no such file: $f" >&2; exit 2; }
  T=$((T + 1))
  while IFS= read -r m; do
    [[ -z "$m" ]] && continue
    H=$((H + 1))
    hits+="    ${f#"$ROOT"/}:${m%%:*}: ${m#*:}"$'\n'
  done < <(scan "$f")
done

echo "scanned $T app source files, $H UTC-date cut(s)"

if ((DEFAULT_SCAN)) && ((T < 500)); then
  echo "✗ scanned too little (need ≥500 files) — the check is broken" >&2
  exit 2
fi

if [[ -n "$hits" ]]; then
  echo "✗ a timestamp cut to its UTC date — a day behind SGT before 08:00 (§7.7):"
  printf '%s' "$hits"
  cat <<'MSG'

Take the SGT date instead: toSgDate(x) for logic (guard a null first — §7.229),
formatSgStamp(x, opts) for display. If the value is NOT a UTC-cut timestamp
(a bare YYYY-MM-DD `date` column, the first ten rows of a list), end the line
with   // sg-date-ok: <why>
MSG
  exit 1
fi

echo "✓ neither app takes the UTC date of a timestamp"
