// The marking screen's SAVE PATH (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 4) —
// handleSave moved VERBATIM from app/(coach)/classes/[id]/attendance.tsx; only its
// network calls became dao/ calls. A wrong mark is a wrong invoice.
//
// ⚠ handleSave is a PLAIN FUNCTION recreated every render — NO useCallback/useMemo.
// It must read THIS render's `students`/`attendance`/`resolved`/`shadowsHere`; a deps
// list is how a save writes the marks from a previous render. `loadedStatuses` is the
// REF, read at save time (`.current`), never a snapshot. The step ORDER is load-bearing
// in five places (plan §6 Stage 4) — do not split, reorder or wrap this in a try.
import { useState } from "react";
import type { MutableRefObject } from "react";
import { useAppStore } from "@/store/useAppStore";
import { buildAttendanceRows } from "@/lib/attendancePayload";
import { attendanceSaveErrorMessage } from "@/lib/attendanceSaveError";
import { resolveSessionForDate, type ResolvedSession } from "@/lib/attendanceSession";
import { mayHaveIssuedCreditNote } from "@/lib/creditNoteEmail";
import type { AttState, DBStatus, StudentRow } from "../types";
import { toDBStatus } from "./attendanceStatus";
import {
  createSession,
  deleteAbsences,
  insertAuditLog,
  loadCoachRecord,
  loadSessionId,
  upsertAbsences,
  upsertAttendance,
} from "../dao/markAttendance.repo";
import { notifyCreditNotes } from "../dao/markAttendance.rpc";

export function useSaveAttendance({
  id,
  date,
  students,
  attendance,
  resolved,
  setResolved,
  shadowsHere,
  loadedStatuses,
  leaveScreen,
}: {
  id: string;
  date: string;
  students: StudentRow[];
  attendance: Record<string, AttState>;
  resolved: ResolvedSession | null;
  setResolved: (r: ResolvedSession | null) => void;
  shadowsHere: { coach_id: string; name: string; present: boolean }[];
  loadedStatuses: MutableRefObject<Record<string, DBStatus | null>>;
  leaveScreen: () => void;
}) {
  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    // Validate all statuses are complete
    for (const student of students) {
      const state = attendance[student.id];
      // A holiday row is admin-owned and read-only here — it needs no marking and
      // is left out of the save payload below, so don't demand a status for it.
      if (state?.top === "holiday") continue;
      if (!state || state.top === "unmarked") {
        showToast(`Please mark attendance for ${student.full_name}.`, "error");
        return;
      }
      if (toDBStatus(state.top, state.sub) === null) {
        showToast(
          `Please select a sub-type for ${student.full_name}.`,
          "error"
        );
        return;
      }
    }

    setSaving(true);

    // Get coach record
    const { data: coach } = await loadCoachRecord(session!.id);

    if (!coach) {
      showToast("Could not find coach record.", "error");
      setSaving(false);
      return;
    }

    // ── WHICH LESSON AM I WRITING TO? ──────────────────────────────────────
    // Never the bare id this screen happens to be holding. It is only usable
    // if it was resolved for the date now on screen; anything else is treated
    // as unknown and re-resolved from (class_id, date) — the pair that
    // uniquely identifies a lesson. This is the layer that would have caught
    // §7.64 even with the mount-only effect still in place.
    const decision = resolveSessionForDate(resolved, date);
    let finalSessionId =
      decision.kind === "use" ? decision.sessionId : null;

    if (decision.kind === "stale") {
      const { data: existingSession } = await loadSessionId(id, date);
      finalSessionId = existingSession?.id ?? null;
    }

    if (!finalSessionId) {
      const { data: newSession, error: sessionError } = await createSession(id, date);

      if (sessionError || !newSession) {
        showToast("Could not create session record.", "error");
        setSaving(false);
        return;
      }

      finalSessionId = newSession.id;
    }

    // A real guard rather than `!`: everything below writes attendance against
    // this id, and a null here would be the §7.64 class of mistake again.
    if (!finalSessionId) {
      showToast("Could not create session record.", "error");
      setSaving(false);
      return;
    }

    setResolved({ date, sessionId: finalSessionId });

    // Built in lib/attendancePayload.ts, NOT inline — every row has to carry
    // the same keys or PostgREST inserts NULL for the ones a row omits (§7.67).
    // That is what made a partially-marked lesson permanently unsaveable.
    const rows = buildAttendanceRows(
      finalSessionId,
      session!.id,
      students
        // EXCLUDE holiday rows: the DB guard refuses a coach writing 'holiday', and
        // one refused row rolls back the whole batch upsert (§7.67). Leaving them
        // out of the payload keeps the admin's void untouched by a coach save.
        .filter((student) => attendance[student.id].top !== "holiday")
        .map((student) => ({
          studentId: student.id,
          status: toDBStatus(
            attendance[student.id].top,
            attendance[student.id].sub
          )!,
        }))
    );

    const { error: upsertError } = await upsertAttendance(rows);

    if (upsertError) {
      // ⚠ CN001 — the credit-note trigger REFUSED to un-correct a lesson whose
      // credit is already applied (20260818000100). One row in a batch upsert, so
      // the whole roster rolled back — attendanceSaveErrorMessage says so.
      showToast(
        attendanceSaveErrorMessage((upsertError as { code?: string }).code),
        "error"
      );
      setSaving(false);
      return;
    }

    // ── Coaches present ───────────────────────────────────────────────────
    // ⚠ AFTER THE ATTENDANCE UPSERT, AND ON finalSessionId. The lesson_sessions
    // row is created LAZILY above, so an absence written before it has no lesson
    // to reference.
    //
    // ⚠ A ROW MEANS ABSENT. No row means the shadow was here and is paid, which
    // is why a FAILED write here is survivable: it leaves them PAID, the
    // recoverable direction. Inverting this to a presence record would trade
    // that for a silent underpayment (migration §2).
    //
    // Alert.alert is a no-op on RN-web, so the failure is a Toast.
    if (shadowsHere.length > 0) {
      const absent = shadowsHere.filter((sh) => !sh.present);
      const present = shadowsHere.filter((sh) => sh.present);

      const [delRes, insRes] = await Promise.all([
        present.length > 0
          ? deleteAbsences(finalSessionId, present.map((sh) => sh.coach_id))
          : Promise.resolve({ error: null }),
        absent.length > 0
          ? upsertAbsences(
              absent.map((sh) => ({
                lesson_session_id: finalSessionId,
                coach_id: sh.coach_id,
                // Stamped by the trigger; the value sent is never trusted.
                tenant_id: "00000000-0000-0000-0000-000000000000",
                marked_by: session!.id,
              }))
            )
          : Promise.resolve({ error: null }),
      ]);

      if (delRes.error || insRes.error) {
        // Named, not swallowed: the month may be settled, in which case the
        // seal refused this deliberately and the attendance above still saved.
        showToast(
          `Attendance saved, but the coaches-present list did not: ${
            (delRes.error ?? insRes.error)?.message ?? "unknown error"
          }`,
          "error"
        );
      }
    }

    // Audit log
    await insertAuditLog({
      actor_id: session!.id,
      action: "attendance_saved",
      entity_type: "lesson_session",
      entity_id: finalSessionId,
      new_value: {
        class_id: id,
        date,
        student_count: students.length,
      },
    });

    // ⚠ RISK 9 (CREDIT_NOTE_EMAIL_PLAN.md) — BEFORE setSaving(false), and before
    // leaveScreen(). If this attendance edit flipped an already-invoiced lesson from
    // billable to non-billable, the handle_attendance_update trigger has just issued
    // a credit note, and the parent has no idea until they open the app.
    //
    // AWAITED ON PURPOSE, bounded to 3s. leaveScreen() below is a router.replace
    // that unmounts this screen, so an unawaited request is issued milliseconds
    // before its own destruction — and a coach who locks the phone kills it. Held
    // here, the existing save spinner covers the wait; the attendance rows are
    // already committed above, so this can only delay the toast, never the save.
    // Silent on failure by decision: the admin's Credit Notes page has the Resend
    // button, and a failed email is not something the coach can act on (§8.27).
    //
    // GUARDED so the COMMON save pays nothing. A credit note can only arise when a
    // lesson LEAVES 'present'/'trial_paid'; every other save — the normal one — would
    // otherwise wait on an edge-function cold start plus five queries to be told there
    // was nothing to do. The server stays authoritative; this only skips the call when
    // a note is impossible.
    const savedStatuses = Object.fromEntries(
      rows.map((r) => [r.student_id, r.status as string | null])
    );
    if (mayHaveIssuedCreditNote(loadedStatuses.current, savedStatuses)) {
      await notifyCreditNotes(finalSessionId);
    }

    setSaving(false);
    showToast("Attendance saved.", "success");
    leaveScreen();
  }

  return { saving, handleSave };
}
