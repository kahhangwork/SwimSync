/**
 * The comparison rules behind every sortable column in the admin panel.
 *
 * Kept here, pure and free of React, because the interesting part of sorting is
 * not the click handler — it is what "A→Z" means for a column holding
 * `S$40.00`, `2026-07-19`, `Tanglin View Sun 930am`, and `—` all at once.
 * `useTableSort` in `components/Table.tsx` is the thin stateful wrapper.
 */

export type SortDir = "asc" | "desc";

/** What a column can hand the comparator. Anything else should be mapped first. */
export type SortValue = string | number | boolean | null | undefined;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * A cell with nothing in it.
 *
 * The em/en dash matters as much as `null` does: the admin pages render `—`
 * for "no coach", "not on payroll", "no rate yet", so by the time a value
 * reaches here the *absence* has already become a string. Treating it as text
 * would sort those rows into the middle of the alphabet, which is where a
 * missing coach is hardest to notice.
 *
 * A plain hyphen is deliberately NOT blank — it is a real character in real
 * data (`Sun 8-45am`, hyphenated names), and there is no way to tell a
 * placeholder from content once we start guessing.
 */
export function isBlank(value: SortValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false; // 0 and false are values, not blanks
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "—" || trimmed === "–";
}

/**
 * Ascending comparison of two NON-BLANK values. Blanks are handled by
 * `sortRows`, which must keep them last in both directions — so they cannot go
 * through a comparator that gets negated.
 */
export function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a) - Number(b);

  const as = String(a);
  const bs = String(b);

  // ISO dates already sort correctly as text, and comparing them as text keeps
  // sorting free of timezone conversion entirely — which is the only way this
  // can never repeat §7.7. There is no Date construction anywhere in this file.
  if (ISO_DATE.test(as) && ISO_DATE.test(bs)) {
    return as < bs ? -1 : as > bs ? 1 : 0;
  }

  // `numeric` is what makes a column of class names read the way a human wrote
  // them: "Sun 845am" before "Sun 930am", and "Level 2" before "Level 10",
  // which plain lexical order gets backwards. `sensitivity: "base"` makes the
  // sort case-insensitive, so a lowercase entry does not land after Z.
  return as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
}

const DAY_ORDER = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * Weekday sort position, for any column showing a day name.
 *
 * A weekday is the one column where A→Z is simply wrong: alphabetically the
 * week runs Friday, Monday, Saturday, Sunday, Thursday, Tuesday, Wednesday,
 * which tells an admin nothing about which classes run near each other.
 *
 * `lib/lessonDates.ts` holds the same order in a private `DAY_INDEX`, and it is
 * deliberately not exported or imported here: that file is duplicated
 * byte-identical across SwimSyncAdmin, SwimSyncApp and the Edge Function
 * (`docs/ARCHITECTURE.md` §6), so widening its surface for a display concern
 * would mean editing three copies. Sorting is not a lesson-date calculation.
 * The order is a calendar fact and cannot drift; `tableSort.test.ts` pins it.
 */
export function dayOfWeekOrder(day: string | null | undefined): number | null {
  if (!day) return null; // blank, so it sorts last rather than as Sunday
  const i = DAY_ORDER.indexOf(day.trim().toLowerCase() as (typeof DAY_ORDER)[number]);
  return i === -1 ? null : i;
}

/**
 * Sort a copy of `rows` by the value `get` extracts from each.
 *
 * Two guarantees the call sites depend on:
 *
 * 1. **Blank cells stay last in both directions.** Reversing the sort of a
 *    column that is half-empty should not fill the first screen with `—`; the
 *    rows you can act on stay where you can see them.
 * 2. **It is stable**, because `Array.prototype.sort` is. Rows that tie on the
 *    sort column keep the order the page put them in, so sorting Attendance by
 *    Status leaves each status group in date order rather than scrambled.
 */
export function sortRows<T>(
  rows: readonly T[],
  get: (row: T) => SortValue,
  dir: SortDir
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((rowA, rowB) => {
    const a = get(rowA);
    const b = get(rowB);
    const aBlank = isBlank(a);
    const bBlank = isBlank(b);
    if (aBlank || bBlank) {
      if (aBlank && bBlank) return 0;
      return aBlank ? 1 : -1; // NOT multiplied by sign — that is the point
    }
    return sign * compareValues(a, b);
  });
}
