// Which read failed, for the admin lesson page's load. Pure — raw results in,
// one message out — so the rule is unit-tested rather than living inline.
//
// ⚠ EVERY read the page renders from is checked, and the first error fails the
// whole page. Until 2026-09-24 six were not (tenants, students, getSession and
// the three session-scoped reads), and a failed `attendance` read rendered
// every row "Not marked": an admin who re-marked and saved then upserted over
// the real statuses — the save sends `prevStatus: null`, so the changed-rows
// filter could not protect them, and a billed `present` turned into anything
// else issued a credit note. A failed read must never look like an empty one.

/** The shape every Supabase result shares — `{ error }`, null on success. */
export type ReadResult = { error: { message: string } | null };

/** The first error's message, in the order given; null when every read succeeded. */
export function firstLoadError(results: readonly ReadResult[]): string | null {
  return results.find((r) => r.error)?.error?.message ?? null;
}

/** Shown instead of the lesson when no one is signed in: a Save would do nothing. */
export const SIGNED_OUT_MESSAGE =
  "Your sign-in has expired, so changes here can't be saved. Sign in again, then reopen this lesson.";
