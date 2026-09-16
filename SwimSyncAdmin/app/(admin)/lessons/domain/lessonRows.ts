import { addDays, type CalendarLesson, type DateRange } from "@/lib/calendarLessons";

// Pure view-model for the Lessons list: filter the built lessons by the active
// location/coach and (in NEEDS-MARKING mode) to the unfinished ones, count the
// outstanding, expand the visible days and group the survivors by date. Extracted
// verbatim from the page's useMemo chain so it can be characterised in isolation.
export type LessonView = {
  lessons: CalendarLesson[];
  needsCount: number;
  days: string[];
  byDate: Map<string, CalendarLesson[]>;
};

const needsMarking = (l: CalendarLesson) =>
  l.progress === "unmarked" || l.progress === "partial";

export function lessonView(opts: {
  all: CalendarLesson[];
  range: DateRange;
  mode: "week" | "needs";
  location: string;
  coach: string;
}): LessonView {
  const { all, range, mode, location, coach } = opts;

  const lessons = all.filter(
    (l) =>
      (!location || l.location === location) &&
      (!coach || l.mainCoach.id === coach) &&
      (mode !== "needs" || needsMarking(l))
  );
  const needsCount = all.filter(needsMarking).length;

  const days: string[] = [];
  for (let d = range.from; d && d <= range.to; d = addDays(d, 1)) days.push(d);

  const byDate = new Map<string, CalendarLesson[]>();
  for (const l of lessons) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);

  return { lessons, needsCount, days, byDate };
}
