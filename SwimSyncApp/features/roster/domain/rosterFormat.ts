// The roster screen's display formatters (COACH_ROSTER_REFACTOR_PLAN.md,
// Stage 1) — moved verbatim from app/(coach)/classes/[id]/roster.tsx.
import { formatSgDate } from "@/lib/lessonDates";

export function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

export function formatDate(dateStr: string): string {
  return formatSgDate(dateStr, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
