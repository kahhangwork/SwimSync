// Deriving the location dropdowns on the Classes page from raw data — pure so
// it is unit-tested, mirroring how every other list-shaping rule in this app
// (classRoster, packageCoverage, …) is factored out of the page.

export type ClassLocationRef = { location_id: string; location_name: string };
export type LocationLite = { id: string; name: string; archived_at: string | null };

/**
 * The Classes-list location FILTER options: the distinct locations actually
 * present on the loaded classes, sorted by name.
 *
 * Deliberately derived from the CLASS LIST, not the locations table — so an
 * ARCHIVED location that a retired class still sits on stays filterable, rather
 * than inheriting the form picker's non-archived rule and vanishing from the
 * filter while its classes are still on screen.
 */
export function locationFilterOptions(
  classes: readonly ClassLocationRef[]
): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const c of classes) if (c.location_id) m.set(c.location_id, c.location_name);
  return [...m.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The class FORM's location picker: the non-archived locations, PLUS the
 * currently-selected one when it is archived (a reactivated class whose location
 * was archived), so the form can represent that value without offering the
 * archived location as a NEW choice. reactivate_class() takes no refusals, so
 * the form must never wedge on such a class (RISK 6).
 */
export function formLocationOptions(
  locations: readonly LocationLite[],
  selectedId: string
): LocationLite[] {
  const opts = locations.filter((l) => !l.archived_at);
  const current = locations.find((l) => l.id === selectedId);
  if (current && current.archived_at && !opts.some((l) => l.id === current.id)) {
    return [current, ...opts];
  }
  return opts;
}
