// "Running low" — the business's two thresholds, as the Packages page edits
// them. Pure. One definition of "low" (lessons ≤ threshold OR expiring within N
// days) feeds Generate renewal offers, and the Students page's columns and
// "Package running low" filter — all computed in SQL from these two columns.
//
// Moved here from the Students page on 2026-09-24: they are the business's
// PACKAGE configuration, and they sat on Students only because the filter that
// reads them does.

/** The stored value for a typed count, or null when it must NOT be saved.
 *  Empty is refused BEFORE coercing (§7.22): Number("") is 0, and an empty
 *  field must never save 0. */
export function parseCount(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
