// Moved verbatim from app/(coach)/pay/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// app fence).

/** Twelve months of payouts, and their items bounded below PostgREST's silent
 *  `max_rows` ceiling — the same discipline the Schedule tab's ROW_LIMIT
 *  encodes, for the same reason. */
export const ITEM_LIMIT = 900;
