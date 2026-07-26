#!/usr/bin/env bash
# Fails if any fixtures-*.sql has no sibling fixtures-*-teardown.sql.
#
# WHY THIS IS A CI GUARD AND NOT A NOTE. The rule is mechanical and it kept being
# forgotten: on 2026-07-26 NINE of the thirteen fixtures had no teardown, and two
# of the four that did (`-attendance-guard`, `-contact-details`) were written a
# session LATE, after the fixture had already shipped. A note in a document does
# not catch that; a failing build does.
#
# What it costs to skip: one Postgres serves every worktree on the machine
# (docs/GOTCHAS.md §7.55), and /session-close forbids `supabase db reset` as
# cleanup because it rebuilds that database from whichever branch happens to be
# running. Without a teardown a session has no third option — it either leaves
# rows behind, or destroys a sibling's state. Rows left behind are not merely
# untidy: a sibling's test can PASS BECAUSE OF THEM.
#
# Run locally:  .claude/skills/run-ui-playwright/drivers/check-teardowns.sh

set -euo pipefail
cd "$(dirname "$0")"

missing=()
for f in fixtures-*.sql; do
  case "$f" in *-teardown.sql) continue ;; esac
  [[ -f "${f%.sql}-teardown.sql" ]] || missing+=("$f")
done

if ((${#missing[@]})); then
  echo "✗ ${#missing[@]} fixture(s) have no teardown script:"
  printf '    %s  →  needs %s\n' "${missing[@]/%.sql/.sql}" >/dev/null 2>&1 || true
  for f in "${missing[@]}"; do
    echo "    $f  →  create ${f%.sql}-teardown.sql"
  done
  cat <<'EOF'

A fixture seeds the SHARED local database. Without a teardown, the only way to
clean up is `supabase db reset`, which rebuilds that database from whichever
branch is running and takes a sibling worktree's state with it.

Write the teardown next to the fixture. Copy the shape from
fixtures-attendance-guard-teardown.sql:
  • delete by EXACT id or a UUID prefix the fixture owns — never a name pattern
    (`LIKE '%Guard%'` works today and takes a real child called Guardiola later)
  • reverse any UPDATE the fixture made, not just its INSERTs
  • delete audit_log rows authored by the fixture BEFORE the profile
    (actor_id is NOT NULL / NO ACTION — docs/GOTCHAS.md §7.50)
  • clean up what the DRIVER wrote too, not only the fixture
  • end with a SELECT that prints 0 for each thing removed, and 1 for each seed
    identity that must have survived

Then prove it round-trips: snapshot table counts, apply the fixture, apply the
teardown, and assert the counts are identical. See docs/WORKTREES.md Phase 4.
EOF
  exit 1
fi

echo "✓ all $(ls fixtures-*.sql | grep -vc -- '-teardown.sql') fixtures have a teardown"
