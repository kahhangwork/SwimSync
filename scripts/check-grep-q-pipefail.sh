#!/usr/bin/env bash
# check-grep-q-pipefail — no `cmd | grep -q` in a script that sets pipefail (§7.339).
#
# WHY. `grep -q` exits on its first match; the producer still writing to the pipe
# takes SIGPIPE (141), and under `set -o pipefail` the pipeline's status is that
# failure — so a MATCH reads as "not there". Bitten twice (G1's first draft
# 2026-10-06, scripts/watch-deploy.sh's first draft 2026-11-16) after the note in
# GOTCHAS was already written. This fires without anyone reading it.
#
# THE RULE. In every tracked *.sh file that sets pipefail, no code line may pipe
# into grep with -q / --quiet / --silent (in any option cluster: -qE, -Eq, -vq …).
# Safe forms:  grep -q PAT <(cmd)  ·  grep -q PAT <<<"$captured"  ·  cmd | grep PAT >/dev/null
# (`>/dev/null` reads the whole input, so the producer is never cut off.)
# A line may keep the pipe if it says why:  `# grep-q-ok: <why>`
#
# BLIND SPOTS — a text scan: a `#` inside a string hides the rest of its line; a pipe
# continued onto the next line (`cmd |\n grep -q`) is not seen; grep reached via a
# variable or function is not seen.
#
# Usage:  scripts/check-grep-q-pipefail.sh            # CI: every tracked *.sh
#         scripts/check-grep-q-pipefail.sh FILE...    # just these
# Exit:   0 clean · 1 a `| grep -q` under pipefail · 2 the check itself is broken.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PIPE_RE='(^|[^|])\|[[:space:]]*grep([[:space:]]+-[A-Za-z]+)*[[:space:]]+(-[A-Za-z]*q[A-Za-z]*|--quiet|--silent)([[:space:]]|$)'
PIPEFAIL_RE='^[[:space:]]*set[[:space:]].*pipefail'
MARK_RE='# grep-q-ok:[[:space:]]*[^[:space:]]'

# scan — read lines on stdin, print "<lineno>\t<line>" for each offender. ONE perl
# process per file (a per-line grep took ~1 min over the repo). The self-test below
# drives this same function, so it tests the matcher CI actually runs.
# Comments are stripped first: a full-line `#…` and a trailing ` #…` (see BLIND SPOTS).
scan() {
  PIPE_RE="$PIPE_RE" MARK_RE="$MARK_RE" perl -ne '
    BEGIN { $p = qr/$ENV{PIPE_RE}/; $m = qr/$ENV{MARK_RE}/ }
    next if /$m/;
    ($c = $_) =~ s/^[[:space:]]*#.*$//;
    $c =~ s/[[:space:]]#.*$//;
    print "$.\t$_" if $c =~ $p;
  '
}

# Self-test on every run: a guard that cannot see its own target is not one.
# The probes are offenders by design, so each carries the opt-out mark for the
# repo scan (which reads this file too); scan() is fed the bare string.
MUST_FLAG=(
  'x | grep -q foo'                 # grep-q-ok: self-test probe
  'x|grep -qE foo'                  # grep-q-ok: self-test probe
  'x | grep -Eq foo'                # grep-q-ok: self-test probe
  'x | grep -vqF foo'               # grep-q-ok: self-test probe
  'x | grep -E a | grep -qE b'      # grep-q-ok: self-test probe
  'x | grep --quiet foo'            # grep-q-ok: self-test probe
  'x | grep -i -q foo'              # grep-q-ok: self-test probe
)
MUST_PASS=(
  'grep -q foo <(x)'
  'grep -q foo <<<"$x"'
  'x | grep foo >/dev/null'
  'x || grep -q foo'
  'x | grep -c foo'
  '# x | grep -q foo'               # grep-q-ok: self-test probe (a comment line)
  'y  # x | grep -q foo'
  'x | grep -E "^-q"'
  'x | grep -q foo  # grep-q-ok: input is one line'
)
for probe in "${MUST_FLAG[@]}"; do
  [[ -n "$(scan <<<"$probe")" ]] \
    || { echo "✗ check-grep-q-pipefail self-test: missed '$probe'" >&2; exit 2; }
done
for probe in "${MUST_PASS[@]}"; do
  if [[ -n "$(scan <<<"$probe")" ]]; then
    echo "✗ check-grep-q-pipefail self-test: flagged safe '$probe'" >&2; exit 2
  fi
done

if (($# > 0)); then
  FILES=("$@")
else
  FILES=()
  # A tracked file deleted in the working tree is skipped, not an error.
  while IFS= read -r f; do [[ -f "$f" ]] && FILES+=("$f"); done < <(git ls-files '*.sh')
  ((${#FILES[@]} > 0)) || { echo "✗ check-grep-q-pipefail: no *.sh files found" >&2; exit 2; }
fi

bad=0 scanned=0
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "✗ check-grep-q-pipefail: no such file $f" >&2; exit 2; }
  grep -qE -- "$PIPEFAIL_RE" "$f" || continue
  scanned=$((scanned + 1))
  hits="$(scan <"$f")"
  [[ -z "$hits" ]] && continue
  bad=1
  while IFS=$'\t' read -r n line; do
    echo "✗ $f:$n: pipes into grep -q under pipefail (§7.339): $(sed -E 's/^[[:space:]]+//' <<<"$line")"
  done <<<"$hits"
done

if ((bad)); then
  echo "Fix: grep -q PAT <(cmd), a here-string of a captured variable, or cmd | grep PAT >/dev/null." >&2
  echo "Or mark the line: # grep-q-ok: <why>" >&2
  exit 1
fi
echo "✓ no '| grep -q' under pipefail ($scanned scripts)"
