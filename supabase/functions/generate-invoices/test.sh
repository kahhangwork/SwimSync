#!/usr/bin/env bash
# Run the generate-invoices integration tests against the LOCAL Supabase stack.
# Exports SUPABASE_URL + SERVICE_ROLE_KEY from `supabase status`, then runs the
# Deno tests. Prereq: `supabase start` (Docker) must be running.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../../.. && pwd)"

# `supabase status -o env` prints API_URL=... / SERVICE_ROLE_KEY=... / etc.
eval "$(cd "$ROOT" && supabase status -o env)"
export SUPABASE_URL="${API_URL}"
export SERVICE_ROLE_KEY

# A stale clock pin (a killed run-all-drivers.sh --now) would run the engine on a fake day. Read-only check.
"$ROOT/scripts/clock-unpin.sh" --check || exit 2

exec deno test --allow-net --allow-env core.test.ts clock.test.ts orderingGuard.test.ts email.test.ts emailClaim.test.ts dates.test.ts packages.test.ts unclaimed.test.ts trials.test.ts makeups.test.ts enrolmentSpans.test.ts classDeactivation.test.ts guestOnlyClass.test.ts cancelledLessons.test.ts runLog.test.ts wave6.test.ts ../package-emails/email.test.ts ../credit-note-emails/email.test.ts ../credit-note-emails/core.test.ts ../public-invoice/core.test.ts ../public-package/core.test.ts
