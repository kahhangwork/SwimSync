// Moving a child to another business — the only CROSS-BUSINESS WRITE on this
// page. Stage 9 of docs/refactor/PLATFORM_REFACTOR_PLAN.md.
//
// ⚠ THE CREDIT CHECK MUST FAIL TOWARD PROMPTING. There are TWO `checkFailed = true`
// sites (the parent-link read and the balance read) and they are separate on
// purpose: an advisory that silently skips is worse than one shown twice, and a
// merged query would collapse the two failures into one silent outcome. Do NOT
// join the two reads, and do NOT let either error path fall through to a move.
//
// ⚠ doMove's ORDER IS LOAD-BEARING: refresh FIRST, then set the message.
// handleSearch() clears `message` on entry, so setting the confirmation before
// the refresh meant it was wiped by its own refresh and the move looked like it
// had done nothing.
//
// ⚠ moveNonce REMOUNTS AN UNCONTROLLED <select>. The picker is defaultValue=""
// with key={`move-${s.id}-${moveNonce}`}; bumping the nonce is the ONLY way it
// resets to "Choose…". Every path that ends a pending move must bump it — which
// is why cancelMove() exists here rather than as two inline copies in ui/: the
// Modal's onClose and the Cancel button are two paths, and one of them is easy
// to lose when the dialog moves into its own component. Do NOT make the picker
// controlled instead; that is a behaviour change.
//
// ⚠ The coverage RPC is DELIBERATELY NOT AWAITED (see dao/platform.rpc.ts).

import { useState } from "react";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import {
  familyCreditAt,
  parentLinksForStudent,
  searchStudents,
} from "../dao/platform.repo";
import {
  reassignStudentTenant,
  studentPackageCoverage,
} from "../dao/platform.rpc";
import { totalFamilyCredit } from "./moveStudentWarning";
import type { StudentRow, TenantRow } from "../types";

export function useStudentMove(
  tenants: TenantRow[],
  setMessage: (m: string | null) => void
) {
const [search, setSearch] = useState("");
const [students, setStudents] = useState<StudentRow[]>([]);
const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(
  new Map()
);
const [moving, setMoving] = useState<string | null>(null);
// The advisory credit warning before a cross-business move (Piece 3). Set when
// the family holds credit at the OLD business (or that could not be checked);
// confirming calls doMove(). `moveNonce` remounts the per-row picker so it
// resets to "Choose…" after a move or a cancel (it is uncontrolled).
const [pendingMove, setPendingMove] = useState<{
  studentId: string;
  tenantId: string;
  studentName: string;
  oldTenantName: string;
  credit: number;
  checkFailed: boolean;
} | null>(null);
const [moveNonce, setMoveNonce] = useState(0);

async function handleSearch() {
  setMessage(null);
  if (!search.trim()) {
    setStudents([]);
    return;
  }
  const { data } = await searchStudents(search);
  setStudents((data ?? []) as StudentRow[]);
  // Payment-method chips. Under a platform admin the RPC returns EVERY
  // tenant's rows, each carrying its tenant_id — keyed per student here, so
  // a cross-tenant mixup is structurally impossible. Fire-and-forget.
  studentPackageCoverage().then(({ data: cov }) =>
    setCovMap(coverageByStudent(cov ?? []))
  );
}

// Advisory gate: credit never crosses businesses (PRD §5.6), so a family with
// credit at the OLD business would strand it. Check the balance FIRST and
// prompt; a zero balance (the common case) moves straight through.
async function handleMove(studentId: string, tenantId: string) {
  // Disable this row's picker for the whole credit check, so a second
  // selection cannot overwrite the pending move mid-flight.
  setMoving(studentId);
  const student = students.find((s) => s.id === studentId);
  const oldTenantId = student?.tenant_id ?? null;
  const oldTenantName =
    tenants.find((t) => t.tenant_id === oldTenantId)?.display_name ??
    "the old business";

  let credit = 0;
  let checkFailed = false;
  if (oldTenantId) {
    // ⚠ RISK (fable): sum EVERY linked parent's credit, not just one — a child
    // can have two parents. The balance table is platform-admin readable.
    const { data: links, error: linkErr } = await parentLinksForStudent(studentId);
    // A failed link read must fail TOWARD prompting: skipping it silently
    // would drop the warning in exactly the case we cannot verify.
    if (linkErr) checkFailed = true;
    const parentIds = (links ?? []).map((l: any) => l.parent_id);
    if (!checkFailed && parentIds.length > 0) {
      const { data: bal, error: balErr } = await familyCreditAt(
        oldTenantId,
        parentIds
      );
      if (balErr) checkFailed = true;
      else credit = totalFamilyCredit((bal ?? []) as any[]);
    }
  }

  setMoving(null);
  // Warn when there IS credit, or when the check could not run (fail toward
  // prompting — an advisory that silently skips is worse than one shown twice).
  if (credit > 0 || checkFailed) {
    setPendingMove({
      studentId,
      tenantId,
      studentName: student?.full_name ?? "this child",
      oldTenantName,
      credit,
      checkFailed,
    });
    // The picker keeps its chosen value; the dialog owns the next step, and
    // both its buttons bump moveNonce to reset it.
    return;
  }
  await doMove(studentId, tenantId);
}

async function doMove(studentId: string, tenantId: string) {
  setPendingMove(null);
  setMoving(studentId);
  setMessage(null);
  const { error } = await reassignStudentTenant(studentId, tenantId);
  setMoving(null);
  setMoveNonce((n) => n + 1); // reset the per-row picker
  if (error) {
    setMessage(`Could not move: ${error.message}`);
    return;
  }
  // Refresh FIRST, then set the message: handleSearch() clears it on entry,
  // so setting it beforehand meant the confirmation was wiped by its own
  // refresh and the move looked like it had done nothing.
  await handleSearch();
  setMessage(
    "Moved. Any active class enrolment was closed — the new business needs to assign them a class."
  );
}

  /** Ends a pending move and resets the picker. BOTH the dialog's onClose and
   *  its Cancel button call this — the nonce bump is what returns the
   *  uncontrolled <select> to "Choose…", and losing it on either path leaves a
   *  stale business name showing after a cancel. */
  function cancelMove() {
    setPendingMove(null);
    setMoveNonce((n) => n + 1); // reset the picker on cancel too
  }

  return {
    search,
    setSearch,
    students,
    covMap,
    moving,
    moveNonce,
    pendingMove,
    handleSearch,
    handleMove,
    doMove,
    cancelMove,
  };
}
