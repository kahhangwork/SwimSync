// The Schedule tab's display formatters (COACH_SCHEDULE_REFACTOR_PLAN.md, Stage 1) —
// moved verbatim from app/(coach)/schedule/index.tsx.
import { formatSgDate } from "@/lib/lessonDates";

export function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

export const shortDate = (d: string) =>
  formatSgDate(d, { day: "numeric", month: "short" });
export const dayHeading = (d: string) =>
  formatSgDate(d, { weekday: "short", day: "numeric", month: "short" });
