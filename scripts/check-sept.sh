#!/usr/bin/env bash
# G-Sept — September is "Sept" everywhere a person reads a date (§7.302).
#
# WHY. The apps format dates through en-SG Intl, whose short September is
# "Sept". Everything that spelled a month any other way said "Sep": 13 DB
# functions (Postgres to_char 'Mon'), three email templates and two app
# formatters, each with its own hand-typed month list. Fixed 2026-10-09
# (migration 20261009000100 + the lists). This keeps it fixed.
#
# THE RULES.
#   1. Source (every git-tracked non-test .ts/.tsx/.js/.jsx/.mjs/.cjs under
#      SwimSyncApp/, SwimSyncAdmin/, supabase/functions/): no code line holds the
#      word "Sep", and none asks Intl for "en-US" (whose short month is "Sep").
#      Lines that are only a comment are skipped.
#   2. Migrations from 20261009000100 on: no code line calls to_char with a
#      format holding the word Mon — use sg_date_label(date, format). Earlier
#      migrations are applied and can never change; the LIVE functions they
#      defined are covered by supabase/tests/sg_date_label.test.sql, which
#      scans pg_proc (that census is the DB half of this check).
#
# ALLOWED, per line only:  // sept-ok: <why>   (or  -- sept-ok: <why>  in SQL)
#
# BLIND SPOTS — a text scan: a month built by computation (a month list typed
# in another casing, or sliced from "September"), to_char split across lines,
# a format held in a variable. Display formatting with an en-SG/en-GB locale is
# correct by construction.
#
# Usage:
#   scripts/check-sept.sh           # CI: the default scan
#   scripts/check-sept.sh FILE...   # just these (proofs; .sql files get rule 2)
# Exit: 0 clean · 1 a "Sep" · 2 the check itself is broken.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIRST_MIGRATION=20261009000100

DEFAULT_SCAN=1
if (($# > 0)); then
  DEFAULT_SCAN=0
  FILES=("$@")
else
  FILES=()
  while IFS= read -r f; do FILES+=("$ROOT/$f"); done < <(
    git -C "$ROOT" ls-files -- SwimSyncApp SwimSyncAdmin supabase/functions |
      grep -E '\.(ts|tsx|js|jsx|mjs|cjs)$' |
      grep -vE '\.(test|spec)\.[a-z]+$|(^|/)(__tests__|__mocks__|e2e)/|\.d\.ts$|database\.types\.ts$' | sort)
  while IFS= read -r f; do
    b=$(basename "$f")
    [[ "${b%%_*}" < "$FIRST_MIGRATION" ]] || FILES+=("$ROOT/$f")
  done < <(git -C "$ROOT" ls-files -- 'supabase/migrations/*.sql' | sort)
fi

# Prints "LINE:code" for every hit in one file.
scan_source() {
  perl -ne '
    next if /sept-ok:/;
    next if m{^\s*(//|/\*|\*)};
    print "$.:$_" if /\bSep\b/ || /["\x27`]en-US["\x27`]/;
  ' "$1"
}
scan_sql() {
  perl -ne '
    next if /sept-ok:/;
    next if /^\s*--/;
    print "$.:$_" if /\bto_char\s*\(.*\x27[^\x27]*\bMon\b[^\x27]*\x27/i;
  ' "$1"
}
scan() { if [[ "$1" == *.sql ]]; then scan_sql "$1"; else scan_source "$1"; fi; }

# CANARY — a scanner that matches nothing passes every file (§7.230: a vacuous
# guard is silent). Each sample must hit exactly the lines it should.
src_canary=$(scan_source <(printf '%s\n' \
  'const M = ["Aug", "Sep", "Oct"];' \
  '// "Sep" in a comment is fine' \
  'new Intl.DateTimeFormat("en-US", o);' \
  'const ok = ["Aug", "Sept", "Oct"];' \
  'const x = "Sep"; // sept-ok: proof') | cut -d: -f1 | tr '\n' ' ')
sql_canary=$(scan_sql <(printf '%s\n' \
  "  to_char(d, 'DD Mon YYYY')," \
  "  -- to_char(d, 'DD Mon YYYY') in a comment" \
  "  to_char((x AT TIME ZONE 'Asia/Singapore')::date, 'FMDD Mon')" \
  "  to_char(d, 'YYYY-MM'), to_char(d, 'FMDD Month')," \
  "  sg_date_label(d, 'DD Mon YYYY')") | cut -d: -f1 | tr '\n' ' ')
[[ "$src_canary" == "1 3 " && "$sql_canary" == "1 3 " ]] || {
  echo "✗ the scanner failed its canary (source: '${src_canary}', sql: '${sql_canary}') — the check is broken" >&2
  exit 2
}

T=0; S=0; H=0; hits=""
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "✗ no such file: $f" >&2; exit 2; }
  if [[ "$f" == *.sql ]]; then S=$((S + 1)); else T=$((T + 1)); fi
  while IFS= read -r m; do
    [[ -z "$m" ]] && continue
    H=$((H + 1))
    hits+="    ${f#"$ROOT"/}:${m%%:*}: $(echo "${m#*:}" | sed 's/^[[:space:]]*//')"$'\n'
  done < <(scan "$f")
done

echo "scanned $T source files + $S migrations, $H \"Sep\"(s)"

if ((DEFAULT_SCAN)) && { ((T < 500)) || ((S < 1)); }; then
  echo "✗ scanned too little (need ≥500 source files and ≥1 migration) — the check is broken" >&2
  exit 2
fi

if [[ -n "$hits" ]]; then
  echo "✗ September spelled \"Sep\" — every surface says \"Sept\" (§7.302):"
  printf '%s' "$hits"
  cat <<'MSG'

In TS: format through formatSgStamp / en-SG Intl, or spell the month "Sept".
In SQL: sg_date_label(date, format) instead of to_char(date, '… Mon …').
If the line is not a month a person reads, end it with   // sept-ok: <why>
MSG
  exit 1
fi

echo "✓ September reads \"Sept\" on every surface"
