// The Make-ups booking form's child search.
//
// One search box matches EITHER the child's name OR their home class's title —
// with hundreds of children a plain dropdown is unusable, and the admin often
// knows the class ("everyone from Tanglin View Sun 930am") rather than the
// spelling of a name. Pure, so it is unit-testable; the page owns the state.

export type SearchableKid = {
  id: string;
  full_name: string;
  home_class_title: string;
};

/**
 * Case-insensitive substring match on the child's name OR their home class.
 * Every whitespace-separated term must match at least one of the two fields,
 * so "anya 1100" finds Anya in the 11:00 class without demanding the admin
 * type either field exactly. An empty/blank query matches everyone.
 */
export function filterEligibleKids<K extends SearchableKid>(
  kids: readonly K[],
  query: string
): K[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...kids];
  return kids.filter((k) => {
    const name = k.full_name.toLowerCase();
    const cls = k.home_class_title.toLowerCase();
    return terms.every((t) => name.includes(t) || cls.includes(t));
  });
}
