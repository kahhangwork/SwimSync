// Slice 3 — rename a child. Stage 5 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Lifted from page.tsx intact.
//
// The admin's only sanctioned way to set a child's name. It goes through
// rename_student(), NEVER a raw `.update({ full_name })` (see
// updateStudentContact's three-key-payload note: a stray full_name rewrites a
// child's identity or trips students_identity_uniq). The RPC derives the
// tenant from the row, and refuses a name that would duplicate an active
// child's (name + DOB) — including the NULL-DOB case the unique index cannot
// see — surfacing a friendly message either way.
//
// ⚠ DELIBERATELY NOT FROZEN UNDER A PENDING CLAIM, unlike the contact modal.
// A contact edit is frozen because `student_claims.match_reason` was
// snapshotted against those details; a NAME change does not invalidate
// match_reason, so a pending claim has nothing to be made stale by. Two
// writers to full_name now exist (this and the parent's own app edit,
// PRD §7.4) — that is fine: both pass the uniqueness index and both are
// audited, so last-writer-wins is legible, not corrupting. Do not add a lock.

import { useState } from "react";
import * as rpc from "../dao/students.rpc";
import type { StudentRow } from "../types";

export function useRename(reload: () => Promise<void>) {
  const [renameFor, setRenameFor] = useState<StudentRow | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  function openRename(student: StudentRow) {
    setRenameFor(student);
    setRenameName(student.full_name);
    setRenameError(null);
  }

  async function handleRename() {
    if (!renameFor) return;
    const name = renameName.trim();
    if (name === "") {
      setRenameError("Enter a name.");
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    const { error } = await rpc.renameStudent(renameFor.id, name);
    setRenameBusy(false);
    if (error) {
      // The RPC's messages are written for the admin (empty name, a name that
      // is already registered) — surfaced verbatim, not reworded.
      setRenameError(error.message);
      return;
    }
    setRenameFor(null);
    await reload();
  }

  return {
    renameFor,
    renameName,
    setRenameName,
    renameBusy,
    renameError,
    openRename,
    close: () => setRenameFor(null),
    handleRename,
  };
}

export type RenameState = ReturnType<typeof useRename>;
