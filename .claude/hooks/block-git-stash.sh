#!/usr/bin/env bash
# PreToolUse(Bash) hook: refuse the stash command — the stash stack is shared across every
# worktree, so a bare pop can take a sibling's work (session-close rule; §8.139). Use a WIP commit.
#
# Matches only a REAL invocation: `git [-C <path>] stash …` in command position (start of the
# command, or after ; && || | ( or a newline). Text that merely MENTIONS it — inside '…' / "…"
# quotes or a heredoc body (commit messages, greps, echoes) — is stripped first and never blocks.
# Known gap, accepted: a stash hidden inside a quoted string run by `bash -c "…"` is not caught.
set -euo pipefail

cmd="$(jq -r '.tool_input.command // empty')"

stripped="$(printf '%s' "$cmd" | perl -0777 -pe '
  s/<<-?\s*([\x27"]?)(\w+)\1[^\n]*\n.*?\n\s*\2[ \t]*(?=\n|\z)//gs;  # heredoc bodies
  s/\x27[^\x27]*\x27//g;                                              # single-quoted text
  s/"(?:[^"\\]|\\.)*"//g;                                             # double-quoted text
')"

if printf '%s' "$stripped" | grep -Eq '(^|[;&|(])[[:space:]]*git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+stash([^[:alnum:]_-]|$)'; then
  echo "Blocked: git stash — the stash stack is shared across every worktree (session-close rule). Use a WIP commit instead: git commit -m 'WIP: …'" >&2
  exit 2
fi
exit 0
