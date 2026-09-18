"use client";

// The attendance save — holiday confirm, "Set all", and the save itself. Stage 6
// of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md — state and handlers verbatim.
//
// ⚠ Plan §5 RISK 1 — a wrong mark is a wrong invoice:
//   • doSave/requestSave/setAll are plain functions — NEVER wrap them in
//     useCallback/useMemo (a deps array is a stale-closure surface the page
//     never had);
//   • setSaving(false) stays before either setSaveMsg; a failed save reloads
//     ONLY when res.step === "audit" (the attendance is already committed);
//   • the save is saveAdminAttendance over the real client — the coach app's
//     path step for step, every DB guard unchanged, NO override.
//
// This hook OWNS `saveMsg`; the restore and cancel-booking slices write it too,
// so it is created before them and they take setSaveMsg as a creation dep.

import { useState, type Dispatch, type SetStateAction } from "react";
import { supabaseSaveDeps } from "../dao/lessonDetail.save";
import { saveAdminAttendance, type SaveEntry } from "./adminAttendanceSave";
import { holidayTransitions, optionsForKind, rowEditable, type DbStatus } from "./lessonMarking";
import type { ClassInfo, RosterRow, SaveMsg } from "../types";

export function useAttendanceSave(input: {
  classId: string;
  date: string;
  cls: ClassInfo | null;
  actorId: string | null;
  sessionId: string | null;
  roster: RosterRow[];
  draft: Record<string, DbStatus | null>;
  setDraft: Dispatch<SetStateAction<Record<string, DbStatus | null>>>;
  newRowsAllowed: boolean;
  reload: () => void;
}) {
  const { classId, date, cls, actorId, sessionId, roster, draft, setDraft, newRowsAllowed, reload } = input;
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<SaveMsg>(null);
  const [confirmHoliday, setConfirmHoliday] = useState<number | null>(null);

  // ── Save ────────────────────────────────────────────────────────────────
  async function doSave() {
    if (!cls || !actorId) return;
    setSaving(true);
    setSaveMsg(null);
    const entries: SaveEntry[] = roster
      .filter((r) => draft[r.studentId] !== null && draft[r.studentId] !== undefined)
      .map((r) => ({ studentId: r.studentId, status: draft[r.studentId] as string, prevStatus: r.prev }));
    const res = await saveAdminAttendance({ deps: supabaseSaveDeps(), classId, date, actorProfileId: actorId, knownSessionId: sessionId, entries });
    setSaving(false);
    if (res.ok) {
      setSaveMsg({ kind: "ok", text: res.sent === 0 ? "Nothing to save." : `Saved ${res.sent} mark${res.sent === 1 ? "" : "s"}.${res.emailed ? " A credit-note email was requested." : ""}` });
      reload();
    } else {
      setSaveMsg({ kind: "error", text: res.message });
      if (res.step === "audit") reload();
    }
  }

  function requestSave() {
    const n = holidayTransitions(roster.map((r) => ({ studentId: r.studentId, kind: r.kind, prev: r.prev, next: draft[r.studentId] ?? null })));
    if (n > 0) setConfirmHoliday(n);
    else void doSave();
  }

  function setAll(status: DbStatus) {
    setDraft((d) => {
      const next = { ...d };
      for (const r of roster) {
        if (!rowEditable(r.prev !== null, newRowsAllowed)) continue;
        if (!optionsForKind(r.kind).includes(status)) continue;
        next[r.studentId] = status;
      }
      return next;
    });
  }

  return { saving, saveMsg, setSaveMsg, confirmHoliday, setConfirmHoliday, doSave, requestSave, setAll };
}
