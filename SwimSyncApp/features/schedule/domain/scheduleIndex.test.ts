// CHARACTERISATION test (COACH_SCHEDULE_REFACTOR_PLAN.md, Stage 2): pins the maps
// and flags loadData builds from its raw rows, as they were before the move.
// §7.25's prove-it-red rule does not apply — there is no fix, only a move.
import {
  coveredClassIdsOf,
  shadowClassIdsOf,
  coachClassesOf,
  sessionIndex,
  bookedIndex,
  isTruncated,
} from "./scheduleIndex";
import { ROW_LIMIT } from "../constants";

const rows = (n: number) => Array.from({ length: n }, () => ({}));

describe("scheduleIndex (characterisation)", () => {
  it("coveredClassIdsOf: rostered classes I do not own", () => {
    expect(coveredClassIdsOf(new Map([["a", []], ["b", []]]), new Set(["a"]))).toEqual(["b"]);
  });

  it("shadowClassIdsOf: deduped, minus owned and covered; null rows -> []", () => {
    const shadow = [{ class_id: "a" }, { class_id: "c" }, { class_id: "c" }, { class_id: "b" }];
    expect(shadowClassIdsOf(shadow, new Set(["a"]), ["b"])).toEqual(["c"]);
    expect(shadowClassIdsOf(null, new Set(), [])).toEqual([]);
  });

  it("coachClassesOf: owned, then covered, then shadowed — flags per source; null data -> skipped", () => {
    const out = coachClassesOf([{ id: "o" }], { data: [{ id: "c" }] }, { data: [{ id: "s" }] }, new Set(["s"]));
    expect(out.map((c) => [c.cls.id, c.owned, c.shadowed])).toEqual([
      ["o", true, false],
      ["c", false, false],
      ["s", false, true],
    ]);
    expect(coachClassesOf([], { data: null }, { data: null }, new Set())).toEqual([]);
  });

  it("sessionIndex: keyed by class:date, cancelled flag, marked set and statuses; dates per class", () => {
    const { sessionByClassDate, sessionDatesByClass } = sessionIndex([
      { id: "x", class_id: "c1", session_date: "2026-09-14", cancelled_at: "2026-09-10T00:00:00+08:00", attendance: [{ student_id: "s1", status: "absent" }] },
      { id: "y", class_id: "c1", session_date: "2026-09-21", cancelled_at: null, attendance: null },
    ]);
    const x = sessionByClassDate.get("c1:2026-09-14")!;
    expect([x.id, x.cancelled, [...x.markedStudentIds], x.statusByStudent.get("s1")]).toEqual(["x", true, ["s1"], "absent"]);
    expect(sessionByClassDate.get("c1:2026-09-21")!.markedStudentIds.size).toBe(0);
    expect(sessionDatesByClass.get("c1")).toEqual(["2026-09-14", "2026-09-21"]);
  });

  it("bookedIndex: trials and make-ups merge into one class -> date -> students map, trials first", () => {
    const m = bookedIndex(
      [{ class_id: "c1", student_id: "t1", session_date: "2026-09-14" }],
      [{ class_id: "c1", student_id: "m1", session_date: "2026-09-14" }]
    );
    expect(m.get("c1")!.get("2026-09-14")).toEqual(["t1", "m1"]);
  });

  it("9. isTruncated: each leg alone AT the limit trips it; one below does not; a null roster does not throw", () => {
    const none = { windowSessions: [], bookingRows: [], makeupRows: [], rosterRes: { data: [] } };
    expect(isTruncated(none)).toBe(false);
    expect(isTruncated({ ...none, windowSessions: rows(ROW_LIMIT) })).toBe(true);
    expect(isTruncated({ ...none, bookingRows: rows(ROW_LIMIT) })).toBe(true);
    expect(isTruncated({ ...none, makeupRows: rows(ROW_LIMIT) })).toBe(true);
    expect(isTruncated({ ...none, rosterRes: { data: rows(ROW_LIMIT) } })).toBe(true);
    expect(
      isTruncated({
        windowSessions: rows(ROW_LIMIT - 1),
        bookingRows: rows(ROW_LIMIT - 1),
        makeupRows: rows(ROW_LIMIT - 1),
        rosterRes: { data: rows(ROW_LIMIT - 1) },
      })
    ).toBe(false);
    expect(isTruncated({ ...none, rosterRes: { data: null } })).toBe(false);
  });
});
