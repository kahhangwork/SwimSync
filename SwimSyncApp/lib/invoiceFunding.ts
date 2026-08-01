// package_applications rows → which invoice lines a package funded, and by
// which package. The ledger is the fact (one un-reversed row per funded
// invoice_item — UNIQUE WHERE reversed_at IS NULL); this only indexes it for
// the invoice-detail screen. A REVERSED draw is not funding: the correction
// path restored that money to the package, so the line must not claim it.
//
// Tolerant of null/undefined/garbage BY DESIGN: a failed read must degrade to
// "no tags", never to a broken invoice screen.

export function fundingByItem(rows: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(rows)) return map;
  for (const raw of rows) {
    const r = raw as {
      invoice_item_id?: unknown;
      reversed_at?: unknown;
      parent_packages?: unknown;
    } | null;
    if (!r || typeof r.invoice_item_id !== "string") continue;
    if (r.reversed_at != null) continue;
    // PostgREST returns the embed as an object (FK to one row), but has
    // returned arrays for other shapes before — accept both.
    const pkg = Array.isArray(r.parent_packages)
      ? r.parent_packages[0]
      : r.parent_packages;
    const name = (pkg as { name?: unknown } | null | undefined)?.name;
    map.set(
      r.invoice_item_id,
      typeof name === "string" && name.trim() !== "" ? name : "Package"
    );
  }
  return map;
}
