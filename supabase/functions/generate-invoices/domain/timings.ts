// Per-part run timings, moved verbatim out of core.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B7).

import type { RunTimings } from "../types.ts";

/** Whole milliseconds per part of a run; `tInvoices` null when phase 2 never ran. */
export function timingsSince(
  tStart: number,
  tGuards: number,
  tTally: number,
  tInvoices: number | null
): RunTimings {
  const end = tInvoices ?? tTally;
  return {
    guards: Math.round(tGuards - tStart),
    tally: Math.round(tTally - tGuards),
    invoices: tInvoices === null ? 0 : Math.round(tInvoices - tTally),
    total: Math.round(end - tStart),
  };
}
