// Prev/next lesson and prev/next coach for the admin lesson page — pure, no
// React, no clock. Input is the Calendar's own lesson list for ONE date
// (buildCalendarLessons), so the strip steps through exactly what the Calendar
// day view shows: cancelled, holiday, no-students and off-pattern extras
// included.
//
// GROUPED BY THE TEACHING COACH (`mainCoach.id`), not the class's regular
// coach: a lesson a substitute covers sits in the substitute's sequence, as it
// does on the Calendar. Lessons with no resolvable coach form "Unassigned",
// always last.
//
// ⚠ EVERY COMPARATOR ENDS ON A UNIQUE KEY (classId, coach id). PostgREST returns
// classes in no fixed order, so two lessons at the same time with the same
// title would otherwise swap between loads, and Next would bounce between them
// and never reach the lesson after (plan RISK 4).

import type { CalendarLesson } from "@/lib/calendarLessons";
import { lessonHref } from "@/components/calendar/LessonTooltip";

export const UNASSIGNED_LABEL = "Unassigned";

export type LessonNav = {
  /** 1-based position of the current lesson within its coach's day. */
  lesson: { position: number; total: number; prevHref: string | null; nextHref: string | null };
  /** 1-based position of the current coach among the day's coaches. The hrefs
   *  land on that coach's EARLIEST lesson. */
  coach: { name: string; position: number; total: number; prevHref: string | null; nextHref: string | null };
};

type Group = { id: string | null; name: string; lessons: CalendarLesson[] };

function byTime(a: CalendarLesson, b: CalendarLesson): number {
  if (a.startMin !== b.startMin) return a.startMin - b.startMin;
  const t = a.title.localeCompare(b.title);
  if (t !== 0) return t;
  return a.classId < b.classId ? -1 : a.classId > b.classId ? 1 : 0;
}

function byCoach(a: Group, b: Group): number {
  // Unassigned last, whatever its label sorts as.
  if (a.id === null) return b.id === null ? 0 : 1;
  if (b.id === null) return -1;
  const n = a.name.localeCompare(b.name);
  if (n !== 0) return n;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Where the lesson `(classId, date)` sits in its coach's day, and the hrefs
 * either side. `null` hides the strip:
 *   • the lesson is not in the list (an off-pattern date with no session row,
 *     or a retired class's date — the page shows them, the Calendar does not);
 *   • the Calendar's teaching coach disagrees with the page's (`currentMainId`)
 *     — better no strip than one grouping the lesson under a coach the Coaches
 *     panel contradicts (plan RISK 3).
 */
export function lessonNav(
  lessons: readonly CalendarLesson[],
  classId: string,
  date: string,
  currentMainId: string | null
): LessonNav | null {
  const day = lessons.filter((l) => l.date === date);
  const current = day.find((l) => l.classId === classId);
  if (!current) return null;
  if ((current.mainCoach.id ?? null) !== currentMainId) return null;

  const groupsById = new Map<string | null, Group>();
  for (const l of day) {
    const id = l.mainCoach.id ?? null;
    let g = groupsById.get(id);
    if (!g) {
      g = { id, name: id === null ? UNASSIGNED_LABEL : l.mainCoach.name, lessons: [] };
      groupsById.set(id, g);
    }
    g.lessons.push(l);
  }
  const groups = [...groupsById.values()].sort(byCoach);
  for (const g of groups) g.lessons.sort(byTime);

  const gi = groups.findIndex((g) => g.id === currentMainId);
  const group = groups[gi];
  const li = group.lessons.findIndex((l) => l.classId === classId);
  const href = (l: CalendarLesson | undefined) => (l ? lessonHref(l) : null);

  return {
    lesson: {
      position: li + 1,
      total: group.lessons.length,
      prevHref: href(group.lessons[li - 1]),
      nextHref: href(group.lessons[li + 1]),
    },
    coach: {
      name: group.name,
      position: gi + 1,
      total: groups.length,
      prevHref: href(groups[gi - 1]?.lessons[0]),
      nextHref: href(groups[gi + 1]?.lessons[0]),
    },
  };
}
