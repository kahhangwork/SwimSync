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
// ⚠ EVERY FAILURE PATH ANSWERS "I AM THE MAIN COACH", AND THAT DIRECTION IS
// DELIBERATE. A wrong TRUE leaves a lesson on the coach's NEEDS MARKING list
// and the database refuses the save with a visible error. A wrong FALSE hides a
// lesson that genuinely needs marking — and unmarked attendance blocks the
// billing month with no override (§8i) and nothing on any screen saying why.
// Fail towards the loud failure.

import { supabase } from "./supabase";

/** How many probes are in flight at once. The caller passes only sessions that
 *  already EXIST and are still unmarked — covers, partially-marked lessons and
 *  admin-scheduled extras — which is a handful, not a month of history. The
 *  chunking is here so that stays true if a caller ever gets generous. */
const CHUNK = 8;

/** TRUE if this coach is the one the database will accept attendance from. */
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
 * Returned as a Set of the ids to drop, rather than a map of every answer, so a
 * caller cannot accidentally treat "not asked" as "covered".
 */
export async function fetchCoveredOutSessions(
  sessionIds: readonly string[]
): Promise<Set<string>> {
  const unique = [...new Set(sessionIds)];
  const covered = new Set<string>();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const answers = await Promise.all(chunk.map(fetchIsMainOnSession));
    chunk.forEach((id, n) => {
      if (!answers[n]) covered.add(id);
    });
  }
  return covered;
}
