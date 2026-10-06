// useSaveAttendance — the marking screen's SAVE PATH. A wrong mark is a wrong invoice,
// so what is pinned is every way this hook decides WHAT is written, WHERE, and WHEN:
//   • guards: nothing is written while a child is unmarked or lacks a sub-type; a
//     public-holiday void needs no mark and is never in the payload; every row has
//     the same keys (§7.67);
//   • the right lesson (§7.64): a session id resolved for ANOTHER date is never sent;
//     the lesson is re-resolved from (class, date), or created;
//   • failure paths: CN001 says so and stops; a failed coaches-present write is
//     named but the attendance still counts as saved;
//   • credit-note + order: the email is asked for only when a lesson LEFT a billable
//     status, AFTER the upsert, and AWAITED before the screen is left (RISK 9 of
//     CREDIT_NOTE_EMAIL_PLAN).
//
// Every case is ONE change away from the happy fixture, which is tested first — a
// "not called" assertion on a fixture that never reaches the branch passes for free
// (§7.111). Dao calls, toasts and leaveScreen land in ONE ordered log (saveHarness).
//
// MUTATION PROOFS (§7.25) — each applied to useSaveAttendance.ts by mutate.sh
// (scratchpad; restores from HEAD on exit), each RED on the named test:
//   M1  delete `if (state?.top === "holiday") continue;`        → "a holiday row needs no mark"
//   M2  holiday payload filter → `.filter(() => true)`           → "a holiday row needs no mark"
//   M3  `resolveSessionForDate(resolved, date)` → `(resolved, resolved?.date ?? date)`
//                                                                 → "a session resolved for ANOTHER date is never sent"
//       (the plan's M3, `use ? id : null` → `resolved?.sessionId ?? null`, is an
//        EQUIVALENT mutant: the stale branch overwrites it on every path. Replaced.)
//   M4  `if (decision.kind === "stale") {` → `if (false) {`      → "a session resolved for ANOTHER date is never sent"
//   M5  `await notifyCreditNotes(` → `notifyCreditNotes(`        → "the credit-note request is AWAITED before leaving"
//   M6  `mayHaveIssuedCreditNote(loadedStatuses.current,` → `({},` → "a lesson that LEFT present asks for the credit-note email"
//   M7  `(upsertError as { code?: string }).code` → `undefined`  → "CN001 says so and stops"
//   M8  drop the `return;` after the CN001 setSaving(false)      → "CN001 says so and stops"
//   M9  `if (delRes.error || insRes.error) {` → `if (false) {`   → "a failed coaches-present write is named"
//   M10 `deleteAbsences(finalSessionId,` → `deleteAbsences(id,`  → "absences are written on the final session id"
//   M11 `if (!coach) {` → `if (false) {`                         → "no coach record"
//   M12 drop setSaving(false) in the createSession-error branch   → "createSession failing says so"
//   M13 `setResolved({ date, sessionId: finalSessionId })` → `sessionId: null`
//                                                                 → "stale with no lesson yet creates it"
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { MutableRefObject } from "react";
import { attendanceSaveErrorMessage } from "@/lib/attendanceSaveError";
import { buildAttendanceRows, hasUniformKeys } from "@/lib/attendancePayload";
import type { ResolvedSession } from "@/lib/attendanceSession";
import type { AttState, DBStatus, StudentRow } from "../types";
import {
  att,
  calledFns,
  calls,
  deferred,
  expectIdNeverSent,
  expectNoWrites,
  firstIndex,
  leaveScreen,
  repoMock,
  resetHarness,
  rpcMock,
  student,
  toasts,
  when,
} from "../testing/saveHarness";

jest.mock("../dao/markAttendance.repo", () => require("../testing/saveHarness").repoMock);
jest.mock("../dao/markAttendance.rpc", () => require("../testing/saveHarness").rpcMock);
jest.mock("@/store/useAppStore", () => ({
  useAppStore: (sel: any) => sel(require("../testing/saveHarness").store),
}));
jest.mock("@/lib/confirm", () => ({
  confirmAction: (...a: any[]) => require("../testing/saveHarness").confirmAction(...a),
}));
jest.mock("@/lib/supabase", () => require("../testing/saveHarness").supabaseTripwire);

// eslint-disable-next-line import/first
import { useSaveAttendance } from "./useSaveAttendance";

const CLASS = "class-1";
const DATE = "2026-09-05";
const OTHER = "2026-08-29";

const ANNA = student("s1", "Anna Tan");
const BEN = student("s2", "Ben Lim");

type Props = Parameters<typeof useSaveAttendance>[0];

/** The happy fixture: two children marked present on this date's known lesson. */
function props(over: Partial<Props> = {}): Props {
  return {
    id: CLASS,
    date: DATE,
    students: [ANNA, BEN],
    attendance: { s1: att("present"), s2: att("present") },
    resolved: { date: DATE, sessionId: "sess-1" },
    setResolved: jest.fn(),
    shadowsHere: [],
    loadedStatuses: { current: {} } as MutableRefObject<Record<string, DBStatus | null>>,
    leaveScreen,
    ...over,
  };
}

function setup(p: Props = props()) {
  const hook = renderHook(() => useSaveAttendance(p));
  return { ...hook, p };
}

/** Run a whole save. No try/catch anywhere: a throw must turn the test red. */
async function runSave(result: { current: ReturnType<typeof useSaveAttendance> }) {
  await act(async () => {
    await result.current.handleSave();
  });
  return [...calls];
}

function upsertedRows(): ReturnType<typeof buildAttendanceRows> {
  const c = calls.filter((x) => x.fn === "upsertAttendance");
  expect(c).toHaveLength(1);
  return c[0].args[0] as ReturnType<typeof buildAttendanceRows>;
}

beforeEach(() => resetHarness());

describe("useSaveAttendance — the happy save (positive control)", () => {
  it("writes exactly the marked rows on this date's lesson, says so, and leaves", async () => {
    const { result } = setup();
    await runSave(result);

    expect(upsertedRows()).toEqual([
      { lesson_session_id: "sess-1", student_id: "s1", status: "present", marked_by: "profile-1", last_edited_by: "profile-1" },
      { lesson_session_id: "sess-1", student_id: "s2", status: "present", marked_by: "profile-1", last_edited_by: "profile-1" },
    ]);
    expect(toasts()).toContainEqual(["Attendance saved.", "success"]);
    expect(leaveScreen).toHaveBeenCalledTimes(1);
    expect(result.current.saving).toBe(false);
  });
});

describe("useSaveAttendance — guards and payload", () => {
  it("an unmarked child: the toast names them and nothing is written", async () => {
    const { result } = setup(props({ attendance: { s1: att("present"), s2: att("unmarked") } }));
    await runSave(result);

    expect(toasts()).toEqual([["Please mark attendance for Ben Lim.", "error"]]);
    expectNoWrites();
    expect(repoMock.loadCoachRecord).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it.each(["cancelled", "trial"] as const)("a %s mark with no sub-type: the sub-type toast, nothing written", async (top) => {
    const { result } = setup(props({ attendance: { s1: att("present"), s2: att(top, null) } }));
    await runSave(result);

    expect(toasts()).toEqual([["Please select a sub-type for Ben Lim.", "error"]]);
    expectNoWrites();
  });

  it("a holiday row needs no mark and is never in the payload", async () => {
    const HANA = student("h", "Hana Goh");
    const { result } = setup(
      props({
        students: [ANNA, BEN, HANA],
        attendance: { s1: att("present"), s2: att("present"), h: att("holiday") },
      })
    );
    await runSave(result);

    expect(upsertedRows().map((r) => r.student_id)).toEqual(["s1", "s2"]);
    expect(toasts()).toContainEqual(["Attendance saved.", "success"]);
  });

  it("every row carries the same keys, whatever its status (§7.67)", async () => {
    const CARA = student("s3", "Cara Ng");
    const DEV = student("s4", "Dev Raj", { isTrial: true });
    const { result } = setup(
      props({
        students: [ANNA, BEN, CARA, DEV],
        attendance: {
          s1: att("present"),
          s2: att("absent"),
          s3: att("cancelled", "rain"),
          s4: att("trial", "paid"),
        },
      })
    );
    await runSave(result);

    const rows = upsertedRows();
    expect(rows.map((r) => r.status)).toEqual(["present", "absent", "cancelled_rain", "trial_paid"]);
    expect(hasUniformKeys(rows)).toBe(true);
  });

  it("saving is true while the save is in flight, and false after", async () => {
    const coach = deferred<{ data: { id: string } | null; error: null }>();
    when("loadCoachRecord", () => coach.promise);
    const { result } = setup();

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleSave();
    });
    await waitFor(() => expect(result.current.saving).toBe(true));

    await act(async () => {
      coach.resolve({ data: { id: "coach-1" }, error: null });
      await pending;
    });
    expect(result.current.saving).toBe(false);
  });
});

describe("useSaveAttendance — the right lesson (§7.64)", () => {
  it("a lesson resolved for THIS date is used as is", async () => {
    const { result } = setup();
    await runSave(result);

    expect(repoMock.loadSessionId).not.toHaveBeenCalled();
    expect(repoMock.createSession).not.toHaveBeenCalled();
    expect(upsertedRows().every((r) => r.lesson_session_id === "sess-1")).toBe(true);
  });

  it("this date with no lesson yet creates it, without looking it up again", async () => {
    const { result, p } = setup(props({ resolved: { date: DATE, sessionId: null } }));
    await runSave(result);

    expect(repoMock.createSession).toHaveBeenCalledWith(CLASS, DATE);
    expect(repoMock.loadSessionId).not.toHaveBeenCalled();
    expect(upsertedRows().every((r) => r.lesson_session_id === "sess-new")).toBe(true);
    expect(p.setResolved).toHaveBeenCalledWith({ date: DATE, sessionId: "sess-new" });
  });

  it("a session resolved for ANOTHER date is never sent — the lesson is looked up from (class, date)", async () => {
    when("loadSessionId", async () => ({ data: { id: "sess-1" }, error: null }));
    const stale: ResolvedSession = { date: OTHER, sessionId: "sess-stale" };
    const { result } = setup(
      props({
        resolved: stale,
        shadowsHere: [{ coach_id: "c-sh", name: "Sam", present: false }],
        loadedStatuses: { current: { s1: "present" } },
        attendance: { s1: att("absent"), s2: att("present") },
      })
    );
    await runSave(result);

    expect(repoMock.loadSessionId).toHaveBeenCalledWith(CLASS, DATE);
    expect(upsertedRows().every((r) => r.lesson_session_id === "sess-1")).toBe(true);
    // Upsert, absences, audit AND the credit-note call all reached the log…
    expect(calledFns()).toEqual(
      expect.arrayContaining(["upsertAttendance", "upsertAbsences", "insertAuditLog", "notifyCreditNotes"])
    );
    // …and not one of them carried the stale id.
    expectIdNeverSent("sess-stale");
  });

  it("stale with no lesson yet creates it, and remembers it for this date", async () => {
    const { result, p } = setup(props({ resolved: { date: OTHER, sessionId: "sess-stale" } }));
    await runSave(result);

    expect(repoMock.loadSessionId).toHaveBeenCalledWith(CLASS, DATE);
    expect(repoMock.createSession).toHaveBeenCalledWith(CLASS, DATE);
    expect(upsertedRows().every((r) => r.lesson_session_id === "sess-new")).toBe(true);
    expect(p.setResolved).toHaveBeenCalledWith({ date: DATE, sessionId: "sess-new" });
  });

  it("createSession failing says so, writes nothing and stays", async () => {
    when("createSession", async () => ({ data: null, error: { message: "x" } }));
    const { result } = setup(props({ resolved: { date: DATE, sessionId: null } }));
    await runSave(result);

    expect(toasts()).toEqual([["Could not create session record.", "error"]]);
    expect(repoMock.upsertAttendance).not.toHaveBeenCalled();
    expect(leaveScreen).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it("no coach record: says so and writes nothing", async () => {
    when("loadCoachRecord", async () => ({ data: null, error: null }));
    const { result } = setup();
    await runSave(result);

    expect(toasts()).toEqual([["Could not find coach record.", "error"]]);
    expectNoWrites();
    expect(result.current.saving).toBe(false);
  });
});

describe("useSaveAttendance — failure paths", () => {
  it("PK001 toasts the DB's own words and stops: no absences, no audit, no email, stays", async () => {
    const db = "Mark 3 Oct first — the package has 1 lesson left. (Ava · Dolphins Fri 4pm)";
    when("upsertAttendance", async () => ({ error: { code: "PK001", message: db } }));
    const { result } = setup();
    await runSave(result);

    expect(toasts()).toEqual([[db, "error"]]);
    for (const fn of ["upsertAbsences", "deleteAbsences", "insertAuditLog", "notifyCreditNotes", "leaveScreen"]) {
      expect(calledFns()).not.toContain(fn);
    }
    expect(calls.filter((c) => c.fn === "upsertAttendance")).toHaveLength(1); // no retry, no per-row split
    expect(result.current.saving).toBe(false);
  });

  it("CN001 says so and stops: no absences, no audit, no email, stays", async () => {
    when("upsertAttendance", async () => ({ error: { code: "CN001", message: "refused" } }));
    const { result } = setup(
      props({
        shadowsHere: [{ coach_id: "c-sh", name: "Sam", present: false }],
        loadedStatuses: { current: { s1: "present" } },
        attendance: { s1: att("absent"), s2: att("present") },
      })
    );
    await runSave(result);

    expect(attendanceSaveErrorMessage("CN001")).not.toBe(attendanceSaveErrorMessage(undefined));
    expect(toasts()).toEqual([[attendanceSaveErrorMessage("CN001"), "error"]]);
    for (const fn of ["upsertAbsences", "deleteAbsences", "insertAuditLog", "notifyCreditNotes", "leaveScreen"]) {
      expect(calledFns()).not.toContain(fn);
    }
    expect(result.current.saving).toBe(false);
  });

  it("a failed coaches-present write is named, and the attendance still counts as saved", async () => {
    when("upsertAbsences", async () => ({ error: { message: "month is sealed" } }));
    const { result } = setup(props({ shadowsHere: [{ coach_id: "c-sh", name: "Sam", present: false }] }));
    await runSave(result);

    expect(toasts()).toContainEqual([
      "Attendance saved, but the coaches-present list did not: month is sealed",
      "error",
    ]);
    expect(toasts()).toContainEqual(["Attendance saved.", "success"]);
    expect(leaveScreen).toHaveBeenCalledTimes(1);
  });
});

describe("useSaveAttendance — coaches present", () => {
  it("absences are written on the final session id: absent → upsert, present → delete", async () => {
    when("loadSessionId", async () => ({ data: { id: "sess-1" }, error: null }));
    const { result } = setup(
      props({
        resolved: { date: OTHER, sessionId: "sess-stale" },
        shadowsHere: [
          { coach_id: "c-away", name: "Sam", present: false },
          { coach_id: "c-here", name: "Kim", present: true },
        ],
      })
    );
    await runSave(result);

    expect(repoMock.upsertAbsences).toHaveBeenCalledWith([
      expect.objectContaining({ lesson_session_id: "sess-1", coach_id: "c-away", marked_by: "profile-1" }),
    ]);
    expect(repoMock.deleteAbsences).toHaveBeenCalledWith("sess-1", ["c-here"]);
  });

  it("no shadows: neither absence call is made", async () => {
    const { result } = setup();
    await runSave(result);

    expect(repoMock.upsertAbsences).not.toHaveBeenCalled();
    expect(repoMock.deleteAbsences).not.toHaveBeenCalled();
    expect(toasts()).toContainEqual(["Attendance saved.", "success"]);
  });
});

describe("useSaveAttendance — credit-note email and order", () => {
  it("a lesson that LEFT present asks for the credit-note email on this lesson", async () => {
    const { result, p } = setup(props({ attendance: { s1: att("absent"), s2: att("present") } }));
    // Filled AFTER first render, as load() does — the hook must read the ref at
    // save time, not a snapshot.
    p.loadedStatuses.current = { s1: "present", s2: "present" };
    await runSave(result);

    expect(rpcMock.notifyCreditNotes).toHaveBeenCalledWith("sess-1");
  });

  it("no lesson left a billable status: no credit-note call", async () => {
    const { result, p } = setup(props({ attendance: { s1: att("absent"), s2: att("present") } }));
    p.loadedStatuses.current = { s1: "absent", s2: "present" };
    await runSave(result);

    expect(rpcMock.notifyCreditNotes).not.toHaveBeenCalled();
    expect(toasts()).toContainEqual(["Attendance saved.", "success"]);
  });

  it("order: upsert → absences → audit → credit-note → success toast → leave", async () => {
    const { result, p } = setup(
      props({
        attendance: { s1: att("absent"), s2: att("present") },
        shadowsHere: [{ coach_id: "c-sh", name: "Sam", present: false }],
      })
    );
    p.loadedStatuses.current = { s1: "present" };
    await runSave(result);

    const saved = calls.findIndex((c) => c.fn === "showToast" && c.args[0] === "Attendance saved.");
    const order = [
      firstIndex("upsertAttendance"),
      firstIndex("upsertAbsences"),
      firstIndex("insertAuditLog"),
      firstIndex("notifyCreditNotes"),
      saved,
      firstIndex("leaveScreen"),
    ];
    // Strictly increasing; a -1 (the toast never shown) also breaks the sort.
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });

  it("the credit-note request is AWAITED before leaving", async () => {
    const notify = deferred<undefined>();
    when("notifyCreditNotes", () => notify.promise);
    const { result, p } = setup(props({ attendance: { s1: att("absent"), s2: att("present") } }));
    p.loadedStatuses.current = { s1: "present" };

    let pending!: Promise<void>;
    try {
      act(() => {
        pending = result.current.handleSave();
      });
      await waitFor(() => expect(rpcMock.notifyCreditNotes).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(leaveScreen).not.toHaveBeenCalled();
      expect(result.current.saving).toBe(true);
    } finally {
      await act(async () => {
        notify.resolve(undefined);
        await pending;
      });
    }
    expect(leaveScreen).toHaveBeenCalledTimes(1);
  });
});
