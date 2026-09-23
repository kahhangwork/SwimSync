// Moved VERBATIM from app/package/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); pinned by formatDate.test.ts. String parsing only — no Date object,
// so no timezone drift.
import { MONTHS_SHORT } from "../constants";

export function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const month = MONTHS_SHORT[Number(m[2]) - 1];
  if (!month) return dateStr;
  return `${Number(m[3])} ${month} ${m[1]}`;
}
