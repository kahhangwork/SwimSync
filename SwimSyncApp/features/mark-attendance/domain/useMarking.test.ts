// useMarking — per-row marks and Set all. Every mark becomes an attendance row, and the
// row's status IS the charge, so what is pinned:
//   • Set all on an untouched roster applies at once; on a roster with ANY mark it asks
//     first, and applies NOTHING until confirmed — a stray tap can't wipe edits;
//   • Set all never touches a public-holiday void — neither re-marks it nor DELETES it;
//   • setTop clears the sub-type (a stale "rain" must not ride onto Trial); setSub
//     keeps the top.
//
// A holiday row is admin-owned and read-only to a coach (types.ts). onSetAll leaves it
// out of the ids it re-marks, because one refused holiday row fails the whole batch
// save (§7.67). Until 2026-10-02 that was only half the rule: applyBulkStatus returned
// ONLY the ids it was given, and the result replaced the whole map — so the holiday
// row was DELETED, not skipped. The card then read "Not yet marked" with buttons, and
// Save refused ("Please mark attendance for <child>") until the lesson was reopened.
//
// `setAttendance` is a real useState inside the renderHook callback, so the updaters
// run for real against the previous map.
//
// PROVEN RED (§7.25): against the unfixed lib/attendanceBulk.ts, "leaves a holiday
// row's state intact" failed with `Received: undefined` (fixed in d45e84d).
// MUTATION PROOFS — applied to useMarking.ts by mutate.sh, each RED on the named test:
//   U1 `.filter((s) => prev[s.id]?.top !== "holiday")` → `.filter(() => true)`
//      → "never writes the option onto a holiday row"
//   U2 `if (anyMarked) {` → `if (false) {`  → "already marked: asks first"
//   U3 setTop's `top, sub: null },` → `top },` → "setTop clears the sub-type"
import { useState } from "react";
import { act, renderHook } from "@testing-library/react-native";
import { SET_ALL_OPTIONS } from "@/lib/attendanceBulk";
import type { AttState, StudentRow } from "../types";
import { att, confirms, resetHarness, student } from "../testing/saveHarness";

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
import { useMarking } from "./useMarking";

const PRESENT = SET_ALL_OPTIONS.find((o) => o.label === "Present")!;
const RAIN = SET_ALL_OPTIONS.find((o) => o.label === "Cancelled — Rain")!;

const ANNA = student("a", "Anna Tan");
const BEN = student("b", "Ben Lim");
const HANA = student("h", "Hana Goh");

function setup(students: StudentRow[], init: Record<string, AttState>) {
  return renderHook(() => {
    const [attendance, setAttendance] = useState(init);
    return { attendance, ...useMarking(students, attendance, setAttendance) };
  });
}

beforeEach(() => resetHarness());

describe("useMarking — Set all", () => {
  it("an untouched roster: applies at once, no prompt", () => {
    const { result } = setup([ANNA, BEN], { a: att("unmarked"), b: att("unmarked") });
    act(() => result.current.onSetAll(RAIN));

    expect(confirms).toHaveLength(0);
    expect(result.current.attendance).toEqual({ a: att("cancelled", "rain"), b: att("cancelled", "rain") });
  });

  it("already marked: asks first, and applies NOTHING until confirmed", () => {
    const init = { a: att("absent"), b: att("unmarked") };
    const { result } = setup([ANNA, BEN], init);
    act(() => result.current.onSetAll(PRESENT));

    expect(confirms).toHaveLength(1);
    expect(confirms[0].title).toBe("Set all to Present?");
    expect(result.current.attendance).toEqual(init);

    act(() => confirms[0].onConfirm());
    expect(result.current.attendance).toEqual({ a: att("present"), b: att("present") });
  });
});

describe("useMarking — Set all and a public-holiday void", () => {
  const init: Record<string, AttState> = {
    a: att("unmarked"),
    b: att("unmarked"),
    h: att("holiday"),
  };

  function setAllPresent(result: ReturnType<typeof setup>["result"]) {
    act(() => result.current.onSetAll(PRESENT));
    // A holiday row is not "unmarked", so the confirm path runs.
    expect(confirms).toHaveLength(1);
    act(() => confirms[0].onConfirm());
  }

  it("sets every other child to the option", () => {
    const { result } = setup([ANNA, BEN, HANA], init);
    setAllPresent(result);
    expect(result.current.attendance.a).toEqual(att("present"));
    expect(result.current.attendance.b).toEqual(att("present"));
  });

  it("never writes the option onto a holiday row", () => {
    const { result } = setup([ANNA, BEN, HANA], init);
    setAllPresent(result);
    expect(result.current.attendance.h?.top).not.toBe("present");
  });

  it("leaves a holiday row's state intact", () => {
    const { result } = setup([ANNA, BEN, HANA], init);
    setAllPresent(result);
    // toEqual on the whole entry, never `not.toBe("present")` alone — that also
    // passes when the key has been deleted, which was the bug.
    expect(result.current.attendance.h).toEqual(att("holiday"));
  });
});

describe("useMarking — per-row marks", () => {
  it("setTop clears the sub-type", () => {
    const { result } = setup([ANNA], { a: att("cancelled", "rain") });
    act(() => result.current.setTop("a", "trial"));
    expect(result.current.attendance.a).toEqual(att("trial", null));
  });

  it("setSub keeps the top", () => {
    const { result } = setup([ANNA], { a: att("trial", null) });
    act(() => result.current.setSub("a", "free"));
    expect(result.current.attendance.a).toEqual(att("trial", "free"));
  });
});
