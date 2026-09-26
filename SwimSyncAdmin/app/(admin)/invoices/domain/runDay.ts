import { runDayOf } from "@/lib/billingMonths";

/**
 * What the run-day input shows, and what it says, after a save.
 *
 * Decided from the value RE-READ from the database, never from the update's
 * error alone: an update that RLS filters out (a suspended business, a
 * disabled co-admin) returns no error and changes nothing, so "no error"
 * cannot be read as "saved". Before this, a refused save left the input
 * showing the rejected day while billing ran on the stored one.
 *
 * `storedRaw` is `undefined` when the re-read itself failed — the input then
 * keeps what was typed, and the message says the saved day is unknown.
 */
export function runDaySaveOutcome(
  wanted: number,
  updateError: string | null,
  storedRaw: unknown
): { day: number | null; message: string | null } {
  if (storedRaw === undefined) {
    return {
      day: null,
      message: updateError
        ? `Error: ${updateError} — reload to see the saved run day.`
        : "Could not confirm the run day saved — reload to check.",
    };
  }
  const stored = runDayOf(storedRaw);
  if (updateError) return { day: stored, message: `Error: ${updateError}` };
  if (stored !== wanted) {
    return { day: stored, message: `Not saved — the run day is still ${stored}.` };
  }
  return { day: stored, message: null };
}
