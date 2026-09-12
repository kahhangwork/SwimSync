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
import type { StudentRow } from "../types";

export function useAddClass(reload: () => Promise<void>) {
  const [addClassFor, setAddClassFor] = useState<StudentRow | null>(null);
  const [addClassChoice, setAddClassChoice] = useState("");
  const [addClassBusy, setAddClassBusy] = useState(false);
  const [addClassError, setAddClassError] = useState<string | null>(null);
  const [classOptions, setClassOptions] = useState<{ id: string; title: string }[]>([]);

  async function loadClasses() {
    const { data } = await repo.fetchActiveClasses();
    setClassOptions((data ?? []) as { id: string; title: string }[]);
  }

  function openAddClass(student: StudentRow) {
    setAddClassFor(student);
    setAddClassChoice("");
    setAddClassError(null);
    loadClasses();
  }

  async function handleAddClass() {
    if (!addClassFor || !addClassChoice) return;
    setAddClassBusy(true);
    setAddClassError(null);

    const { error } = await repo.insertEnrolment(addClassFor.id, addClassChoice);

    if (!error) {
      // Only ever moves TOWARD assigned. close_student_enrolment() owns the
      // other direction, and only when the last class goes.
      await repo.markAssigned(addClassFor.id);
    }

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
    loadClasses,
    openAddClass,
    close: () => setAddClassFor(null),
    handleAddClass,
  };
}

export type AddClassState = ReturnType<typeof useAddClass>;
