// What the route needs to decide WHICH of its three screens to render
// (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 6) — the route may not import @/lib, so
// the two role predicates and the stale-date guard reach it through here, unchanged.
import { canMark, roleNotice, type LessonRole } from "@/lib/coachRoster";

// The spinner also covers the gap between a param change and the reload landing —
// see the route. Re-exported, not wrapped: lib/attendanceSession.ts is the rule.
export { isShowingDate } from "@/lib/attendanceSession";

/** `readOnly` and `notice` exactly as the route computed them inline. */
export function roleView(role: LessonRole) {
  const readOnly = !canMark(role);
  const notice = roleNotice(role);
  return { readOnly, notice };
}
