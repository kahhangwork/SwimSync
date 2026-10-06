#!/usr/bin/env bash
# "Type-only" is PROVEN, never judged by eye (§7.348). Wave 8
# (docs/plans/WAVE8_GENERATED_TYPES_PLAN.md, RISK 1).
#
# WHY. `as`, `: T`, `!` and `import`→`import type` are erased at build. `?.`, `??`,
# `|| ""`, a dropped payload key and a select-string edit are NOT — each changes what
# users see while looking like a type fix. A `types(…)` commit must exit 0 here;
# anything that does not is a `fix(…)` commit with a Bug-ledger row, a failing-first
# test and its `--only` driver.
#
# THE RULE, for every path that differs between <base> and <head> (renames = delete
# + add; the WORKING TREE is ignored — commit first):
#   - a modified non-test .ts/.tsx under SwimSyncApp/ or SwimSyncAdmin/ must
#     transpile to the same program (scripts/lib/runtime-identical.mjs — it states
#     its two normalisations);
#   - a DELETED non-test file there, any other changed source there (.js, .json,
#     package files, assets…), an ADDED file under an app's `app/` (a route — no
#     importer needed) or at an app's root (config, middleware), and any change under
#     supabase/migrations/ or supabase/functions/ are runtime changes outright;
#   - an ADDED module elsewhere is fine on its own: it runs only if something imports
#     it, and that importer is a modified file, which is checked;
#   - ignored: test files (*.test.ts[x], */testing/*), *.md, .db-any-allowance,
#     lib/database.types.ts (type-only by G6's `import type` rule; G5 checks it), and
#     everything outside the two apps and supabase/.
#
# Usage: scripts/check-runtime-identical.sh [<base>=HEAD~1] [<head>=HEAD]
#   CI:  for every `types(…)` commit C in a push, run it with C~1 C.
# Needs each changed app's node_modules (its own TypeScript).
# Exit: 0 runtime-identical · 1 a runtime change · 2 the check itself is broken.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE=${1:-HEAD~1}
HEAD_REV=${2:-HEAD}

git -C "$ROOT" rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || { echo "✗ unknown base: $BASE" >&2; exit 2; }
git -C "$ROOT" rev-parse --verify --quiet "$HEAD_REV^{commit}" >/dev/null || { echo "✗ unknown head: $HEAD_REV" >&2; exit 2; }

is_test() { [[ "$1" =~ \.test\.tsx?$ || "$1" == */testing/* ]]; }

compare=(); runtime=(); added=()
while IFS=$'\t' read -r status path; do
  case "$path" in
    SwimSyncApp/*|SwimSyncAdmin/*) ;;
    supabase/migrations/*|supabase/functions/*)
      [[ "$path" =~ \.test\.ts$ || "$path" == */test.sh ]] || runtime+=("$status $path")
      continue ;;
    *) continue ;;
  esac
  app=${path%%/*}; rel=${path#*/}
  if is_test "$path" || [[ "$path" == *.md || "$rel" == .db-any-allowance || "$rel" == lib/database.types.ts ]]; then
    continue
  fi
  if [[ "$path" =~ \.tsx?$ ]]; then
    case "$status" in
      M) compare+=("$path") ;;
      A) if [[ "$rel" == app/* || "$rel" != */* ]]; then runtime+=("A $path (route or app-root file)"); else added+=("$path"); fi ;;
      *) runtime+=("$status $path") ;;
    esac
  else
    runtime+=("$status $path")
  fi
done < <(git -C "$ROOT" diff --no-renames --name-status "$BASE" "$HEAD_REV")

echo "runtime-identity: $BASE → $HEAD_REV"
for a in ${added[@]+"${added[@]}"}; do echo "  · added module (runs only via a modified importer, which is checked): $a"; done

rc=0
if ((${#compare[@]})); then
  node "$ROOT/scripts/lib/runtime-identical.mjs" "$ROOT" "$BASE" "$HEAD_REV" "${compare[@]}" || rc=$?
  ((rc == 2)) && exit 2
else
  echo "✓ no modified app .ts/.tsx files"
fi
if ((${#runtime[@]})); then
  for r in "${runtime[@]}"; do echo "✗ RUNTIME CHANGE (not a transpilable type edit): $r"; done
  rc=1
fi
if ((rc)); then
  echo ""
  echo "  NOT runtime-identical → this is a fix(…) commit: Bug-ledger row, failing-first test, --only driver."
  exit 1
fi
echo "✓ runtime-identical — a types(…) label is allowed"
