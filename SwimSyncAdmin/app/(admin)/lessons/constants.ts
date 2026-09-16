import type { CalendarLesson } from "@/lib/calendarLessons";

// Progress → badge label + classes. Shared by the list rows.
export const PROGRESS_LABEL: Record<CalendarLesson["progress"], { text: string; cls: string }> = {
  upcoming: { text: "Upcoming", cls: "bg-gray-100 text-gray-600" },
  unmarked: { text: "Needs marking", cls: "bg-amber-100 text-amber-800" },
  partial: { text: "Partly marked", cls: "bg-amber-100 text-amber-800" },
  complete: { text: "Marked", cls: "bg-emerald-100 text-emerald-800" },
  holiday: { text: "Holiday", cls: "bg-gray-100 text-gray-500" },
  "no-students": { text: "Nobody expected", cls: "bg-gray-100 text-gray-500" },
  cancelled: { text: "Cancelled", cls: "bg-gray-100 text-gray-500" },
};
