// Who is teaching THIS lesson — the coach app's half of the lesson-level roster
// (`session_coaches`, 20260811000200).
//
// ⚠ THE ABSENCE RULE IS THE WHOLE SAFETY ARGUMENT, AND IT LIVES HERE TOO.
// No roster row means the class's own coach is the main coach. Every function
// below falls back that way, so a business that has never assigned anybody sees
// byte-identical behaviour to the day before the table shipped.
//
// ⚠ WHAT THIS COACH CAN SEE OF THE ROSTER IS ONLY THEIR OWN ROW.
// `session_coaches_select` is `admin OR coach_id = current_coach_id()`, so
// Coach A cannot read the row that says Coach B is covering A's Tuesday. A's
// screens therefore CANNOT derive "someone else has this lesson" from data —
// the only answer is the `coach_is_main_on_session()` gate, which is
// SECURITY DEFINER precisely so it can see the row A cannot. That is why
// `lessonRole` takes `coveredOut` as an input rather than working it out: the
// fact arrives from an RPC, and this file stays clock-free and IO-free like the
// rest of lib/ (§7.7's discipline).
//
// ⚠ NO CLOCK, NO FETCH. Callers pass everything in.

/** A roster row's role. The database enum is `session_coach_role`. */
export type RosterRole = "main" | "shadow";

/** One of MY `session_coaches` rows, flattened with the lesson it names. */
export type RosterAssignment = {
  sessionId: string;
  classId: string;
  /** YYYY-MM-DD */
  date: string;
  role: RosterRole;
};

/**
 * What this coach may do with one lesson on one date.
 *
 * `owner` is the only value that existed before Wave 3, and it is still what
 * every lesson resolves to until an admin assigns somebody.
 */
export type LessonRole =
  | "owner"    // my class, no roster main but me — the ordinary case
  | "cover"    // I am the roster main on a class I do not own
  | "shadow"   // I am rostered to watch: I read the lesson, I never mark it
  | "covered"; // someone else is the roster main — including on my own class

/** The key every lesson map in the coach app is keyed by. One lesson is one
 *  (class, date) pair — `lesson_sessions` carries UNIQUE (class_id,
 *  session_date), and the Schedule tab's `sessionByClassDate` already uses it. */
export function lessonKey(classId: string, date: string): string {
  return `${classId}:${date}`;
}

/**
 * Flatten the `session_coaches` → `lesson_sessions` embed into assignments.
 *
 * Tolerant on purpose: PostgREST renders a many-to-one embed as an object, but
 * renders it as an ARRAY when the relationship is resolved through a different
 * path, and a row whose embed did not come back at all is not a crash — it is a
 * lesson we simply cannot place. Dropping it silently is right here and only
 * here: a dropped assignment costs a coach a card they can chase, while a
 * malformed one would put a lesson on the wrong date, which is the §7.64 shape.
 */
export function parseAssignments(rows: readonly any[] | null): RosterAssignment[] {
  const out: RosterAssignment[] = [];
  for (const row of rows ?? []) {
    const role = row?.role;
    if (role !== "main" && role !== "shadow") continue;
    const embed = Array.isArray(row?.lesson_sessions)
      ? row.lesson_sessions[0]
      : row?.lesson_sessions;
    const classId = embed?.class_id;
    const date = embed?.session_date;
    const sessionId = embed?.id ?? row?.lesson_session_id;
    if (typeof classId !== "string" || typeof date !== "string") continue;
    if (typeof sessionId !== "string") continue;
    out.push({ sessionId, classId, date, role });
  }
  return out;
}

/** My assignments keyed by `lessonKey`. One row per (session, coach) is a
 *  database UNIQUE, so a later duplicate can only be a repeated fetch. */
export function assignmentsByLesson(
  assignments: readonly RosterAssignment[]
): Map<string, RosterAssignment> {
  const map = new Map<string, RosterAssignment>();
  for (const a of assignments) map.set(lessonKey(a.classId, a.date), a);
  return map;
}

/**
 * The dates I am rostered on, per class, ascending and de-duplicated.
 *
 * ⚠ THIS IS THE ONLY DATE SOURCE FOR A CLASS I DO NOT OWN, AND THAT IS THE
 * POINT. A substitute must see the ONE lesson they are covering, not the
 * class's every Tuesday: `lessonDatesInRange()` derives dates from the class's
 * weekday, so pointing it at a covered class would invent cards for lessons
 * nobody assigned me to — lessons whose sessions RLS will not even return.
 */
export function rosteredDatesByClass(
  assignments: readonly RosterAssignment[]
): Map<string, string[]> {
  const byClass = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = byClass.get(a.classId) ?? new Set<string>();
    set.add(a.date);
    byClass.set(a.classId, set);
  }
  const out = new Map<string, string[]>();
  for (const [classId, dates] of byClass) out.set(classId, [...dates].sort());
  return out;
}

/**
 * Resolve one lesson to a role.
 *
 * `coveredOut` answers `coach_is_main_on_session()` = FALSE for a lesson of a
 * class I DO own — the narrowing in 20260811000200's `attendance_write`. It is
 * only ever known for a session row that exists; a lesson with no session row
 * cannot have been assigned (an assignment creates the row through
 * `assign_session_coach()`), so `undefined` correctly means "not covered".
 */
export function lessonRole(opts: {
  ownsClass: boolean;
  assignment?: RosterRole;
  coveredOut?: boolean;
}): LessonRole {
  const { ownsClass, assignment, coveredOut } = opts;
  if (assignment === "shadow") return "shadow";
  if (assignment === "main") return ownsClass ? "owner" : "cover";
  // No row of my own on this lesson.
  if (!ownsClass) return "covered";
  return coveredOut ? "covered" : "owner";
}

/**
 * May I record attendance for this lesson?
 *
 * ⚠ THIS IS THE SAME PREDICATE THAT DECIDES NEEDS MARKING, DELIBERATELY.
 * A lesson I cannot save is a straggler I can never clear, and unmarked
 * attendance blocks the billing month with no override (§8i) — so a nag I am
 * not permitted to answer is worse than no nag at all. It is the covering
 * coach's list it belongs on, and `coach_is_main_on_session()` is the same
 * question the database asks on the write.
 */
export function canMark(role: LessonRole): boolean {
  return role === "owner" || role === "cover";
}

/** The short badge for a lesson card. `null` for the ordinary case, so an
 *  untouched business gains no new furniture on its screens. */
export function roleBadge(role: LessonRole): string | null {
  switch (role) {
    case "cover":   return "Covering";
    case "shadow":  return "Shadowing";
    case "covered": return "Covered";
    case "owner":   return null;
  }
}

/**
 * Why the attendance screen is read-only, said where the work would have
 * happened. Shown INSTEAD of the status buttons — a roster a coach can fill in
 * and never save is the failure `blocked` already exists to prevent.
 */
export function roleNotice(
  role: LessonRole
): { title: string; detail: string } | null {
  switch (role) {
    case "shadow":
      return {
        title: "You're shadowing this lesson",
        detail:
          "The main coach records attendance. You can see who is expected so you know the class.",
      };
    case "covered":
      return {
        title: "Another coach is teaching this lesson",
        detail:
          "Whoever your admin rostered to teach it marks it. Ask your admin if that isn't right.",
      };
    default:
      return null;
  }
}
