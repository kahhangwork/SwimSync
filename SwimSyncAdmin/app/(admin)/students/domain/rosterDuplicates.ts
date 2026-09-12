// Presenting the Add-student duplicate warning.
//
// The MATCHING lives in SQL — find_roster_duplicates() (20260814000200) is the
// authority on what counts as a possible duplicate, because it is the disclosure
// surface and it alone can see phones and claimed-parent links. This module only
// SHAPES what that RPC already returned, for the dialog. There is no match logic
// here, deliberately: a second copy of the rule would be the drift trap
// duplicateStudents.ts warns about.
//
// ⚠ RISK 3 (plan): a name-only hit is the WEAK signal and is grouped BELOW phone
// hits, so the admin reads the strong evidence first and does not train
// themselves to click "Add anyway" through noise. The RPC already orders phone
// first; partitionCandidates keeps that split explicit for the UI.

export type RosterCandidate = {
  student_id: string;
  full_name: string;
  /** The claiming parent's name, or null when nobody has claimed the child. */
  parent_name: string | null;
  is_active: boolean;
  /** 'phone' — a strong signal; 'name' — a weaker same-name hint. */
  reason: "phone" | "name";
  last_lesson: string | null;
};

/**
 * The one-line status shown under a candidate's name, e.g.
 *   "claimed by Priya · last lesson 2026-08-12"
 *   "unclaimed · inactive"
 * The claim state comes first (it is what tells the admin the family is already
 * onboarded), then inactivity, then the last lesson as recognition context.
 */
export function describeCandidate(c: RosterCandidate): string {
  const parts: string[] = [
    c.parent_name ? `claimed by ${c.parent_name}` : "unclaimed",
  ];
  if (!c.is_active) parts.push("inactive");
  if (c.last_lesson) parts.push(`last lesson ${c.last_lesson}`);
  return parts.join(" · ");
}

/**
 * Split the RPC's rows into the strong (phone) group and the weak (same-name)
 * group, each preserving the RPC's own order. The UI renders `strong` first and
 * visually separates `weak` so a name-only coincidence never sits beside a
 * phone match as if it were equal evidence.
 */
export function partitionCandidates(list: RosterCandidate[]): {
  strong: RosterCandidate[];
  weak: RosterCandidate[];
} {
  return {
    strong: list.filter((c) => c.reason === "phone"),
    weak: list.filter((c) => c.reason === "name"),
  };
}
