// Parse a data.gov.sg public-holidays CSV into { date, name } rows.
//
// The file shape (https://data.gov.sg — "Public Holidays") is:
//
//     date,day,holiday
//     2026-01-01,Thursday,New Year's Day
//     2026-02-17,Tuesday,Chinese New Year
//
// We read `date` and `holiday`; `day` is ignored. ⚠ RISK 6: the date is a
// literal YYYY-MM-DD string, passed straight through to the DATE column — never
// parsed into a Date and re-formatted, which would shift it a day in SGT (§7.7).
// A row whose date is not exactly YYYY-MM-DD is REJECTED with a per-row error,
// not silently dropped, so a malformed file cannot look like a clean import.

export type ParsedHoliday = { date: string; name: string };
export type CsvParseResult = { holidays: ParsedHoliday[]; errors: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real calendar date in YYYY-MM-DD. Validation uses Date.UTC
 *  with explicit numeric parts — no `new Date(string)` and no local getters, so
 *  no timezone shift (§7.7). The stored value stays the original string. */
function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** Split one CSV line into fields, honouring "quoted, fields" and "" escapes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

export function parseHolidaysCsv(text: string): CsvParseResult {
  const holidays: ParsedHoliday[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { holidays, errors: ["The file is empty."] };
  }

  // Locate the date and holiday columns from a header row if present; otherwise
  // assume the documented order date,day,holiday (holiday = last column).
  let dateCol = 0;
  let nameCol = -1;
  let startRow = 0;
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const looksLikeHeader =
    header.includes("date") && header.some((h) => h.includes("holiday"));
  if (looksLikeHeader) {
    dateCol = header.indexOf("date");
    nameCol = header.findIndex((h) => h.includes("holiday"));
    startRow = 1;
  }

  for (let i = startRow; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const date = (cols[dateCol] ?? "").trim();
    // No header ⇒ name is the last column (date,day,holiday), else the header's.
    const name = (nameCol >= 0 ? cols[nameCol] : cols[cols.length - 1] ?? "").trim();

    if (!isRealDate(date)) {
      errors.push(`Row ${i + 1}: "${date}" is not a valid YYYY-MM-DD date.`);
      continue;
    }
    if (!name) {
      errors.push(`Row ${i + 1}: missing a holiday name.`);
      continue;
    }
    if (seen.has(date)) continue; // one entry per date; first wins
    seen.add(date);
    holidays.push({ date, name });
  }

  return { holidays, errors };
}
