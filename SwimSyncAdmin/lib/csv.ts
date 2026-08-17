// CSV export for the admin tables (invoices, credit notes, attendance).
//
// The only other CSV code in the app is `holidaysCsv.ts`, which PARSES an import;
// this is the inverse — it serialises rows the admin is already looking at and
// hands the browser a download. Two hazards drove the shape (see WAVE_C_PLAN.md):
//
//   ⚠ RISK 3 — CSV formula injection. Student/parent names are parent-entered
//     free text. A name like `=HYPERLINK(...)` executes when the admin opens the
//     file in Excel, and QUOTING DOES NOT STOP IT — Excel evaluates quoted
//     formulas. A leading apostrophe does. We prefix any STRING field whose first
//     char is = + - @ TAB or CR. Numbers are passed through untouched — a JS
//     number can never stringify to a formula, and guarding it would turn a real
//     `-5` credit into text and break the accountant's SUM.
//
//   ⚠ RISK 2 — silent truncation. The admin pages cap their fetch (attendance
//     ROW_LIMIT=1000; the others ride PostgREST's ~1000 default). Exporting a
//     capped array yields a file that SUMS WRONG with no on-file warning. So
//     `exportCsv` REFUSES to emit when the row count is at the cap — a blocked
//     download is recoverable (narrow the date range); a wrong revenue figure is
//     not. A warning row inside the CSV would corrupt column parsing, so blocking
//     is the only safe form.

export type CsvValue = string | number | null | undefined;
export type CsvColumn<T> = { header: string; value: (row: T) => CsvValue };

/** The row count at or above which an export is assumed truncated and refused.
 *  Matches the pages' fetch caps (attendance ROW_LIMIT, PostgREST default). */
export const CSV_DEFAULT_CAP = 1000;

const INJECTION_LEADERS = /^[=+\-@\t\r]/;
const NEEDS_QUOTING = /[",\r\n]/;

/** Serialise one field. Numbers pass through; strings are injection-guarded then
 *  RFC-4180 quoted (double inner quotes, wrap if it holds a comma/quote/newline). */
function escapeField(raw: CsvValue): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number") return String(raw);
  let s = String(raw);
  if (INJECTION_LEADERS.test(s)) s = "'" + s; // ⚠ RISK 3 — neutralise a formula
  if (NEEDS_QUOTING.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Build a CRLF-delimited CSV string (header row + one row per item). No BOM —
 *  the BOM is added by `downloadCsv` so `toCsv` stays a pure, testable transform. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeField(c.header)).join(",");
  if (rows.length === 0) return header;
  const body = rows
    .map((r) => columns.map((c) => escapeField(c.value(r))).join(","))
    .join("\r\n");
  return header + "\r\n" + body;
}

/** True when the row count means the source query was (probably) capped, so the
 *  export would be silently incomplete. */
export function isTruncated(rowCount: number, cap: number = CSV_DEFAULT_CAP): boolean {
  return rowCount >= cap;
}

export type ExportResult = { ok: true } | { ok: false; truncated: true; cap: number };

/** Trigger a browser download of `rows` as CSV, UNLESS the source query was
 *  capped (⚠ RISK 2) — in which case it refuses and returns the reason so the
 *  caller can tell the user to narrow the range. This is the structural guard:
 *  a page that routes its export through here cannot emit a truncated file.
 *
 *  `rows` is what gets written (already filtered/sorted for display). The cap is
 *  tested against `opts.sourceCount` — the size of the UNFILTERED fetch — because
 *  a client-side filter that shrinks 1000 capped rows to 50 does NOT make the
 *  export complete: it just hides that the fetch already dropped the rest. When
 *  `sourceCount` is omitted it falls back to `rows.length` (safe for a list that
 *  is never filtered before export). */
export function exportCsv<T>(
  filename: string,
  rows: T[],
  columns: CsvColumn<T>[],
  opts: { cap?: number; sourceCount?: number } = {},
): ExportResult {
  const cap = opts.cap ?? CSV_DEFAULT_CAP;
  const count = opts.sourceCount ?? rows.length;
  if (isTruncated(count, cap)) return { ok: false, truncated: true, cap };
  downloadCsv(filename, toCsv(rows, columns));
  return { ok: true };
}

/** Hand the browser a CSV file. Prepends a UTF-8 BOM so Excel opens Singaporean
 *  unicode names (中文 / tamil / etc.) in the right encoding instead of mojibake. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
