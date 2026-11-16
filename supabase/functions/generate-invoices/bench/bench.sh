#!/usr/bin/env bash
# Run the billing-engine benchmark against the LOCAL stack. Env knobs: see run.ts.
#   ./bench/bench.sh                                   # 12×5 seed, no added latency
#   LATENCY_MS=300 CLASSES=6 PER_CLASS=2 ./bench/bench.sh
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../../../.. && pwd)"
eval "$(cd "$ROOT" && supabase status -o env 2>/dev/null)"
export SUPABASE_URL="${API_URL}" SERVICE_ROLE_KEY
exec deno run --allow-net --allow-env --allow-read --allow-write run.ts
