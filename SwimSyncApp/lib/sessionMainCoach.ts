// "Am I the coach who marks this lesson?" — asked of the database, because it
// is the only party that can answer.
//
// ⚠ WHY THIS IS AN RPC AND NOT A COLUMN ON A QUERY WE ALREADY MAKE.
// `session_coaches_select` lets a coach read only their OWN roster rows, so the
// row that says "Coach B is covering Tuesday" is invisible to Coach A — whose
// screen is exactly the one that has to stop nagging about it.
// `coach_is_main_on_session()` is SECURITY DEFINER (20260811000200) and can see
// what the caller cannot, which is the entire reason it exists. It takes a
// UUID, not a `lesson_sessions` row, so it is not usable as a PostgREST
// computed column either.
//
// ⚠ THIS FILE HOLDS TWO FAIL-LOUD DIRECTIONS AND THEY ARE OPPOSITES. Do not
// "harmonise" them — they say the same thing about two different shapes of
// answer, and making them agree literally would break one of them:
//
//   · `fetchIsMainOnSession` (one session, a BOOLEAN) fails towards TRUE —
//     "I am the main coach".
//   · `fetchCoveredOutSessions` (many sessions, a SET of ids to DROP) fails
//     towards the EMPTY SET — "nobody else has any of these", which is the same
//     verdict expressed as a subtraction. Its validation lives in
//     `coachRoster.ts`'s `coveredOutFrom`, which is pure and therefore tested.
//
// The direction, in both: a wrong TRUE leaves a lesson on the coach's NEEDS
// MARKING list and the database refuses the save with a visible error. A wrong
// FALSE hides a lesson that genuinely needs marking — and unmarked attendance
// blocks the billing month with no override (§8i) and nothing on any screen
// saying why. Fail towards the loud failure.

import { supabase } from "./supabase";
import { coveredOutFrom, MAX_PROBE } from "./coachRoster";

/** TRUE if this coach is the one the database will accept attendance from.
 *  Every failure path answers TRUE — see the file header. */
export async function fetchIsMainOnSession(
  sessionId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("coach_is_main_on_session", {
      p_session_id: sessionId,
    });
    if (error) return true;
    return data === false ? false : true;
  } catch {
    return true;
  }
}

/**
 * The subset of `sessionIds` that some OTHER coach is rostered to teach.
 *
 * One round trip, whatever the size of the set — `sessions_i_am_main_on()`
 * (20260812000100) answers for the whole array. Returned as a Set of the ids to
 * drop, rather than a map of every answer, so a caller cannot accidentally
 * treat "not asked" as "covered".
 *
 * ⚠ EVERY PATH GOES THROUGH `coveredOutFrom`, WHICH IS THE POINT. This function
 * must never subtract anything itself, or the validation above becomes optional.
 */
export async function fetchCoveredOutSessions(
  sessionIds: readonly string[]
): Promise<Set<string>> {
  const unique = [...new Set(sessionIds)];
  if (unique.length === 0) return new Set();
  // Checked BEFORE the round trip, not only inside coveredOutFrom. Sending an
  // over-cap array and discarding the answer is a large POST plus one
  // SECURITY DEFINER call per element for a result we will not use — and it
  // would make MAX_PROBE's own comment ("the most we will ever ask about in one
  // request") false.
  if (unique.length > MAX_PROBE) return new Set();
  try {
    const { data, error } = await supabase.rpc("sessions_i_am_main_on", {
      p_session_ids: unique,
    });
    // A dropped function, a revoked grant, a network failure: `error` is set,
    // and the loud answer is "nothing is covered out".
    if (error || !Array.isArray(data)) return new Set();
    return coveredOutFrom(unique, data);
  } catch {
    return new Set();
  }
}
