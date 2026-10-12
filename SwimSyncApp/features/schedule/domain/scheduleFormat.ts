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
/** "Sat 26 Sept" — DESIGN.md's One Date Style: no comma after the weekday.
 *  en-SG Intl prints "Sat, 26 Sept"; the comma is dropped here, for this screen
 *  only. formatSgDate itself is NOT changed — every other date in the app reads
 *  through it (UI_RESTYLE_PLAN 2.1). Mirrored by drivers/lib.mjs sgDayLabel(). */
export const dayHeading = (d: string) =>
  formatSgDate(d, { weekday: "short", day: "numeric", month: "short" }).replace(",", "");

// ── The billing blocker's words (DESIGN.md, Blocker-Outranks-Routine) ──────────
// "Sept", as every surface spells it (§7.302, G-Sept; UI_RESTYLE_PLAN §0 Q1).
// Built from the "YYYY-MM-DD" string itself — no Date, no locale, no clock.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** The months a set of unmarked lesson dates hold, oldest first, as one phrase:
 *  "Sept", "Sept and Oct", "Aug, Sept and Oct". Each is a month that cannot be
 *  billed until its lessons are marked (§8a — no override). */
export function blockedMonths(dates: string[]): string {
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))].sort();
  const names = months.map((ym) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym);
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Coach Marcus" for "Marcus" — but never "Coach Coach Marcus" when the stored
 *  name already carries the title (the seed coach's does; so can a real one). */
export function coachTitle(fullName: string | null | undefined): string {
  const name = (fullName ?? "").trim();
  if (!name) return "Coach —";
  return /^coach\b/i.test(name) ? name : `Coach ${name}`;
}
