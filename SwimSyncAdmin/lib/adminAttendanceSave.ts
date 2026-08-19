// The admin lesson page's attendance save — the coach app's save path
// (SwimSyncApp/app/(coach)/classes/[id]/attendance.tsx handleSave), mirrored
// step for step, with the differences that review required written down:
//
//   1. resolve-or-INSERT the lesson_sessions row for (class, date) — never a
//      session id the page happened to be holding (§7.64);
//   2. buildAttendanceRows (byte-identical copy of the coach helper — one key
//      set per row, §7.67) over ONLY the rows that changed or have no row yet,
//      so an untouched billed `present` cannot re-fire the credit-note trigger
//      and a CN001 on a row the admin did not touch cannot abort the save;
//   3. ONE upsert, onConflict (lesson_session_id, student_id). A refused row
//      rolls the whole batch back; the error is mapped by
//      attendanceSaveErrorMessage (CN001 says so) and surfaced VERBATIM.
//      PROHIBITION: no retry, no "force", no splitting into per-row upserts to
//      "get the others through" (§7.67 — partial rosters are the bug);
//   4. the audit_log row — and unlike the coach app's unchecked `await`, its
//      error is CHECKED and surfaced as step "audit" (the attendance is already
//      committed; the message says so). 20260819000100 is the policy arm that
//      lets a pure tenant admin write it;
//   5. the bounded credit-note email, only when a SENT row left a billable
//      status (mayHaveIssuedCreditNote over the sent rows).
//
// PROHIBITION: this path does NOT write session_coach_absences. The coach
// writes shadow absences from a "coaches present" checklist this page does not
// have; a row means absent/unpaid, so writing none leaves every shadow PAID —
// the recoverable direction (20260812000200 §2).
//
// Everything the database guards still applies unchanged: the marking window
// and weekday (guard_session_date / guard_attendance_date), the holiday
// admin-only seam, the credit-note trigger and its CN001 lock. The UI explains;
// the DB decides.
//
// Pure orchestration over an injected `deps` so every branch is unit-tested
// with a mock; `supabaseSaveDeps()` (adminAttendanceSaveDeps.ts) binds it to
// the real client — kept apart so this file imports no Supabase client and the
// tests need no env.

import { buildAttendanceRows, type AttendanceRow } from "./attendancePayload";
import { attendanceSaveErrorMessage } from "./attendanceSaveError";
import { mayHaveIssuedCreditNote } from "./creditNoteEmail";

export type SaveEntry = {
  studentId: string;
  /** The DB status to save, e.g. "present" | "absent" | … | "holiday". */
  status: string;
  /** The status as loaded (null = no row yet). Decides whether the row is sent. */
  prevStatus: string | null;
};

export type SaveError = { code?: string; message: string };

export type SaveDeps = {
  findSession(classId: string, date: string): Promise<{ id: string } | null>;
  insertSession(classId: string, date: string): Promise<{ id: string } | { error: SaveError }>;
  upsertAttendance(rows: AttendanceRow[]): Promise<{ error: SaveError | null }>;
  insertAudit(row: {
    actor_id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    new_value: Record<string, unknown>;
  }): Promise<{ error: SaveError | null }>;
  notifyCreditNote(sessionId: string): Promise<void>;
};

export type SaveResult =
  | { ok: true; sessionId: string | null; sent: number; emailed: boolean }
  | { ok: false; step: "session" | "upsert" | "audit"; message: string };

/** The rows worth sending: changed, or never written. */
export function rowsToSend(entries: readonly SaveEntry[]): SaveEntry[] {
  return entries.filter((e) => e.prevStatus === null || e.prevStatus !== e.status);
}

export async function saveAdminAttendance(input: {
  deps: SaveDeps;
  classId: string;
  date: string;
  actorProfileId: string;
  /** The session id IF it was resolved for THIS (class, date); null otherwise. */
  knownSessionId: string | null;
  entries: readonly SaveEntry[];
}): Promise<SaveResult> {
  const { deps, classId, date, actorProfileId, knownSessionId } = input;

  const changed = rowsToSend(input.entries);
  if (changed.length === 0) {
    // Nothing to write — and nothing to materialise: a session row with no
    // marks is the one state unmarkedOn() treats as "every student unmarked".
    return { ok: true, sessionId: knownSessionId, sent: 0, emailed: false };
  }

  // 1. Which lesson am I writing to? Re-resolve from (class, date) unless the
  //    caller already resolved it for exactly this pair.
  let sessionId = knownSessionId;
  if (!sessionId) {
    const existing = await deps.findSession(classId, date);
    sessionId = existing?.id ?? null;
  }
  if (!sessionId) {
    const created = await deps.insertSession(classId, date);
    if ("error" in created) {
      return { ok: false, step: "session", message: created.error.message };
    }
    sessionId = created.id;
  }

  // 2-3. One upsert of the changed rows, uniform key set.
  const rows = buildAttendanceRows(
    sessionId,
    actorProfileId,
    changed.map((e) => ({ studentId: e.studentId, status: e.status }))
  );
  const { error: upsertError } = await deps.upsertAttendance(rows);
  if (upsertError) {
    const mapped = attendanceSaveErrorMessage(upsertError.code);
    // Mapped message for the known code; the DB's own words for anything else
    // (a window-guard refusal names the floor date, and that is the fix).
    const message =
      upsertError.code === "CN001"
        ? mapped
        : upsertError.message || mapped;
    return { ok: false, step: "upsert", message };
  }

  // 4. Audit — checked, never swallowed.
  const { error: auditError } = await deps.insertAudit({
    actor_id: actorProfileId,
    action: "attendance_saved",
    entity_type: "lesson_session",
    entity_id: sessionId,
    new_value: {
      class_id: classId,
      date,
      student_count: changed.length,
      actor_role: "admin",
    },
  });

  // 5. Credit-note email, bounded, only when a SENT row left a billable status.
  const before: Record<string, string | null> = {};
  const after: Record<string, string | null> = {};
  for (const e of changed) {
    before[e.studentId] = e.prevStatus;
    after[e.studentId] = e.status;
  }
  const emailed = mayHaveIssuedCreditNote(before, after);
  if (emailed) await deps.notifyCreditNote(sessionId);

  if (auditError) {
    return {
      ok: false,
      step: "audit",
      message:
        `Attendance was saved, but the audit entry was refused (${auditError.message}). ` +
        `The marks are in; the change history will not show this save.`,
    };
  }

  return { ok: true, sessionId, sent: rows.length, emailed };
}
