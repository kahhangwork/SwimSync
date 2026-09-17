/** PostgREST caps every fetch at max_rows (1000); this many back means the list
 *  is (probably) truncated and search is how to reach past it (⚠ RISK 3). */
export const ROW_LIMIT = 1000;

export const STATUS_FILTERS = ["All", "Applied", "Available", "Reversed"];
