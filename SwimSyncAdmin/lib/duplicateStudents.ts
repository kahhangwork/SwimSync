// Spotting two rows that are probably the same child.
//
// WHY THIS EXISTS. The claim flow (PARENT_CLAIM_PLAN) stops duplicates being
// created from now on. It does nothing about the ones already there — every
// child added before it shipped, plus every child a parent deliberately created
// by answering "no, that's a different child". Without this the admin has no
// way to know a duplicate exists, and the remedy is SQL.
//
// ⚠ THE MATCH RULE IS DUPLICATED FROM SQL, DELIBERATELY, AND MUST STAY IN STEP.
// `names_match()` in 20260726000200 is the authority — it decides what a parent
// is offered, which is the security-relevant use. This copy only decides what
// the admin is SHOWN on their own business's data, so a drift here is a missed
// suggestion rather than a leak. It is duplicated for the same reason
// lessonDates.ts is: there is no shared package between the DB, the admin and
// the app. If you change one, change both:
//   supabase/migrations/20260726000200_find_student_candidates.sql
//
// A DETECTION IS A DERIVATION, NOT A FLAG. Nothing would maintain a stored
// "possible duplicate" column, and a stored value nothing maintains is not a
// fact (§7.37). The pool is a few dozen rows per business, so deriving it on
// read is both cheaper and always correct.

export type DupStudent = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  /** Has a parent account attached. */
  claimed: boolean;
  /** How many attendance rows — decides which row must survive a merge. */
  lessons: number;
};

export type DupPair = {
  /** The row that must survive: the one holding the history. */
  survivor: DupStudent;
  duplicate: DupStudent;
  /** True when neither row has attendance, so the direction is arbitrary. */
  eitherWay: boolean;
  /** True when BOTH carry attendance — merge will refuse; a human must look. */
  needsHuman: boolean;
};

/** Lowercased tokens of 2+ characters. Mirrors SQL name_tokens(). */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length >= 2);
}

/**
 * Mirrors SQL names_match(): the given name matches, or two tokens do.
 *
 * NOT "any shared token" — in Singapore that makes every Tan match every Tan,
 * which here would bury a real duplicate in a page of noise, and on the
 * parent-facing side would be a disclosure bug.
 */
export function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta[0] === tb[0]) return true;
  return ta.filter((t) => tb.includes(t)).length >= 2;
}

/**
 * Pairs worth showing the admin.
 *
 * Only pairs where AT LEAST ONE side is unclaimed: two children who each have
 * their own parent account are two families, and suggesting a merge there is
 * both wrong and alarming.
 *
 * A conflicting date of birth is disqualifying. Two children genuinely called
 * "Ethan Tan" born on different days are siblings or namesakes, not a
 * duplicate — and the whole reason duplicates form is that one side usually has
 * NO date of birth at all, which is not a conflict.
 */
export function findDuplicatePairs(students: DupStudent[]): DupPair[] {
  const pairs: DupPair[] = [];

  for (let i = 0; i < students.length; i++) {
    for (let j = i + 1; j < students.length; j++) {
      const a = students[i];
      const b = students[j];

      if (a.claimed && b.claimed) continue;
      if (!namesMatch(a.full_name, b.full_name)) continue;
      if (a.date_of_birth && b.date_of_birth && a.date_of_birth !== b.date_of_birth) {
        continue;
      }

      const needsHuman = a.lessons > 0 && b.lessons > 0;
      const eitherWay = a.lessons === 0 && b.lessons === 0;
      // The survivor is the row with the history; merge_students() refuses the
      // other direction outright, so offering it would be offering a refusal.
      const survivor = b.lessons > a.lessons ? b : a;
      const duplicate = survivor === a ? b : a;

      pairs.push({ survivor, duplicate, eitherWay, needsHuman });
    }
  }

  return pairs;
}
