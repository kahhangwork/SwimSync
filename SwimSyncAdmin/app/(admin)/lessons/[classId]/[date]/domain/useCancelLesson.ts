"use client";

// Advance-cancel / restore the whole lesson. Stage 3 of
// docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md — state and handlers verbatim.
//
// Restore reports into the attendance bar's `saveMsg`, which the SAVE slice
// owns; it arrives as a creation dep (playbook §5: the later-created hook may
// depend on the earlier, never the reverse).

import { useState, type Dispatch, type SetStateAction } from "react";
import { cancelLesson, restoreLesson } from "../dao/lessonDetail.rpc";
import type { SaveMsg } from "../types";

export function useCancelLesson(classId: string, date: string, reload: () => void, setSaveMsg: Dispatch<SetStateAction<SaveMsg>>) {
  // Advance-cancel / restore (plan Phase B, Step B4). Every rule is enforced by
  // cancel_lesson()/restore_lesson() themselves — future-only, no guests, no
  // marks, not into a billed month — and their message is RENDERED, not
  // pre-empted (§7.32: a limit only the admin screen applies is not a limit).
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // ── Cancel / restore the whole lesson ───────────────────────────────────
  async function doCancelLesson() {
    setCancelBusy(true);
    setCancelError(null);
    const { error } = await cancelLesson(classId, date, cancelReason);
    setCancelBusy(false);
    if (error) {
      setCancelError(error.message);
      return;
    }
    setCancelOpen(false);
    setCancelReason("");
    reload();
  }
  async function doRestoreLesson() {
    setCancelBusy(true);
    setSaveMsg(null);
    const { error } = await restoreLesson(classId, date);
    setCancelBusy(false);
    if (error) {
      setSaveMsg({ kind: "error", text: `Could not restore the lesson: ${error.message}` });
      return;
    }
    reload();
  }

  return {
    cancelOpen,
    setCancelOpen,
    cancelReason,
    setCancelReason,
    cancelBusy,
    cancelError,
    setCancelError,
    doCancelLesson,
    doRestoreLesson,
  };
}
