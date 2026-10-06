#!/usr/bin/env bash
# G6 — the `any` ratchet. Wave 8 (docs/plans/WAVE8_GENERATED_TYPES_PLAN.md, F0 step 7).
#
# WHY. With generated `Database` types, a database value typed `any` is the one place
# the compiler still cannot see a renamed column (§7.76). Wave 8 removes those casts
# folder by folder; without a ratchet they grow back.
#
# THE RULE, over every tracked-or-new non-test .ts/.tsx under SwimSyncApp/ and
# SwimSyncAdmin/ (not lib/database.types.ts; tests = *.test.ts[x] and */testing/*):
#   1. Count, outside comments: `as any`, `: any`, `any[]`, `<any>`,
#      `Record<string, any>`, `as unknown as`, `@ts-ignore`, `@ts-expect-error`.
#      EXEMPT: one line per lib/database.overrides.ts carrying `// g6-exempt: fromJson`
#      (the single permitted cast, RISK 8). A second marked line in a file fails.
#   2. Each file's count must EQUAL its line in <app>/.db-any-allowance (`path count`,
#      path relative to the app; absent = 0). Above it: you added an `any`. Below it:
#      you removed one — lower the allowance (`--update`) in the same commit, so the
#      slack cannot be refilled.
#   3. No allowance may be HIGHER than in the base commit's version of the file
#      (G6_BASE, default HEAD~1; CI passes the push's base) — it can only go down.
#   4. `database.types` is imported or re-exported ONLY with `import type`/`export type`
#      — it exports a runtime `Constants` object a value import would bundle.
#   Surviving non-database anys carry an inline `// db-any-ok: <reason>`; this check
#   counts them like any other (they are the closing census, not an exemption).
#
# Usage:
#   scripts/check-db-any.sh            # check (CI: repo-invariants)
#   scripts/check-db-any.sh --update   # rewrite both allowances to the current counts;
#                                      # refuses if any count would rise (creates a missing file)
#   G6_LIST=1 scripts/check-db-any.sh  # also print every file's count
# Exit: 0 clean · 1 a violation · 2 the check itself is broken.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
APPS=(SwimSyncApp SwimSyncAdmin)
BASE=${G6_BASE:-HEAD~1}
UPDATE=0
[[ "${1:-}" == "--update" ]] && UPDATE=1

# path<TAB>count<TAB>exempt-lines<TAB>bad-imports for each file of $1 (paths relative to the app).
count_app() {
  local app=$1
  (cd "$app" && git ls-files --cached --others --exclude-standard -- '*.ts' '*.tsx') |
    grep -vE '\.test\.tsx?$|(^|/)testing/|^lib/database\.types\.ts$' |
    while IFS= read -r f; do [[ -f "$app/$f" ]] && printf '%s\n' "$f"; done |
    (cd "$app" && perl -ne '
      chomp; my $f = $_;
      open(my $h, "<", $f) or die "cannot read $f\n";
      local $/; my $src = <$h>; close $h;
      my $is_ov = ($f eq "lib/database.overrides.ts");
      my ($n, $ex) = (0, 0);
      for my $line (split /\n/, $src) {
        if ($is_ov && $line =~ m{//\s*g6-exempt:\s*fromJson\b}) { $ex++; next; }
        $line =~ s{//.*$}{};                           # line comment (and anything after //)
        $n++ while $line =~ /as\s+unknown\s+as\b|\@ts-ignore|\@ts-expect-error|Record<\s*string\s*,\s*any\s*>|\bas\s+any\b|:\s*any\b|\bany\[\]|<any>/g;
      }
      # Block comments: subtract what the line pass counted inside them.
      while ($src =~ m{/\*(.*?)\*/}gs) {
        my $c = $1; $c =~ s{//.*$}{}mg;
        $n-- while $c =~ /as\s+unknown\s+as\b|\@ts-ignore|\@ts-expect-error|Record<\s*string\s*,\s*any\s*>|\bas\s+any\b|:\s*any\b|\bany\[\]|<any>/g;
      }
      my @bad;
      push @bad, $1 while $src =~ /((?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["\x27][^"\x27]*database\.types["\x27])/gs;
      push @bad, $1 while $src =~ /((?:import\s*\(|require\s*\(|import\s+)["\x27][^"\x27]*database\.types["\x27])/g;
      my $b = join(" | ", map { my $s = $_; $s =~ s/\s+/ /g; $s } @bad);
      print "$f\t$n\t$ex\t$b\n";
    ')
}

allowance_of() { # $1 = allowance text (stdin), prints "path count" lines without comments
  sed -e 's/#.*//' -e '/^[[:space:]]*$/d'
}

fail=0
for app in "${APPS[@]}"; do
  af="$app/.db-any-allowance"
  counts=$(count_app "$app")
  [[ -n "$counts" ]] || { echo "✗ G6: no files found under $app" >&2; exit 2; }
  cur=""; [[ -f "$af" ]] && cur=$(allowance_of <"$af")

  # Rule 4 + the exemption limit.
  while IFS=$'\t' read -r f n ex bad; do
    if [[ -n "$bad" ]]; then echo "✗ G6: $app/$f imports database.types as a VALUE — use \`import type\`: $bad"; fail=1; fi
    if ((ex > 1)); then echo "✗ G6: $app/$f has $ex '// g6-exempt: fromJson' lines — exactly one is allowed"; fail=1; fi
  done <<<"$counts"

  if ((UPDATE)); then
    # First creation has nothing to raise; after that, rule 3 (vs the base commit) guards too.
    [[ -f "$af" ]] && raised=$(awk -F'\t' 'NR==FNR { if ($0 != "") { split($0, a, " "); allow[a[1]] = a[2] }; next }
                        $2 > (allow[$1] + 0) { print "    " $1 ": " (allow[$1] + 0) " → " $2 }' \
             <(echo "$cur") <(echo "$counts")) || raised=""
    if [[ -n "$raised" ]]; then
      echo "✗ G6 --update refuses to RAISE $af:"; echo "$raised"; fail=1; continue
    fi
    {
      echo "# G6 allowance (scripts/check-db-any.sh): \`any\`-family casts per file, outside comments."
      echo "# Only ever LOWERED — regenerate with \`scripts/check-db-any.sh --update\`. Absent = 0."
      awk -F'\t' '$2 > 0 { print $1 " " $2 }' <<<"$counts" | LC_ALL=C sort
    } >"$af"
    echo "✓ G6: wrote $af ($(awk -F'\t' '{ s += $2 } END { print s + 0 }' <<<"$counts") total)"
    continue
  fi

  [[ -f "$af" ]] || { echo "✗ G6: $af is missing — run scripts/check-db-any.sh --update"; fail=1; continue; }

  # Rule 2: count == allowance, both directions; and entries for files that no longer exist.
  out=$(awk -F'\t' 'NR==FNR { if ($0 != "") { split($0, a, " "); allow[a[1]] = a[2] }; next }
    { seen[$1] = 1; al = allow[$1] + 0
      if ($2 > al) print "✗ G6: " app "/" $1 " has " $2 " (allowance " al ") — you added an `any`; type it instead"
      else if ($2 < al) print "✗ G6: " app "/" $1 " has " $2 " (allowance " al ") — lower the allowance: scripts/check-db-any.sh --update" }
    END { for (p in allow) if (!(p in seen)) print "✗ G6: " app "/.db-any-allowance lists " p ", which is not a counted file — scripts/check-db-any.sh --update" }' \
    app="$app" <(echo "$cur") <(echo "$counts"))
  [[ -n "$out" ]] && { echo "$out"; fail=1; }

  # Rule 3: never higher than the base commit's allowance.
  if base_txt=$(git show "$BASE:$af" 2>/dev/null); then
    up=$(awk 'NR==FNR { if ($0 != "") { split($0, a, " "); was[a[1]] = a[2] }; next }
              $0 != "" { split($0, a, " "); if (a[2] > was[a[1]] + 0) print "✗ G6: " af " raises " a[1] ": " (was[a[1]] + 0) " → " a[2] " (vs " base ") — the allowance only goes down" }' \
         af="$af" base="$BASE" <(allowance_of <<<"$base_txt") <(echo "$cur"))
    [[ -n "$up" ]] && { echo "$up"; fail=1; }
  fi

  total=$(awk -F'\t' '{ s += $2 } END { print s + 0 }' <<<"$counts")
  [[ -n "${G6_LIST:-}" ]] && awk -F'\t' '$2 > 0 { print "    " $2 "\t" $1 }' <<<"$counts" | sort -rn
  echo "  $app: $total \`any\`-family casts in $(awk -F'\t' '$2 > 0' <<<"$counts" | wc -l | tr -d ' ') files"
done

((fail)) && exit 1
((UPDATE)) || echo "✓ G6: every file at its allowance; no allowance raised; database.types imported as types only"
