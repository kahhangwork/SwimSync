// The Make-ups booking form's child search.
//
// One search box matches EITHER the child's name OR their home class's title —
// with hundreds of children a plain dropdown is unusable, and the admin often
// knows the class ("everyone from Tanglin View Sun 930am") rather than the
// spelling of a name. Pure, so it is unit-testable; the page owns the state.

export type SearchableKid = {
  id: string;
  full_name: string;
  /** EVERY class the child is in. A list since Wave 2 (`20260811000100`): a
   *  child may hold several enrolments, and the admin searching "tanglin" must
   *  find a child whose SECOND class is the Tanglin one. Matching only the
   *  first would hide them behind a search that looks like it worked. */
  home_class_titles: readonly string[];
};

/**
 * Case-insensitive substring match on the child's name OR ANY of their classes.
 * Every whitespace-separated term must match at least one of those, so
 * "anya 1100" finds Anya in the 11:00 class without demanding the admin type
 * either field exactly. An empty/blank query matches everyone.
 *
 * Terms are matched independently across fields on purpose: "anya tanglin"
 * finds a child called Anya who is in the Tanglin class, even though no single
 * field contains both words.
 */
export function filterEligibleKids<K extends SearchableKid>(
  kids: readonly K[],
  query: string
): K[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...kids];
  return kids.filter((k) => {
    const name = k.full_name.toLowerCase();
    const classes = k.home_class_titles.map((t) => t.toLowerCase());
    return terms.every(
      (t) => name.includes(t) || classes.some((c) => c.includes(t))
    );
  });
}
