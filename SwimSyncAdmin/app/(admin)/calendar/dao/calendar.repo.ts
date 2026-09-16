// dao/ — data access for the admin Calendar. Transport only (no React, no
// presentation — tierBoundaries check 2). The read lives in shared
// lib/calendarData.ts (the Lessons list reads it too), so this binds it for the
// page's tiers; the page and hook import from here, never from @/lib (check 4).
// READ-ONLY BY CONSTRUCTION — calendarData performs no writes.
export { loadCalendarData } from "@/lib/calendarData";
export type { CalendarData, CalendarLoad } from "@/lib/calendarData";
