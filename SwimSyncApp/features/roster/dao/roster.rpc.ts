// Postgres-function access for the coach roster screen. Stage 3 of
// docs/refactor/COACH_ROSTER_REFACTOR_PLAN.md.
//
// ORCHESTRATE, NEVER REPLACE. These are BINDINGS of shared lib/ helpers, not
// re-implementations: the helpers stay in lib/ (shared, or twinned with the
// admin app), and binding them here is what keeps the screen's tiers from
// touching the client.
//
// dao/ is transport only (fence check 2).

// Reads the markable window's floor itself (an RPC inside lib/markableFloor —
// it imports the client, so the fence's check 3 treats importing it as a
// network reach). Re-exported untouched: it resolves on every path and NEVER
// rejects, which is what makes the load's deferred await safe. Do not wrap it
// in anything that could reject.
export { fetchMarkableFloor } from "@/lib/markableFloor";
