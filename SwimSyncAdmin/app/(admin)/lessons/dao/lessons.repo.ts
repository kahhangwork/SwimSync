// dao/ — data access for the Lessons list page. Transport only (no React, no
// presentation — tierBoundaries check 2). Both reads already live in shared
// lib/ modules that do the query themselves (calendarData is also read by the
// Calendar page, markableFloor by the coach/lesson screens), so this dao BINDS
// them for the page's tiers rather than re-implementing — the page and its
// hook import from here, never from @/lib (check 4).
export { loadCalendarData } from "@/lib/calendarData";
export type { CalendarData, CalendarLoad } from "@/lib/calendarData";
export { fetchMarkableFloor } from "@/lib/markableFloor";
