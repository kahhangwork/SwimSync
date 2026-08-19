// Time of day in Singapore — the admin twin of SwimSyncApp/lib/timeOfDay.ts's
// one clock-reading function. Everything that COMPARES times takes a plain
// `nowMinutes: number` (calendarLessons.ts `buildCalendarLessons`), so those
// functions cannot read a clock and therefore cannot read the wrong one (§7.7 —
// `getHours()` is the local-machine hour, which is not Singapore's on Vercel
// or on a travelling laptop).

/** Minutes since midnight in Asia/Singapore. */
export function nowMinutesInSg(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  // Some ICU builds render midnight as hour "24" with hour12:false. Left
  // unhandled that is 1440 minutes — past every class's end time — so every
  // lesson would read as ended. Normalise it to 0.
  const hour = get("hour") % 24;
  return hour * 60 + get("minute");
}
