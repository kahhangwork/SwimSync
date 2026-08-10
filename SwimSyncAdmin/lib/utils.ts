import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * "17:00:00" → "5:00 PM". Lifted out of `classes/page.tsx` when the Students
 * page needed it too (Wave 2). Duplication is the accepted answer only ACROSS
 * the two npm projects (`docs/ARCHITECTURE.md` §6, `lessonDates.ts`); inside one app it is
 * just two implementations waiting to disagree about midnight.
 *
 * Takes the raw `time` column, which Postgres renders with seconds.
 */
export function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}
