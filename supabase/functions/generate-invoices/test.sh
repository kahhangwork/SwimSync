#!/usr/bin/env bash
# Run the generate-invoices integration tests against the LOCAL Supabase stack.
# Exports SUPABASE_URL + SERVICE_ROLE_KEY from `supabase status`, then runs the
# Deno tests. Prereq: `supabase start` (Docker) must be running.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../../.. && pwd)"

# The run list, relative to this directory. EVERY *.test.ts under supabase/functions
# (bench/ excluded) must be on it — the check below refuses to run otherwise, so a moved
# or new test file can never be silently skipped while the suite stays green
# (EDGE_FUNCTIONS_REFACTOR_PLAN.md P1).
TESTS=(
  test/billing.test.ts
  test/cancelledLessons.test.ts
  test/classDeactivation.test.ts
  test/clock.test.ts
  test/completeness.test.ts
  test/createdEmails.test.ts
  test/credit.test.ts
  test/dates.test.ts
  test/email.test.ts
  test/emailClaim.test.ts
  test/emailRetry.test.ts
  test/enrolmentSpans.test.ts
  test/fixtureGuard.test.ts
  test/guards.test.ts
  test/guestOnlyClass.test.ts
  test/isolation.test.ts
  test/makeups.test.ts
  test/multiClass.test.ts
  test/orderingGuard.test.ts
  test/packages.test.ts
  test/rates.test.ts
  test/runLog.test.ts
  test/seal.test.ts
  test/speed.test.ts
  test/trials.test.ts
  test/unclaimed.test.ts
  test/wave6.test.ts
  ../credit-note-emails/test/core.test.ts
  ../credit-note-emails/test/email.test.ts
  ../package-emails/test/email.test.ts
  ../package-emails/test/packageEmailMapping.test.ts
  ../public-invoice/core.test.ts
  ../public-package/core.test.ts
  ../tierBoundaries.test.ts
)

listed=$(for t in "${TESTS[@]}"; do (cd "$(dirname "$t")" && echo "$(pwd)/$(basename "$t")"); done | sort)
found=$(find "$ROOT/supabase/functions" -name '*.test.ts' ! -path '*/bench/*' | sort)
if [[ "$listed" != "$found" ]]; then
  echo "✗ test.sh's TESTS list does not match the *.test.ts files on disk:" >&2
  diff <(echo "$listed") <(echo "$found") | sed -n 's/^</  listed, not on disk:/p; s/^>/  on disk, NOT RUN:   /p' >&2 || true  # diff exits 1 on a difference; pipefail (§7.339)
  exit 2
fi

# `supabase status -o env` prints API_URL=... / SERVICE_ROLE_KEY=... / etc.
eval "$(cd "$ROOT" && supabase status -o env)"
export SUPABASE_URL="${API_URL}"
export SERVICE_ROLE_KEY

# A stale clock pin (a killed run-all-drivers.sh --now) would run the engine on a fake day. Read-only check.
"$ROOT/scripts/clock-unpin.sh" --check || exit 2

# --allow-read=.. is for tierBoundaries.test.ts, which reads supabase/functions source. Nothing else.
exec deno test --allow-net --allow-env --allow-read=.. "${TESTS[@]}"
