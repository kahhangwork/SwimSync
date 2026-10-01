// useMarking — Set all must never touch a public-holiday void.
//
// A holiday row is admin-owned and read-only to a coach (types.ts). onSetAll leaves it
// out of the ids it re-marks, because one refused holiday row fails the whole batch
// save (§7.67). Until 2026-10-02 that was only half the rule: applyBulkStatus returned
// ONLY the ids it was given, and the result replaced the whole map — so the holiday
// row was DELETED, not skipped. The card then read "Not yet marked" with buttons, and
// Save refused ("Please mark attendance for <child>") until the lesson was reopened.
//
// `setAttendance` is a real useState inside the renderHook callback, so the updater
// onSetAll passes runs for real against the previous map.
//
// PROVEN RED (§7.25): against the unfixed lib/attendanceBulk.ts, "leaves a holiday
// row's state intact" failed with the `h` key missing from the map.
import { useState } from "react";
import { act, renderHook } from "@testing-library/react-native";
import { SET_ALL_OPTIONS } from "@/lib/attendanceBulk";
import type { AttState, StudentRow } from "../types";

jest.mock("@/store/useAppStore", () => ({
  useAppStore: (sel: (s: any) => unknown) => sel({ showToast: () => {} }),
}));

const mockConfirms: (() => void)[] = [];
jest.mock("@/lib/confirm", () => ({
  confirmAction: (_t: string, _m: string, onConfirm: () => void) => mockConfirms.push(onConfirm),
}));

// eslint-disable-next-line import/first
import { useMarking } from "./useMarking";

const PRESENT = SET_ALL_OPTIONS.find((o) => o.label === "Present")!;

const students: StudentRow[] = [
  { id: "a", full_name: "Anna Tan" },
  { id: "b", full_name: "Ben Lim" },
  { id: "h", full_name: "Hana Goh" },
];

function setup(init: Record<string, AttState>) {
  return renderHook(() => {
    const [att, setAtt] = useState(init);
    return { att, ...useMarking(students, att, setAtt) };
  });
}

beforeEach(() => {
  mockConfirms.length = 0;
});

describe("useMarking — Set all and a public-holiday void", () => {
  const init: Record<string, AttState> = {
    a: { top: "unmarked", sub: null },
    b: { top: "unmarked", sub: null },
    h: { top: "holiday", sub: null },
  };

  function setAllPresent(result: ReturnType<typeof setup>["result"]) {
    act(() => result.current.onSetAll(PRESENT));
    // A holiday row is not "unmarked", so anyMarked is true and Set all asks first.
    expect(mockConfirms).toHaveLength(1);
    act(() => mockConfirms[0]());
  }

  it("sets every other child to the option", () => {
    const { result } = setup(init);
    setAllPresent(result);
    expect(result.current.att.a).toEqual({ top: "present", sub: null });
    expect(result.current.att.b).toEqual({ top: "present", sub: null });
  });

  it("leaves a holiday row's state intact", () => {
    const { result } = setup(init);
    setAllPresent(result);
    // toEqual on the whole entry, never `not.toBe("present")` — that also passes
    // when the key has been deleted, which was the bug.
    expect(result.current.att.h).toEqual({ top: "holiday", sub: null });
  });
});
