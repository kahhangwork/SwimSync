#!/usr/bin/env bash
# G3 — no edge function takes the UTC date of a timestamp. §7.7, promoted from a
# note to a check (BACKLOG "Promote §7.7 to a check over supabase/functions",
# folded into Wave 7 — docs/plans/WAVE7_DB_CLOCK_PLAN.md, "CI guards").
#
# WHY. `x.toISOString().slice(0, 10)` / `.split("T")[0]` is the UTC date, a day
# behind SGT before 08:00. It shipped in the engine until 41d9676 (core.ts:699 —
# earliest enrolment floored as a UTC day) after being written down as §7.7.
#
# THE RULE. In supabase/functions/**/*.ts (not tests, not test-helpers.ts), no
# code line may `slice(0, 10)` or `split("T")[0]` (any spacing, either quote).
# Comments are stripped first.
#
# ALLOWED, exactly (RISK 9 — file AND function, never a whole file):
#   generate-invoices/dates.ts   formatDate          pure UTC-midnight arithmetic
#   public-package/core.ts       validUntilPreview   pure UTC-midnight arithmetic
# Each entry allows ONE hit. A hit in any other function of those files is
# red — including a second slice inside the allowed function, or a new helper
# written right beside formatDate. A nested function inside an allowed one is
# attributed to the nested name, so it is red too.
# Or, per line:  // utc-date-ok: <why this value is already a UTC calendar date>
#
# BLIND SPOTS — a text scan: function extents are tracked by brace depth (braces
# inside strings/template literals can mis-scope a hit); class methods are
# attributed to the enclosing declaration; a `//` inside a string hides the rest
# of its line; `.substring(0, 10)` and Intl formatting are not looked for.
#
# Usage:
#   scripts/check-functions-sg-date.sh           # CI: every non-test .ts under supabase/functions
#   scripts/check-functions-sg-date.sh FILE...   # just these (proofs; path must contain supabase/functions/)
# Exit: 0 clean · 1 a UTC-date slice · 2 the check itself is broken.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ALLOW=$'generate-invoices/dates.ts:formatDate\npublic-package/core.ts:validUntilPreview'

DEFAULT_SCAN=1
if (($# > 0)); then
  DEFAULT_SCAN=0
  FILES=("$@")
else
  FILES=()
  while IFS= read -r f; do FILES+=("$f"); done < <(
    find "$ROOT/supabase/functions" -name '*.ts' ! -name '*.test.ts' ! -name '*_test.ts' \
      ! -name 'test-helpers.ts' ! -path '*/tests/*' | sort)
fi

# Prints "LINE:FUNCTION:code" for every UTC-date slice in a TypeScript file.
# FUNCTION is the innermost named declaration around the line, or "-".
scan() {
  awk '
    function count(s, c,   n) { n = gsub(c, "", s); return n }
    {
      raw = $0
      marked = (raw ~ /\/\/[ \t]*utc-date-ok:[ \t]*[^ \t]/)
      # strip /* … */ (possibly multi-line) and // comments
      line = ""; s = raw
      while (s != "") {
        if (inblock) {
          i = index(s, "*/"); if (i == 0) { s = ""; break }
          s = substr(s, i + 2); inblock = 0
        } else {
          i = index(s, "/*"); j = index(s, "//")
          if (j > 0 && (i == 0 || j < i)) { line = line substr(s, 1, j - 1); s = ""; break }
          if (i == 0) { line = line s; s = ""; break }
          line = line substr(s, 1, i - 1); s = substr(s, i + 2); inblock = 1
        }
      }
      # a named declaration opens a scope at the current depth
      name = ""
      if (match(line, /(^|[^A-Za-z0-9_$])function[ \t]*\*?[ \t]+[A-Za-z_$][A-Za-z0-9_$]*/)) {
        name = substr(line, RSTART, RLENGTH); sub(/.*function[ \t]*\*?[ \t]+/, "", name)
      } else if (match(line, /(const|let|var)[ \t]+[A-Za-z_$][A-Za-z0-9_$]*[ \t]*(:[^=]*)?=[ \t]*(async[ \t]*)?(\(|function|[A-Za-z_$][A-Za-z0-9_$]*[ \t]*=>)/)) {
        name = substr(line, RSTART, RLENGTH); sub(/^(const|let|var)[ \t]+/, "", name); sub(/[^A-Za-z0-9_$].*/, "", name)
      }
      if (name != "") { sp++; sname[sp] = name; sdepth[sp] = depth; sopen[sp] = 0 }

      cur = (sp > 0) ? sname[sp] : "-"
      if (!marked && (line ~ /slice\([ \t]*0[ \t]*,[ \t]*10[ \t]*\)/ || line ~ /split\([ \t]*["\047`]T["\047`][ \t]*\)[ \t]*\[[ \t]*0[ \t]*\]/)) {
        code = line; sub(/^[ \t]+/, "", code)
        print NR ":" cur ":" substr(code, 1, 100)
      }

      depth += count(line, "[{]") - count(line, "[}]")
      while (sp > 0) {
        if (depth > sdepth[sp]) { sopen[sp] = 1; break }
        # a declaration that never opened a brace on its line (one-liner arrow) ends with it
        if (sopen[sp] || line ~ /;[ \t]*$/) { sp--; continue }
        break
      }
    }' "$1"
}

T=0; H=0; hits=""; allowed_seen=""
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "✗ no such file: $f" >&2; exit 2; }
  case "$f" in
    */supabase/functions/*) rel=${f##*/supabase/functions/} ;;
    supabase/functions/*) rel=${f#supabase/functions/} ;;
    *) echo "✗ not under supabase/functions/: $f" >&2; exit 2 ;;
  esac
  T=$((T + 1))
  while IFS= read -r m; do
    [[ -z "$m" ]] && continue
    n=${m%%:*}; rest=${m#*:}; fn=${rest%%:*}; code=${rest#*:}
    # Allowed once per entry: a second slice inside formatDate is a new one.
    if grep -qxF -- "$rel:$fn" <<< "$ALLOW" && ! grep -qxF -- "$rel:$fn" <<< "$allowed_seen"; then
      allowed_seen+="$rel:$fn"$'\n'; continue
    fi
    H=$((H + 1))
    hits+="    supabase/functions/$rel:$n ($fn): $code"$'\n'
  done < <(scan "$f")
done

echo "scanned $T edge-function files, $H UTC-date slice(s) outside the allowlist"

if ((DEFAULT_SCAN)); then
  if ((T < 15)); then
    echo "✗ scanned too little (need ≥15 files) — the check is broken" >&2
    exit 2
  fi
  # Each allowlist entry must still match a hit: proves the function scoping
  # works on this runner, and that a stale entry cannot linger.
  while IFS= read -r a; do
    grep -qxF -- "$a" <<< "$allowed_seen" || {
      echo "✗ allowlist entry '$a' matched nothing — stale, or function scoping is broken" >&2
      exit 2
    }
  done <<< "$ALLOW"
fi

if [[ -n "$hits" ]]; then
  echo "✗ a timestamp cut to its UTC date — a day behind SGT before 08:00 (§7.7):"
  printf '%s' "$hits"
  cat <<'MSG'

Take the SGT date instead (toSgDate() in generate-invoices/dates.ts, or the
Intl en-CA / Asia/Singapore pattern beside it). If the value is ALREADY a UTC
calendar date (pure YYYY-MM-DD arithmetic at UTC midnight, no clock read), end
the line with   // utc-date-ok: <why>
MSG
  exit 1
fi

echo "✓ no edge function takes the UTC date of a timestamp"
