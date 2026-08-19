// The business's own marking floor, fetched from the database.
//
// WHY THIS EXISTS AS ITS OWN FILE. Since 20260806000200 the floor follows
// `billing_periods` rather than the calendar, so it can no longer be computed
// on the device — and the coach app cannot read `billing_periods` directly
// (its SELECT policy is platform-admin or tenant-admin only, deliberately: a
// coach app shows no invoice or payment figures). `markable_window_start()` is
// a SECURITY DEFINER function that answers with one DATE for the caller's own
// business and nothing else.
//
// ⚠ EVERY FAILURE PATH RETURNS null, AND null IS SAFE. The consumers
// (backlogWindowStart, markableWindowStart) apply the result as a MINIMUM
// against the calendar rule, so a null floor produces exactly the behaviour the
// app had before this migration. That is why this never throws and never
// surfaces an error to the coach: the floor is an affordance, and a coach who
// cannot reach a two-month-old lesson has lost nothing they had yesterday,
// whereas a coach who cannot open the screen has lost the day's work.
//
// It does not LOG either, deliberately. Nothing else under app/ or lib/ writes
// to the console, and on React Native a console.warn raises a dev yellow-box —
// an alarm for the one condition this file exists to make unremarkable. If this
// ever needs diagnosing, the database is the place to ask: the floor is
// markable_floor(tenant), and the RPC either grants EXECUTE to `authenticated`
// or it does not.

import { supabase } from "./supabase";

/**
 * The caller's business's marking floor as "YYYY-MM-DD", or null if it could
 * not be fetched. Callers pass the result straight through as `serverFloor` /
 * `windowFloor`; they must not branch on null.
 */
export async function fetchMarkableFloor(): Promise<string | null> {
  // try/catch as well as the { error } shape, because callers START this
  // promise before they AWAIT it (so the round trip overlaps the queries they
  // were already making). An unawaited promise that rejects is an unhandled
  // rejection, and supabase-js only returns transport failures in `error` for
  // the paths it handles — a DNS or fetch-layer throw comes out as a rejection.
  // Resolving to null on every path is what makes the deferred await safe.
  try {
    const { data, error } = await supabase.rpc("markable_window_start");
    if (error) return null;

    // The RPC returns a bare DATE, which PostgREST renders as "YYYY-MM-DD".
    // Anything else means the contract moved; treat it as absent rather than
    // feeding a malformed string into date comparisons.
    return typeof data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data)
      ? data
      : null;
  } catch {
    return null;
  }
}
