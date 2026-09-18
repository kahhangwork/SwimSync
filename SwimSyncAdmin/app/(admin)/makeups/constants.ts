// The search results, capped so a two-letter query over hundreds of
// children doesn't render a wall. The cap is display-only — narrowing the
// query is the intended way to find someone, and the cut is announced.
export const KID_RESULTS_CAP = 8;
