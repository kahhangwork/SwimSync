#!/usr/bin/env bash
# watch-run — wait for one or more GitHub Actions runs BY ID (a nightly, a later
# CI run) and print one line per run the moment it completes.
#
# WHY. On 2026-11-18 an inline Monitor loop watched two CI runs:
#     left="44314472661 44315618958"; for id in $left; do gh run view $id …
# The Monitor shell is zsh, which does NOT word-split `$left` (§7.340), so
# `gh run view` got both ids as ONE argument, failed, and the `|| echo
# query-failed` fallback read as "not done yet". It looped silently while both
# runs went green; the user asked why CI was "still running" 20 minutes later.
# A broken query and a slow run look identical from inside a loop — so this
# script is bash (immune to the zsh split), takes the ids as separate argv,
# and reports a query that keeps failing instead of waiting on it.
#
# Usage:  scripts/watch-run.sh <run-id> [<run-id>...] [--deadline <minutes>]
#   A nightly takes ~2 h — longer than Monitor's 30-min cap — so run it with
#   Bash run_in_background (one notification on exit), or Monitor + re-arm.
#   WATCH_POLL=<s> overrides the 60 s poll (the proofs use 1).
# Output lines start  RUN · BROKEN · TIMEOUT  — every exit prints at least one.
# Exit:   0 every run completed (whatever its conclusion — read the RUN lines)
#         2 the watch itself is broken (bad id, gh failing) · 3 deadline hit
set -uo pipefail

POLL=${WATCH_POLL:-60}
FAIL_LIMIT=3          # consecutive failed queries for one id → BROKEN, not "waiting"
DEADLINE_MIN=180

ids=()
while (($#)); do
  case "$1" in
    --deadline) DEADLINE_MIN="$2"; shift 2 ;;
    *) [[ $1 =~ ^[0-9]+$ ]] || { echo "BROKEN  not a run id: '$1' (one id per argument)"; exit 2; }
       ids+=("$1"); shift ;;
  esac
done
((${#ids[@]})) || { echo "usage: $0 <run-id> [<run-id>...] [--deadline <minutes>]" >&2; exit 2; }

# bash 3.2 (macOS /usr/bin/env bash) has no associative arrays: one failure
# counter per id, kept in a parallel indexed array.
nfail=(); for i in "${!ids[@]}"; do nfail[i]=0; done
end=$((SECONDS + DEADLINE_MIN * 60))
while ((${#ids[@]})); do
  left=(); lfail=()
  for i in "${!ids[@]}"; do
    id=${ids[i]}; f=${nfail[i]}
    if out=$(gh run view "$id" --json status,conclusion,workflowName,headSha \
               -q '"\(.status)|\(.conclusion)|\(.workflowName)|\(.headSha[0:7])"' 2>&1); then
      f=0
      IFS='|' read -r status conclusion name sha <<<"$out"
      if [[ $status == completed ]]; then
        echo "RUN  $id $name on $sha: ${conclusion:-?} — https://github.com/kahhangwork/SwimSync/actions/runs/$id"
      else
        left+=("$id"); lfail+=("$f")
      fi
    else
      f=$((f + 1))
      if ((f >= FAIL_LIMIT)); then
        echo "BROKEN  $id: gh run view failed ${FAIL_LIMIT}× — ${out//$'\n'/ }"
        exit 2
      fi
      left+=("$id"); lfail+=("$f")
    fi
  done
  ids=("${left[@]+"${left[@]}"}"); nfail=("${lfail[@]+"${lfail[@]}"}")
  ((${#ids[@]})) || exit 0
  if ((SECONDS >= end)); then
    echo "TIMEOUT  still running after ${DEADLINE_MIN} min: ${ids[*]}"
    exit 3
  fi
  sleep "$POLL"
done
