// Slice 4 — add a class to a child who already has one. Stage 5 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Lifted from page.tsx intact.
//
// The Unassigned page still owns FIRST assignment; this is the second and
// third. Both write the same row, and neither validates the schedule itself:
// enforce_enrolment_schedule() refuses a retired class and a time clash, and
// its messages are written for the admin, so they are surfaced verbatim.
//
// `classOptions` is loaded once on mount and ALSO read by the Add-student form
// (slice 7) for its class picker — one list, two pickers.

import { useState } from "react";
import * as repo from "../dao/students.repo";
import { setEnrolmentStart } from "@/lib/enrolmentStart.rpc";
import { useStartsOn } from "@/components/StartsOnField";
import type { StudentRow } from "../types";

export function useAddClass(reload: () => Promise<void>) {
  const [addClassFor, setAddClassFor] = useState<StudentRow | null>(null);
  const [addClassChoice, setAddClassChoice] = useState("");
  const [addClassBusy, setAddClassBusy] = useState(false);
  const [addClassError, setAddClassError] = useState<string | null>(null);
  const [classOptions, setClassOptions] = useState<{ id: string; title: string }[]>([]);
  // Wave 4: an optional start date before today (set_enrolment_start).
  const start = useStartsOn(addClassChoice || null);

  async function loadClasses() {
    const { data } = await repo.fetchActiveClasses();
    setClassOptions((data ?? []) as { id: string; title: string }[]);
  }

  function openAddClass(student: StudentRow) {
    setAddClassFor(student);
    setAddClassChoice("");
    setAddClassError(null);
    start.reset();
    loadClasses();
  }

  async function handleAddClass() {
    if (!addClassFor || !addClassChoice) return;
    // RISK 1: a start in an earlier, unbilled month needs a second press.
    if (start.holdForConfirmation()) return;
    setAddClassBusy(true);
    setAddClassError(null);

    // ONE atomic call: the enrolment, the move toward 'assigned', and the audit
    // row (set_enrolment_start, 20261005000100). Mode 'add' is refused for a
    // class the child is already in — never a silent start-date rewrite.
    const { error } = await setEnrolmentStart(
      addClassFor.id,
      addClassChoice,
      start.startsOnParam(),
      "add"
    );

    setAddClassBusy(false);
    if (error) {
      setAddClassError(error.message);
      return;
    }
    setAddClassFor(null);
    await reload();
  }

  return {
    addClassFor,
    addClassChoice,
    setAddClassChoice,
    addClassBusy,
    addClassError,
    classOptions,
    start,
    loadClasses,
    openAddClass,
    close: () => setAddClassFor(null),
    handleAddClass,
  };
}

export type AddClassState = ReturnType<typeof useAddClass>;
