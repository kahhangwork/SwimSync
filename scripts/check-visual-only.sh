#!/usr/bin/env bash
# check-visual-only — is a change a VISUAL-ONLY restyle? (UI_RESTYLE_PLAN §6, D3.)
#
# WHY. A visual-only restyle may land without waiting for the next nightly (the
# relaxed HANDOVER §9 GATE). "It only touched UI files" is not enough to say so:
# login routing, permission gates and the admin nav live under UI paths too
# (§7.363). This classifies a range so the call is mechanical, not a feeling.
# It ADVISES — it is not wired into CI and blocks nothing.
#
# NOT VISUAL-ONLY when any of these hold:
#   (a) a changed path is outside the UI path list below;
#   (b) a changed path is on the NEVER-VISUAL list (overrides (a));
#   (c) an added/removed code line in an app source file matches LOGIC_RE —
#       each match must be explained by one line in the commit message, or the
#       change is not visual-only (the script lists them; a person judges);
#   (d) an app's .db-any-allowance went UP;
#   (e) a Tailwind config's `content` key changed.
#
# Usage:  scripts/check-visual-only.sh <base> <head>
# Exit:   0 VISUAL-ONLY · 1 NOT VISUAL-ONLY · 2 the check itself is broken.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if (($# != 2)); then
  echo "usage: $0 <base> <head>" >&2
  exit 2
fi
BASE="$1"
HEAD="$2"
git rev-parse --verify -q "$BASE^{commit}" >/dev/null || { echo "check-visual-only: bad base '$BASE'" >&2; exit 2; }
git rev-parse --verify -q "$HEAD^{commit}" >/dev/null || { echo "check-visual-only: bad head '$HEAD'" >&2; exit 2; }

# Paths a restyle may touch. Extended regex, matched against the whole path.
UI_PATHS='^(SwimSyncApp/app/.*|SwimSyncApp/features/[^/]+/ui/.*|SwimSyncApp/components/.*|SwimSyncAdmin/app/.*|SwimSyncAdmin/components/.*|SwimSyncApp/tailwind\.config\.js|SwimSyncAdmin/tailwind\.config\.ts|SwimSyncAdmin/app/globals\.css|brand/.*|SwimSyncApp/assets/.*|SwimSyncAdmin/public/.*|\.claude/skills/run-ui-playwright/drivers/[^/]+\.mjs|.*\.test\.tsx?|.*\.md|SwimSyncApp/\.db-any-allowance|SwimSyncAdmin/\.db-any-allowance)$'

# Pure display helpers (formatters, label/tone maps) — allowed although they sit
# in domain/ or lib/. Add one here only with its unit test in the same change.
DISPLAY_HELPERS='^(SwimSyncApp/features/schedule/domain/scheduleFormat\.ts|SwimSyncApp/lib/statusTone\.ts|SwimSyncAdmin/lib/statusTone\.ts)$'

# Under a UI path but holding access logic, data, or what a parent receives.
NEVER_VISUAL='^(SwimSyncApp/app/_layout\.tsx|SwimSyncApp/app/\(auth\)/.*|SwimSyncApp/app/(invoice|package)/.*|SwimSyncAdmin/app/(login|accept-invite|forgot-password|reset-password|api)/.*|SwimSyncAdmin/app/layout\.tsx|SwimSyncAdmin/components/(AuthGuard|RequiresTenant|PermissionsProvider|Sidebar)\.tsx|SwimSyncAdmin/lib/adminNav\.ts|SwimSyncAdmin/lib/classColours\.ts|.*/dao/.*|supabase/.*|.*[Ee]mail[^/]*\.ts|.*package(-lock)?\.json|.*/app\.json)$'

LOGIC_RE='supabase\.|\.from\(|\.rpc\(|fetch\(|router\.(push|replace|back)|use(Effect|State|Memo|Callback|Ref|Query)\b|await |signUp|signIn|auth\.|disabled=|enabled=|\.filter\(|\.sort\(|toSgDate|todayInSg|nowMinutesInSg|Alert\.alert'

REASONS=()
add() { REASONS+=("$1"); }

# --no-renames: a rename lists BOTH paths, so moving a never-visual file out is seen.
CHANGED="$(git diff --no-renames --name-only "$BASE" "$HEAD")"
if [[ -z "$CHANGED" ]]; then
  echo "check-visual-only: no changes between $BASE and $HEAD" >&2
  exit 2
fi

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if [[ "$f" =~ $NEVER_VISUAL ]]; then
    add "(b) never-visual path: $f"
  elif ! [[ "$f" =~ $UI_PATHS || "$f" =~ $DISPLAY_HELPERS ]]; then
    add "(a) outside the UI paths: $f"
  fi
done <<<"$CHANGED"

# (c) logic-looking lines in app source. Tests, drivers and docs are exempt:
# they carry `await` by nature. Comment-only lines are skipped.
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  [[ "$f" =~ ^(SwimSyncApp|SwimSyncAdmin)/.*\.(ts|tsx|js|jsx)$ ]] || continue
  [[ "$f" =~ \.test\.tsx?$ ]] && continue
  while IFS= read -r line; do
    body="${line:1}"
    trimmed="$(sed -E 's/^[[:space:]]+//' <<<"$body")"
    [[ "$trimmed" =~ ^(//|\*|/\*|\{/\*) ]] && continue
    if grep -qE "$LOGIC_RE" <<<"$body"; then
      add "(c) logic pattern in $f: ${line:0:1}${trimmed:0:110}"
    fi
  done < <(git diff -U0 "$BASE" "$HEAD" -- "$f" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' || true)
done <<<"$CHANGED"

# (d) the G6 any-allowance only ever goes down.
sum_allowance() {
  git show "$1:$2" 2>/dev/null | awk '!/^#/ && NF >= 2 { s += $NF } END { print s + 0 }'
}
for a in SwimSyncApp/.db-any-allowance SwimSyncAdmin/.db-any-allowance; do
  before="$(sum_allowance "$BASE" "$a")"
  after="$(sum_allowance "$HEAD" "$a")"
  if ((after > before)); then
    add "(d) $a rose: $before -> $after"
  fi
done

# (e) a Tailwind `content` change decides which files compile at all (§7.191).
for t in SwimSyncApp/tailwind.config.js SwimSyncAdmin/tailwind.config.ts; do
  if git diff -U0 "$BASE" "$HEAD" -- "$t" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' | grep -qE '\bcontent\b'; then
    add "(e) Tailwind content key changed: $t"
  fi
done

if ((${#REASONS[@]} == 0)); then
  echo "VISUAL-ONLY ($BASE..$HEAD, $(wc -l <<<"$CHANGED" | tr -d ' ') files)"
  exit 0
fi
echo "NOT VISUAL-ONLY ($BASE..$HEAD):"
for r in "${REASONS[@]}"; do
  echo "  $r"
done
exit 1
