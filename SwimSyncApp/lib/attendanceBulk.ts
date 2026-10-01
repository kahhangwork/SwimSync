// Bulk "Set all to…" helper for the coach attendance screen.
// Pure logic, kept out of the screen so it's unit-testable (jest runs lib/** only).

export type BulkTop = "present" | "absent" | "cancelled";

export type BulkOption = {
  label: string; // "Present", "Cancelled — Rain", …
  top: BulkTop;
  sub: "rain" | "coach" | null;
  dot: string; // tailwind bg for the colour dot (mirrors TOP_STATUSES palette)
};

// Trial is deliberately excluded — a whole class of trials never happens, and its
// paid/free split would need a sub-type prompt. It stays a per-student choice.
export const SET_ALL_OPTIONS: BulkOption[] = [
  { label: "Present", top: "present", sub: null, dot: "bg-green-500" },
  { label: "Absent", top: "absent", sub: null, dot: "bg-gray-400" },
  { label: "Cancelled — Rain", top: "cancelled", sub: "rain", dot: "bg-orange-500" },
  { label: "Cancelled — Coach", top: "cancelled", sub: "coach", dot: "bg-orange-500" },
];

export type BulkState = { top: BulkTop; sub: "rain" | "coach" | null };

/**
 * Build a NEW attendance map: every id in `studentIds` set to next.top/next.sub, and
 * EVERY OTHER entry of `current` carried over untouched. A set entry is a status
 * only — there is no attendance-row id to carry: the save matches an existing row on
 * (lesson_session_id, student_id), and sending the primary key is what broke
 * partially-marked lessons (§7.67). (The save payload is built from statuses in
 * lib/attendancePayload.ts, so a carried-over entry cannot put an id back in it.)
 *
 * ⚠ The carry-over is load-bearing. The caller leaves a public-holiday void out of
 * `studentIds` (a coach may not re-mark it); until 2026-10-02 this returned only the
 * listed ids, so that row was DELETED from the map and Save refused the lesson.
 * Does not mutate the input.
 */
export function applyBulkStatus<T>(
  studentIds: string[],
  current: Record<string, T>,
  next: BulkState
): Record<string, T | BulkState> {
  const result: Record<string, T | BulkState> = { ...current };
  for (const id of studentIds) {
    result[id] = {
      top: next.top,
      sub: next.sub,
    };
  }
  return result;
}
