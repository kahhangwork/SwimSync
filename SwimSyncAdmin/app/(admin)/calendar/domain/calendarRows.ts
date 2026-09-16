import {
  addDays,
  rangeForView,
  type CalendarLesson,
  type CalendarView,
  type DateRange,
} from "@/lib/calendarLessons";
import { formatSgDate } from "@/lib/lessonDates";

// Pure derivations for the admin Calendar, lifted verbatim from the page so the
// L-B extraction is provably a no-op.

/** Narrow the built lessons to the active location/coach filters. */
export function visibleLessons(
  allLessons: CalendarLesson[],
  location: string,
  coach: string
): CalendarLesson[] {
  return allLessons.filter(
    (l) => (!location || l.location === location) && (!coach || l.mainCoach.id === coach)
  );
}

/** Every date in the range, inclusive. */
export function expandDays(range: DateRange): string[] {
  const out: string[] = [];
  for (let d = range.from; d && d <= range.to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "N lessons" or "N lessons of M" when a filter is hiding some. */
export function calendarSummary(loading: boolean, visible: number, total: number): string {
  if (loading) return "Loading…";
  return `${visible} lesson${visible === 1 ? "" : "s"}${visible !== total ? ` of ${total}` : ""}`;
}

/** The toolbar's range label for the active view. */
export function rangeLabel(view: CalendarView, anchor: string): string {
  const { from, to } = rangeForView(view, anchor);
  switch (view) {
    case "day":
      return formatSgDate(anchor, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    case "month":
      return formatSgDate(anchor, { month: "long", year: "numeric" });
    case "week":
    case "agenda":
      return `${formatSgDate(from, { day: "numeric", month: "short" })} – ${formatSgDate(to, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}`;
  }
}
