// Shared search primitives for the admin table pages (Students, Invoices,
// Credit Notes, Classes, Packages, Attendance).
//
// WHY THIS EXISTS — ⚠ RISK 3 / WAVE_C_SPOOL_PLAN.md Piece 1.
// Every admin table fetches at most PostgREST's `max_rows` (1000) rows. A
// free-text search filtered in the BROWSER therefore only ever searches the
// first 1000 records and silently misses anyone past the cap — a search box
// that looks like it worked and lies. So search is pushed into the DATABASE,
// where it reaches every row however many there are.
//
// THE SEARCH IS SCOPED. Each page offers a field selector ("Student" / "Parent"
// / …), so every search targets ONE column — base (`students.full_name`) or
// embedded (`parent_students.parents.profiles.full_name`). A single column is a
// bound-parameter `.ilike(path, pattern)`: the term is never concatenated into
// PostgREST's filter grammar, so `, ( )` in a name cannot change the query. That
// is why scoping matters beyond UX — it keeps the term OUT of the or-grammar.
//
// The one place raw interpolation is unavoidable is a field that spans several
// columns (a parent's name OR email, Platform page). `.or()` takes only a string,
// so its value is sanitised HERE and nowhere else — double-quoted, with wildcards
// and quotes/backslashes escaped — and covered by hostile-term tests.

/**
 * Build the pattern argument for the injection-safe supabase-js
 * `.ilike(column, pattern)` method (a bound parameter — `, ( )` need no
 * escaping). The LIKE wildcards `%` and `_` (and the escape char `\`) ARE
 * escaped, so a term like "50%" matches the three literal characters rather
 * than "50" followed by anything.
 */
export function ilikeContains(term: string): string {
  const escaped = term.trim().replace(/([\\%_])/g, "\\$1");
  return `%${escaped}%`;
}

/**
 * Escape a term for embedding as a VALUE inside a PostgREST `.or()` string.
 *
 * The or-grammar reads `column.operator.value,column.operator.value` — where
 * `,` `(` `)` are structural and `*` `%` are wildcards. Wrapping the value in
 * double quotes makes punctuation literal; the quotes and any backslash inside
 * must then be backslash-escaped, and the wildcards are escaped so a literal
 * `*`/`%` matches itself. The `*…*` gives a substring (contains) match.
 */
function orValue(term: string): string {
  const escaped = term
    .trim()
    .replace(/\\/g, "\\\\") // a literal backslash → \\ (survives unquoting as \)
    .replace(/"/g, '\\"') // a quote would otherwise close the value early
    // Wildcards → literal. ⚠ The backslash must be DOUBLED: PostgREST unescapes
    // `\x` → `x` inside a quoted value BEFORE the `*`→`%` mapping, so a single
    // `\%` unescapes back to a bare `%` wildcard (matches everything). `\\%`
    // unescapes to `\%`, which SQL ILIKE reads as a literal percent. Verified
    // against the live DB: `"*\%*"` matched every row; `"*\\%*"` matched none.
    .replace(/([*%_])/g, "\\\\$1");
  return `"*${escaped}*"`;
}

/**
 * A PostgREST `.or()` filter string matching `term` (case-insensitive substring)
 * against ANY of `columns`. Used for a search field that maps to more than one
 * column. The value is sanitised by `orValue`, so a name containing `, ( ) "`
 * can never change the query — the whole point of the double-quoting.
 */
export function orIlike(columns: readonly string[], term: string): string {
  const v = orValue(term);
  return columns.map((c) => `${c}.ilike.${v}`).join(",");
}

/** Reads the searchable text for one field off a row. */
export type SearchFieldMatcher<T> = (row: T) => string | null | undefined;

/**
 * Case-insensitive substring match of `term` against ANY of `fields` — the
 * pure reference for the client-side filter these pages used before search
 * moved into the database. A blank term matches everyone (the caller decides
 * whether to run a search at all). The term is matched LITERALLY: a `%` or `*`
 * in it is a character to find, never a wildcard.
 */
export function matchesAnyField<T>(
  row: T,
  term: string,
  fields: readonly SearchFieldMatcher<T>[],
): boolean {
  const q = term.trim().toLowerCase();
  if (q === "") return true;
  return fields.some((f) => (f(row) ?? "").toLowerCase().includes(q));
}
