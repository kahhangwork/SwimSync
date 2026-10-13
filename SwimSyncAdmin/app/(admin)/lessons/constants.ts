import type { CalendarLesson } from "@/lib/calendarLessons";
import type { Tone } from "@/components/ui/Tag";

// Progress → the row's status WORD and its tone on DESIGN.md's five-step scale.
// A PAST lesson still needing a mark blocks that month's billing, and the guard
// has no override (CLAUDE.md) — so it is Danger, "Blocks billing" (BACKLOG S8,
// UI restyle 5.7). The same state TODAY is routine: Warning.
export type ProgressTag = { text: string; tone: Tone };

const NEEDS_TODAY: Partial<Record<CalendarLesson["progress"], ProgressTag>> = {
  unmarked: { text: "Not marked", tone: "warning" },
  partial: { text: "Partly marked", tone: "warning" },
};

export const PROGRESS_LABEL: Record<CalendarLesson["progress"], ProgressTag> = {
  upcoming: { text: "Upcoming", tone: "neutral" },
  unmarked: { text: "Blocks billing", tone: "danger" },
  partial: { text: "Blocks billing", tone: "danger" },
  complete: { text: "Marked", tone: "success" },
  holiday: { text: "Holiday", tone: "neutral" },
  "no-students": { text: "Nobody expected", tone: "neutral" },
  cancelled: { text: "Cancelled", tone: "neutral" },
};

/** The row's tag: a past lesson's backlog blocks billing; today's does not yet. */
export function progressTag(progress: CalendarLesson["progress"], date: string, today: string): ProgressTag {
  return (date >= today && NEEDS_TODAY[progress]) || PROGRESS_LABEL[progress];
}
