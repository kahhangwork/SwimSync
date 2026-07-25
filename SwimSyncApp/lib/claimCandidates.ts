// Presenting an unclaimed child to a parent who may or may not be theirs.
//
// ⚠ THIS FILE DOES NOT MASK ANYTHING, AND MUST NOT START TO.
// The masking is done in SQL by find_student_candidates(), so a full name never
// crosses the wire at all — that is the whole point, and a mask applied here
// would be decoration over data the network tab already has. Everything below
// only FORMATS what the server already reduced.
//
// The wording matters as much as the data. The popup appears at the moment a
// parent is trying to finish a task, offering a card that looks like the
// answer, and a wrong "Confirm" is the one outcome that hands a stranger a
// family's attendance and billing history. So the copy asks a QUESTION and
// never announces a finding.

import { formatSgDate } from "./lessonDates";

export type ClaimCandidate = {
  student_id: string;
  masked_name: string;
  match_reason: "email" | "phone" | "name_dob" | "name_only" | string;
  last_lesson: string | null;
  class_title: string | null;
};

/**
 * The single line describing a candidate, e.g.
 *   "Ethan T. W. M. — Saturday Beginners on Sat 11 Jul"
 *
 * The lesson detail is the load-bearing half: it is the thing a real parent can
 * check and a guesser cannot. A candidate with no lesson yet says so plainly
 * rather than rendering a dangling dash.
 */
export function describeCandidate(c: ClaimCandidate): string {
  const when = c.last_lesson ? formatSgDate(c.last_lesson) : null;
  if (!when) return `${c.masked_name} — no lessons recorded yet`;
  return c.class_title
    ? `${c.masked_name} — ${c.class_title} on ${when}`
    : `${c.masked_name} — last lesson ${when}`;
}

/**
 * Why this child was suggested, in the parent's language.
 *
 * Deliberately vague about the phone case: "the contact number your coach has"
 * rather than echoing the number back. Confirming a number is a disclosure in
 * itself — it would let anyone holding a join code test whether a given phone
 * belongs to a family at that business.
 */
export function matchReasonLabel(reason: string): string {
  switch (reason) {
    case "email":
      return "This matches the email address your coach has on file.";
    case "phone":
      return "This matches the contact number your coach has on file.";
    case "name_dob":
      return "The name and date of birth both match.";
    case "name_only":
      return "The name is similar.";
    default:
      return "This may be the same child.";
  }
}

/**
 * Is this outcome one where the child was NOT created and the parent is now
 * waiting? Both claim answers land here, because the admin decides every link.
 */
export function isPendingOutcome(outcome: string): boolean {
  return outcome === "pending" || outcome === "already_pending";
}

/**
 * How long a claim has been waiting, in the parent's words.
 *
 * A blocked parent with no sense of elapsed time assumes the app is broken.
 * Saying "waiting since Sat 26 Jul" plus a named next action is the difference
 * between patience and a call to the coach — and there is deliberately no
 * email chasing the admin (PARENT_CLAIM_PLAN decision 7), so this line is the
 * only thing managing that wait.
 */
export function waitingSince(createdAtIso: string): string {
  const d = createdAtIso.slice(0, 10);
  return `Waiting since ${formatSgDate(d)}`;
}
