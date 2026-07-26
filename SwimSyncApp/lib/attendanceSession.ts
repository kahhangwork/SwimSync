// Which lesson_session a save is allowed to write to.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// The Mark Attendance screen is reached at ONE route,
// /(coach)/classes/[id]/attendance, with the lesson identified only by a
// `?date=` search param. Today's card, the Unmarked Lessons backlog and the
// class roster all push that same route with a different date.
//
// Expo Router reuses the mounted screen when only search params change, so the
// component does NOT remount. `date` comes from useLocalSearchParams and is
// reactive, so the header repaints to the new lesson immediately — but any
// session id held in component state still belongs to the PREVIOUS lesson.
//
// That shipped, and it wrote attendance to the wrong day: a coach opened the
// backlog's 19 Jul lesson from today's screen, marked two children, got
// "Attendance saved.", and the rows landed on the 26 Jul session. The 19 Jul
// lesson stayed unmarked (correctly — nothing was written to it) while today's
// lesson silently acquired statuses nobody had entered for it. A 200 and a
// success toast the whole way. See §7.62.
//
// The screen's effect deps are the root fix. This is the second layer, and it
// is the one that holds even if the first is broken again: a session id is
// never a bare string here, it is a string BOUND TO THE DATE IT WAS RESOLVED
// FOR. A resolution for another date is not a session id at all — it is
// `stale`, and the caller must go back to the database rather than write.
//
// This is the same shape as attendanceWindow.ts: the client cannot be the only
// thing standing between a coach and a wrong row, but where the database
// cannot tell the difference — and it cannot, because (class_id, session_date)
// is a perfectly valid lesson whichever date the client meant — the client
// must not guess.

/**
 * A session id together with the date it was resolved for.
 *
 * `sessionId` null means "resolved, and this lesson has no session row yet" —
 * which is different from "not resolved", and the difference is what lets the
 * ordinary first-time save skip a redundant round trip.
 */
export type ResolvedSession = {
  date: string;
  sessionId: string | null;
};

/** What a save should do about the session row. */
export type SessionResolution =
  /** Write to this existing session. */
  | { kind: "use"; sessionId: string }
  /** No session exists for this date yet; create one. */
  | { kind: "create" }
  /** What we are holding belongs to another date. Re-resolve from the server. */
  | { kind: "stale" };

/**
 * Decide what `date` should be written to, given whatever the screen is
 * currently holding.
 *
 * Returns `stale` for anything not provably about `date` — including null.
 * Defaulting to `stale` rather than to the carried id is the whole point: the
 * cost of a needless lookup is one indexed query on a unique key, and the cost
 * of the other mistake is attendance on the wrong lesson.
 */
export function resolveSessionForDate(
  resolved: ResolvedSession | null,
  date: string
): SessionResolution {
  if (resolved === null || resolved.date !== date) return { kind: "stale" };
  return resolved.sessionId === null
    ? { kind: "create" }
    : { kind: "use", sessionId: resolved.sessionId };
}

/**
 * Is the screen currently showing data that belongs to `date`?
 *
 * Used to hold the spinner over the gap between a param change and the reload
 * finishing. Without it there is a window — short, but a tap is shorter — in
 * which the header names the new lesson while the roster beneath it, and the
 * statuses in it, are still the previous one's.
 */
export function isShowingDate(
  resolved: ResolvedSession | null,
  date: string
): boolean {
  return resolved !== null && resolved.date === date;
}
