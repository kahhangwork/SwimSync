#!/usr/bin/env bash
# G5 — the committed `Database` types match the schema. Wave 8
# (docs/plans/WAVE8_GENERATED_TYPES_PLAN.md, F0 step 3).
#
# WHY. Generated types are only true while they match the migrations. A migration
# that changes the public schema without a regen leaves the apps compiling against
# a schema that no longer exists — the exact lie (§7.76) the types were added to end.
#
# THE RULE. Regenerate from the local DB into a temp file and diff it against BOTH
# committed files (SwimSyncApp/ and SwimSyncAdmin/lib/database.types.ts). Any
# difference fails. Then runs scripts/check-db-overrides.sh (it needs the same DB).
#
# Runs in CI's backend-tests job right after `supabase start`. CI's G5 runs AFTER
# Vercel has deployed a push, so run it LOCALLY before every push to main — that is
# the real gate. Safe from a worktree (it writes nothing), but it refuses when the
# shared DB's migrations ≠ this checkout's.
#
# Usage: scripts/check-db-types.sh
# Exit: 0 in sync · 1 stale/refused · 2 the check itself is broken.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/db-types.sh
source "$ROOT/scripts/lib/db-types.sh"

versions() {
  echo "  CLI: local $(db_types_local_cli || true) · pinned in ci.yml $(db_types_pinned_cli "$ROOT" 2>/dev/null || echo '?')" >&2
}

db_types_require_cli "$ROOT" || { versions; exit 1; }
db_types_require_migration_sync "$ROOT" || exit 1

tmp=$(mktemp)
trap 'rm -f "$tmp" "$tmp.diff"' EXIT
db_types_generate "$ROOT" "$tmp" || { versions; exit 2; }

stale=0
for t in "${DB_TYPES_TARGETS[@]}"; do
  if [[ ! -f "$ROOT/$t" ]]; then
    echo "✗ G5: $t is missing" >&2; stale=1; continue
  fi
  if ! diff -u "$ROOT/$t" "$tmp" >"$tmp.diff"; then
    echo "✗ G5: $t does not match the schema:" >&2
    head -40 "$tmp.diff" >&2
    stale=1
  fi
done

if ((stale)); then
  echo "" >&2
  echo "  run scripts/gen-db-types.sh and commit (in the same commit as the migration)." >&2
  versions
  exit 1
fi
echo "✓ G5: both database.types.ts match the local schema"

"$ROOT/scripts/check-db-overrides.sh"
