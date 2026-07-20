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

exec deno test --allow-net --allow-env core.test.ts email.test.ts dates.test.ts packages.test.ts
