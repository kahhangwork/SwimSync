// Slice 2 — merge two rows that are probably the same child. Stage 6 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Lifted from page.tsx intact.

import { useState } from "react";
import * as rpc from "../dao/students.rpc";
import type { StudentRow } from "../types";
import { findDuplicatePairs, type DupPair } from "./duplicateStudents";

export function useMerge(students: StudentRow[], reload: () => Promise<void>) {
  const [merging, setMerging] = useState<DupPair | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // Derived on read, never stored: nothing would maintain a "possible
  // duplicate" flag, and a stored value nothing maintains is not a fact
  // (§7.37). A business has a few dozen students, so this is cheap.
  const dupPairs = findDuplicatePairs(
    students.map((s) => ({
      id: s.id,
      full_name: s.full_name,
      date_of_birth: s.date_of_birth,
      // The parent's IDENTITY, not just whether there is one: two rows under
      // the same family is the commonest duplicate, and a boolean hid it.
      parentId: s.parent_id,
      lessons: s.lessons,
      // A child who has left is never flagged as a duplicate — the banner has
      // no dismiss, so a pair the admin has already retired would be permanent
      // noise. Reported from production 2026-07-26.
      isActive: s.is_active,
    }))
  );

  /**
   * Fold the emptied duplicate into the row holding the history.
   *
   * All the safety lives in merge_students(): it refuses when both rows carry
   * attendance, when the direction is wrong, when money is already documented
   * against the duplicate, and when an unknown cascading foreign key has
   * appeared that it has not been taught to move. So this handler does not
   * re-check any of that — it surfaces the refusal verbatim, because those
   * messages are written for the admin to act on.
   */
  async function doMerge(pair: DupPair) {
    setMergeBusy(true);
    setMergeError(null);
    const { error } = await rpc.mergeStudents(pair.survivor.id, pair.duplicate.id);
    setMergeBusy(false);
    if (error) {
      setMergeError(error.message);
      return;
    }
    setMerging(null);
    await reload();
  }

  return {
    dupPairs,
    merging,
    mergeBusy,
    mergeError,
    review: (pair: DupPair) => setMerging(pair),
    close: () => {
      setMerging(null);
      setMergeError(null);
    },
    doMerge,
  };
}

export type MergeState = ReturnType<typeof useMerge>;
