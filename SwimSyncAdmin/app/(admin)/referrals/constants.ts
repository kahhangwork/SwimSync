// The Singapore calendar date of a timestamptz, in the dd/mm/yyyy shape this
// page has always shown. `formatSgStamp` pins Asia/Singapore; the bare
// `toLocaleDateString("en-SG")` it replaced rendered the VIEWER's date, a day
// early west of Singapore for anything stamped before 08:00 SGT.
export const DMY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};
