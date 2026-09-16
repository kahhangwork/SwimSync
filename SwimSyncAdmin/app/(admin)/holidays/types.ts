// Shared row type for the Holidays page. Lives here (not in dao/) so ui/ may
// import it without crossing the ui -> dao boundary (tierBoundaries check 1).
export type Holiday = { id: string; holiday_date: string; name: string };
