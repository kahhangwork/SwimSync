import { describe, it, expect, vi } from "vitest";
import { rowsToSend, saveAdminAttendance, type SaveDeps, type SaveEntry } from "./adminAttendanceSave";
import { hasUniformKeys } from "./attendancePayload";

function mockDeps(over: Partial<SaveDeps> = {}) {
  const calls: Record<string, unknown[]> = { findSession: [], insertSession: [], upsertAttendance: [], insertAudit: [], notifyCreditNote: [] };
  const deps: SaveDeps = {
    findSession: vi.fn(async (...a) => { calls.findSession.push(a); return null; }),
    insertSession: vi.fn(async (...a) => { calls.insertSession.push(a); return { id: "sess-new" }; }),
    upsertAttendance: vi.fn(async (...a) => { calls.upsertAttendance.push(a); return { error: null }; }),
    insertAudit: vi.fn(async (...a) => { calls.insertAudit.push(a); return { error: null }; }),
    notifyCreditNote: vi.fn(async (...a) => { calls.notifyCreditNote.push(a); }),
    ...over,
  };
  return { deps, calls };
}

const ENTRIES: SaveEntry[] = [
  { studentId: "s1", status: "present", prevStatus: null },
  { studentId: "s2", status: "absent", prevStatus: "present" },
  { studentId: "s3", status: "present", prevStatus: "present" }, // unchanged
  { studentId: "s4", status: "holiday", prevStatus: null },
];

describe("rowsToSend", () => {
  it("sends new rows and changed rows, never unchanged ones", () => {
    expect(rowsToSend(ENTRIES).map((e) => e.studentId)).toEqual(["s1", "s2", "s4"]);
  });
});

describe("saveAdminAttendance", () => {
  it("does nothing at all when nothing changed (no session materialised)", async () => {
    const { deps, calls } = mockDeps();
    const r = await saveAdminAttendance({
      deps, classId: "c1", date: "2026-08-10", actorProfileId: "admin",
      knownSessionId: null,
      entries: [{ studentId: "s3", status: "present", prevStatus: "present" }],
    });
    expect(r).toEqual({ ok: true, sessionId: null, sent: 0, emailed: false });
    expect(calls.findSession).toHaveLength(0);
    expect(calls.insertSession).toHaveLength(0);
    expect(calls.upsertAttendance).toHaveLength(0);
  });

  it("resolves the session from (class, date), inserts it once when missing, upserts only changed rows with uniform keys, audits as admin", async () => {
    const { deps, calls } = mockDeps();
    const r = await saveAdminAttendance({
      deps, classId: "c1", date: "2026-08-10", actorProfileId: "admin-1",
      knownSessionId: null, entries: ENTRIES,
    });
    expect(r).toEqual({ ok: true, sessionId: "sess-new", sent: 3, emailed: true });
    expect(calls.findSession).toEqual([["c1", "2026-08-10"]]);
    expect(calls.insertSession).toHaveLength(1);

    const rows = (calls.upsertAttendance[0] as any[])[0];
    expect(rows.map((x: any) => x.student_id)).toEqual(["s1", "s2", "s4"]);
    expect(hasUniformKeys(rows)).toBe(true);
    expect(rows[2]).toEqual({
      lesson_session_id: "sess-new", student_id: "s4", status: "holiday",
      marked_by: "admin-1", last_edited_by: "admin-1",
    });
    // holiday rows are KEPT (the admin may write them; the coach path filters them)
    expect(rows.some((x: any) => x.status === "holiday")).toBe(true);

    const audit = (calls.insertAudit[0] as any[])[0];
    expect(audit.action).toBe("attendance_saved");
    expect(audit.entity_type).toBe("lesson_session");
    expect(audit.entity_id).toBe("sess-new");
    expect(audit.actor_id).toBe("admin-1");
    expect(audit.new_value.actor_role).toBe("admin");
  });

  it("uses the known session id without re-resolving, and skips the insert", async () => {
    const { deps, calls } = mockDeps();
    await saveAdminAttendance({
      deps, classId: "c1", date: "2026-08-10", actorProfileId: "a",
      knownSessionId: "sess-known", entries: ENTRIES,
    });
    expect(calls.findSession).toHaveLength(0);
    expect(calls.insertSession).toHaveLength(0);
    expect(((calls.upsertAttendance[0] as any[])[0] as any[])[0].lesson_session_id).toBe("sess-known");
  });

  it("finds an existing session rather than inserting", async () => {
    const { deps, calls } = mockDeps({ findSession: vi.fn(async () => ({ id: "sess-found" })) });
    const r = await saveAdminAttendance({
      deps, classId: "c1", date: "2026-08-10", actorProfileId: "a",
      knownSessionId: null, entries: ENTRIES,
    });
    expect(r.ok && r.sessionId).toBe("sess-found");
    expect(calls.insertSession).toHaveLength(0);
  });

  it("emails the credit note ONLY when a sent row left a billable status", async () => {
    const noLeave = mockDeps();
    await saveAdminAttendance({
      deps: noLeave.deps, classId: "c1", date: "d", actorProfileId: "a", knownSessionId: "s",
      entries: [{ studentId: "s1", status: "present", prevStatus: null }, { studentId: "s2", status: "absent", prevStatus: "absent" }],
    });
    expect(noLeave.calls.notifyCreditNote).toHaveLength(0);

    const leave = mockDeps();
    await saveAdminAttendance({
      deps: leave.deps, classId: "c1", date: "d", actorProfileId: "a", knownSessionId: "s",
      entries: [{ studentId: "s2", status: "absent", prevStatus: "trial_paid" }],
    });
    expect(leave.calls.notifyCreditNote).toEqual([["s"]]);
  });

  it("surfaces a session-insert failure as step 'session' and writes nothing else", async () => {
    const { deps, calls } = mockDeps({
      insertSession: vi.fn(async () => ({ error: { code: "P0001", message: "That lesson (01 Mar 2026) is closed." } })),
    });
    const r = await saveAdminAttendance({ deps, classId: "c1", date: "2026-03-01", actorProfileId: "a", knownSessionId: null, entries: ENTRIES });
    expect(r).toEqual({ ok: false, step: "session", message: "That lesson (01 Mar 2026) is closed." });
    expect(calls.upsertAttendance).toHaveLength(0);
    expect(calls.insertAudit).toHaveLength(0);
  });

  it("maps CN001 to the credit-lock message and stops (no audit, no email)", async () => {
    const { deps, calls } = mockDeps({
      upsertAttendance: vi.fn(async () => ({ error: { code: "CN001", message: "raw" } })),
    });
    const r = await saveAdminAttendance({ deps, classId: "c1", date: "d", actorProfileId: "a", knownSessionId: "s", entries: ENTRIES });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.step).toBe("upsert");
      expect(r.message).toMatch(/credit was already applied/);
      expect(r.message).toMatch(/None of your changes were saved/);
    }
    expect(calls.insertAudit).toHaveLength(0);
    expect(calls.notifyCreditNote).toHaveLength(0);
  });

  it("surfaces any other upsert refusal with the DB's own words (the window guard names the floor)", async () => {
    const { deps } = mockDeps({
      upsertAttendance: vi.fn(async () => ({ error: { code: "P0001", message: "That lesson (01 Mar 2026) is closed. Attendance can be marked back to 01 Jul 2026" } })),
    });
    const r = await saveAdminAttendance({ deps, classId: "c1", date: "d", actorProfileId: "a", knownSessionId: "s", entries: ENTRIES });
    expect(!r.ok && r.message).toMatch(/marked back to 01 Jul 2026/);
  });

  it("an audit refusal (42501) is reported as step 'audit' AFTER the marks are committed — never swallowed", async () => {
    const { deps, calls } = mockDeps({
      insertAudit: vi.fn(async () => ({ error: { code: "42501", message: "new row violates row-level security policy" } })),
    });
    const r = await saveAdminAttendance({ deps, classId: "c1", date: "d", actorProfileId: "a", knownSessionId: "s", entries: ENTRIES });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.step).toBe("audit");
      expect(r.message).toMatch(/Attendance was saved/);
      expect(r.message).toMatch(/row-level security/);
    }
    expect(calls.upsertAttendance).toHaveLength(1);
    // the email still went (the marks ARE committed)
    expect(calls.notifyCreditNote).toHaveLength(1);
  });

  it("never touches session_coach_absences (the deps have no such call)", () => {
    const { deps } = mockDeps();
    expect(Object.keys(deps).sort()).toEqual(["findSession", "insertAudit", "insertSession", "notifyCreditNote", "upsertAttendance"]);
  });
});
