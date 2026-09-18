"use client";

// Assign / remove a per-lesson substitute. Stage 4 of
// docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md — state, the picker's exclusion
// trio and both handlers verbatim.
//
// ⚠ removeCover does NOT clear coachMsg before its delete (assignCoach does).
// That asymmetry is the page's behaviour — do not "tidy" it (plan §6 Stage 4).

import { useState } from "react";
import { assignSessionCoach } from "../dao/lessonDetail.rpc";
import { deleteSessionCoach } from "../dao/lessonDetail.repo";
import type { ClassInfo, CoachOpt } from "../types";

export function useSubstitute(input: {
  classId: string;
  date: string;
  cls: ClassInfo | null;
  coaches: CoachOpt[];
  termsCoachId: string | null;
  attr: { subRowId: string | null } | null;
  reload: () => void;
}) {
  const { classId, date, cls, coaches, termsCoachId, attr, reload } = input;
  const [coachPick, setCoachPick] = useState("");
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachMsg, setCoachMsg] = useState<string | null>(null);

  // The coach the class rate already pays teaches this lesson anyway, so
  // assigning them records no cover — the DB refuses it (20260821000100). Exclude
  // that coach from the picker so the UI never offers what the DB will reject.
  // Falls back to the class's own coach before rates have loaded.
  const excludedCoachId = termsCoachId ?? cls?.coach_id ?? null;
  const classCoachName = coaches.find((c) => c.id === excludedCoachId)?.name ?? "the class's coach";
  const substituteOptions = coaches.filter((c) => c.id !== excludedCoachId);

  // ── Coaches ─────────────────────────────────────────────────────────────
  async function assignCoach() {
    if (!coachPick) return;
    setCoachBusy(true);
    setCoachMsg(null);
    const { error } = await assignSessionCoach(classId, date, coachPick);
    setCoachBusy(false);
    if (error) {
      setCoachMsg(`Could not assign: ${error.message}`);
      return;
    }
    setCoachPick("");
    reload();
  }
  async function removeCover() {
    if (!attr?.subRowId) return;
    setCoachBusy(true);
    const { error } = await deleteSessionCoach(attr.subRowId);
    setCoachBusy(false);
    if (error) {
      setCoachMsg(`Could not remove: ${error.message}`);
      return;
    }
    reload();
  }

  return { coachPick, setCoachPick, coachBusy, coachMsg, classCoachName, substituteOptions, assignCoach, removeCover };
}
