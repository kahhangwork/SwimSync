// Postgres-function access for the coach Schedule tab (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 3).
//
// ORCHESTRATE, NEVER REPLACE. These are BINDINGS of shared lib/ helpers, not
// re-implementations: both hold the client themselves and stay in lib/ (shared
// with the roster and the marking screen). Re-exporting them here is what keeps
// the screen's tiers from touching a client-holding helper directly.
//
// dao/ is transport only (fence check 2).

// Reads the business's markable floor (an RPC inside lib/markableFloor). It
// resolves on every path and NEVER rejects — do not wrap it in anything that
// could reject.
export { fetchMarkableFloor } from "@/lib/markableFloor";

// ONE round trip for the whole probe array (`sessions_i_am_main_on`). It
// DEDUPES FIRST and then applies MAX_PROBE to the unique count; over the cap it
// returns the EMPTY set (fail-loud: covered lessons stay on the owner's list).
// ⚠ Pass the probe list RAW — do not dedupe or slice it on the way in.
export { fetchCoveredOutSessions } from "@/lib/sessionMainCoach";
