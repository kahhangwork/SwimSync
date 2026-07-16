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

/**
 * Build a NEW attendance map with every student set to next.top/next.sub. Each student's
 * existingId is preserved so handleSave upserts/updates in place rather than duplicating.
 * Does not mutate the input.
 */
export function applyBulkStatus(
  studentIds: string[],
  current: Record<string, { existingId: string | null }>,
  next: { top: BulkTop; sub: "rain" | "coach" | null }
): Record<string, { top: BulkTop; sub: "rain" | "coach" | null; existingId: string | null }> {
  const result: Record<
    string,
    { top: BulkTop; sub: "rain" | "coach" | null; existingId: string | null }
  > = {};
  for (const id of studentIds) {
    result[id] = {
      top: next.top,
      sub: next.sub,
      existingId: current[id]?.existingId ?? null,
    };
  }
  return result;
}
