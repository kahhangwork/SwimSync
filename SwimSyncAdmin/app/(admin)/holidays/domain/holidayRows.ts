// Pure derivations for the Holidays page, lifted verbatim so they can be
// characterised alone.

/** How many lessons are currently voided on each holiday date. */
export function buildVoidCounts(
  rows: { lesson_sessions: { session_date: string } | null }[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const d = row.lesson_sessions?.session_date;
    if (d) counts[d] = (counts[d] ?? 0) + 1;
  }
  return counts;
}

/** The extension-days input is clamped to 0..90 whole days before saving. */
export function clampExtDays(next: number): number {
  return Math.min(90, Math.max(0, Math.trunc(next)));
}
