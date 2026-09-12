/** "monday" → "Mon". The chip has room for a weekday and a time, not both in
 *  full, and the day is what an admin scans for. */
export const capitalizeDay = (d: string) => d.charAt(0).toUpperCase() + d.slice(1, 3);
