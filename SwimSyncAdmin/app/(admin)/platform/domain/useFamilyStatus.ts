// Family status across businesses. Stage 10 of
// docs/refactor/PLATFORM_REFACTOR_PLAN.md.
//
// Platform-admin view of a family ACROSS businesses — the one place that exists.
// A tenant admin can only ever see their own side of this.
//
// Deliberately shows activity but NOT assigned/unassigned: which class a child is
// in is the business's operational concern, and putting it here would invite the
// platform admin to reason about it.
//
// ⚠ NO DRIVER OPENS THIS SECTION. verify-platform-admin mentions "Family status"
// only in a COMMENT explaining why its Search click needs .first() — it never
// asserts on the section. (The plan credited it in error; corrected at
// plan-review.) domain/familyRows.test.ts is the whole net for the mapping, and
// the rest is hand-checked at Stage 10.
//
// ⚠ The query's shape lives in dao/platform.repo.ts and is load-bearing there
// (both embeds !inner, the orIlike sanitisation, the .in() sentinel). Read that
// file before changing anything about what comes back here.

import { useState } from "react";
import { childrenOfParents, searchFamilyMemberships } from "../dao/platform.repo";
import { buildFamilyRows, familyMessage } from "./familyRows";
import type { FamilyStatusRow } from "../types";

export function useFamilyStatus() {
  const [famSearch, setFamSearch] = useState("");
  const [families, setFamilies] = useState<FamilyStatusRow[]>([]);
  const [famMessage, setFamMessage] = useState<string | null>(null);

  async function handleFamilySearch() {
    setFamMessage(null);
    const term = famSearch.trim();
    if (!term) {
      setFamilies([]);
      return;
    }
    const { data, error } = await searchFamilyMemberships(term);

    if (error) {
      setFamilies([]);
      setFamMessage(`Could not search families: ${error.message}`);
      return;
    }
    const matching = (data ?? []) as any[];

    const { data: kids, error: kidsErr } = await childrenOfParents(
      matching.map((r) => r.parent_id)
    );

    setFamilies(buildFamilyRows(matching, kids));
    setFamMessage(familyMessage(matching.length, Boolean(kidsErr)));
  }

  return { famSearch, setFamSearch, families, famMessage, handleFamilySearch };
}
