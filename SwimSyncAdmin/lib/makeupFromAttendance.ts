// Booking a make-up from a row on the Attendance page — the pure decision bits,
// kept out of the component so they can be tested without a database.

/** Statuses a make-up can be booked from: the child missed the lesson. */
export const MAKEUP_STATUSES = [
  "absent",
  "cancelled_rain",
  "cancelled_coach",
] as const;

export function isMakeupEligibleStatus(status: string): boolean {
  return (MAKEUP_STATUSES as readonly string[]).includes(status);
}

/**
 * ⚠ RISK 6 — a make-up can only be seeded from the child's OWN enrolled class.
 * The attendance table also shows guest rows (a trial, or another child's
 * make-up), where the row's class is the HOST, not an enrolment. Passing that as
 * the home class earns a baffling "not one of the child's current classes"
 * refusal from book_makeup(). So the button shows only when the row is both a
 * missed-lesson status AND one of the child's active enrolments.
 */
export function canBookMakeupFromRow(
  status: string,
  isOwnEnrolledClass: boolean,
): boolean {
  return isMakeupEligibleStatus(status) && isOwnEnrolledClass;
}

export type HostClass = { id: string; category_id: string; is_active: boolean };

/**
 * Classes that can HOST a make-up for a child whose missed (home) class is
 * `homeClassId`: active, the same category, and NOT one of the child's own
 * classes. Excluding EVERY own class (not just the home) is load-bearing — their
 * other same-category class is the likeliest wrong pick, and booking it silently
 * VOIDS the make-up (the child attends a class they already attend). Returns []
 * when the home class is unknown (e.g. a retired class no longer in the list).
 */
export function makeupHostChoices<T extends HostClass>(
  classes: T[],
  homeClassId: string,
  ownClassIds: ReadonlySet<string>,
): T[] {
  const home = classes.find((c) => c.id === homeClassId);
  if (!home) return [];
  return classes.filter(
    (c) =>
      c.is_active && c.category_id === home.category_id && !ownClassIds.has(c.id),
  );
}
