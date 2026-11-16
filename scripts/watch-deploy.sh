#!/usr/bin/env bash
# watch-deploy — after `git push … :main`, report the web-app deploy and CI as
# two SEPARATE results, each the moment it is known.
#
# WHY. On 2026-11-16 two hand-written watcher loops failed silently:
#   1. one waited for CI before it checked Vercel — the apps were live in
#      minutes, the report came only after CI;
#   2. one passed a SHORT sha to `gh run list --commit`, which matches nothing
#      and returns [] with exit 0 — the loop read "empty" as "not done yet" and
#      would never have fired.
# A broken query and a slow build look identical from inside a loop. So this
# script never treats "nothing found" as "still waiting" past a short grace
# period, resolves the full sha itself, and has a deadline on every phase.
#
# Run it under Monitor (each stdout line is one event), not a silent
# background loop:  Monitor  command: scripts/watch-deploy.sh <sha> …
#
# Usage:  scripts/watch-deploy.sh <sha> [--expect <url> <string>]... [--no-ci]
#   --expect  after Vercel succeeds, fetch <url> and every script it loads, and
#             require <string> in them (§7.31 — a 200 proves nothing). Repeatable.
#             Pick a string ONLY the new build has.
#   --no-ci   report the deploy and stop (CI is not watched).
# Output lines start with  DEPLOY · LIVE · CI · FAIL  — every exit prints one.
# Exit:   0 everything asked for passed · 1 a real failure · 2 the watch itself
#         is broken (bad sha, query matched nothing, deadline hit).

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

POLL=20
VERCEL_GRACE=120     # no Vercel status at all after this → the query is wrong
VERCEL_DEADLINE=900
CI_GRACE=180         # no CI run at all after this → the query is wrong
CI_DEADLINE=2400
CONTEXTS=("Vercel – swimsync-app" "Vercel – swimsync-admin")

(($# >= 1)) || { echo "usage: $0 <sha> [--expect <url> <string>]... [--no-ci]" >&2; exit 2; }
SHA="$(git rev-parse --verify --quiet "$1^{commit}")" || { echo "FAIL  not a commit: $1"; exit 2; }
shift
EXPECT=(); WATCH_CI=1
while (($#)); do
  case "$1" in
    --expect) (($# >= 3)) || { echo "FAIL  --expect needs <url> <string>"; exit 2; }
              EXPECT+=("$2" "$3"); shift 3 ;;
    --no-ci)  WATCH_CI=0; shift ;;
    *)        echo "FAIL  unknown argument: $1"; exit 2 ;;
  esac
done
short="${SHA:0:7}"
start=$(date +%s)
elapsed() { echo $(( $(date +%s) - start )); }

# ── Phase 1: Vercel ────────────────────────────────────────────────────────
# The combined-status endpoint gives the LATEST state per context.
done_ctx="|"   # contexts already reported (bash 3.2 has no assoc arrays)
ndone=0
while :; do
  json="$(gh api "repos/{owner}/{repo}/commits/$SHA/status" 2>/dev/null)" || json=""
  seen=0
  for ctx in "${CONTEXTS[@]}"; do
    state="$(jq -r --arg c "$ctx" '.statuses[]? | select(.context==$c) | .state' <<<"$json" | head -1)"
    [[ -n "$state" ]] && seen=$((seen + 1))
    [[ "$done_ctx" == *"|$ctx|"* ]] && continue
    case "$state" in
      success)       echo "DEPLOY  $ctx: success on $short ($(elapsed)s)"; done_ctx="$done_ctx$ctx|"; ndone=$((ndone + 1)) ;;
      failure|error) echo "FAIL  $ctx: $state on $short — $(jq -r --arg c "$ctx" '.statuses[]|select(.context==$c)|.target_url' <<<"$json" | head -1)"; exit 1 ;;
    esac
  done
  ((ndone == ${#CONTEXTS[@]})) && break
  if ((seen == 0 && $(elapsed) > VERCEL_GRACE)); then
    echo "FAIL  no Vercel status for $short after ${VERCEL_GRACE}s — wrong sha, or the push did not reach main"; exit 2
  fi
  (($(elapsed) > VERCEL_DEADLINE)) && { echo "FAIL  Vercel still not done after ${VERCEL_DEADLINE}s"; exit 2; }
  sleep "$POLL"
done

# ── Phase 1b: the served bundle carries the change (§7.31) ─────────────────
for ((i = 0; i < ${#EXPECT[@]}; i += 2)); do
  url="${EXPECT[i]}"; want="${EXPECT[i+1]}"
  origin="$(sed -E 's#^(https?://[^/]+).*#\1#' <<<"$url")"
  found=0
  for attempt in 1 2 3; do   # the CDN can serve the old build for a moment
    html="$(curl -fsSL "$url" 2>/dev/null)" || html=""
    if grep -qF -- "$want" <<<"$html"; then found=1; break; fi
    for src in $(grep -oE 'src="[^"]+\.js[^"]*"' <<<"$html" | sed -E 's/^src="//; s/"$//' | sort -u); do
      [[ "$src" == http* ]] || src="$origin$src"
      # Download FIRST, then grep: `curl | grep -q` under pipefail reports a MATCH
      # as a failure (grep -q exits early, curl dies of SIGPIPE) — found 2026-11-16.
      js="$(curl -fsSL "$src" 2>/dev/null)" || js=""
      if grep -qF -- "$want" <<<"$js"; then found=1; break 2; fi
    done
    sleep "$POLL"
  done
  if ((found)); then echo "LIVE  $url serves \"$want\""
  else echo "FAIL  $url does not serve \"$want\" — the live build is not this change"; exit 1; fi
done
((${#EXPECT[@]} > 0)) || echo "DEPLOY  no --expect given — the bundle was NOT checked (§7.31)"

((WATCH_CI)) || exit 0

# ── Phase 2: CI, reported on its own ───────────────────────────────────────
while :; do
  run="$(gh run list --commit "$SHA" --workflow CI --limit 1 --json status,conclusion,url \
        --jq '.[0] // empty | "\(.status) \(if (.conclusion // "") == "" then "-" else .conclusion end) \(.url)"' 2>/dev/null)"
  if [[ -z "$run" ]]; then
    (($(elapsed) > CI_GRACE)) && { echo "FAIL  no CI run found for $short after ${CI_GRACE}s — the query matched nothing"; exit 2; }
  else
    read -r status conclusion url <<<"$run"
    if [[ "$status" == completed ]]; then
      if [[ "$conclusion" == success ]]; then echo "CI  success on $short — $url"; exit 0
      else echo "FAIL  CI $conclusion on $short — $url"; exit 1; fi
    fi
  fi
  (($(elapsed) > CI_DEADLINE)) && { echo "FAIL  CI still running after ${CI_DEADLINE}s — $url"; exit 2; }
  sleep "$POLL"
done
