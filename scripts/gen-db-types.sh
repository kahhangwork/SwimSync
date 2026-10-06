#!/usr/bin/env bash
# Regenerate the Supabase `Database` types for BOTH apps from the LOCAL DB. Wave 8
# (docs/plans/WAVE8_GENERATED_TYPES_PLAN.md, F0 step 1).
#
# Writes SwimSyncApp/lib/database.types.ts and SwimSyncAdmin/lib/database.types.ts,
# byte-identical (the apps share no package; CI `cmp`s them).
#
# REFUSES (exit 1) when:
#   - run from a worktree — only the root checkout regenerates (§7.347);
#   - the local stack is down;
#   - the local DB's applied migrations ≠ this checkout's supabase/migrations
#     (a sibling's db/… migration would leak into the types — §7.347);
#   - the local CLI ≠ the version pinned in ci.yml (output differs by version).
#
# Run it after any migration that changes the public schema, and commit the result
# in the SAME commit as the migration — G5 (scripts/check-db-types.sh) fails CI otherwise.
#
# Usage: scripts/gen-db-types.sh
# Exit: 0 written · 1 refused · 2 the script itself is broken.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/db-types.sh
source "$ROOT/scripts/lib/db-types.sh"

if [[ "$(git -C "$ROOT" rev-parse --git-dir)" != "$(git -C "$ROOT" rev-parse --git-common-dir)" ]]; then
  echo "✗ this is a worktree — only the root checkout regenerates database types (§7.347)." >&2
  echo "  Ask the root session to run scripts/gen-db-types.sh and commit; then merge main." >&2
  exit 1
fi

db_types_require_cli "$ROOT"
db_types_require_migration_sync "$ROOT"

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
db_types_generate "$ROOT" "$tmp"
for t in "${DB_TYPES_TARGETS[@]}"; do
  cp "$tmp" "$ROOT/$t"
  echo "✓ wrote $t"
done
