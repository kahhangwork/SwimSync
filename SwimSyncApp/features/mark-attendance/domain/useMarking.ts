// The marking screen's per-row and Set-all marking (COACH_ATTENDANCE_REFACTOR_PLAN.md,
// Stage 5) — setTop / setSub / onSetAll and the Set-all menu's open state, moved verbatim
// from app/(coach)/classes/[id]/attendance.tsx. `attendance` stays owned by the spine
// (useAttendanceLoad); this hook takes its setter. onSetAll reads THIS render's
// students/attendance for `anyMarked` and the count, and confirms with confirmAction
// (never Alert.alert — a no-op on RN-web).
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useAppStore } from "@/store/useAppStore";
import { confirmAction } from "@/lib/confirm";
import { applyBulkStatus, type BulkOption } from "@/lib/attendanceBulk";
import type { AttState, StudentRow, TopStatus } from "../types";

export function useMarking(
  students: StudentRow[],
  attendance: Record<string, AttState>,
  setAttendance: Dispatch<SetStateAction<Record<string, AttState>>>
) {
  const showToast = useAppStore((s) => s.showToast);
  const [menuOpen, setMenuOpen] = useState(false);

  function setTop(studentId: string, top: TopStatus) {
    setAttendance((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], top, sub: null },
    }));
  }

  function setSub(studentId: string, sub: string) {
    setAttendance((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], sub },
    }));
  }

  function onSetAll(opt: BulkOption) {
    setMenuOpen(false);
    const apply = () => {
      setAttendance((prev) =>
        applyBulkStatus(
          // Never re-mark a holiday row — the guard refuses a coach clearing one,
          // and a single refused row fails the whole batch save (§7.67).
          students.filter((s) => prev[s.id]?.top !== "holiday").map((s) => s.id),
          prev,
          { top: opt.top, sub: opt.sub }
        )
      );
      showToast(`All ${students.length} set to ${opt.label}.`, "info");
    };
    const anyMarked = students.some(
      (s) => (attendance[s.id]?.top ?? "unmarked") !== "unmarked"
    );
    if (anyMarked) {
      confirmAction(
        `Set all to ${opt.label}?`,
        `This will change all ${students.length} students to ${opt.label}.`,
        apply,
        "Set all"
      );
    } else {
      apply();
    }
  }

  return { menuOpen, setMenuOpen, setTop, setSub, onSetAll };
}
