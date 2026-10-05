// dao/ — the Calendar's read, bound for the lesson page's prev/next strip.
// Transport only (no React, no presentation — tierBoundaries check 2). The read
// lives in shared lib/calendarData.ts (the Calendar and the Lessons list read
// it too), so the strip steps through exactly the lessons the Calendar shows.
// READ-ONLY BY CONSTRUCTION — calendarData performs no writes.
export { loadCalendarData } from "@/lib/calendarData";
export type { CalendarData, CalendarLoad } from "@/lib/calendarData";
