// The coach location-filter chips — shared by the Classes list and the Schedule
// week. Pure so it is unit-tested, like every other list-shaping rule in lib/.

/**
 * Distinct locations across a list of lessons/classes, deduped by id and sorted
 * by name. Entries with no id are skipped. A coach who teaches at one location
 * gets a single-entry (or empty) list, and the caller hides the chips.
 */
export function locationChips(
  items: readonly { id: string | null | undefined; name: string }[]
): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const it of items) if (it.id) m.set(it.id, it.name);
  return [...m.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
