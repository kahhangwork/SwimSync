// The pure half of family status: turning two raw PostgREST result sets into the
// rows the table renders. Stage 10 of docs/refactor/PLATFORM_REFACTOR_PLAN.md.
//
// Extracted so the narrowing below is ASSERTED rather than assumed. Everything
// here is a straight lift of the mapping that lived inline in handleFamilySearch;
// familyRows.test.ts is a CHARACTERISATION test (it pins behaviour that already
// exists, so §7.25's prove-it-red rule does not apply).

import { ROW_LIMIT } from "../constants";
import type { FamilyStatusRow } from "../types";

/**
 * One row per (parent, business) membership, each carrying only that business's
 * children.
 *
 * ⚠ THE DOUBLE CONDITION IS THE WHOLE POINT. A child is attributed to a row only
 * when BOTH `parent_id` AND `students.tenant_id` match. The children query is
 * bounded by parent, not by business, so a parent who deals with two businesses
 * gets both businesses' children back in one list — matching on parent alone
 * would show each child under both rows, which reads as data rather than as a
 * bug. Do NOT drop `k.students?.tenant_id === r.tenant_id`.
 *
 * Missing embeds degrade to "—" rather than throwing: this is a support page
 * looking at other people's data, and a single malformed row must not blank the
 * whole table.
 */
export function buildFamilyRows(
  memberships: readonly any[],
  kids: readonly any[] | null
): FamilyStatusRow[] {
  return memberships.map((r) => ({
    parent_name: r.parents?.profiles?.full_name ?? "—",
    email: r.parents?.profiles?.email ?? "—",
    tenant_name: r.tenants?.display_name ?? "—",
    family_active: r.is_active,
    children: (kids ?? [])
      .filter((k: any) => k.parent_id === r.parent_id && k.students?.tenant_id === r.tenant_id)
      .map((k: any) => ({ full_name: k.students.full_name, is_active: k.students.is_active })),
  }));
}

/**
 * The notice under the search box, or null when there is nothing to say.
 *
 * ⚠ THE PRECEDENCE IS COPIED, NOT CHOSEN, and it is the opposite of what reads
 * naturally. Inline, the children-failed message was assigned FIRST and then
 * OVERWRITTEN by the count branches:
 *
 *     if (kidsErr) setFamMessage("Found N families, but their children …")
 *     …
 *     if (count === 0) setFamMessage("No families matched.")
 *     else if (count >= ROW_LIMIT) setFamMessage("Showing the first 1000 …")
 *
 * So "No families matched." wins over a failed children read, and so does the
 * cap warning. Writing `if (kidsFailed) return …` first LOOKS more correct —
 * a failure sounds more urgent than a count — but it is a behaviour change, and
 * the characterisation tests below exist to keep it from being made by accident.
 *
 * The children-failed message is still surfaced rather than swallowed whenever
 * a count branch does not claim the slot: a failed children read would otherwise
 * render every matched family as "none", a wrong answer that looks like data.
 */
export function familyMessage(count: number, kidsFailed: boolean): string | null {
  if (count === 0) return "No families matched.";
  if (count >= ROW_LIMIT) {
    return `Showing the first ${ROW_LIMIT} matches — refine your search.`;
  }
  if (kidsFailed) {
    return `Found ${count} famil${count === 1 ? "y" : "ies"}, but their children could not be loaded — try again.`;
  }
  return null;
}
