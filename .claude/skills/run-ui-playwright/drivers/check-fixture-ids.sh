#!/usr/bin/env bash
# Fails if a UI fixture or driver carries a UUID that looks CAPTURED, not made.
#
# WHY THIS IS A CI GUARD AND NOT A NOTE. It was filed as a gotcha twice — §7.163
# (a driver borrowed a class id from a live DB) and §7.224 (a fixture carried
# the seed's Saturday Beginners id). `seed.sql` names no `id` on most of its
# INSERTs, so Postgres mints fresh UUIDs on every `db reset`: an id copied out
# of today's database loads fine today and fails on the first reset. The
# roundtrip check cannot see it — it never resets (§7.224).
#
# THE RULE IT ENFORCES. Every id a fixture owns, and every stable seed constant
# (`7c000000-…`, `a0000000-…`), is HAND-MADE, and hand-made ids are mostly
# zeros. A captured id is random v4, which contains a run of four zeros about
# once in 2,000. So: any UUID literal without `0000` in it is a captured id.
# Resolve a seed row by a stable identity instead — an email, or a title with
# `ORDER BY created_at, id LIMIT 1` and a RAISE when it comes back NULL.
#
# Run locally:  .claude/skills/run-ui-playwright/drivers/check-fixture-ids.sh

set -euo pipefail
cd "$(dirname "$0")"

uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
hits=$(grep -noE "$uuid" fixtures-*.sql ./*.mjs | grep -v '0000' || true)

if [[ -n "$hits" ]]; then
  echo "✗ UUID literal(s) that look captured from a live database:"
  echo "$hits" | sed 's/^/    /'
  cat <<'EOF'

A seed row's id changes on every `supabase db reset` (docs/GOTCHAS.md §7.163,
§7.224). Either OWN the row — insert it in the fixture with a hand-made id like
`c5000000-0000-0000-0000-000000000001` and delete it in the teardown — or look
the seed row up by a stable identity (an email, or a title with ORDER BY and a
RAISE when it is missing).
EOF
  exit 1
fi

echo "✓ no captured UUIDs in $(ls fixtures-*.sql ./*.mjs | wc -l | tr -d ' ') fixture/driver files"
