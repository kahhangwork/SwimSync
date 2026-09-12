// Slice 5 — set a child inactive, or remove them from ONE class. Stage 5 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Lifted from page.tsx intact.

import { useState } from "react";
import type { FamilyChild } from "@/lib/studentStatus";
import * as rpc from "../dao/students.rpc";
import type { EnrolledClass, StudentRow } from "../types";

export type PendingStatusChange = {
  student: StudentRow;
  mode: "remove" | "inactive";
  cls?: EnrolledClass;
};

export function useStudentStatus(reload: () => Promise<void>) {
  // `cls` is set only for mode "remove", and it is WHICH class — a child may be
  // in several, so "remove from class" is not a question the student id can
  // answer on its own.
  const [pending, setPending] = useState<PendingStatusChange | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Siblings are READ before anything is written, so the admin confirms a named
  // set rather than a count that could change underneath them — and the set
  // they confirm is exactly what gets written.
  const [family, setFamily] = useState<FamilyChild[]>([]);
  const [takeSiblings, setTakeSiblings] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function openInactive(student: StudentRow) {
    setTakeSiblings(false);
    setFamily([]);
    setPending({ student, mode: "inactive" });
    const { children } = await rpc.familyActiveChildren(student.id);
    setFamily(children);
  }

  function openRemove(student: StudentRow, cls: EnrolledClass) {
    setPending({ student, mode: "remove", cls });
  }

  const siblings = family.filter((c) => !c.is_self);
  // True when this action leaves the family with no active children here — the
  // point at which the family itself becomes inactive. Not a second question:
  // it is a consequence, so the modal states it rather than asking.
  const lastActive = family.length > 0 && (siblings.length === 0 || takeSiblings);

  async function handleStatusChange(
    student: StudentRow,
    mode: "remove" | "inactive",
    cls?: EnrolledClass
  ) {
    // "Set inactive" still ends EVERY enrolment — that is the point of it, and
    // set_students_active() owns that path. "Remove" is per class and cannot
    // proceed without one; the RPC refuses a NULL anyway, but failing here
    // keeps the reason in the admin's language.
    if (mode === "remove" && !cls) {
      setActionError("Which class? Press the × on the class to remove.");
      return;
    }
    setBusyId(student.id);
    setActionError(null);
    const ids =
      mode === "inactive" && takeSiblings
        ? family.map((c) => c.student_id)
        : [student.id];
    const { error } =
      mode === "inactive"
        ? await rpc.setStudentsActive(ids, false)
        : await rpc.removeFromClass(student.id, cls!.id);
    setBusyId(null);
    setPending(null);
    if (error) {
      setActionError(`Could not update ${student.full_name}: ${error}`);
      return;
    }
    await reload();
  }

  return {
    pending,
    busyId,
    family,
    siblings,
    takeSiblings,
    setTakeSiblings,
    lastActive,
    actionError,
    openInactive,
    openRemove,
    close: () => setPending(null),
    handleStatusChange,
  };
}

export type StudentStatusState = ReturnType<typeof useStudentStatus>;
